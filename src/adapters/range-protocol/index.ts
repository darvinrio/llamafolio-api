import type { Adapter } from '@lib/adapter'

import * as arbitrum from './arbitrum'
import * as base from './base'
import * as bsc from './bsc'
import * as ethereum from './ethereum'
import * as polygon from './polygon'

const adapter: Adapter = {
  id: 'range-protocol',
  ethereum,
  arbitrum,
  bsc,
  base,
  polygon,
}

export default adapter
