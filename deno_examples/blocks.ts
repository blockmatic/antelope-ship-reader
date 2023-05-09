import { loadReader } from './ship-reader.ts'

const run = async () => {
  const { blocks$, log$, errors$ } = await loadReader()

  console.log('Subscribing to blocks')
  blocks$.subscribe((block) => {
    console.log('============================================================')
    console.log(
      JSON.stringify({
        actions: block.actions?.length,
        table_rows: block.table_rows?.length,
        transactions: block.transactions.length,
      }),
    )
    console.log(block)
  })

  errors$.subscribe(console.log)
  log$.subscribe(console.log)
}

run()
