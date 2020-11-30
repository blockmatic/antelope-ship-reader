import { EosioShipReaderInfo } from '../src'
import { loadReader } from './ship-reader'

const run = async () => {
  const { close$, log$ } = await loadReader()

  log$.subscribe((logInfo: EosioShipReaderInfo) => console.log(logInfo))

  close$.subscribe(() => console.log('connection closed'))
}

run()
