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
  EosioAction,
  EosioReaderState,
  DeserializerMessageParams,
  EosioReaderLightBlock,
  DeserializerResults,
  EosioReaderLightTableRow,
} from './types'
import { serialize } from './serializer'
import { StaticPool } from 'node-worker-threads-pool'
import { deserialize } from './deserializer'
import * as nodeAbieos from '@eosrio/node-abieos'
export * from './types'
import fetch from 'node-fetch'

const defaultShipRequest: EosioShipRequest = {
  start_block_num: 0,
  end_block_num: 0xffffffff,
  max_messages_in_flight: 20,
  have_positions: [],
  irreversible_only: false,
  fetch_block: true,
  fetch_traces: true,
  fetch_deltas: true,
}

export const createEosioShipReader = async (config: EosioReaderConfig) => {
  // check if the contact abis were provided
  const contractNames = [...new Set(config.table_rows_whitelist?.map((row) => row.code))]
  const missingAbis = contractNames.filter((name) => !config.contract_abis?.get(name))

  if (missingAbis.length > 0) {
    throw new Error(`Missing abis for the following contracts ${missingAbis.toString()} in eosio-ship-reader `)
  }

  // TODO: get missing abis from nodeos rpc ?
  if (config.ds_experimental && !nodeAbieos) throw new Error('Only Linux is supported by abieos')

  // eosio-ship-reader state
  const state: EosioReaderState = {
    chain_id: null,
    socket: null,
    eosioAbi: null,
    eosioTypes: null,
    deserializationWorkers: null,
    unconfirmedMessages: 0,
    lastBlock: 0,
    blocksQueue: new PQueue({ concurrency: 1 }),
    shipRequest: { ...defaultShipRequest, ...config.request },
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
  const actions$ = new Subject<EosioAction>()
  const rows$ = new Subject<EosioReaderTableRowsStreamData>()
  const forks$ = new Subject<number>()
  const abis$ = new Subject<RpcInterfaces.Abi>()
  const log$ = new Subject<EosioReaderInfo>()

  // load types
  if (config.ds_experimental && config.contract_abis) {
    config.contract_abis.forEach((contractAbi, contractName) => nodeAbieos.load_abi(contractName, JSON.stringify(contractAbi)))
  }

  // get chain_id
  try {
    const info = await fetch(`${config.rpc_url}/v1/chain/get_info`).then((res: any) => res.json())
    state.chain_id = info.chain_id
  } catch (error) {
    throw new Error('Cannot get info from rpc endpoint')
  }

  // create socket connection with nodeos ship and push event data through rx subjects
  const connectSocket = () => {
    state.socket = new WebSocket(config.ws_url, { perMessageDeflate: false })
    state.socket.on('open', (e: OpenEvent) => open$.next(e))
    state.socket.on('close', (e: CloseEvent) => close$.next(e))
    state.socket.on('error', (e: ErrorEvent) => errors$.next(e))
    state.socket.on('message', (e: string) => messages$.next(e))
  }

  // start streaming
  const start = () => {
    state.blocksQueue.start()
    connectSocket()
  }

  // stop streaming
  const stop = () => {
    if (state.socket) state.socket.removeAllListeners()
    state.eosioAbi = null
    state.eosioTypes = null
    state.blocksQueue.clear()
    state.blocksQueue.pause()
  }

  // reset eosio-ship-reader state
  const reset = () => {
    stop()
    state.unconfirmedMessages = 0
    state.lastBlock = 0
    if (config.ds_experimental && config.contract_abis) {
      nodeAbieos.delete_contract('eosio')
      config.contract_abis.forEach((_contractAbi, contractName) => nodeAbieos.delete_contract(contractName))
    }
  }

  // reset state on close
  // TODO: handle reconnection attempls
  close$.subscribe(reset)

  // filter ship socket messages stream by type (string for abi and )
  const abiMessages$ = messages$.pipe(filter((message: EosioSocketMessage) => typeof message === 'string'))
  const serializedMessages$ = messages$.pipe(filter((message: EosioSocketMessage) => typeof message !== 'string')) // Uint8Array

  // ship sends the abi as string on first message, we need to get the ship types from it
  // types are necessary to deserialize subsequent messages
  abiMessages$.subscribe((message: EosioSocketMessage) => {
    state.eosioAbi = JSON.parse(message as string) as RpcInterfaces.Abi
    state.eosioTypes = Serialize.getTypesFromAbi(Serialize.createInitialTypes(), state.eosioAbi) as EosioTypes

    if (config.ds_experimental) nodeAbieos.load_abi('eosio', message as string)

    // initialize deserialization worker threads once abi is ready
    log$.next({ message: 'Initializing deserialization worker pool', data: { ds_threads: config.ds_threads } })
    state.deserializationWorkers = new StaticPool({
      size: config.ds_threads,
      task: `${__dirname}/../dist/deserializer.js`,
      workerData: {
        abi: state.eosioAbi,
        contract_abis: config.contract_abis,
        ds_experimental: config.ds_experimental,
      },
    })

    const serializedRequest = serialize('request', ['get_blocks_request_v0', state.shipRequest], state.eosioTypes)
    state.socket!.send(serializedRequest)
  })

  // ------------------ handle deserialization --------------------

  const deserializeParallel = async (deserializerParams: DeserializerMessageParams[]): Promise<any> => {
    // This will choose one idle worker in the pool and deserialize whithout blocking the main thread
    const result = (await state.deserializationWorkers?.exec(deserializerParams)) as DeserializerResults
    if (!result.success) throw new Error(result.message)
    return result.data
  }

  // TODO: types
  const deserializeTableRow = async ({ block, row, deserializedRowData }: any) => {
    // check if the table is whitelisted
    const tableWhitelisted = config.table_rows_whitelist?.find((tableRow) => {
      return (
        tableRow.code === deserializedRowData[1].code &&
        (!tableRow.scope || tableRow.scope === deserializedRowData[1].scope) &&
        tableRow.table === deserializedRowData[1].table
      )
    })

    // return if the table is not whitelisted
    if (!tableWhitelisted || !config.contract_abis) return [{ ...row, data: deserializedRowData }, tableWhitelisted]

    // get the correct abi and types for table deserialization
    const tableDeserializationAbi =
      tableWhitelisted.code === 'eosio' ? state.eosioAbi! : config.contract_abis.get(tableWhitelisted.code)
    if (!tableDeserializationAbi) {
      throw new Error('Table deserialization abi not found')
    }

    const tableDeserializationTypes =
      tableWhitelisted.code === 'eosio'
        ? state.eosioTypes
        : (Serialize.getTypesFromAbi(Serialize.createInitialTypes(), tableDeserializationAbi) as EosioTypes)

    const tableDeserializationType = tableDeserializationAbi?.tables?.find(({ name }) => name === tableWhitelisted.table)?.type

    if (!tableDeserializationTypes || !tableDeserializationType) {
      throw new Error('Table deserialization types not found')
    }

    // deserialize table row value
    deserializedRowData[1].value = deserialize({
      code: tableWhitelisted.code,
      type: tableDeserializationType,
      data: deserializedRowData[1].value,
      types: tableDeserializationTypes as EosioTypes,
      ds_experimental: config.ds_experimental,
    })

    rows$.next({ ...block, present: row.present, ...deserializedRowData[1] })

    return [{ ...row, data: deserializedRowData }, tableWhitelisted]
  }

  const deserializeDeltas = async (data: Uint8Array, block: any): Promise<any> => {
    const deltas = await deserializeParallel([{ code: 'eosio', type: 'table_delta[]', data }])
    const lightTableRows: EosioReaderLightTableRow[] = []

    const processedDeltas = await Promise.all(
      deltas[0].map(async (delta: any) => {
        if (delta[0] !== 'table_delta_v0') throw Error(`Unsupported table delta type received ${delta[0]}`)

        // only process whitelisted deltas, return if not in delta_whitelist
        if (config.delta_whitelist?.indexOf(delta[1].name) === -1) return delta

        const deserializedDelta = await deserializeParallel(
          delta[1].rows.map((row: any) => ({
            type: delta[1].name,
            data: row.data,
            code: 'eosio',
          })),
        )

        const fullDeltas = [
          delta[0],
          {
            ...delta[1],
            rows: delta[1].rows.map(async (row: any, index: number) => {
              const deserializedRowData = deserializedDelta[index]

              // return if it's not a contract row delta
              if (deserializedRowData[0] !== 'contract_row_v0') return { ...row, data: deserializedRowData }

              const [tableRow, whitelisted] = await deserializeTableRow({ block, row, deserializedRowData })

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
          },
        ]
        return fullDeltas
      }),
    )

    return [processedDeltas, lightTableRows]
  }

  const deserializeMessage = async (message: EosioSocketMessage) => {
    if (!state.eosioTypes) throw new Error('missing types')

    const [type, response] = deserialize({
      code: 'eosio',
      type: 'result',
      data: message,
      types: state.eosioTypes,
      ds_experimental: config.ds_experimental,
    })

    if (type !== 'get_blocks_result_v0') {
      log$.next({ message: 'Not supported message received', data: { type, response } })
      return
    }

    if (!response?.this_block) {
      log$.next({ message: 'this_block is missing in eosio ship response' })
      return
    }

    // TODO: fix types
    // deserialize blocks, transaction traces and table deltas
    let block: any = null
    let traces: any = []
    let deltas: any = []
    // let lightTraces: any = []
    let lightTableRows: EosioReaderLightTableRow[]
    const lightBlock: EosioReaderLightBlock = { chain_id: state.chain_id, ...response.this_block }

    // TODO: review error handling
    if (response.block) {
      block = await deserializeParallel([{ code: 'eosio', type: 'signed_block', data: response.block }])
    } else if (state.shipRequest.fetch_block) {
      log$.next({ message: `Block #${response.this_block.block_num} does not contain block data` })
    }

    if (response.traces) {
      traces = await deserializeParallel([{ code: 'eosio', type: 'transaction_trace[]', data: response.traces }])
    } else if (state.shipRequest.fetch_traces) {
      log$.next({ message: `Block #${response.this_block.block_num} does not contain trace data` })
    }

    if (response.deltas) {
      [deltas, lightTableRows] = await deserializeDeltas(response.deltas, response.this_block)
      lightBlock.table_rows = lightTableRows
    } else if (state.shipRequest.fetch_deltas) {
      log$.next({ message: `Block #${response.this_block.block_num} does not contain delta data` })
    }

    const blockData: EosioReaderFullBlock = {
      this_block: response.this_block,
      head: response.head,
      last_irreversible: response.last_irreversible,
      prev_block: response.prev_block,
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

  // eosio-ship-reader api
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
