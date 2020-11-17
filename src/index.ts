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
import { deserialize, parallelDeserializer } from 'deserializer'

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
  let deserializeWorkers: StaticPool<Array<{ type: string; data: Uint8Array }>, any>
  let unconfirmedMessages = 0
  let lastBlock = 0
  let currentBlock = 0
  const shipRequest = { ...defaultShipRequest, ...request }

  // create rxjs subjects
  const messages$ = new Subject<string>()
  const errors$ = new Subject<ErrorEvent>()
  const close$ = new Subject<CloseEvent>()
  const open$ = new Subject<OpenEvent>()
  const blocks$ = new Subject<ShipBlockResponse>()
  const forks$ = new Subject<number>()
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

  // SHiP sends the abi as string on first message, we need to get the SHiP types from it
  // types are necessary to deserialize subsequent messages
  abiMessages$.subscribe((message: EosioShipSocketMessage) => {
    abi = JSON.parse(message as string) as RpcInterfaces.Abi
    types = Serialize.getTypesFromAbi(Serialize.createInitialTypes(), abi) as EosioShipTypes

    const serializedRequest = serialize('request', ['get_blocks_request_v0', shipRequest], types)
    socket.send(serializedRequest)
  })

  serializedMessages$.subscribe((message: EosioShipSocketMessage) => {
    if (!types) throw new Error('missing types')

    const [type, response] = deserialize({ type: 'result', data: message, types })

    if (type !== 'get_blocks_result_v0') info$.next({ message: 'Not supported message received', data: { type, response } })

    // deserializeWorkers = new StaticPool({
    //   size: ds_threads,
    //   task: parallelDeserializer,
    //   workerData: {
    //     abi,
    //     types,
    //     message,
    //     options: {
    //       ds_threads,
    //       ds_experimental,
    //     },
    //   },
    // })

    // SHiP requires acknowledment of received blocks
    unconfirmedMessages += 1
    if (unconfirmedMessages >= shipRequest.max_messages_in_flight!) {
      socket.send(serialize('request', ['get_blocks_ack_request_v0', { num_messages: unconfirmedMessages }], types!))
      unconfirmedMessages = 0
    }

    // blocks$.next({})
  })

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
