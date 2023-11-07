const libPath = Deno.realPathSync('./bin/abieos.so')

const abieos = Deno.dlopen(libPath, {
  string_to_name: { parameters: ['pointer'], result: 'u64' },
  abieos_name_to_string: { parameters: ['u64'], result: 'pointer' },
  abieos_get_error: { parameters: [], result: 'pointer' },
  json_to_hex: {
    parameters: ['pointer', 'pointer', 'pointer'],
    result: 'pointer',
  },
  hex_to_json: {
    parameters: ['pointer', 'pointer', 'pointer'],
    result: 'pointer',
  },
  bin_to_json: {
    parameters: ['pointer', 'pointer', 'pointer', 'u32'],
    result: 'pointer',
  },
  load_abi: { parameters: ['pointer', 'pointer'], result: 'bool' },
  load_abi_hex: { parameters: ['pointer', 'pointer'], result: 'bool' },
  get_type_for_action: {
    parameters: ['pointer', 'pointer'],
    result: 'pointer',
  },
  get_type_for_table: {
    parameters: ['pointer', 'pointer'],
    result: 'pointer',
  },
  delete_contract: { parameters: ['pointer'], result: 'bool' },
})

export class AbiEos {
  abieos: any
  constructor() {
    this.abieos = abieos
  }

  cstr2ptr(cstr) {
    const buffer = new Uint8Array([...new TextEncoder().encode(cstr), 0])
    return Deno.UnsafePointer.of(buffer)
  }

  ptr2cstr(ptr) {
    if (ptr.value === 0n) {
      return ''
    }
    return new Deno.UnsafePointerView(ptr).getCString()
  }

  stringToName(nameString) {
    const ptr = this.cstr2ptr(nameString)
    return this.abieos.symbols.string_to_name(ptr)
  }

  jsonToHex(contractName, type, json) {
    const contractPtr = this.cstr2ptr(contractName)
    const typePtr = this.cstr2ptr(type)
    const jsonPtr = this.cstr2ptr(json)
    const resultPtr = this.abieos.symbols.json_to_hex(contractPtr, typePtr, jsonPtr)
    return this.ptr2cstr(resultPtr)
  }

  hexToJson(contractName, type, hex) {
    const contractPtr = this.cstr2ptr(contractName)
    const typePtr = this.cstr2ptr(type)
    const hexPtr = this.cstr2ptr(hex)
    const resultPtr = this.abieos.symbols.hex_to_json(contractPtr, typePtr, hexPtr)
    return this.ptr2cstr(resultPtr)
  }

  binToJson(contractName, type, buffer) {
    const contractPtr = this.cstr2ptr(contractName)
    const typePtr = this.cstr2ptr(type)
    const bufferPtr = Deno.UnsafePointer.of(buffer)
    const size = buffer.byteLength
    const resultPtr = this.abieos.symbols.bin_to_json(contractPtr, typePtr, bufferPtr, size)
    return this.ptr2cstr(resultPtr)
  }

  loadAbi(contractName, abi) {
    const contractPtr = this.cstr2ptr(contractName)
    const abiPtr = this.cstr2ptr(abi)
    return this.abieos.symbols.load_abi(contractPtr, abiPtr)
  }

  loadAbiHex(contractName, abihex) {
    const contractPtr = this.cstr2ptr(contractName)
    const abihexPtr = this.cstr2ptr(abihex)
    return this.abieos.symbols.load_abi_hex(contractPtr, abihexPtr)
  }

  getTypeForAction(contractName, actionName) {
    const contractPtr = this.cstr2ptr(contractName)
    const actionNamePtr = this.cstr2ptr(actionName)
    const resultPtr = this.abieos.symbols.get_type_for_action(contractPtr, actionNamePtr)
    return this.ptr2cstr(resultPtr)
  }

  getTypeForTable(contractName, tableName) {
    const contractPtr = this.cstr2ptr(contractName)
    const tableNamePtr = this.cstr2ptr(tableName)
    const resultPtr = this.abieos.symbols.get_type_for_table(contractPtr, tableNamePtr)
    return this.ptr2cstr(resultPtr)
  }

  deleteContract(contractName) {
    const contractPtr = this.cstr2ptr(contractName)
    return this.abieos.symbols.delete_contract(contractPtr)
  }
}

/*
const abieosInstance = new AbiEos();
const result = abieosInstance.stringToName("abcdefgh");
console.log(result);
*/
