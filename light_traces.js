export default [
  { name: 'account_metadata', rows: [] },
  { name: 'contract_table', rows: [] },
  { name: 'contract_index64', rows: [] },
  { name: 'resource_limits_state', rows: [] },
  { name: 'resource_usage', rows: [] },
  {
    name: 'contract_row',
    rows: [
      {
        present: true,
        data: [
          'contract_row_v0',
          {
            code: 'eosio.token',
            scope: 'eidosonecoin',
            table: 'accounts',
            primary_key: '5459781',
            payer: 'eidosonecoin',
            value: { balance: '0.0000 EOS' },
          },
        ],
      },
      {
        present: true,
        data: [
          'contract_row_v0',
          {
            code: 'eosio.token',
            scope: 'jksqmwdylo2m',
            table: 'accounts',
            primary_key: '5459781',
            payer: 'jksqmwdylo2m',
            value: { balance: '0.8493 EOS' },
          },
        ],
      },
      {
        present: true,
        data: [
          'contract_row_v0',
          {
            code: 'eosio.token',
            scope: 'felixlottery',
            table: 'accounts',
            primary_key: '5459781',
            payer: 'felixlottery',
            value: { balance: '11163.7000 EOS' },
          },
        ],
      },
      {
        present: true,
        data: [
          'contract_row_v0',
          {
            code: 'eosio.token',
            scope: 'felixeosgame',
            table: 'accounts',
            primary_key: '5459781',
            payer: 'felixeosgame',
            value: { balance: '9656.5960 EOS' },
          },
        ],
      },
      {
        present: true,
        data: [
          'contract_row_v0',
          {
            code: 'eosio.token',
            scope: 'whitetea1234',
            table: 'accounts',
            primary_key: '5459781',
            payer: 'whitetea1234',
            value: { balance: '25.0005 EOS' },
          },
        ],
      },
    ],
  },
]
