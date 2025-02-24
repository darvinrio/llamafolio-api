import { getPoolsBalances } from '@adapters/curve-dex/common/balance'
import type { Balance, BalancesContext, BorrowBalance, Contract, LendBalance } from '@lib/adapter'
import { mapSuccessFilter } from '@lib/array'
import { call } from '@lib/call'
import { parseFloatBI } from '@lib/math'
import { multicall } from '@lib/multicall'
import type { Token } from '@lib/token'

const abi = {
  Troves: {
    inputs: [{ internalType: 'address', name: '', type: 'address' }],
    name: 'Troves',
    outputs: [
      { internalType: 'uint256', name: 'debt', type: 'uint256' },
      { internalType: 'uint256', name: 'coll', type: 'uint256' },
      { internalType: 'uint256', name: 'stake', type: 'uint256' },
      { internalType: 'enum TroveManager.Status', name: 'status', type: 'uint8' },
      { internalType: 'uint128', name: 'arrayIndex', type: 'uint128' },
      { internalType: 'uint256', name: 'activeInterestIndex', type: 'uint256' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  accountDeposits: {
    inputs: [{ internalType: 'address', name: '', type: 'address' }],
    name: 'accountDeposits',
    outputs: [
      { internalType: 'uint128', name: 'amount', type: 'uint128' },
      { internalType: 'uint128', name: 'timestamp', type: 'uint128' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  claimableReward: {
    inputs: [{ internalType: 'address', name: 'account', type: 'address' }],
    name: 'claimableReward',
    outputs: [
      { internalType: 'uint256', name: 'prismaAmount', type: 'uint256' },
      { internalType: 'uint256', name: 'crvAmount', type: 'uint256' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  MCR: {
    inputs: [],
    name: 'MCR',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
} as const

const mkUSD: Token = {
  chain: 'ethereum',
  address: '0x4591DBfF62656E7859Afe5e45f6f47D3669fBB28',
  symbol: 'mkUSD',
  decimals: 18,
}

export async function getPrismaLendBalances(ctx: BalancesContext, vaults: Contract[]) {
  const [userBalances, MCRs] = await Promise.all([
    multicall({
      ctx,
      calls: vaults.map((vault) => ({ target: vault.troves, params: [ctx.address] }) as const),
      abi: abi.Troves,
    }),
    multicall({
      ctx,
      calls: vaults.map((vault) => ({ target: vault.troves })),
      abi: abi.MCR,
    }),
  ])

  const balances = mapSuccessFilter(userBalances, (res, idx) => {
    const [debt, coll, _stake, _status, _arrayIndex, _activeInterestIndex] = res.output
    const MCR = MCRs[idx]

    const lendBalance: LendBalance = {
      ...vaults[idx],
      amount: coll,
      underlyings: undefined,
      rewards: undefined,
      category: 'lend',
      MCR: MCR.output != null ? parseFloatBI(MCR.output, 18) : undefined,
    }

    const borrowBalance: BorrowBalance = {
      ...mkUSD,
      amount: debt,
      underlyings: undefined,
      rewards: undefined,
      category: 'borrow',
    }

    return {
      balances: [lendBalance, borrowBalance],
    }
  })

  return balances
}

export async function getPrismaFarmBalance(ctx: BalancesContext, farmer: Contract): Promise<Balance> {
  const userBalance = await call({ ctx, target: farmer.address, params: [ctx.address], abi: abi.accountDeposits })

  return {
    ...farmer,
    amount: userBalance[0],
    underlyings: undefined,
    rewards: undefined,
    category: 'farm',
  }
}

export async function getPrismaFarmBalancesFromConvex(
  ctx: BalancesContext,
  farmers: Contract[],
  registry: Contract,
): Promise<Balance[] | undefined> {
  const poolBalances = await getPoolsBalances(ctx, farmers, registry)

  if (!poolBalances) return

  const userPendingsRewardsRes = await multicall({
    ctx,
    calls: farmers.map((farmer) => ({ target: farmer.address, params: [ctx.address] }) as const),
    abi: abi.claimableReward,
  })

  return mapSuccessFilter(userPendingsRewardsRes, (res, poolIdx) => {
    const poolBalance = poolBalances[poolIdx]
    if (!poolBalance) return null

    let rewards = poolBalance.rewards

    if (rewards) {
      rewards = rewards.map((reward, idx) => ({ ...reward, amount: res.output[idx] }))
    }

    return {
      ...poolBalance,
      rewards,
      category: 'farm',
    }
  })
}
