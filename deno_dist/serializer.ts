import { Serialize } from 'npm:eosjs@22.0.0'
import { TextDecoder, TextEncoder } from 'node:util'
import { EosioTypes } from './types/index.ts'

const encoding = { textEncoder: new TextEncoder(), textDecoder: new TextDecoder() }

export const serialize = (type: string, value: Array<string | {}>, types: EosioTypes) => {
  const buffer = new Serialize.SerialBuffer(encoding)
  Serialize.getType(types, type).serialize(buffer, value)
  return buffer.asUint8Array()
}
