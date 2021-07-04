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
  EosioReaderFullBlock,
  EosioReaderInfo,
  EosioReaderTableRowsStreamData,
  ShipTransactionTrace,
  EosioReaderState,
  EosioReaderLightBlock,
  DeserializerResults,
  EosioReaderLightTableRow,
  ShipTableDelta,
  EosioReaderActionStreamData,
  DeserializerParams,
  DeserializeActionsParams,
  EosioReaderLightAction,
} from './types'
import { serialize } from './serializer'
import { StaticPool } from 'node-worker-threads-pool'
import * as nodeAbieos from '@eosrio/node-abieos'
import fetch from 'node-fetch'

export * from './types'

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

  if (missingAbis.length > 0)
    throw new Error(`Missing abis for the following contracts ${missingAbis.toString()} in eosio-ship-reader `)

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
  const errors$ = new Subject<ErrorEvent>()
  const close$ = new Subject<CloseEvent>()
  const open$ = new Subject<OpenEvent>()
  const blocks$ = new Subject<EosioReaderLightBlock>()
  const fullBlocks$ = new Subject<EosioReaderFullBlock>()
  const deltas$ = new Subject<any>()
  const traces$ = new Subject<ShipTransactionTrace>()
  const actions$ = new Subject<EosioReaderActionStreamData>()
  const rows$ = new Subject<EosioReaderTableRowsStreamData>()
  const forks$ = new Subject<number>()
  const abis$ = new Subject<RpcInterfaces.Abi>()
  const log$ = new Subject<EosioReaderInfo>()

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

    const processed: Array<[any, Array<EosioReaderLightTableRow>]> = await Promise.all(
      deltas.map(async (delta: any) => {
        if (delta[0] !== 'table_delta_v1') throw Error(`Unsupported table delta type received ${delta[0]}`)
        const lightTableRows: EosioReaderLightTableRow[] = []

        // only process whitelisted deltas, return if not in delta_whitelist
        if (config.delta_whitelist().indexOf(delta[1].name) === -1) return [delta, lightTableRows]

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
                if (deserializedRowData[0] !== 'contract_row_v1') return { ...row, data: deserializedRowData }

                // TODO: send array to deserializer, not one by one.
                const [tableRow, whitelisted] = await deserializeTableRow({ block, row, deserializedRowData })

                // TODO: this push might be better inside deserializeTableRow
                if (whitelisted) {
                  const rowDataClone = { ...tableRow.data[1] }
                  delete rowDataClone.payer
                  const lightRow: EosioReaderLightTableRow = {
                    present: tableRow.present,
                    ...rowDataClone,
                  }

                  lightTableRows.push(lightRow)

                  rows$.next({
                    chain_id: state.chain_id,
                    ...block,
                    ...lightRow,
                  })
                }

                return tableRow
              }),
            ),
          },
        ]

        return [fullDeltas, lightTableRows]
      }),
    )

    const processedLightRows: EosioReaderLightTableRow[] = []
    const processedDeltas: ShipTableDelta[] = []

    processed.forEach(([processedDelta, lightRows]) => {
      processedDeltas.push(processedDelta)
      lightRows.forEach((row) => processedLightRows.push(row))
    })

    return [processedDeltas, processedLightRows]
  }

  const deserializeActions = async ({ traces, block_id, block_num }: DeserializeActionsParams) => {
    const allDeserializedActions = await Promise.all(
      traces.map(async ([_a, { id, status, action_traces }]) => {
        if (status !== 0) return undefined // failed transaction

        const whitelistedActionsDeserializerParams: DeserializerParams[] = []
        const deserializedActions: EosioReaderLightAction[] = []

        // deserialize action data of all whitelisted actions
        action_traces.forEach(([_b, { act, receipt }]) => {
          const whitelistedAction = config
            .actions_whitelist()
            .find(({ code, action }) => act.account === code && (action === '*' || act.name === action))

          if (!whitelistedAction) return

          deserializedActions.push({ transaction_id: id, global_sequence: receipt[1].global_sequence, ...act })

          whitelistedActionsDeserializerParams.push({
            code: act.account,
            action: act.name,
            data: act.data,
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

        return deserializedActions
      }),
    )

    return allDeserializedActions.flat().filter((x) => x !== undefined) as EosioReaderLightAction[]
  }

  const deserializeMessage = async (message: EosioSocketMessage) => {
    const [type, deserializedShipMessage] = await deserializeParallel({
      code: 'eosio',
      type: 'result',
      data: message,
    })

    // TODO: double check
    if (type === 'get_blocks_result_v0') {
      log$.next({ message: 'Not supported message received', data: { type, deserializedShipMessage } })
      return
    }

    if (!deserializedShipMessage?.this_block) {
      log$.next({ message: 'this_block is missing in eosio ship deserializedShipMessage' })
      return
    }

    // deserialize blocks, transaction traces and table deltas
    let block: any
    let traces: ShipTransactionTrace[] = []
    let deltas: ShipTableDelta[] = []
    let lightTableRows: EosioReaderLightTableRow[]
    const lightBlock: EosioReaderLightBlock = { chain_id: state.chain_id, ...deserializedShipMessage.this_block }

    // TODO: review error handling
    if (deserializedShipMessage.block) {
      block = await deserializeParallel({ code: 'eosio', type: 'signed_block_variant', data: deserializedShipMessage.block })
    } else if (state.shipRequest.fetch_block) {
      log$.next({ message: `Block #${deserializedShipMessage.this_block.block_num} does not contain block data` })
    }

    if (deserializedShipMessage.traces) {
      traces = await deserializeParallel({ code: 'eosio', type: 'transaction_trace[]', data: deserializedShipMessage.traces })
      lightBlock.actions = await deserializeActions({ traces, ...deserializedShipMessage.this_block })
    } else if (state.shipRequest.fetch_traces) {
      log$.next({ message: `Block #${deserializedShipMessage.this_block.block_num} does not contain trace data` })
    }

    if (deserializedShipMessage.deltas) {
      ;[deltas, lightTableRows] = await deserializeDeltas(deserializedShipMessage.deltas, deserializedShipMessage.this_block)
      lightBlock.table_rows = lightTableRows
    } else if (state.shipRequest.fetch_deltas) {
      log$.next({ message: `Block #${deserializedShipMessage.this_block.block_num} does not contain delta data` })
    }

    const blockData: EosioReaderFullBlock = {
      this_block: deserializedShipMessage.this_block,
      head: deserializedShipMessage.head,
      last_irreversible: deserializedShipMessage.last_irreversible,
      prev_block: deserializedShipMessage.prev_block,
      block,
      traces,
      deltas,
    }

    // Push microfork events
    if (blockData.this_block.block_num <= state.lastBlock) {
      forks$.next(blockData.this_block.block_num)
      log$.next({ message: `Chain fork detected at block ${blockData.this_block.block_num}` })
    }

    // Push block data
    fullBlocks$.next(blockData)
    blocks$.next(lightBlock)

    state.lastBlock = blockData.this_block.block_num
    log$.next({ message: `Processed block ${blockData.this_block.block_num}` })
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
    deltas$,
    traces$,
    rows$,
    actions$,
    forks$,
    open$,
    close$,
    errors$,
    log$,
    abis$,
    fullBlocks$,
  }
}
