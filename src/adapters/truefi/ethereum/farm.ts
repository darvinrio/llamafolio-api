import type { Balance, BalancesContext, Contract } from '@lib/adapter'
import type { Call } from '@lib/multicall'
import { multicall } from '@lib/multicall'
import type { Token } from '@lib/token'

const abi = {
  staked: {
    inputs: [
      {
        internalType: 'contract IERC20',
        name: 'token',
        type: 'address',
      },
      { internalType: 'address', name: 'staker', type: 'address' },
    ],
    name: 'staked',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  claimable: {
    inputs: [
      {
        internalType: 'contract IERC20',
        name: 'token',
        type: 'address',
      },
      { internalType: 'address', name: 'account', type: 'address' },
    ],
    name: 'claimable',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
} as const

const TRU: Token = {
  chain: 'ethereum',
  address: '0x4c19596f5aaff459fa38b0f7ed92f11ae6543784',
  symbol: 'TRU',
  decimals: 8,
}

export async function getFarmBalances(ctx: BalancesContext, pools: Contract[], multifarm: Contract) {
  const balances: Balance[] = []

  const calls: Call<typeof abi.staked>[] = pools.map((pool) => ({
    target: multifarm.address,
    params: [pool.address, ctx.address],
  }))

  const [stakeds, claimables] = await Promise.all([
    multicall({ ctx, calls, abi: abi.staked }),
    multicall({ ctx, calls, abi: abi.claimable }),
  ])

  for (let i = 0; i < pools.length; i++) {
    const pool = pools[i]
    const staked = stakeds[i]
    const underlying = pool.underlyings?.[0]
    const claimable = claimables[i]

    if (staked.success) {
      const amount = (staked.output * pool.poolValue) / pool.totalSupply

      const balance: Balance = {
        ...(pool as Balance),
        amount,
        underlyings: [underlying as Balance],
        rewards: [],
        category: 'farm',
      }

      if (claimable.success) {
        balance.rewards?.push({ ...TRU, amount: claimable.output })
      }

      balances.push(balance)
    }
  }

  return balances
}
