// Get balances of all ERC20 tokens owned by an address.
// Uses the "wallet" adapter internally to narrow down the list of contracts to llamafolio-tokens ("allow list")

import walletAdapter from '@adapters/wallet'
import { client } from '@db/clickhouse'
import { getWalletInteractions } from '@db/contracts'
import { badRequest, serverError, success } from '@handlers/response'
import type { BalancesContext, PricedBalance } from '@lib/adapter'
import { groupBy } from '@lib/array'
import { sanitizeBalances, sanitizePricedBalances, sortBalances, sumBalances } from '@lib/balance'
import type { Chain } from '@lib/chains'
import { chainById, chains as allChains } from '@lib/chains'
import { isHex } from '@lib/contract'
import { getPricedBalances } from '@lib/price'
import { isNotNullish } from '@lib/type'
import type { APIGatewayProxyHandler } from 'aws-lambda'

function formatBalance(balance: any): FormattedBalance {
  return {
    address: balance.address,
    symbol: balance.symbol,
    decimals: balance.decimals,
    price: balance.price,
    amount: balance.amount,
    balanceUSD: balance.balanceUSD,
  }
}

export interface FormattedBalance {
  address: string
  symbol?: string
  decimals?: number
  price?: number
  amount?: string
  balanceUSD?: number
}

export interface BalancesErc20ChainResponse {
  id: Chain
  chainId: number
  balances: FormattedBalance[]
}

export interface BalancesErc20Response {
  updatedAt: string
  chains: BalancesErc20ChainResponse[]
}
export const handler: APIGatewayProxyHandler = async (event, _context) => {
  const address = event.pathParameters?.address as `0x${string}` | undefined
  console.log(`Get balances tokens`, address)
  if (!address) {
    return badRequest('Missing address parameter')
  }
  if (!isHex(address)) {
    return badRequest('Invalid address parameter, expected hex')
  }

  try {
    const tokensByChain = await getWalletInteractions(client, address)

    // add wallet adapter on each non-indexed chain, assuming there was an interaction with each token
    const nonIndexedChains = allChains.filter((chain) => !chain.indexed)
    for (const chain of nonIndexedChains) {
      if (!tokensByChain[chain.id]) {
        tokensByChain[chain.id] = []
      }
    }

    const chains = Object.keys(tokensByChain)

    const chainsBalances = await Promise.all(
      chains
        .filter((chain) => walletAdapter[chain as Chain])
        .map(async (chain) => {
          const handler = walletAdapter[chain as Chain]!

          try {
            const hrstart = process.hrtime()

            const contracts = { erc20: tokensByChain[chain] }

            const ctx: BalancesContext = { address, chain: chain as Chain, adapterId: walletAdapter.id }

            console.log(`[${walletAdapter.id}][${chain}] getBalances ${tokensByChain[chain].length} contracts`)

            const balancesConfig = await handler.getBalances(ctx, contracts)

            const hrend = process.hrtime(hrstart)

            console.log(
              `[${walletAdapter.id}][${chain}] found ${balancesConfig.groups[0].balances.length} balances in %ds %dms`,
              hrend[0],
              hrend[1] / 1000000,
            )

            return balancesConfig.groups[0].balances
          } catch (error) {
            console.error(`[${walletAdapter.id}][${chain}]: Failed to getBalances`, error)
            return
          }
        }),
    )

    const walletBalances = chainsBalances.filter(isNotNullish)

    // Ungroup balances to make only 1 call to the price API
    const balances = walletBalances.flat().filter(isNotNullish)

    const sanitizedBalances = sanitizeBalances(balances)

    const hrstart = process.hrtime()

    const pricedBalances = await getPricedBalances(sanitizedBalances)

    const sanitizedPricedBalances = sanitizePricedBalances(pricedBalances)

    const hrend = process.hrtime(hrstart)

    console.log(
      `getPricedBalances ${sanitizedBalances.length} balances, found ${sanitizedPricedBalances.length} balances in %ds %dms`,
      hrend[0],
      hrend[1] / 1000000,
    )

    const pricedBalancesByChain = groupBy(sanitizedPricedBalances, 'chain')

    const now = new Date()

    const balancesResponse: BalancesErc20Response = {
      updatedAt: now.toISOString(),
      chains: Object.keys(pricedBalancesByChain)
        .map((chain) => {
          const chainInfo = chainById[chain]
          const balances = pricedBalancesByChain[chain] as PricedBalance[]

          return {
            id: chain as Chain,
            chainId: chainInfo.chainId,
            balances: balances.sort(sortBalances).map(formatBalance),
          }
        })
        .sort((a, b) => sumBalances(b.balances) - sumBalances(a.balances)),
    }

    return success(balancesResponse, { maxAge: 20 })
  } catch (error) {
    console.error('Failed to retrieve balances', { error, address })
    return serverError('Failed to retrieve balances', { error })
  }
}
