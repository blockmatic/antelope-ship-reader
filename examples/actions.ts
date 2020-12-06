import { loadReader } from './ship-reader'

const run = async () => {
  const { actions$ } = await loadReader()

  console.log('Subscribing to actions')
  actions$.subscribe((action) => console.log(`${JSON.stringify(action)} \n`))
}

run()
