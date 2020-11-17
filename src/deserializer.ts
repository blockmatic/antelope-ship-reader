import { parentPort, workerData } from 'worker_threads'
import { TextDecoder, TextEncoder } from 'text-encoding'
import { Serialize } from 'eosjs'
import * as nodeAbieos from '@eosrio/node-abieos'
import { EosioShipTypes, DeserializerOptions, EosioShipSocketMessage } from './types'

const deserialize = (type: string, data: Uint8Array | string, abieos: boolean, types: EosioShipTypes) => {
  if (abieos) {
    if (typeof data === 'string') return nodeAbieos.hex_to_json('0', type, data)
    return nodeAbieos.bin_to_json('0', type, Buffer.from(data))
  }

  const dataArray = typeof data === 'string' ? Uint8Array.from(Buffer.from(data, 'hex')) : data
  const buffer = new Serialize.SerialBuffer({ textEncoder: new TextEncoder(), textDecoder: new TextDecoder(), array: dataArray })
  const result = Serialize.getType(types, type).deserialize(buffer, new Serialize.SerializerState({ bytesAsUint8Array: true }))

  if (buffer.readPos !== data.length) {
    throw new Error(`Deserialization error: ${type}`)
  }

  return result
}

export const parallelDeserializer = () => {
  const args: {
    options: DeserializerOptions
    types: EosioShipTypes
    message: EosioShipSocketMessage
    abi: string
  } = workerData

  let abieosSupported = false
  if (args.options.ds_experimental) {
    if (!nodeAbieos) {
      throw new Error('C abi deserializer not supported on this platform. Using eosjs instead')
    } else if (!nodeAbieos.load_abi('0', args.abi)) {
      throw new Error('Failed to load ship ABI in abieos')
    } else {
      abieosSupported = true
    }
  }

  if (!parentPort) throw new Error('worker_threads parentPort is not defined')

  parentPort.on('message', (param: Array<{ type: string; data: Uint8Array | string }>) => {
    try {
      const result = []

      for (const row of param) {
        if (row.data === null) {
          return parentPort!.postMessage({ success: false, message: 'Empty data received on deserialize worker' })
        }

        result.push(deserialize(row.type, row.data, abieosSupported, args.types))
      }

      return parentPort!.postMessage({ success: true, data: result })
    } catch (e) {
      return parentPort!.postMessage({ success: false, message: String(e) })
    }
  })
}
