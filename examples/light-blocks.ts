import { loadReader } from './ship-reader'

const run = async () => {
  const { blocks$, log$, errors$ } = await loadReader()

  console.log('Subscribing to blocks')
  blocks$.subscribe(({ actions, table_rows, block_id }) =>
    console.log(`${JSON.stringify({ block_id, actions: actions?.length, table_rows: table_rows?.length })} \n`),
  )

  errors$.subscribe(console.log)
  log$.subscribe(console.log)
}

run()
