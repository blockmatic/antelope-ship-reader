import WebSocket, { OpenEvent, CloseEvent, ErrorEvent } from 'ws'
import { Subject } from 'rxjs'
import { filter } from 'rxjs/operators'
import { Serialize, RpcInterfaces } from 'eosjs'
import PQueue from 'p-queue'
import {
  EosioShipRequest,
  EosioReaderConfig,
  EosioTypes,
  EosioSocketMessage,
  EosioReaderInfo,
  EosioReaderTableRowsStreamData,
  EosioReaderState,
  EosioReaderBlock,
  DeserializerResults,
  EosioReaderTableRow,
  ShipTableDelta,
  EosioReaderActionStreamData,
  DeserializerParams,
  DeserializeActionsParams,
  EosioReaderAction,
  EosioReaderTransaction,
  EosioReaderTransactionStreamData,
} from './types'
import { serialize } from './serializer'
import { StaticPool } from 'node-worker-threads-pool'
import * as nodeAbieos from '@eosrio/node-abieos'
import fetch from 'node-fetch'
import omit from 'lodash.omit'

export * from './types'
export * from 'rxjs'

const defaultShipRequest: EosioShipRequest = {
  start_block_num: 0,
  end_block_num: 0xffffffff,
  max_messages_in_flight: 20,
  have_positions: [],
  irreversible_only: false,
  fetch_block: true,
  fetch_traces: true,
  fetch_deltas: true,
  fetch_block_header: true,
}

export const createEosioShipReader = async (config: EosioReaderConfig) => {
  // ========================= eosio-ship-reader factory validations ===================================
  const contractNames = [...new Set(config.table_rows_whitelist().map((row) => row.code))]
  const missingAbis = contractNames.filter((name) => !config.contract_abis().get(name))

  if (missingAbis.length > 0) {
    throw new Error(`Missing abis for the following contracts ${missingAbis.toString()} in eosio-ship-reader `)
  }

  if (config.ds_experimental && !nodeAbieos) throw new Error('Only Linux is supported by abieos')

  // ========================= eosio-ship-reader state ===================================
  const state: EosioReaderState = {
    chain_id: null,
    socket: null,
    eosioTypes: null,
    abis: new Map<string, RpcInterfaces.Abi>(config.contract_abis()),
    deserializationWorkers: null,
    unconfirmedMessages: 0,
    lastBlock: 0,
    blocksQueue: new PQueue({ concurrency: 1 }),
    shipRequest: { ...defaultShipRequest, ...config.request },
  }

  try {
    const info = await fetch(`${config.rpc_url}/v1/chain/get_info`).then((res: any) => res.json())
    state.chain_id = info.chain_id
  } catch (error) {
    throw new Error('Cannot get info from rpc endpoint')
  }

  // create rxjs subjects
  const messages$ = new Subject<string>()
  const blocks$ = new Subject<EosioReaderBlock>()
  const transactions$ = new Subject<EosioReaderTransactionStreamData>()
  const actions$ = new Subject<EosioReaderActionStreamData>()
  const rows$ = new Subject<EosioReaderTableRowsStreamData>()
  const forks$ = new Subject<number>()
  const abis$ = new Subject<RpcInterfaces.Abi>()
  const log$ = new Subject<EosioReaderInfo>()
  const errors$ = new Subject<ErrorEvent>()
  const close$ = new Subject<CloseEvent>()
  const open$ = new Subject<OpenEvent>()

  // ========================= eosio-ship-reader methods ===================================

  // create socket connection with nodeos ship and push ws events through rx subjects
  const connectSocket = () => {
    state.socket = new WebSocket(config.ws_url, { perMessageDeflate: false })
    state.socket.on('open', (e: OpenEvent) => open$.next(e))
    state.socket.on('close', (e: CloseEvent) => close$.next(e))
    state.socket.on('error', (e: ErrorEvent) => errors$.next(e))
    state.socket.on('message', (e: string) => messages$.next(e))
  }

  // start streaming
  const start = () => {
    if (config.ds_experimental) {
      state.abis.forEach((contractAbi, contractName) => nodeAbieos.load_abi(contractName, JSON.stringify(contractAbi)))
    }
    state.blocksQueue.start()
    connectSocket()
  }

  // stop streaming
  const stop = () => {
    if (state.socket) state.socket.removeAllListeners()
    state.blocksQueue.clear()
    state.blocksQueue.pause()
  }

  // reset eosio-ship-reader state
  const reset = () => {
    stop()
    state.unconfirmedMessages = 0
    state.lastBlock = 0
    if (config.ds_experimental) {
      state.abis.forEach((_contractAbi, contractName) => nodeAbieos.delete_contract(contractName))
    }
  }

  const deserializeParallel = async (deserializerParams: DeserializerParams | DeserializerParams[]): Promise<any> => {
    // This will choose one idle worker in the pool and deserialize whithout blocking the main thread
    const result = (await state.deserializationWorkers?.exec(deserializerParams)) as DeserializerResults
    if (!result.success) throw new Error(result.message)
    return result.data
  }

  const deserializeTableRow = async ({ _block, row, deserializedRowData }: any) => {
    // check if the table is whitelisted
    const tableWhitelisted = config.table_rows_whitelist().find((tableRow) => {
      return (
        tableRow.code === deserializedRowData[1].code &&
        (!tableRow.scope || tableRow.scope === deserializedRowData[1].scope) &&
        tableRow.table === deserializedRowData[1].table
      )
    })

    // return if the table is not whitelisted
    if (!tableWhitelisted) return [{ ...row, data: deserializedRowData }, tableWhitelisted]

    // deserialize table row value
    deserializedRowData[1].value = await deserializeParallel({
      code: tableWhitelisted.code,
      table: tableWhitelisted.table,
      data: deserializedRowData[1].value,
    })

    return [{ ...row, data: deserializedRowData }, Boolean(tableWhitelisted)]
  }

  const deserializeDeltas = async (data: Uint8Array, block: any): Promise<any> => {
    const deltas = await deserializeParallel({ code: 'eosio', type: 'table_delta[]', data })

    const processed: Array<[any, Array<EosioReaderTableRow>]> = await Promise.all(
      deltas.map(async (delta: any) => {
        if (delta[0] !== 'table_delta_v1') throw Error(`Unsupported table delta type received ${delta[0]}`)
        const tableRows: EosioReaderTableRow[] = []

        // only process whitelisted deltas, return if not in delta_whitelist
        if (config.delta_whitelist().indexOf(delta[1].name) === -1) return [delta, tableRows]

        const deserializerParams: DeserializerParams[] = delta[1].rows.map((row: any) => ({
          type: delta[1].name,
          data: row.data,
          code: 'eosio',
        }))

        const deserializedDelta = await deserializeParallel(deserializerParams)

        const fullDeltas = [
          delta[0],
          {
            ...delta[1],
            rows: await Promise.all(
              delta[1].rows.map(async (row: any, index: number) => {
                const deserializedRowData = deserializedDelta[index]

                // return if it's not a contract row delta
                if (deserializedRowData[0] !== 'contract_row_v0') return { ...row, data: deserializedRowData }

                // TODO: send array to deserializer, not one by one.
                const [tableRow, whitelisted] = await deserializeTableRow({ block, row, deserializedRowData })

                // TODO: this push might be better inside deserializeTableRow
                if (whitelisted) {
                  const rowDataClone = { ...tableRow.data[1] }
                  delete rowDataClone.payer
                  const readerRow: EosioReaderTableRow = {
                    present: tableRow.present,
                    ...rowDataClone,
                  }

                  tableRows.push(readerRow)

                  rows$.next({
                    chain_id: state.chain_id,
                    ...block,
                    ...readerRow,
                  })
                }

                return tableRow
              }),
            ),
          },
        ]

        return [fullDeltas, tableRows]
      }),
    )

    const processedreaderRows: EosioReaderTableRow[] = []
    const processedDeltas: ShipTableDelta[] = []

    processed.forEach(([processedDelta, readerRows]) => {
      processedDeltas.push(processedDelta)
      readerRows.forEach((row) => processedreaderRows.push(row))
    })

    return [processedDeltas, processedreaderRows]
  }

  const deserializeTransactionTraces = async ({
    transaction_traces,
    block_id,
    block_num,
  }: DeserializeActionsParams): Promise<[EosioReaderTransaction[], EosioReaderAction[]]> => {
    const readerTransactions: EosioReaderTransaction[] = []
    const allDeserializedActions = await Promise.all(
      transaction_traces.map(async ([, transaction_trace]) => {
        const { id, status, action_traces, cpu_usage_us, net_usage_words, net_usage } = transaction_trace

        const readerTransaction = {
          transaction_id: id,
          cpu_usage_us,
          net_usage_words,
          net_usage,
        }

        if (status !== 0) return undefined // failed transaction

        const whitelistedActionsDeserializerParams: DeserializerParams[] = []
        const deserializedActions: EosioReaderAction[] = []

        // deserialize action all whitelisted actions
        action_traces.forEach(([_b, action_trace]) => {
          const whitelistedAction = config
            .actions_whitelist()
            .find(({ code, action }) => action_trace.act.account === code && (action === '*' || action_trace.act.name === action))

          if (!whitelistedAction) return

          deserializedActions.push({
            transaction_id: id,
            global_sequence: action_trace.receipt[1]?.global_sequence, // does this make sense ? - Gabo
            receipt: action_trace.receipt[1],
            ...action_trace.act,
            ...omit(action_trace, ['act', 'except', 'error_code', 'receipt']),
          })

          whitelistedActionsDeserializerParams.push({
            code: action_trace.act.account,
            action: action_trace.act.name,
            data: action_trace.act.data,
          })
        })

        const deserializedActionsData = await deserializeParallel(whitelistedActionsDeserializerParams)

        deserializedActionsData.forEach((actionData: any, index: number) => {
          deserializedActions[index].data = actionData
          actions$.next({
            chain_id: state.chain_id!,
            block_id,
            block_num,
            ...deserializedActions[index],
          })
        })

        transactions$.next({
          chain_id: state.chain_id!,
          block_id,
          block_num,
          ...readerTransaction,
          actions: deserializedActions,
        })

        // add transactions if whitelisted actions in this block
        if (deserializedActions.length > 0) readerTransactions.push(readerTransaction)

        return deserializedActions
      }),
    )

    return [readerTransactions, allDeserializedActions.flat().filter((x) => x !== undefined) as EosioReaderAction[]]
  }

  const deserializeMessage = async (message: EosioSocketMessage) => {
    const [type, deserializedShipMessage] = await deserializeParallel({
      code: 'eosio',
      type: 'result',
      data: message,
    })

    // TODO: support all versions
    if (type === 'get_blocks_result_v0') {
      log$.next({ message: 'Not supported message received', data: { type, deserializedShipMessage } })
      return
    }

    if (!deserializedShipMessage?.this_block) {
      log$.next({ message: 'this_block is missing in eosio ship deserializedShipMessage' })
      return
    }

    // deserialize blocks, transaction traces and table deltas
    const block: EosioReaderBlock = { chain_id: state.chain_id, ...deserializedShipMessage.this_block }

    // deserialize signed blocks
    if (deserializedShipMessage.block) {
      const deserializedBlock = await deserializeParallel({
        code: 'eosio',
        type: 'signed_block_variant',
        data: deserializedShipMessage.block,
      })

      console.log('========== deserializedBlock ==========')
      console.log(deserializedBlock)
      block.timestamp = deserializedBlock[1].timestamp
      block.producer = deserializedBlock[1].producer
    } else if (state.shipRequest.fetch_block) {
      log$.next({ message: `Block #${deserializedShipMessage.this_block.block_num} does not contain block data` })
    }

    if (deserializedShipMessage.traces) {
      const traces = await deserializeParallel({
        code: 'eosio',
        type: 'transaction_trace[]',
        data: deserializedShipMessage.traces,
      })

      const [transactions, actions] = await deserializeTransactionTraces({
        transaction_traces: traces,
        ...deserializedShipMessage.this_block,
      })
      block.actions = actions
      block.transactions = transactions
    } else if (state.shipRequest.fetch_traces) {
      log$.next({ message: `Block #${deserializedShipMessage.this_block.block_num} does not contain transaction traces` })
    }

    if (deserializedShipMessage.deltas) {
      const [, tableRows] = await deserializeDeltas(deserializedShipMessage.deltas, deserializedShipMessage.this_block)
      block.table_rows = tableRows
    } else if (state.shipRequest.fetch_deltas) {
      log$.next({ message: `Block #${deserializedShipMessage.this_block.block_num} does not contain deltas` })
    }

    // Push microfork events
    if (deserializedShipMessage.this_block <= state.lastBlock) {
      forks$.next(deserializedShipMessage.this_block)
      log$.next({ message: `Chain fork detected at block ${deserializedShipMessage.this_block}` })
    }

    // Push block data
    blocks$.next(block)

    state.lastBlock = deserializedShipMessage.this_block.block_num
    log$.next({ message: `Processed block ${deserializedShipMessage.this_block.block_num}` })
  }

  // ========================= eosio-ship-reader "effects" ===================================

  // TODO: handle reconnection attempls
  close$.subscribe(reset)

  // filter ship socket messages stream by type (string for abi and )
  const abiMessages$ = messages$.pipe(filter((message: EosioSocketMessage) => typeof message === 'string'))
  const serializedMessages$ = messages$.pipe(filter((message: EosioSocketMessage) => typeof message !== 'string')) // Uint8Array

  // ship sends the abi as string on first message, we need to get the ship types from it
  // types are necessary to deserialize subsequent messages
  abiMessages$.subscribe((message: EosioSocketMessage) => {
    // push eosio abi and types to state
    if (config.ds_experimental) nodeAbieos.load_abi('eosio', message as string)
    const eosioAbi = JSON.parse(message as string) as RpcInterfaces.Abi
    state.eosioTypes = Serialize.getTypesFromAbi(Serialize.createInitialTypes(), eosioAbi) as EosioTypes
    state.abis.set('eosio', eosioAbi)

    // initialize deserialization worker threads once abi is ready
    log$.next({ message: 'Initializing deserialization worker pool', data: { ds_threads: config.ds_threads } })
    state.deserializationWorkers = new StaticPool({
      size: config.ds_threads,
      task: `${__dirname}/../dist/deserializer.js`,
      workerData: {
        abis: state.abis,
        ds_experimental: config.ds_experimental,
      },
    })

    const serializedRequest = serialize('request', ['get_blocks_request_v1', state.shipRequest], state.eosioTypes)
    state.socket!.send(serializedRequest)
  })

  serializedMessages$.subscribe(async (message: EosioSocketMessage) => {
    try {
      // deserialize eosio ship message, blocksQueue helps with block ordering
      state.blocksQueue.add(async () => deserializeMessage(message))

      // ship requires acknowledgement of received blocks
      state.unconfirmedMessages += 1
      if (state.unconfirmedMessages >= state.shipRequest.max_messages_in_flight!) {
        state.socket!.send(
          serialize('request', ['get_blocks_ack_request_v0', { num_messages: state.unconfirmedMessages }], state.eosioTypes!),
        )
        state.unconfirmedMessages = 0
      }
    } catch (error) {
      errors$.next(error)
      stop()
    }
  })

  // auto start
  if (config.auto_start) start()

  // ========================= eosio-ship-reader api ===================================
  return {
    start,
    stop,
    blocks$,
    rows$,
    actions$,
    abis$,
    forks$,
    open$,
    close$,
    errors$,
    log$,
  }
}
