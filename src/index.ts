import WebSocket, { OpenEvent, CloseEvent, ErrorEvent } from 'ws'
import { Subject } from 'rxjs'
import { filter } from 'rxjs/operators'
import { Serialize, RpcInterfaces } from 'eosjs'
import PQueue from 'p-queue'
import {
  EosioShipRequest,
  EosioShipReaderConfig,
  EosioShipTypes,
  EosioShipSocketMessage,
  EosioShipBlock,
  EosioShipReaderInfo,
  EosioShipTableRow,
  ShipTransactionTrace,
  ShipTableDelta,
} from './types'
import { serialize } from './serializer'
import { StaticPool } from 'node-worker-threads-pool'
import { deserialize } from './deserializer'
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
}

export const createEosioShipReader = async ({
  ws_url,
  request,
  ds_threads,
  ds_experimental,
  delta_whitelist,
  table_rows,
  contract_abis,
}: EosioShipReaderConfig) => {
  // check if the contact abis were provided
  const contractNames = [...new Set(table_rows.map((row) => row.code))]
  const missingAbis = contractNames.map((code) => !contract_abis?.find(({ contract_name }) => contract_name === code))
  // TODO: get abis from node if the are missing.
  if (missingAbis.length > 0) throw new Error('Missing abis in eosio-ship-reader')

  // eosio-ship-reader state
  let socket: WebSocket
  let abi: RpcInterfaces.Abi | null
  let types: EosioShipTypes | null
  let deserializationWorkers: StaticPool<Array<{ type: string; data: Uint8Array }>, any>
  let unconfirmedMessages = 0
  const blocksQueue = new PQueue({ concurrency: 1 })
  const shipRequest = { ...defaultShipRequest, ...request }

  // create rxjs subjects
  const messages$ = new Subject<string>()
  const errors$ = new Subject<ErrorEvent>()
  const close$ = new Subject<CloseEvent>()
  const open$ = new Subject<OpenEvent>()
  const blocks$ = new Subject<EosioShipBlock>()
  const deltas$ = new Subject<ShipTableDelta>()
  const traces$ = new Subject<ShipTransactionTrace>()
  const rows$ = new Subject<EosioShipTableRow>()
  const forks$ = new Subject<number>()
  const log$ = new Subject<EosioShipReaderInfo>()

  // create socket connection with nodeos ship and push event data through rx subjects
  const connectSocket = () => {
    socket = new WebSocket(ws_url, { perMessageDeflate: false })
    socket.on('open', (e: OpenEvent) => open$.next(e))
    socket.on('close', (e: CloseEvent) => close$.next(e))
    socket.on('error', (e: ErrorEvent) => errors$.next(e))
    socket.on('message', (e: string) => messages$.next(e))
  }

  // start streaming
  const start = () => {
    blocksQueue.start()
    connectSocket()
  }

  // stop streaming
  const stop = () => {
    socket.removeAllListeners()
    abi = null
    types = null
    blocksQueue.clear()
    blocksQueue.pause()
  }

  // reset eosio-ship-reader state
  const reset = () => {
    stop()
    unconfirmedMessages = 0
  }

  // reset state on close
  // TODO: handle reconnection attempls
  close$.subscribe(reset)

  // filter ship socket messages stream by type (string for abi and )
  const abiMessages$ = messages$.pipe(filter((message: EosioShipSocketMessage) => typeof message === 'string'))
  const serializedMessages$ = messages$.pipe(filter((message: EosioShipSocketMessage) => typeof message !== 'string')) // Uint8Array?

  // ship sends the abi as string on first message, we need to get the ship types from it
  // types are necessary to deserialize subsequent messages
  abiMessages$.subscribe((message: EosioShipSocketMessage) => {
    abi = JSON.parse(message as string) as RpcInterfaces.Abi
    types = Serialize.getTypesFromAbi(Serialize.createInitialTypes(), abi) as EosioShipTypes

    // initialize deserialization worker threads once abi is ready
    log$.next({ message: 'Initializing deserialization worker pool', data: { ds_threads } })
    deserializationWorkers = new StaticPool({
      size: ds_threads,
      task: './dist/deserializer.js',
      workerData: {
        abi,
        options: {
          ds_experimental,
        },
      },
    })

    const serializedRequest = serialize('request', ['get_blocks_request_v0', shipRequest], types)
    socket.send(serializedRequest)
  })

  // ------------------ handle deserialization --------------------
  const deserializeParallel = async (type: string, data: Uint8Array): Promise<any> => {
    const result = await deserializationWorkers.exec([{ type, data }])
    if (!result.success) throw new Error(result.message)
    return result.data[0]
  }

  const deserializeDeltas = async (data: Uint8Array): Promise<any> => {
    const deltas = await deserializeParallel('table_delta[]', data)

    return await Promise.all(
      deltas.map(async (delta: any) => {
        if (delta[0] !== 'table_delta_v0') throw Error(`Unsupported table delta type received ${delta[0]}`)

        if (delta_whitelist.indexOf(delta[1].name) === -1) return delta

        const deserialized = await deserializationWorkers.exec(
          delta[1].rows.map((row: any) => ({
            type: delta[1].name,
            data: row.data,
          })),
        )

        if (!deserialized.success) throw new Error(deserialized.message)

        console.log({ rows: delta[1].rows })

        return [
          delta[0],
          {
            ...delta[1],
            rows: delta[1].rows.map((row: any, index: number) => {
              console.log({ row })
              return {
                ...row,
                data: deserialized.data[index],
              }
            }),
          },
        ]
      }),
    )
  }

  const deserializeMessage = async (message: EosioShipSocketMessage) => {
    if (!types) throw new Error('missing types')

    const [type, response] = deserialize({ type: 'result', data: message, types })

    if (type !== 'get_blocks_result_v0') {
      log$.next({ message: 'Not supported message received', data: { type, response } })
      return
    }

    if (!response?.this_block) {
      log$.next({ message: 'this_block is missing in eosio ship response' })
      return
    }
    // deserialize blocks, transaction traces and table deltas
    let block: any = null
    let traces: any = []
    let deltas: any = []

    if (response.block) {
      block = await deserializeParallel('signed_block', response.block)
    } else if (shipRequest.fetch_block) {
      log$.next({ message: `Block #${response.this_block.block_num} does not contain block data` })
    }

    if (response.traces) {
      traces = await deserializeParallel('transaction_trace[]', response.traces)
    } else if (shipRequest.fetch_traces) {
      log$.next({ message: `Block #${response.this_block.block_num} does not contain trace data` })
    }

    if (response.deltas) {
      deltas = await deserializeDeltas(response.deltas)
    } else if (shipRequest.fetch_deltas) {
      log$.next({ message: `Block #${response.this_block.block_num} does not contain delta data` })
    }

    const blockData: EosioShipBlock = {
      this_block: response.this_block,
      head: response.head,
      last_irreversible: response.last_irreversible,
      prev_block: response.prev_block,
      block: Object.assign(
        { ...response.this_block },
        block,
        { last_irreversible: response.last_irreversible },
        { head: response.head },
      ),
      traces,
      deltas,
    }

    blocks$.next(blockData)
  }

  serializedMessages$.subscribe(async (message: EosioShipSocketMessage) => {
    try {
      // deserialize eosio ship message
      // TODO: review if this is affecting parallelization, this is helping with block ordering
      blocksQueue.add(async () => deserializeMessage(message))

      // ship requires acknowledgement of received blocks
      unconfirmedMessages += 1
      if (unconfirmedMessages >= shipRequest.max_messages_in_flight!) {
        socket.send(serialize('request', ['get_blocks_ack_request_v0', { num_messages: unconfirmedMessages }], types!))
        unconfirmedMessages = 0
      }
    } catch (error) {
      errors$.next(error)
      stop()
    }
  })

  // eosio-ship-reader api
  return {
    start,
    stop,
    blocks$,
    deltas$,
    traces$,
    rows$,
    forks$,
    open$,
    close$,
    errors$,
    log$,
  }
}
