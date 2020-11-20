import { EosioShipReaderConfig, ShipBlockResponse } from '../src/types'
import { ErrorEvent } from 'ws'
import { createEosioShipReader } from '../src/index'
import fetch from 'node-fetch'

const initReader = async () => {
  const info = await fetch('http://127.0.0.1:8888/v1/chain/get_info').then((res) => res.json())
  console.log(info)

  const eosioShipReaderConfig: EosioShipReaderConfig = {
    ws_url: 'ws://localhost:8080',
    ds_threads: 4,
    ds_experimental: false,
    request: {
      start_block_num: info.head_block_num,
      end_block_num: 0xffffffff,
      max_messages_in_flight: 50,
      have_positions: [],
      irreversible_only: false,
      fetch_block: true,s
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

  start()
}

initReader()
