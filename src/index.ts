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
import { serialize, deserialize } from './serialize'
import { StaticPool } from 'node-worker-threads-pool'
import PQueue from 'p-queue'

export const createEosioShipReader = ({ ws_url, request, tick_seconds = 1 }: EosioShipReaderConfig) => {
  // SHiP Subject State
  let socket: WebSocket
  let abi: RpcInterfaces.Abi | null
  let types: EosioShipTypes | null
  let tickIntervalId: NodeJS.Timeout
  const lastBlock = 0
  const currentBlock = 0
  const unconfirmedMessages = 0
  const blocksQueue: PQueue
  const deserializeWorkers: StaticPool<Array<{ type: string; data: Uint8Array }>, any>

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
    const serializedRequest = serialize('request', ['get_blocks_request_v0', { ...defaultShipRequest, ...request }], types)
    socket.send(serializedRequest)
  })

  // SHiP requires acknowledment of received blocks
  const acknowledge = (num_messages: number) => {
    socket.send(serialize('request', ['get_blocks_ack_request_v0', { num_messages }], types))
  }

  serializedMessages$.subscribe((message: EosioShipSocketMessage) => {
    if (!types) throw new Error('missing types')
    const serializedData = message as Uint8Array

    // TODO: parellalized serialization
    // see https://github.com/pinknetworkx/eosio-contract-api/blob/master/src/connections/ship.ts
    const deserializedData = deserialize('result', serializedData, types)

    blocks$.next(deserializedData[1])
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
