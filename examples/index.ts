import { EosioShipReaderConfig, ShipBlockResponse } from '../src/types'
import { ErrorEvent } from 'ws'
import { logger } from './utils/winston'
import { formatSecondsLeft } from './utils/time'
import { createEosioShipReader } from '../src/index'

const eosioShipReaderConfig: EosioShipReaderConfig = {
  ws_url: 'ws://localhost:8080',
  ds_threads: 4,
  ds_experimental: false,
  request: {
    start_block_num: 152774818,
    end_block_num: 0xffffffff,
    max_messages_in_flight: 50,
    have_positions: [],
    irreversible_only: false,
    fetch_block: true,
    fetch_traces: true,
    fetch_deltas: true,
  },
}

const { start, blocks$, close$, errors$ } = createEosioShipReader(eosioShipReaderConfig)

errors$.subscribe((e: ErrorEvent) => console.log(e))

blocks$.subscribe((blockData: ShipBlockResponse) => {
  const { this_block, last_irreversible, head, prev_block, block, traces, deltas } = blockData
  console.log(this_block.block_num)
})

close$.subscribe(() => console.log('connection closed'))

// let lastProcessedBlock: number
// let headBlock: number
// tick$.subscribe(({ currentBlock, lastBlock }: { currentBlock: number; lastBlock: number }) => {
//   const speed = (currentBlock - lastBlock) / eosioShipReaderConfig.tick_seconds
//   if (lastBlock === currentBlock && lastBlock > 0) {
//     logger.warn('Reader - No blocks processed')
//   } else if (currentBlock < lastProcessedBlock) {
//     logger.info(
//       `Reader Progress: ${currentBlock} / ${headBlock} ` +
//         `(${((100 * currentBlock) / headBlock).toFixed(2)}%) ` +
//         `Speed: ${speed.toFixed(1)} B/s ` +
//         `(Syncs ${formatSecondsLeft(Math.floor((headBlock - currentBlock) / speed))})`,
//     )
//   } else {
//     logger.info(`Reader Current Block: ${currentBlock} Speed: ${speed.toFixed(1)} B/s `)
//   }
// })

start()
