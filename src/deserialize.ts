import { parentPort, workerData } from 'worker_threads'
import { TextDecoder, TextEncoder } from 'text-encoding'
import { Serialize } from 'eosjs'
import * as nodeAbieos from '@eosrio/node-abieos'
import { EosioShipTypes, IBlockReaderOptions } from './types'

const args: { options: IBlockReaderOptions; abi: string } = workerData

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

const eosjsTypes: EosioShipTypes = Serialize.getTypesFromAbi(Serialize.createInitialTypes(), JSON.parse(args.abi))

function deserialize(type: string, data: Uint8Array | string): any {
  if (args.options.ds_experimental && abieosSupported) {
    if (typeof data === 'string') {
      return nodeAbieos.hex_to_json('0', type, data)
    }

    return nodeAbieos.bin_to_json('0', type, Buffer.from(data))
  }

  let dataArray
  if (typeof data === 'string') {
    dataArray = Uint8Array.from(Buffer.from(data, 'hex'))
  } else {
    dataArray = data
  }

  const buffer = new Serialize.SerialBuffer({ textEncoder: new TextEncoder(), textDecoder: new TextDecoder(), array: dataArray })
  const result = Serialize.getType(eosjsTypes, type).deserialize(
    buffer,
    new Serialize.SerializerState({ bytesAsUint8Array: true }),
  )

  if (buffer.readPos !== data.length) {
    throw new Error(`Deserialization error: ${type}`)
  }

  return result
}

if (!parentPort) throw new Error('worker_threads parentPort is not defined')

parentPort.on('message', (param: Array<{ type: string; data: Uint8Array | string }>) => {
  try {
    const result = []

    for (const row of param) {
      if (row.data === null) {
        return parentPort!.postMessage({ success: false, message: 'Empty data received on deserialize worker' })
      }

      result.push(deserialize(row.type, row.data))
    }

    return parentPort!.postMessage({ success: true, data: result })
  } catch (e) {
    return parentPort!.postMessage({ success: false, message: String(e) })
  }
})
