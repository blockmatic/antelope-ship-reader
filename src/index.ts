import WebSocket, { OpenEvent, CloseEvent, ErrorEvent } from 'ws'
import { Subject } from 'rxjs'
import { filter } from 'rxjs/operators'
import { Serialize, RpcInterfaces } from 'eosjs'
import {
  EosioShipRequest,
  EosioShipReaderConfig,
  EosioShipTypes,
  EosioShipSocketMessage,
  ShipBlockResponse,
  EosioShipReaderTickData,
  EosioShipReaderInfo,
} from './types'
import { serialize } from './serializer'
import { StaticPool } from 'node-worker-threads-pool'
import { deserialize, parallelDeserializer } from './deserializer'

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

export const createEosioShipReader = ({
  ws_url,
  request,
  tick_seconds = 1,
  ds_threads,
  ds_experimental,
}: EosioShipReaderConfig) => {
  // eosio-ship-reader state
  let socket: WebSocket
  let abi: RpcInterfaces.Abi | null
  let types: EosioShipTypes | null
  let tickIntervalId: NodeJS.Timeout
  // let deserializationWorkers: StaticPool<Array<{ type: string; data: Uint8Array }>, any>
  let deserializationWorkers: StaticPool<number, any>
  let unconfirmedMessages = 0
  let lastBlock = 0
  let currentBlock = 0
  const shipRequest = { ...defaultShipRequest, ...request }
  const deltaWhitelist: string[] = []

  // create rxjs subjects
  const messages$ = new Subject<string>()
  const errors$ = new Subject<ErrorEvent>()
  const close$ = new Subject<CloseEvent>()
  const open$ = new Subject<OpenEvent>()
  const blocks$ = new Subject<ShipBlockResponse>()
  const forks$ = new Subject<number>()
  // tODO review tick and info streams, should we call this log$ ?
  const tick$ = new Subject<EosioShipReaderTickData>()
  const info$ = new Subject<EosioShipReaderInfo>()

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
    connectSocket()
    tickIntervalId = setInterval(() => tick$.next({ lastBlock, currentBlock }), tick_seconds * 1000)
  }

  // stop streaming
  const stop = () => {
    socket.removeAllListeners()
    clearInterval(tickIntervalId)
    abi = null
    types = null
  }

  // reset eosio-ship-reader state
  const reset = () => {
    stop()
    unconfirmedMessages = 0
    lastBlock = 0
    currentBlock = 0
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

    // initialize deserialization worker threads once abi and types are ready
    deserializationWorkers = new StaticPool({
      size: ds_threads,
      task: (n) => n + 1,
      workerData: {
        abi,
        types,
        options: {
          ds_threads,
          ds_experimental,
        },
      },
    })

    const serializedRequest = serialize('request', ['get_blocks_request_v0', shipRequest], types)
    socket.send(serializedRequest)
  })

  // handle serialized messages
  const deserializeParallel = async (type: string, data: Uint8Array): Promise<any> => {
    const result = await deserializationWorkers.exec(1)

    if (result.success) return result.data[0]

    throw new Error(result.message)
  }

  const deserializeDeltas = async (data: Uint8Array): Promise<any> => {
    const deltas = await deserializeParallel('table_delta[]', data)

    return await Promise.all(
      deltas.map(async (delta: any) => {
        if (delta[0] === 'table_delta_v0') {
          if (deltaWhitelist.indexOf(delta[1].name) >= 0) {
            const deserialized = await deserializationWorkers.exec(
              delta[1].rows.map((row: any) => ({
                type: delta[1].name,
                data: row.data,
              })),
            )

            if (!deserialized.success) throw new Error(deserialized.message)

            return [
              delta[0],
              {
                ...delta[1],
                rows: delta[1].rows.map((row: any, index: number) => ({
                  ...row,
                  data: deserialized.data[index],
                })),
              },
            ]
          }

          return delta
        }

        throw Error(`Unsupported table delta type received ${delta[0]}`)
      }),
    )
  }

  serializedMessages$.subscribe(async (message: EosioShipSocketMessage) => {
    if (!types) throw new Error('missing types')

    try {
      // deserialize eosio ship message
      const [type, response] = deserialize({ type: 'result', data: message, types })

      // return and provide info in these cases.
      // TODO: validate is not necessary to update state in these cases
      if (type !== 'get_blocks_result_v0') {
        info$.next({ message: 'Not supported message received', data: { type, response } })
        return
      }

      if (!response?.this_block) {
        info$.next({ message: 'this_block is missing in eosio ship response' })
        return
      }

      // deserialize blocks, transaction traces and table deltas
      let block: any = null
      let traces: any = []
      let deltas: any = []

      if (response.block) {
        block = await deserializeParallel('signed_block', response.block)
      } else if (shipRequest.fetch_block) {
        info$.next({ message: `Block #${response.this_block.block_num} does not contain block data` })
      }

      if (response.traces) {
        traces = await deserializeParallel('transaction_trace[]', response.traces)
      } else if (shipRequest.fetch_traces) {
        info$.next({ message: `Block #${response.this_block.block_num} does not contain trace data` })
      }

      if (response.deltas) {
        deltas = await deserializeDeltas(response.deltas)
      } else if (shipRequest.fetch_deltas) {
        info$.next({ message: `Block #${response.this_block.block_num} does not contain delta data` })
      }

      // ship requires acknowledgement of received blocks
      unconfirmedMessages += 1
      if (unconfirmedMessages >= shipRequest.max_messages_in_flight!) {
        socket.send(serialize('request', ['get_blocks_ack_request_v0', { num_messages: unconfirmedMessages }], types!))
        unconfirmedMessages = 0
      }

      // send block data thru the rxjs subject
      blocks$.next({
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
      })
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
    forks$,
    open$,
    close$,
    errors$,
    tick$,
    info$,
  }
}
