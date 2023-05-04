import { Serialize } from 'npm:eosjs@22.0.0'

export type EosioTypes = Map<string, Serialize.Type>

export type EosioSocketMessage = string | Uint8Array
