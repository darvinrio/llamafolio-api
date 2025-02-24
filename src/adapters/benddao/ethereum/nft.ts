import type { Balance, BalancesContext, BaseContext, Contract } from '@lib/adapter'
import { mapSuccess } from '@lib/array'
import { call } from '@lib/call'
import { ADDRESS_ZERO } from '@lib/contract'
import { abi as erc20Abi } from '@lib/erc20'
import { MAX_UINT_256 } from '@lib/math'
import type { Call } from '@lib/multicall'
import { multicall } from '@lib/multicall'
import type { Token } from '@lib/token'

const abi = {
  getBNFTAssetList: {
    inputs: [],
    name: 'getBNFTAssetList',
    outputs: [{ internalType: 'address[]', name: '', type: 'address[]' }],
    stateMutability: 'view',
    type: 'function',
  },
  bNftProxys: {
    inputs: [{ internalType: 'address', name: '', type: 'address' }],
    name: 'bNftProxys',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  underlyingAsset: {
    inputs: [],
    name: 'underlyingAsset',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  tokenOfOwnerByIndex: {
    inputs: [
      { internalType: 'address', name: 'owner', type: 'address' },
      { internalType: 'uint256', name: 'index', type: 'uint256' },
    ],
    name: 'tokenOfOwnerByIndex',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  tokenURI: {
    constant: true,
    inputs: [{ internalType: 'uint256', name: 'tokenId', type: 'uint256' }],
    name: 'tokenURI',
    outputs: [{ internalType: 'string', name: '', type: 'string' }],
    payable: false,
    stateMutability: 'view',
    type: 'function',
  },
  getNftDebtData: {
    inputs: [
      { internalType: 'address', name: 'nftAsset', type: 'address' },
      { internalType: 'uint256', name: 'nftTokenId', type: 'uint256' },
    ],
    name: 'getNftDebtData',
    outputs: [
      { internalType: 'uint256', name: 'loanId', type: 'uint256' },
      { internalType: 'address', name: 'reserveAsset', type: 'address' },
      { internalType: 'uint256', name: 'totalCollateral', type: 'uint256' },
      { internalType: 'uint256', name: 'totalDebt', type: 'uint256' },
      { internalType: 'uint256', name: 'availableBorrows', type: 'uint256' },
      { internalType: 'uint256', name: 'healthFactor', type: 'uint256' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  getStakedProxies: {
    inputs: [
      { internalType: 'address', name: 'nftAsset', type: 'address' },
      { internalType: 'uint256', name: 'tokenId', type: 'uint256' },
    ],
    name: 'getStakedProxies',
    outputs: [{ internalType: 'address[]', name: '', type: 'address[]' }],
    stateMutability: 'view',
    type: 'function',
  },
  totalStaked: {
    inputs: [
      { internalType: 'contract IStakeProxy', name: 'proxy', type: 'address' },
      { internalType: 'address', name: 'staker', type: 'address' },
    ],
    name: 'totalStaked',
    outputs: [{ internalType: 'uint256', name: 'amount', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  claimable: {
    inputs: [
      { internalType: 'contract IStakeProxy', name: 'proxy', type: 'address' },
      { internalType: 'address', name: 'staker', type: 'address' },
    ],
    name: 'claimable',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
} as const

const weth: Token = {
  chain: 'ethereum',
  address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  decimals: 18,
  symbol: 'WETH',
}

const ape: Token = {
  chain: 'ethereum',
  address: '0x4d224452801ACEd8B2F0aebE155379bb5D594381',
  decimals: 18,
  symbol: 'APE',
}

export async function getNftContracts(ctx: BaseContext, registry: Contract): Promise<Contract[]> {
  const nfts: Contract[] = []

  const nftsAddresses = await call({ ctx, target: registry.address, abi: abi.getBNFTAssetList })

  const nftsProxies = await multicall({
    ctx,
    calls: nftsAddresses.map((nft) => ({ target: registry.address, params: [nft] }) as const),
    abi: abi.bNftProxys,
  })

  const symbolRes = await multicall({
    ctx,
    calls: mapSuccess(nftsProxies, (proxyRes) => ({ target: proxyRes.output })),
    abi: erc20Abi.symbol,
  })

  for (let nftIdx = 0; nftIdx < nftsAddresses.length; nftIdx++) {
    const nftsAddress = nftsAddresses[nftIdx]
    const nftsProxy = nftsProxies[nftIdx]
    const symbol = symbolRes[nftIdx]

    if (!symbol.success) {
      continue
    }

    nfts.push({
      chain: ctx.chain,
      address: nftsAddress,
      proxy: nftsProxy.output,
      decimals: 18,
      symbol: symbol.output,
    })
  }

  return nfts
}

type NFTBalance = Balance & {
  nftId?: string
  proxy?: string
}

export type NFTBorrowBalance = Balance & {
  healthfactor: number | undefined
}

export async function getNftBalances(
  ctx: BalancesContext,
  nfts: Contract[],
  lendPool: Contract,
  apeStaker: Contract,
): Promise<Balance[]> {
  const nftContracts: Contract[] = []
  const nftContractDetails: Contract[] = []

  // Get number of nft contracts owned by the user
  const balancesOfCalls: Call<typeof erc20Abi.balanceOf>[] = nfts.map((nft) => ({
    target: nft.proxy,
    params: [ctx.address],
  }))
  const balancesOfResults = await multicall({ ctx, calls: balancesOfCalls, abi: erc20Abi.balanceOf })

  // Get token ids owned by the user for each nft contract
  const tokenOfOwnerCalls: Call<typeof abi.tokenOfOwnerByIndex>[] = []
  balancesOfResults.forEach((res, idx) => {
    if (res.success && res.output !== 0n) {
      const nftContract = nfts[idx]

      for (let i = 0; i < res.output; i++) {
        nftContracts.push({ ...nftContract, amount: 1 })
        tokenOfOwnerCalls.push({ target: nftContract.proxy, params: [ctx.address, i] })
      }
    }
  })

  const nftsOwnedIdxRes = await multicall({ ctx, calls: tokenOfOwnerCalls, abi: abi.tokenOfOwnerByIndex })

  // Get token URIs for each token id
  const nftURIs = await multicall({
    ctx,
    calls: mapSuccess(nftsOwnedIdxRes, (res) => ({ target: res.input.target, params: [res.output] }) as const),
    abi: abi.tokenURI,
  })

  nftContracts.forEach((balance, idx) => {
    const nftOwnedIdxRes = nftsOwnedIdxRes[idx]
    const nftURI = nftURIs[idx]

    if (nftOwnedIdxRes.success && nftURI.success) {
      nftContractDetails.push({
        ...balance,
        symbol: balance.symbol,
        nftId: nftOwnedIdxRes.output,
        uri: nftURI.output,
      })
    }
  })

  return getNFTLendBorrowBalances(ctx, nftContractDetails, lendPool, apeStaker)
}

const getNFTLendBorrowBalances = async (
  ctx: BalancesContext,
  nfts: Contract[],
  lendPool: Contract,
  apeStaker: Contract,
): Promise<NFTBalance[]> => {
  const nftLendBalances: Balance[] = []
  const nftBorrowBalances: NFTBorrowBalance[] = []

  const calls: Call<typeof abi.getNftDebtData>[] = nfts.map((nft) => ({
    target: lendPool.address,
    params: [nft.address, nft.nftId],
  }))
  const debtBalancesOfsRes = await multicall({ ctx, calls, abi: abi.getNftDebtData })

  nfts.forEach((nft, idx) => {
    const debtBalancesOfRes = debtBalancesOfsRes[idx]

    if (debtBalancesOfRes.success) {
      const [_loanId, _reserveAsset, totalCollateral, totalDebt, _availableBorrows, healthFactor] =
        debtBalancesOfRes.output

      nftLendBalances.push({
        ...nft,
        amount: totalCollateral,
        underlyings: [weth],
        rewards: undefined,
        category: 'lend',
      })

      nftBorrowBalances.push({
        ...nft,
        amount: totalDebt,
        underlyings: [weth],
        rewards: undefined,
        healthfactor: undefined,
        category: 'borrow',
      })

      for (const nftBorrowBalance of nftBorrowBalances) {
        if (healthFactor !== MAX_UINT_256) {
          nftBorrowBalance.healthfactor = Number(healthFactor) / Math.pow(10, 18)
        }
      }
    }
  })

  return apeStakingBalances(ctx, [...nftLendBalances, ...nftBorrowBalances], apeStaker)
}

const apeStakingBalances = async (
  ctx: BalancesContext,
  nftsBalances: NFTBalance[],
  apeStaker: Contract,
): Promise<Balance[]> => {
  const apeBalances: Balance[] = []
  const lendNFTBalances = nftsBalances.filter((balance) => balance.category === 'lend')

  const stakedProxiesRes = await multicall({
    ctx,
    calls: lendNFTBalances.map((nft) =>
      nft.nftId ? ({ target: apeStaker.address, params: [nft.address, BigInt(nft.nftId)] } as const) : null,
    ),
    abi: abi.getStakedProxies,
  })

  const calls: Call<typeof abi.totalStaked>[] = stakedProxiesRes.map((proxy) => ({
    target: apeStaker.address,
    params: proxy.success && proxy.output.length >= 1 ? [proxy.output[0], ctx.address] : [ADDRESS_ZERO, ctx.address],
  }))

  const [totalStakedBalancesRes, claimablesRes] = await Promise.all([
    multicall({ ctx, calls, abi: abi.totalStaked }),
    multicall({ ctx, calls, abi: abi.claimable }),
  ])

  for (let nftIdx = 0; nftIdx < lendNFTBalances.length; nftIdx++) {
    const totalStakedBalanceRes = totalStakedBalancesRes[nftIdx]
    const claimableRes = claimablesRes[nftIdx]

    if (!totalStakedBalanceRes.success || !claimableRes.success) {
      continue
    }

    apeBalances.push({
      ...apeStaker,
      symbol: ape.symbol,
      decimals: ape.decimals,
      amount: totalStakedBalanceRes.output,
      underlyings: [ape],
      rewards: [{ ...ape, amount: claimableRes.output }],
      category: 'stake',
    })
  }

  return [...nftsBalances, ...apeBalances]
}

export async function getNFTHealthFactor(nftsBalances: NFTBorrowBalance[]): Promise<number[]> {
  const healthfactor: number[] = []

  for (const nftsBalance of nftsBalances) {
    if (nftsBalance.healthfactor) {
      healthfactor.push(nftsBalance.healthfactor)
    }
  }

  return healthfactor
}
