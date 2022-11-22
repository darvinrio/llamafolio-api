import { getWStEthStakeBalances } from '@adapters/lido/common/stake'
import { Contract, GetBalancesHandler } from '@lib/adapter'
import { resolveBalances } from '@lib/balance'

const WETHOptimism: Contract = {
  address: '0x4200000000000000000000000000000000000006',
  chain: 'optimism',
  symbol: 'WETH',
  decimals: 18,
  coingeckoId: 'weth',
}

const wstETHOptimism: Contract = {
  name: 'wstETH',
  displayName: 'Wrapped liquid staked Ether 2.0',
  chain: 'optimism',
  address: '0x1F32b1c2345538c0c6f582fCB022739c4A194Ebb',
  symbol: 'wstETH',
  decimals: 18,
  coingeckoId: 'wrapped-steth',
  underlyings: [WETHOptimism],
}

export const getContracts = () => {
  return {
    contracts: {
      wstETHOptimism,
    },
  }
}

export const getBalances: GetBalancesHandler<typeof getContracts> = async (ctx, contracts) => {
  const balances = await resolveBalances<typeof getContracts>(ctx, 'optimism', contracts, {
    wstETHOptimism: getWStEthStakeBalances,
  })

  return {
    balances,
  }
}
