import { parentPort, workerData } from 'worker_threads'
import { TextDecoder, TextEncoder } from 'text-encoding'
import { RpcInterfaces, Serialize } from 'eosjs'
import * as nodeAbieos from '@eosrio/node-abieos'
import { EosioShipTypes, DeserializerWorkerOptions, DeserializeParams } from './types'

export const deserialize = ({ type, data, abieos, types }: DeserializeParams) => {
  if (abieos) {
    if (typeof data === 'string') return nodeAbieos.hex_to_json('0', type, data)
    return nodeAbieos.bin_to_json('0', type, Buffer.from(data))
  }

  const dataArray = typeof data === 'string' ? Uint8Array.from(Buffer.from(data, 'hex')) : data
  const buffer = new Serialize.SerialBuffer({ textEncoder: new TextEncoder(), textDecoder: new TextDecoder(), array: dataArray })
  const result = Serialize.getType(types, type).deserialize(buffer, new Serialize.SerializerState({ bytesAsUint8Array: true }))

  if (buffer.readPos !== data.length) throw new Error(`Deserialization error: ${type}`)

  return result
}

const args: {
  options: DeserializerWorkerOptions
  abi: RpcInterfaces.Abi
} = workerData
const eosioTypes = Serialize.getTypesFromAbi(Serialize.createInitialTypes(), args.abi) as EosioShipTypes

let abieosSupported = false
if (args.options.ds_experimental) {
  if (!nodeAbieos) {
    throw new Error('C abi deserializer not supported on this platform. Using eosjs instead')
  } else if (!nodeAbieos.load_abi('0', JSON.stringify(args.abi))) {
    throw new Error('Failed to load ship ABI in abieos')
  } else {
    abieosSupported = true
  }
}

if (!parentPort) throw new Error('worker_threads parentPort is not defined')

parentPort.on('message', (param: Array<{ type: string; data: Uint8Array | string }>) => {
  console.log('parentPort on message')
  try {
    const result = <any>[]

    for (const row of param) {
      if (row.data === null) {
        return parentPort!.postMessage({ success: false, message: 'Empty data received on deserialize worker' })
      }

      // result.push(deserialize({ type: row.type, data: row.data, abieos: abieosSupported, types: eosioTypes }))
    }

    return parentPort!.postMessage({ success: true, data: result })
  } catch (e) {
    console.log('error', e)
    return parentPort!.postMessage({ success: false, message: String(e) })
  }
})
