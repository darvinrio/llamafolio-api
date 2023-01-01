import { BaseContext, Contract, GetBalancesHandler } from '@lib/adapter'
import { resolveBalances } from '@lib/balance'

import { getPoolsBalances, getPoolsContracts } from '../common/balance'

const MiniChef: Contract = {
  chain: 'fantom',
  address: '0xaeD5b25BE1c3163c907a471082640450F928DDFE',
}

export const getContracts = async (ctx: BaseContext) => {
  const pools = await getPoolsContracts(ctx, MiniChef)

  return {
    contracts: { pools },
  }
}

export const getBalances: GetBalancesHandler<typeof getContracts> = async (ctx, contracts) => {
  const balances = await resolveBalances<typeof getContracts>(ctx, contracts, {
    pools: (...args) => getPoolsBalances(...args, MiniChef),
  })

  return {
    balances,
  }
}
