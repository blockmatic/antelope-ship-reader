import { Serialize } from 'eosjs'
import { TextDecoder, TextEncoder } from 'util'
import { EosioTypes } from './types'

const encoding = { textEncoder: new TextEncoder(), textDecoder: new TextDecoder() }

export const serialize = (type: string, value: Array<string | {}>, types: EosioTypes) => {
  const buffer = new Serialize.SerialBuffer(encoding)
  Serialize.getType(types, type).serialize(buffer, value)
  return buffer.asUint8Array()
}
