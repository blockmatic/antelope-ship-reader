import { parentPort } from 'worker_threads'
import { DeserializeParams } from './types'
import * as nodeAbieos from '@eosrio/node-abieos'

export function deserialize({ type, data }: DeserializeParams) {
  if (typeof data === 'string') return nodeAbieos.hex_to_json('0', type, data)
  return nodeAbieos.bin_to_json('0', type, Buffer.from(data))
}

if (parentPort) {
  // const args: {
  //   abi: RpcInterfaces.Abi
  //   contract_abis: RpcInterfaces.Abi[]
  // } = workerData

  // are the abis loaded here to abieos here on the worker thread.??

  parentPort.on('message', (param: Array<{ type: string; data: Uint8Array | string }>) => {
    try {
      const result = <any>[]

      for (const row of param) {
        if (row.data === null) {
          return parentPort!.postMessage({ success: false, message: 'Empty data received on deserialize worker' })
        }

        result.push(deserialize({ type: row.type, data: row.data }))
      }

      return parentPort!.postMessage({ success: true, data: result })
    } catch (e) {
      console.log('error', e)
      return parentPort!.postMessage({ success: false, message: String(e) })
    }
  })
}
