import path from "path";
import format from "pg-format";
import pool from "../src/db/pool";
import { Adapter } from "../src/lib/adapter";
import { strToBuf } from "../src/lib/buf";
import { sliceIntoChunks } from "../src/lib/array";

function help() {}

async function main() {
  // argv[0]: ts-node
  // argv[1]: revalidate-contracts.ts
  // argv[2]: adapter
  // argv[3]: address
  if (process.argv.length < 3) {
    console.error("Missing adapter argument");
    return help();
  }

  const module = await import(
    path.join(__dirname, "..", "src", "adapters", process.argv[2])
  );
  const adapter = module.default as Adapter;

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

  const client = await pool.connect();

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
  } catch (e) {
    console.log("Failed to revalidate adapter contracts", e);
    await client.query("ROLLBACK");
  } finally {
    client.release(true);
  }
}

main();
