/* eslint-disable no-use-before-define */
export type ShipTransactionTrace = [
  'transaction_trace_v0',
  {
    id: string
    status: number
    cpu_usage_us: number
    net_usage_words: number
    elapsed: number
    net_usage: number
    scheduled: boolean
    action_traces: ShipActionTrace[]
    account_ram_delta: Array<{ account: string; delta: number }> | null
    except: any | null
    error_code: any | null
    failed_dtrx_trace: any | null
    partial: ShipPartialTransaction
  },
]

// this is not out of date, we need to update this types
// there are types for v1
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
    elapsed: number
    console: string
    account_ram_deltas: Array<{ account: string; delta: number }>
    account_disk_deltas: Array<{ account: string; delta: number }>
    code_sequence: number
    abi_sequence: number
    except: any | null
    error_code: any | null
    return_value: string | null // v1
  },
]

export type ShipActionReceiptData = {
  receiver: string
  act_digest: string
  global_sequence: string
  recv_sequence: string
  auth_sequence: Array<{ account: string; sequence: string }>
  code_sequence: number
  abi_sequence: number
}
export type ShipActionReceipt = ['action_receipt_v0', ShipActionReceiptData]

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
