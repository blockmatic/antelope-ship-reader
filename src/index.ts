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
  EosioShipTickData,
} from './types'
import { serialize } from './serializer'
import { StaticPool } from 'node-worker-threads-pool'
import PQueue from 'p-queue'
import { parallelDeserializer } from 'deserializer'

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
  // SHiP Subject State
  let socket: WebSocket
  let abi: RpcInterfaces.Abi | null
  let types: EosioShipTypes | null
  let tickIntervalId: NodeJS.Timeout
  let deserializeWorkers: StaticPool<Array<{ type: string; data: Uint8Array }>, any>
  let unconfirmedMessages = 0
  const lastBlock = 0
  const currentBlock = 0
  const blocksQueue = new PQueue({ concurrency: 1, autoStart: true })
  const shipRequest = { ...defaultShipRequest, ...request }

  // create rxjs subjects
  const messages$ = new Subject<string>()
  const errors$ = new Subject<ErrorEvent>()
  const close$ = new Subject<CloseEvent>()
  const open$ = new Subject<OpenEvent>()
  const blocks$ = new Subject<ShipBlockResponse>()
  const forks$ = new Subject<number>()
  const tick$ = new Subject<EosioShipTickData>()

  // create socket connection with nodeos ship and push event data through rx subjects
  const connect = () => {
    socket = new WebSocket(ws_url, { perMessageDeflate: false })
    socket.on('open', (e: OpenEvent) => open$.next(e))
    socket.on('close', (e: CloseEvent) => close$.next(e))
    socket.on('error', (e: ErrorEvent) => errors$.next(e))
    socket.on('message', (e: string) => messages$.next(e))

    tickIntervalId = setInterval(() => tick$.next({ lastBlock, currentBlock }), tick_seconds * 1000)
  }

  close$.subscribe(() => {
    socket.removeAllListeners()
    clearInterval(tickIntervalId)
    abi = null
    types = null
  })

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

  const acknowledge = (num_messages: number) => {}

  serializedMessages$.subscribe((message: EosioShipSocketMessage) => {
    if (!types) throw new Error('missing types')

    // TODO: parellalized deserialization
    // deserializeWorkers = new StaticPool({
    //   size: ds_threads,
    //   task: parallelDeserializer,
    //   workerData: {
    //     abi,
    //     types,
    //     message,
    //     options: {
    //       min_block_confirmation: 20,
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
    connect,
    blocks$,
    forks$,
    tick$,
    open$,
    close$,
    errors$,
  }
}
