import { BaseContext, GetBalancesHandler } from '@lib/adapter'
import { resolveBalances } from '@lib/balance'
import { getPoolsBalances } from '@lib/pools'
import { Token } from '@lib/token'

import { getGaugesBalances, getGaugesContracts } from '../common/gauges'
import { getPoolsContracts } from '../common/pools'
import { getRegistries } from '../common/registries'

const CRV: Token = {
  chain: 'avax',
  address: '0x249848beca43ac405b8102ec90dd5f22ca513c06',
  decimals: 18,
  symbol: 'CRV.e',
}

export const getContracts = async (ctx: BaseContext) => {
  const registries = await getRegistries(ctx, ['stableSwap', 'stableFactory', 'cryptoSwap'])
  const pools = await getPoolsContracts(ctx, registries)
  const gauges = await getGaugesContracts(ctx, registries, pools, CRV)

  return {
    contracts: {
      pools,
      gauges,
    },
  }
}

export const getBalances: GetBalancesHandler<typeof getContracts> = async (ctx, contracts) => {
  const balances = await resolveBalances<typeof getContracts>(ctx, contracts, {
    pools: (ctx, pools) => getPoolsBalances(ctx, pools, { getPoolAddress: (contract) => contract.pool }),
    gauges: getGaugesBalances,
  })

  return {
    balances,
  }
}
