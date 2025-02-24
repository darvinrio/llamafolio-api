import type { Contract, GetBalancesHandler } from '@lib/adapter'
import type { Token } from '@lib/token'

import { getHealthFactor, getProxiesBalances } from './balances'
import { getCdpidFromProxiesAddresses } from './cdpid'
import { getInstaDappContracts, getMakerContracts } from './proxies'

const InstadAppProxyRegistry: Contract = {
  name: 'InstadApp List',
  chain: 'ethereum',
  address: '0x4c8a1BEb8a87765788946D6B19C6C6355194AbEb',
}

const MakerProxyRegistry: Contract = {
  name: 'Maker Proxy Registry',
  chain: 'ethereum',
  address: '0x4678f0a6958e4D2Bc4F1BAF7Bc52E8F3564f3fE4',
}

const cdpManager: Contract = {
  name: 'Maker CDP Manager',
  chain: 'ethereum',
  address: '0x5ef30b9986345249bc32d8928B7ee64DE9435E39',
}

const getCdps: Contract = {
  name: 'Maker Get CDPS',
  chain: 'ethereum',
  address: '0x36a724Bd100c39f0Ea4D3A20F7097eE01A8Ff573',
  proxy: [MakerProxyRegistry, InstadAppProxyRegistry],
}

const IlkRegistry: Contract = {
  name: 'Maker IlkRegistry',
  chain: 'ethereum',
  address: '0x5a464C28D19848f44199D003BeF5ecc87d090F87',
}

const Spot: Contract = {
  name: 'Maker MCD Spot',
  chain: 'ethereum',
  address: '0x65C79fcB50Ca1594B025960e539eD7A9a6D434A3',
}

const Vat: Contract = {
  name: 'Maker MCD Vat',
  chain: 'ethereum',
  address: '0x35D1b3F3D7966A1DFe207aa4514C12a259A0492B',
}

const DAI: Token = {
  chain: 'ethereum',
  address: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
  decimals: 18,
  symbol: 'DAI',
}

export const getContracts = () => {
  return {
    contracts: { MakerProxyRegistry, InstadAppProxyRegistry, DAI },
  }
}

export const getBalances: GetBalancesHandler<typeof getContracts> = async (ctx) => {
  const proxies = (
    await Promise.all([getMakerContracts(ctx, MakerProxyRegistry), getInstaDappContracts(ctx, InstadAppProxyRegistry)])
  ).flat()

  const cdpid = await getCdpidFromProxiesAddresses(ctx, getCdps, cdpManager, proxies)

  const balancesGroups = await getProxiesBalances(ctx, Vat, IlkRegistry, Spot, cdpid)

  return {
    groups: balancesGroups.map((balances) => ({ balances, healthFactor: getHealthFactor(balances) })),
  }
}
