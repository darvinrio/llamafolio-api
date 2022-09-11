import { APIGatewayProxyHandler } from "aws-lambda";
import format from "pg-format";
import pool from "@db/pool";
import { adapters } from "@adapters/index";
import { invokeLambda, wrapScheduledLambda } from "@lib/lambda";
import { strToBuf } from "@lib/buf";
import { sliceIntoChunks } from "@lib/array";
import { serverError, success } from "./response";

const revalidateAdaptersContracts: APIGatewayProxyHandler = async (
  _event,
  context
) => {
  context.callbackWaitsForEmptyEventLoop = false;

  const client = await pool.connect();

  try {
    const [expiredAdaptersRes, adapterIdsRes] = await Promise.all([
      client.query(
        `select distinct(id) from adapters where contracts_expire_at <= now();`,
        []
      ),
      client.query(`select id from adapters;`, []),
    ]);

    const adapterIds = new Set(adapterIdsRes.rows.map((row) => row.id));

    const revalidateAdapterIds = new Set();

    // revalidate expired adapters
    for (const row of expiredAdaptersRes.rows) {
      revalidateAdapterIds.add(row.id);
    }

    // revalidate new adapters (not stored in our DB yet)
    for (const adapter of adapters) {
      if (!adapterIds.has(adapter.id)) {
        revalidateAdapterIds.add(adapter.id);
      }
    }

    const revalidateAdapterIdsArr = [...revalidateAdapterIds];

    if (revalidateAdapterIdsArr.length > 0) {
      // Run adapters "getContracts" in Lambdas
      for (const adapterId of revalidateAdapterIdsArr) {
        invokeLambda(
          `llamafolio-api-${process.env.stage}-revalidateAdapterContracts`,
          {
            adapterId,
          }
        );
      }
    }

    return success({
      data: revalidateAdapterIdsArr,
    });
  } catch (e) {
    console.error("Failed to revalidate adapters contracts", e);
    return serverError("Failed to revalidate adapters contracts");
  } finally {
    client.release(true);
  }
};

export const scheduledRevalidateAdaptersContracts = wrapScheduledLambda(
  revalidateAdaptersContracts
);

export const revalidateAdapterContracts: APIGatewayProxyHandler = async (
  event,
  context
) => {
  context.callbackWaitsForEmptyEventLoop = false;

  const client = await pool.connect();

  const adapter = adapters.find((adapter) => adapter.id === event.adapterId);
  if (!adapter) {
    console.error(
      `Failed to revalidate adapter contracts, could not find adapter with id: ${event.adapterId}`
    );
    return serverError(
      `Failed to revalidate adapter contracts, could not find adapter with id: ${event.adapterId}`
    );
  }

  const config = await adapter.getContracts();

  let expire_at: Date | null = null;
  if (config.revalidate) {
    expire_at = new Date();
    expire_at.setSeconds(expire_at.getSeconds() + config.revalidate);
  }

  const deleteOldAdapterContractsValues = [[adapter.id]];

  const insertAdapterValues = [[adapter.id, expire_at]];

  const insertAdapterContractsValues = config.contracts.map(
    ({
      name,
      displayName,
      chain,
      address,
      symbol,
      decimals,
      category,
      type,
      stable,
      rewards,
      underlyings,
      ...data
    }) => [
      name?.toString(),
      displayName?.toString(),
      chain,
      strToBuf(address),
      symbol,
      decimals,
      category,
      adapter.id,
      type,
      stable,
      // TODO: validation
      rewards ? JSON.stringify(rewards) : undefined,
      underlyings ? JSON.stringify(underlyings) : undefined,
      // \\u0000 cannot be converted to text
      JSON.parse(JSON.stringify(data).replace(/\\u0000/g, "")),
    ]
  );

  try {
    await client.query("BEGIN");

    // Delete old contracts
    await client.query(
      format(
        "DELETE FROM contracts WHERE adapter_id IN %L;",
        deleteOldAdapterContractsValues
      ),
      []
    );

    // Insert adapter if not exists
    if (insertAdapterValues.length > 0) {
      await client.query(
        format(
          "INSERT INTO adapters (id, contracts_expire_at) VALUES %L ON CONFLICT DO NOTHING;",
          insertAdapterValues
        ),
        []
      );
    }

    // Insert new contracts
    if (insertAdapterContractsValues.length > 0) {
      await Promise.all(
        sliceIntoChunks(insertAdapterContractsValues, 200).map((chunk) =>
          client.query(
            format(
              "INSERT INTO contracts (name, display_name, chain, address, symbol, decimals, category, adapter_id, type, stable, rewards, underlyings, data) VALUES %L ON CONFLICT DO NOTHING;",
              chunk
            ),
            []
          )
        )
      );
    }

    await client.query("COMMIT");

    return success({});
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("Failed to revalidate adapter contracts", e);
    return serverError("Failed to revalidate adapter contracts");
  } finally {
    client.release(true);
  }
};
