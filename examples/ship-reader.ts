import {
  createEosioShipReader,
  EosioReaderAbisMap,
  EosioReaderActionFilter,
  EosioReaderConfig,
  EosioReaderTableRowFilter,
  ShipTableDeltaName,
} from '../src'
import { fetchAbi, getInfo, eosioApi } from './utils'

const table_rows_whitelist: () => EosioReaderTableRowFilter[] = () => [
  { code: 'eosio.token', table: 'accounts' },
  { code: 'bank.bk', scope: 'bank.bk', table: 'appstates' },
  { code: 'bank.bk', scope: 'bank.bk', table: 'exfees' },
  { code: 'bank.bk', scope: 'bank.bk', table: 'fees' },
  { code: 'bank.bk', scope: 'bank.bk', table: 'accounts' },
  { code: 'bank.bk', scope: 'bank.bk', table: 'gpositions' },
  { code: 'bank.bk', scope: 'bank.bk', table: 'limits' },
  { code: 'bank.bk', scope: 'bank.bk', table: 'positions' },
  { code: 'bank.bk', scope: 'bank.bk', table: 'stat' },
]

const actions_whitelist: () => EosioReaderActionFilter[] = () => [
  { code: 'bank.bk', action: '*' },
  { code: 'eosio.token', action: '*' },
]

export const loadReader = async () => {
  const info = await getInfo()
  console.log('chain info',info)
  const unique_contract_names = [...new Set(table_rows_whitelist().map((row) => row.code))]
  const abisArr = await Promise.all(unique_contract_names.map((account_name) => fetchAbi(account_name)))

  const contract_abis: () => EosioReaderAbisMap = () => {
    const numap = new Map()
    abisArr.forEach(({ account_name, abi }) => numap.set(account_name, abi))
    return numap
  }

  const delta_whitelist: () => ShipTableDeltaName[] = () => [
    'account_metadata',
    'contract_table',
    'contract_row',
    'contract_index64',
    'resource_usage',
    'resource_limits_state',
  ]

  const eosioReaderConfig: EosioReaderConfig = {
    ws_url: 'ws://api.np.animus.is:9090',
    rpc_url: eosioApi,
    ds_threads: 6,
    ds_experimental: false,
    delta_whitelist,
    table_rows_whitelist,
    actions_whitelist,
    contract_abis,
    request: {
      start_block_num: 2,
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

  return await createEosioShipReader(eosioReaderConfig)
}
