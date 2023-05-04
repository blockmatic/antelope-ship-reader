import { Buffer } from "node:buffer";
import { parentPort, workerData } from 'node:worker_threads'
import { TextDecoder, TextEncoder } from 'npm:text-encoding@0.7.0'
import { AbiEos as nodeAbieos } from "../deno_dist/abieos.ts"
import { Serialize } from 'npm:eosjs@22.0.0'
import { DeserializeAbieosParams, DeserializeEosjsParams, DeserializerParams, DeserializerWorkerData, EosioTypes } from './types/index.ts'

// NOTE: you need use function instead of arrow here in the deserializer, see Nodejs worker_threads documentation
export function deserializeAbieos({ code, data, type }: DeserializeAbieosParams) {
  //  console.log({ code, data, type })
  return data === 'string' ? nodeAbieos.hex_to_json(code, type, data) : nodeAbieos.bin_to_json(code, type, Buffer.from(data))
}

export function deserializeEosjs({ type, data, types }: DeserializeEosjsParams) {
  const dataArray = typeof data === 'string' ? Uint8Array.from(Buffer.from(data, 'hex')) : data
  const buffer = new Serialize.SerialBuffer({ textEncoder: new TextEncoder(), textDecoder: new TextDecoder(), array: dataArray })
  const result = Serialize.getType(types, type).deserialize(buffer, new Serialize.SerializerState({ bytesAsUint8Array: true }))

  if (buffer.readPos !== data.length) throw new Error(`Deserialization error: ${type}`)

  return result
}

function processDeserializationRequest({ code, data, type, table, action }: DeserializerParams) {
  if (!data) return parentPort!.postMessage({ success: false, message: 'Empty data received on deserialize worker' })
  const args: DeserializerWorkerData = workerData
  // get the correct abi and types for table deserialization
  const deserializationAbi = args.abis.get(code)
  if (!deserializationAbi) {
    return parentPort!.postMessage({ success: false, message: `Deserialization ABI not found for contract ${code}` })
  }

  let deserializationType = type
  if (table) {
    deserializationType = deserializationAbi.tables.find(({ name }) => name === table)?.type
  } else if (action) {
    deserializationType = deserializationAbi.actions.find(({ name }) => name === action)?.type
  }

  if (!deserializationType) return parentPort!.postMessage({ success: false, message: 'Deserialization type not found' })

  let result
  if (args.ds_experimental) {
    result = deserializeAbieos({ code, type: deserializationType, data })
  } else {
    const deserializationTypes = Serialize.getTypesFromAbi(Serialize.createInitialTypes(), deserializationAbi) as EosioTypes
    if (!deserializationTypes) return parentPort!.postMessage({ success: false, message: 'Deserialization types not found' })
    result = deserializeEosjs({ type: deserializationType, data, types: deserializationTypes })
  }
  return result
}

// deserialization workers
if (parentPort) {
  // You can do any heavy stuff here, in a synchronous way without blocking the "main thread"
  parentPort.on('message', (params: DeserializerParams | DeserializerParams[]) => {
    try {
      let result: any[] | any
      if (Array.isArray(params)) {
        result = []
        params.forEach((param) => result.push(processDeserializationRequest(param)))
      } else {
        result = processDeserializationRequest(params)
      }
      return parentPort!.postMessage({ success: true, data: result })
    } catch (e) {
      console.log('error', e)
      return parentPort!.postMessage({ success: false, message: String(e) })
    }
  })
}
