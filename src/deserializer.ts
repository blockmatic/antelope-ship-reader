import { parentPort, workerData } from 'worker_threads'
import { TextDecoder, TextEncoder } from 'text-encoding'
import * as nodeAbieos from '@eosrio/node-abieos'
import { RpcInterfaces, Serialize } from 'eosjs'
import { DeserializeParams, DeserializerMessageParams, EosioShipTypes } from './types'

export function deserialize({ code, type, data, types, ds_experimental }: DeserializeParams) {
  if (ds_experimental) {
    const result =
      typeof data === 'string'
        ? nodeAbieos.hex_to_json(code, type, data)
        : nodeAbieos.bin_to_json('eosio', type, Buffer.from(data))

    return result as any
  }

  const dataArray = typeof data === 'string' ? Uint8Array.from(Buffer.from(data, 'hex')) : data
  const buffer = new Serialize.SerialBuffer({ textEncoder: new TextEncoder(), textDecoder: new TextDecoder(), array: dataArray })
  const result = Serialize.getType(types, type).deserialize(buffer, new Serialize.SerializerState({ bytesAsUint8Array: true }))

  if (buffer.readPos !== data.length) throw new Error(`Deserialization error: ${type}`)

  return result
}

if (parentPort) {
  const args: {
    abi: RpcInterfaces.Abi
    contract_abis: RpcInterfaces.Abi[]
    ds_experimental: boolean
  } = workerData

  const types = Serialize.getTypesFromAbi(Serialize.createInitialTypes(), args.abi) as EosioShipTypes

  parentPort.on('message', (param: DeserializerMessageParams[]) => {
    try {
      const result = <any>[]

      for (const row of param) {
        if (row.data === null) {
          return parentPort!.postMessage({ success: false, message: 'Empty data received on deserialize worker' })
        }

        result.push(deserialize({ code: row.code, type: row.type, data: row.data, types, ds_experimental: args.ds_experimental }))
      }

      return parentPort!.postMessage({ success: true, data: result })
    } catch (e) {
      console.log('error', e)
      return parentPort!.postMessage({ success: false, message: String(e) })
    }
  })
}
