import { EosioShipReaderConfig, EosioShipReaderInfo, ShipBlockData } from '../src/types'
import { ErrorEvent } from 'ws'
import { createEosioShipReader } from '../src/index'
import fetch from 'node-fetch'

const eosioApi = 'http://127.0.0.1:8888'
const eosioRpcRequests = [
  fetch(`${eosioApi}/v1/chain/get_info`).then((res: any) => res.json()),
  fetch(`${eosioApi}/v1/chain/get_abi`, {
    method: 'POST',
    body: JSON.stringify({
      account_name: 'bitcashtests',
    }),
  }).then((res: any) => res.json()),
]
const rpcPromise = Promise.all(eosioRpcRequests)

const initReader = async () => {
  const [info, bitcashtestsAbi] = await rpcPromise

  const eosioShipReaderConfig: EosioShipReaderConfig = {
    ws_url: 'ws://localhost:8080',
    ds_threads: 4,
    ds_experimental: false,
    delta_whitelist: [
      'account_metadata',
      'contract_table',
      'contract_row',
      'contract_index64',
      'resource_usage',
      'resource_limits_state',
    ],
    table_rows_whitelist: [
      { code: 'eosio.token', table: 'accounts' },
      { code: 'bitcashtests', scope: 'bitcashtests', table: 'appstates' },
      { code: 'bitcashtests', scope: 'bitcashtests', table: 'exfees' },
      { code: 'bitcashtests', scope: 'bitcashtests', table: 'fees' },
      { code: 'bitcashtests', scope: 'bitcashtests', table: 'accounts' },
      { code: 'bitcashtests', scope: 'bitcashtests', table: 'gpositions' },
      { code: 'bitcashtests', scope: 'bitcashtests', table: 'limits' },
      { code: 'bitcashtests', scope: 'bitcashtests', table: 'positions' },
      { code: 'bitcashtests', scope: 'bitcashtests', table: 'stat' },
    ],
    contract_abis: [
      {
        code: 'bitcashtests',
        abi: bitcashtestsAbi,
      },
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
    auto_start: true,
  }

  const { blocks$, close$, errors$, log$ } = await createEosioShipReader(eosioShipReaderConfig)

  // stream of block data
  blocks$.subscribe((blockData: ShipBlockData) => {
    console.log(blockData)
    process.exit(1)
  })

  // eosio-ship-reader log info
  log$.subscribe((logInfo: EosioShipReaderInfo) => console.log(logInfo))

  // stream of whitelist table row deltas
  // rows$.subscribe((rowDelta: EosioShipRowDelta) => console.log(rowDelta))

  errors$.subscribe((e: ErrorEvent) => console.log(e))

  close$.subscribe(() => console.log('connection closed'))
}

initReader()
