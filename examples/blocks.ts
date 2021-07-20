import { loadReader } from './ship-reader'

const run = async () => {
  const { blocks$, log$, errors$ } = await loadReader()

  console.log('Subscribing to blocks')
  blocks$.subscribe(({ transactions, actions, table_rows, block_id }) => {
    console.log('============================================================')
    console.log(
      JSON.stringify({
        block_id,
        actions: actions?.length,
        table_rows: table_rows?.length,
        transactions: transactions.length,
      }),
    )
    console.log(JSON.stringify({ transactions, actions, table_rows, block_id }))
  })

  errors$.subscribe(console.log)
  log$.subscribe(console.log)
}

run()
