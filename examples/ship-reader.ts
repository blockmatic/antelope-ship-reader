import { createEosioShipReader, EosioContractAbisMap, EosioShipReaderConfig, EosioShipTableRow } from '../src'
import fetch from 'node-fetch'
import { RpcInterfaces } from 'eosjs'

const eosioApi = 'http://localhost:8888'

const fecthAbi = (account_name: string) =>
  fetch(`${eosioApi}/v1/chain/get_abi`, {
    method: 'POST',
    body: JSON.stringify({
      account_name,
    }),
  }).then(async (res: any) => {
    const response = await res.json()
    return {
      account_name,
      abi: response.abi as RpcInterfaces.Abi,
    }
  })

const table_rows_whitelist: EosioShipTableRow[] = [
  { code: 'eosio.token', table: 'accounts' },
  { code: 'bitcashtests', scope: 'bitcashtests', table: 'appstates' },
  { code: 'bitcashtests', scope: 'bitcashtests', table: 'exfees' },
  { code: 'bitcashtests', scope: 'bitcashtests', table: 'fees' },
  { code: 'bitcashtests', scope: 'bitcashtests', table: 'accounts' },
  { code: 'bitcashtests', scope: 'bitcashtests', table: 'gpositions' },
  { code: 'bitcashtests', scope: 'bitcashtests', table: 'limits' },
  { code: 'bitcashtests', scope: 'bitcashtests', table: 'positions' },
  { code: 'bitcashtests', scope: 'bitcashtests', table: 'stat' },
]

export const loadReader = async () => {
  const info = await fetch(`${eosioApi}/v1/chain/get_info`).then((res: any) => res.json())
  const uniqueContractNames = [...new Set(table_rows_whitelist?.map((row) => row.code))]
  const abisArr = await Promise.all(uniqueContractNames.map((account_name) => fecthAbi(account_name)))

  const contract_abis: EosioContractAbisMap = new Map()
  abisArr.forEach(({ account_name, abi }) => contract_abis.set(account_name, abi))

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
    table_rows_whitelist,
    contract_abis,
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

  return await createEosioShipReader(eosioShipReaderConfig)
}
