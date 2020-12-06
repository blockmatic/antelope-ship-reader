import { RpcInterfaces, Serialize } from 'eosjs'
import { StaticPool } from 'node-worker-threads-pool'
import PQueue from 'p-queue'
import WebSocket from 'ws'

// TODO: Perhaps it would be better to leverage existing types from https://github.com/EOSIO/eosjs/blob/master/src/eosjs-serialize.ts

export type EosioReaderState = {
  chain_id: string | null
  socket: WebSocket | null
  eosioAbi: RpcInterfaces.Abi | null
  eosioTypes: EosioTypes | null
  deserializationWorkers: StaticPool<DeserializerMessageParams[], any> | null
  unconfirmedMessages: number
  lastBlock: number
  blocksQueue: PQueue
  shipRequest: EosioShipRequest
}

export interface EosioShipRequest {
  start_block_num: number
  end_block_num: number
  max_messages_in_flight?: number
  have_positions?: []
  irreversible_only?: boolean
  fetch_block?: boolean
  fetch_traces?: boolean
  fetch_deltas?: boolean
}

export interface EosioReaderActionFilter {
  code: string
  action: string
}

export interface EosioReaderConfig {
  ws_url: string
  rpc_url: string
  ds_threads: number
  ds_experimental?: boolean
  request: EosioShipRequest
  delta_whitelist?: ShipTableDeltaName[]
  table_rows_whitelist?: EosioReaderTableRowFilter[]
  actions_whitelist?: EosioReaderActionFilter[]
  contract_abis?: EosioReaderAbisMap
  auto_start?: boolean
}

export type EosioReaderAbisMap = Map<string, RpcInterfaces.Abi>

export interface EosioReaderInfo {
  message: string
  data?: any
}

export interface EosioReaderTableRowFilter {
  code: string
  scope?: string
  table: string
  json?: boolean
  lower_bound?: string
  upper_bound?: string
}

export type EosioTypes = Map<string, Serialize.Type>

export type EosioSocketMessage = string | Uint8Array

export type DeserializerMessageParams = {
  code: string
  type: string
  data: Uint8Array | string
}

export interface DeserializeParams {
  code: string
  type: string
  data: Uint8Array | string
  types: EosioTypes
  ds_experimental?: boolean
}

export interface DeserializerWorkerData {
  abi: RpcInterfaces.Abi
  contract_abis: EosioReaderAbisMap
  ds_experimental: boolean
}

export interface DeserializerResults {
  success: boolean
  message?: string
  data?: any
}

// TODO: document this approach
export interface EosioReaderLightBlock {
  chain_id: string
  block_num: number
  block_id: string
  transactions?: any[] // light transactions
  actions?: any[] // whitelisted action data
  table_rows?: EosioReaderLightTableRow[]
  abis?: any[] // eosio-ship-sends should handle abi updates.
}

export interface EosioReaderLightTableRow {
  present: string
  code: string
  scope: string
  table: string
  primary_key: string
  value?: any
}

export interface EosioReaderTableRowsStreamData extends EosioReaderLightTableRow {
  chain_id: string
  block_num: number
  block_id: string
}

export interface EosioReaderActionStreamData extends EosioAction {
  chain_id: string
  block_num: number
  block_id: string
  transaction_id: string
}

export interface EosioReaderFullBlock {
  head: { block_num: number; block_id: string }
  last_irreversible: { block_num: number; block_id: string }
  this_block: { block_num: number; block_id: string }
  prev_block: { block_num: number; block_id: string }
  block: ShipBlock
  traces: ShipTransactionTrace[]
  deltas: ShipTableDelta[]
}

export type EosioAction<T = { [key: string]: any } | string> = {
  account: string
  name: string
  authorization: Array<{ actor: string; permission: string }>
  data: T
}

export type EosioActionTrace<T = { [key: string]: any } | string> = {
  action_ordinal: number
  creator_action_ordinal: number
  global_sequence: string
  account_ram_deltas: Array<{ account: string; delta: number }>
  act: EosioAction<T>
}

export type EosioTransaction = {
  id: string
  cpu_usage_us: number
  net_usage_words: number
}

export type EosioTableRow = {
  code: string
  scope: string
  table: string
  primary_key: string
  payer: string
  present: boolean
  value: { [key: string]: any } | string
}

export interface BlockRequestType {
  start_block_num?: number
  end_block_num?: number
  max_messages_in_flight?: number
  have_positions?: any[]
  irreversible_only?: boolean
  fetch_block?: boolean
  fetch_traces?: boolean
  fetch_deltas?: boolean
}

export type ShipBlock = {
  block_num: number
  block_id: string
  head: { block_num: number; block_id: string }
  last_irreversible: { block_num: number; block_id: string }
  timestamp?: string
  producer?: string
  confirmed?: number
  previous?: string
  transaction_mroot?: string
  action_mroot?: string
  schedule_version?: number
  new_producers?: any | null
  header_extensions?: any[]
  producer_signature?: string
  transactions?: any[]
  block_extensions?: any[]
}

export type ShipTransactionTrace = [
  'transaction_trace_v0',
  {
    id: string
    status: number
    cpu_usage_us: number
    net_usage_words: number
    elapsed: string
    net_usage: string
    scheduled: boolean
    action_traces: ShipActionTrace[]
    account_ram_delta: Array<{ account: string; delta: number }> | null
    except: any | null
    error_code: any | null
    failed_dtrx_trace: any | null
    partial: ShipPartialTransaction
  },
]

export type ShipActionTrace = [
  'action_trace_v0',
  {
    action_ordinal: number
    creator_action_ordinal: number
    receipt: ShipActionReceipt
    receiver: string
    act: {
      account: string
      name: string
      authorization: Array<{ actor: string; permission: string }>
      data: string | Uint8Array
    }
    context_free: boolean
    elapsed: string
    console: string
    account_ram_deltas: Array<{ account: string; delta: number }>
    except: any | null
    error_code: any | null
  },
]

export type ShipActionReceipt = [
  'action_receipt_v0',
  {
    receiver: string
    act_digest: string
    global_sequence: string
    recv_sequence: string
    auth_sequence: Array<{ account: string; sequence: string }>
    code_sequence: number
    abi_sequence: number
  },
]

export type ShipPartialTransaction = [
  'partial_transaction_v0',
  {
    expiration: string
    ref_block_num: number
    ref_block_prefix: number
    max_net_usage_words: number
    max_cpu_usage_ms: number
    delay_sec: number
    transaction_extensions: any[]
    signatures: string[]
    context_free_data: any[]
  },
]

export type ShipTableDelta = [
  'table_delta_v0',
  {
    name: ShipTableDeltaName
    rows: Array<{ present: boolean; data: [string, EosioTableRow] }>
  },
]

export type ShipTableDeltaName =
  | 'account_metadata'
  | 'contract_table'
  | 'contract_row'
  | 'contract_index64'
  | 'resource_usage'
  | 'resource_limits_state'

export type ShipContractRow = [
  'contract_row_v0',
  {
    code: string
    scope: string
    table: string
    primary_key: string
    payer: string
    value: Uint8Array | string
  },
]
