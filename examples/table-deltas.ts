import { loadReader } from './ship-reader'

const run = async () => {
  const { deltas$ } = await loadReader()
  deltas$.subscribe((delta) => console.log(`${JSON.stringify(delta)} \n`))
}

run()
