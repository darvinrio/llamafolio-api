/* eslint-disable security/detect-non-literal-fs-filename */
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))

import { chainById, fromDefiLlamaChain } from '@lib/chains'
import { slugify } from '@lib/fmt'
import { fetchProtocolsLite } from '@lib/protocols'
import { isNotNullish } from '@lib/type'

const adapterTemplate = (slug: string, chains: string[]) => `
import type { Adapter } from '@lib/adapter';

${chains.map((chain) => `import * as ${slugify(chain)} from './${chain}'`).join(';')}

const adapter: Adapter = {
  id: '${slug}',
  ${chains.map((chain) => `'${chain}': ${slugify(chain)}`).join(',')}
};

export default adapter;

`

const chainTemplate = `
import type { BaseContext, GetBalancesHandler } from '@lib/adapter'
import { resolveBalances } from '@lib/balance'

export const getContracts = async (ctx: BaseContext) => {
  return {
    // Contracts grouped by keys. They will be passed to getBalances, filtered by user interaction
    contracts: {},
    // Optional revalidate time (in seconds).
    // Contracts returned by the adapter are cached by default and can be updated by interval with this parameter.
    // This is mostly used for Factory contracts, where the number of contracts deployed increases over time
    // revalidate: 60 * 60,
  }
}

export const getBalances: GetBalancesHandler<typeof getContracts> = async (ctx, contracts) => {
  // Any method to check the contracts retrieved above (based on user interaction).
  // This function will be run each time a user queries his balances.
  // As static contracts info is filled in getContracts, this should ideally only fetch the current amount of each contract (+ underlyings and rewards)
  const balances = await resolveBalances<typeof getContracts>(ctx, contracts, {})

  return {
    groups: [{ balances }],
  }
}

`

function help() {
  console.log('pnpm run create-adapter {adapter}')
}

async function main() {
  // argv[0]: node_modules/.bin/tsx
  // argv[1]: create-adapter.ts
  // argv[2]: adapter
  if (process.argv.length < 3) {
    console.error('Missing arguments')
    return help()
  }

  const slug = process.argv[2]
  const dst = path.join(__dirname, '..', 'src', 'adapters', slug)

  const exists = fs.existsSync(dst)

  if (exists) {
    console.error(`Failed to create adapter: ${slug} already exists`)
    return
  }

  const protocols = await fetchProtocolsLite([slug])
  const protocol = protocols[0]

  if (!protocol) {
    console.error(`Failed to create adapter: ${slug} doesn't exist on DefiLlama`)
    console.log(`Create the adapter on DefiLlama first`)
    console.log('https://docs.llama.fi/list-your-project/submit-a-project')
    return
  }

  const chains = protocol.chains.map((chain) => chainById[fromDefiLlamaChain[chain]]?.id).filter(isNotNullish)

  fs.mkdirSync(dst)
  fs.writeFileSync(path.join(dst, 'index.ts'), adapterTemplate(slug, chains))

  for (const chain of chains) {
    fs.mkdirSync(path.join(dst, chain))
    fs.writeFileSync(path.join(dst, chain, 'index.ts'), chainTemplate)
  }

  // format
  execSync(
    `npx prettier --ignore-path .gitignore --ignore-path .prettierignore 'src/adapters/${slug}/**/*.{md,json,js,ts}' --write`,
  )

  console.log(`Successfully created adapter. To try it out run:`)
  console.log('')
  console.log(`npm run adapter ${slug} ethereum 0x0000000000000000000000000000000000000000`)
}

main()
  .then(() => {
    process.exit(0)
  })
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
