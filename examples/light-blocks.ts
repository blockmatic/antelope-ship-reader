import { loadReader } from './ship-reader'

const run = async () => {
  const { blocks$ } = await loadReader()

  console.log('Subscribing to blocks')
  blocks$.subscribe((block) => console.log(`${JSON.stringify(block)} \n`))
}

run()
