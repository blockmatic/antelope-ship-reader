import { EosioShipReaderInfo } from '../src'
import { loadReader } from './ship-reader'
import { getInfo } from './utils'

const run = async () => {
  const { close$, log$, blocks$ } = await loadReader()
  let info = await getInfo()

  setInterval(async () => {
    info = await getInfo()
  }, 250)

  blocks$.subscribe(({ traces }) => {
    console.log(traces)
  })

  log$.subscribe((logInfo: EosioShipReaderInfo) => console.log(logInfo.message, `nodeos head_block_num ${info.head_block_num}`))

  close$.subscribe(() => console.log('connection closed'))
}

run()
