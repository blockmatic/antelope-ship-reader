import { EosioShipReaderConfig, EosioShipBlock } from '../src/types'
import { ErrorEvent } from 'ws'
import { createEosioShipReader } from '../src/index'
import fetch from 'node-fetch'

const initReader = async () => {
  const info = await fetch('http://127.0.0.1:8888/v1/chain/get_info').then((res: any) => res.json())
  console.log(info)

  const eosioShipReaderConfig: EosioShipReaderConfig = {
    ws_url: 'ws://localhost:8080',
    ds_threads: 4,
    ds_experimental: false,
    deltaWhitelist: [
      'account_metadata',
      'contract_table',
      'contract_row',
      'contract_index64',
      'resource_usage',
      'resource_limits_state',
    ],
    tableRows: [
      { code: 'bitcashtests', scope: 'bitcashtests', table: 'appstates' },
      { code: 'bitcashtests', scope: 'bitcashtests', table: 'exfees' },
      { code: 'bitcashtests', scope: 'bitcashtests', table: 'fees' },
      { code: 'bitcashtests', scope: 'bitcashtests', table: 'accounts' },
      { code: 'bitcashtests', scope: 'bitcashtests', table: 'gpositions' },
      { code: 'bitcashtests', scope: 'bitcashtests', table: 'limits' },
      { code: 'bitcashtests', scope: 'bitcashtests', table: 'positions' },
      { code: 'bitcashtests', scope: 'bitcashtests', table: 'stat' },
    ],
    request: {
      start_block_num: info.head_block_num,
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

  blocks$.subscribe((blockData: EosioShipBlock) => {
    const { this_block, deltas } = blockData

    console.log(this_block.block_num)

    // block.transactions?.map(console.log)
    const contract_row_deltas = deltas.find((delta) => delta[1].name === 'contract_row')

    contract_row_deltas &&
      contract_row_deltas.forEach((deltaEntry) => {
        if (typeof deltaEntry !== 'string') {
          deltaEntry.rows.forEach((row) => console.log(row.data))
        }
      })

    process.exit(1)
  })

  close$.subscribe(() => console.log('connection closed'))

  start()
}

initReader()
