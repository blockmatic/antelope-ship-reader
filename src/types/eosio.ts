import { Serialize } from 'eosjs'

export type EosioTypes = Map<string, Serialize.Type>

export type EosioSocketMessage = string | Uint8Array
