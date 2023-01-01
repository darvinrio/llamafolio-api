import { BalancesContext, BaseContext, Contract } from '@lib/adapter'
import { call } from '@lib/call'
import { ethers, utils } from 'ethers'
import { gql, request } from 'graphql-request'

const THE_GRAPH_URL = 'https://api.thegraph.com/subgraphs/name/euler-xyz/euler-mainnet'

const marketsQuery = gql`
  {
    eulerMarketStore(id: "euler-market-store") {
      markets(first: 100) {
        address: id
        name
        symbol
        decimals
        dTokenAddress
        eTokenAddress
        pTokenAddress
      }
    }
  }
`

export async function getMarketsContracts(ctx: BaseContext): Promise<Contract[]> {
  const contracts: Contract[] = []

  const {
    eulerMarketStore: { markets },
  } = await request(THE_GRAPH_URL, marketsQuery)

  for (let marketIdx = 0; marketIdx < markets.length; marketIdx++) {
    contracts.push(
      {
        chain: ctx.chain,
        category: 'lend',
        address: markets[marketIdx].eTokenAddress,
        yieldKey: `${markets[marketIdx].eTokenAddress.toLowerCase()}-euler`,
        underlyings: [markets[marketIdx].address],
      },
      {
        chain: ctx.chain,
        category: 'borrow',
        address: markets[marketIdx].dTokenAddress,
        yieldKey: `${markets[marketIdx].dTokenAddress.toLowerCase()}-euler`,
        underlyings: [markets[marketIdx].address],
      },
    )
  }

  return contracts
}

export async function getHealthFactor(ctx: BalancesContext, lensContract: Contract): Promise<number | undefined> {
  const getHealthFactor = await call({
    chain: ctx.chain,
    target: lensContract.address,
    params: [ctx.address],
    abi: {
      inputs: [{ internalType: 'address', name: 'account', type: 'address' }],
      name: 'getAccountStatus',
      outputs: [
        { internalType: 'uint256', name: 'collateralValue', type: 'uint256' },
        { internalType: 'uint256', name: 'liabilityValue', type: 'uint256' },
        { internalType: 'uint256', name: 'healthScore', type: 'uint256' },
      ],
      stateMutability: 'view',
      type: 'function',
    },
  })

  if (ethers.constants.MaxUint256.eq(getHealthFactor.output.healthScore)) {
    return
  }

  const healthFactor = parseFloat(utils.formatUnits(getHealthFactor.output.healthScore, 18))

  return healthFactor
}
