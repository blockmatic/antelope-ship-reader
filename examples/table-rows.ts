import { filter } from 'rxjs/internal/operators/filter'
import { EosioShipTableRowData } from '../src'
import { loadReader } from './ship-reader'

const run = async () => {
  const { close$, rows$ } = await loadReader()

  // filter ship socket messages stream by type (string for abi and )
  const existingRows$ = rows$.pipe(filter((row: EosioShipTableRowData) => Boolean(row.present)))
  const deletedRows$ = rows$.pipe(filter((row: EosioShipTableRowData) => !Boolean(row.present)))

  existingRows$.subscribe((row: EosioShipTableRowData) => {
    console.log(JSON.stringify(row, null, 2))
  })

  deletedRows$.subscribe((row: EosioShipTableRowData) => {
    console.log('==> deleted row!')
    console.log(JSON.stringify(row, null, 2))
  })

  close$.subscribe(() => console.log('connection closed'))
}

run()
