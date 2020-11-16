// serialization and deserialization helpers
import { Serialize } from 'eosjs'
import { TextDecoder, TextEncoder } from 'util'
import { EosioShipTypes } from './types'

const encoding = { textEncoder: new TextEncoder(), textDecoder: new TextDecoder() }

export const serialize = (type: string, value: Array<string | {}>, types: EosioShipTypes) => {
  const buffer = new Serialize.SerialBuffer(encoding)
  Serialize.getType(types, type).serialize(buffer, value)
  return buffer.asUint8Array()
}

// const serializer = new Serialize.SerializerState({ bytesAsUint8Array: true })
// export function deserialize(type: string, array: Uint8Array, types: Types) {
//   const buffer = new Serialize.SerialBuffer({ ...encoding, array })
//   const result = Serialize.getType(types, type).deserialize(buffer, serializer)
//   if (buffer.readPos !== array.length) throw new Error(`oops: ${type}`)
//   return result
// }
