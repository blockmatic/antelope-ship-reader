/* eslint-disable  no-use-before-define */

import { RpcInterfaces } from 'npm:eosjs@22.0.0'
import { StaticPool } from 'npm:node-worker-threads-pool@1.4.3'
import PQueueModule from 'npm:p-queue@6.6.2'
const PQueue = PQueueModule.default

import WebSocket from 'npm:ws@7.5.2'
import { EosioTypes } from './eosio.ts'
import { EosioShipRequest, ShipActionReceiptData, ShipTableDeltaName, ShipTransactionTrace } from './ship.ts'

export type EosioReaderState = {
  chain_id: string | null
  socket: WebSocket | null
  eosioTypes: EosioTypes | null
  abis: EosioReaderAbisMap
  deserializationWorkers: StaticPool<DeserializerParams | DeserializerParams[], any> | null
  unconfirmedMessages: number
  lastBlock: number
  blocksQueue: PQueue
  shipRequest: EosioShipRequest
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
  delta_whitelist: () => ShipTableDeltaName[]
  table_rows_whitelist: () => EosioReaderTableRowFilter[]
  actions_whitelist: () => EosioReaderActionFilter[]
  contract_abis: () => EosioReaderAbisMap
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
  lower_bound?: string
  upper_bound?: string
}

export interface DeserializeAbieosParams {
  code: string
  type: string
  data: Uint8Array | string
}

export interface DeserializeEosjsParams {
  type: string
  data: Uint8Array | string
  types: EosioTypes
}

export interface DeserializerParams {
  code: string
  type?: string
  table?: string
  action?: string
  data: Uint8Array | string
}

export interface DeserializerWorkerData {
  abis: EosioReaderAbisMap
  ds_experimental: boolean
}

export interface DeserializerResults {
  success: boolean
  message?: string
  data?: any
}

export interface DeserializeActionsParams {
  transaction_traces: ShipTransactionTrace[]
  block_id: string
  block_num: number
}

// TODO: document this approach of whitelisting
export interface EosioReaderBlock {
  chain_id: string
  block_num: number
  block_id: string
  timestamp: string
  producer: string
  transactions: EosioReaderTransaction[]
  actions: EosioReaderAction[] // whitelisted action data
  table_rows: EosioReaderTableRow[] // whitelisted table data
  abis: any[]
}

export interface EosioReaderTransaction {
  transaction_id: string
  cpu_usage_us: number
  net_usage_words: number
  net_usage: number
}

export interface EosioReaderTableRow {
  present: string
  code: string
  scope: string
  table: string
  primary_key: string
  value?: any
}

export interface EosioReaderTableRowsStreamData extends EosioReaderTableRow {
  chain_id: string
  block_num: number
  block_id: string
}

export interface EosioReaderActionStreamData extends EosioReaderAction {
  chain_id: string
  block_num: number
  block_id: string
}

export interface EosioReaderTransactionStreamData extends EosioReaderTransaction {
  chain_id: string
  block_num: number
  block_id: string
  actions: EosioReaderAction[]
}

export interface EosioReaderAction<T = { [key: string]: any } | string> {
  transaction_id: string
  account: string
  name: string
  authorization: Array<{ actor: string; permission: string }>
  data: T
  action_ordinal: number
  global_sequence: string
  account_ram_deltas: Array<{ account: string; delta: number }>
  account_disk_deltas: Array<{ account: string; delta: number }>
  console: string
  return_value: string | null
  receipt: ShipActionReceiptData
  creator_action_ordinal: number
  code_sequence: number
  abi_sequence: number
  context_free: boolean
  elapsed: number
}
