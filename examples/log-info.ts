import { loadReader } from './ship-reader'
import { getInfo } from './utils'

const run = async () => {
  const { close$, log$, blocks$ } = await loadReader()
  let info = await getInfo()

  setInterval(async () => {
    info = await getInfo()
  }, 250)

  blocks$.subscribe(({ actions, table_rows, block_id }) =>
    console.log(`${JSON.stringify({ block_id, actions: actions?.length, table_rows: table_rows?.length })} \n`),
  )

  log$.subscribe(({ message }) => console.log(message, `nodeos head_block_num ${info.head_block_num}`))

  close$.subscribe(() => console.log('connection closed'))
}

run()
