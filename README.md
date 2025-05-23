# Reactive Antelope State Reader

`eosio-ship-reader` is a multi-threaded reactive eosio state reader written in typescript using on rxjs and `worker_threads`.

This package allows you to subscribe to JSON streams of EOSIO state data and events in NodeJS applications. By connecting to the EOSIO State History websocket and deserializing it's binary messages using nodejs worker_threads to parellalize execution we are able to achieve performance required to build real-time services.

By default it is streams `signed_block` data.

## Understanding ABIs

The Application Binary Interface (ABI) is a JSON-based description on how to convert user actions between their JSON and Binary representations. The ABI also describes how to convert the database state to/from JSON. Once you have described your contract via an ABI then developers and users will be able to interact with your contract seamlessly via JSON.

[Understanding ABI - EOSIO Developers](https://developers.eos.io/welcome/latest/getting-started/smart-contract-development/understanding-ABI-files)

## EOSIO Transactions Protocol

https://developers.eos.io/welcome/v2.0/protocol/transactions_protocol

## Demux Pattern

Deterministic event-sourced state and side effect handling for blockchain applications.

Demux is a backend infrastructure pattern for sourcing blockchain events to deterministically update queryable datastores and trigger side effects. In computer science, a deterministic algorithm is an algorithm which, given a particular input, will always produce the same output, with the underlying machine always passing through the same sequence of states.

Storing and retrieving indexed data is something that developers have commonly utilized for decades. The ability to search, sort, filter, etc. are all easily done in traditional database environments, but is something that is missed when working directly with the inherently limited query interface of blockchain nodes.

Demux allows deterministic updates of queryable data stores and event triggers through real-time subscriptions to EOSIO blockchain actions and state deltas using the state_history_plugin web socket and RxJS observable streams.

With the Demux pattern, we can separate concerns and utilize the technology more appropriate to solve them. The blockchain provides decentralized consensus and high security and it's treated at the single source of truth.

Storing blockchain historical data in queryable datastores is useful because:

- The query interface used to retrieve the indexed data is directly from the blockchain is limited. Complex data requirements can mean you either have to make an excessive number of queries and process the data on the client, or you must store additional derivative data on the blockchain itself.
- Scaling your query load means creating more blockchain endpoint nodes, which can be very expensive.

Demux solves these problems by off-loading queries to any persistence layer that you want. By deriving all state from the blockchain we gain the following benefits:

- If the accumulated datastore is lost or deleted, it may be regenerated by replaying blockchain actions
- As long as application code is open source, and the blockchain is public, all application state can be audited
- No need to maintain multiple ways of updating state (submitting transactions is the sole way)

eosio-ship-reader is a reactive alternative to the [DemuxJS](https://github.com/EOSIO/demux-js) library developed by Block.one

## EOSIO State History Plugin

State history plugin for nodeos is part of EOSIO distribution. It stores all transaction traces and table deltas in compressed archive files and provides a websocket interface for querying the traces and deltas for a specific block interval. The plugin listens on a socket for applications to connect and sends blockchain data back based on the plugin options specified when starting nodeos. If the end block number is in the future, the plugin delivers new traces as they become available in real-time. It has also an option to deliver only traces from irreversible blocks.

The data that is exported via this websocket interface is in binary form. The plugin is designed to spend as little as possible CPU time on interpreting the data, so it’s the job of the client to decode the output and process into a usable form. Action arguments are delivered in serialized form, in the same binary form as they are submitted to the smart contract. The same applies to table deltas: the plugin does not try to interpret the contract table contents, it just sends you modified rows as they are stored in server memory.

So, to be able to interpret its output, the client software has to have copies of ABI that the smart contracts are publishing. The ABI is delivered in the same binary form as part of contract data changes when setabi action is executed. As smart contracts and ABI get updated, the client software needs to maintain relevant revisions of ABI to be able to interpret the history data.

[EOSIO Developers Documentation for state_history_plugin](https://developers.eos.io/manuals/eos/latest/nodeos/plugins/state_history_plugin/index)

[Source code of state_history_plugin](https://github.com/EOSIO/eos/blob/master/plugins/state_history_plugin/state_history_plugin.cpp)

## Parallel Deserialization with worker_threads

The nodejs worker_threads module enables the use of threads that execute JavaScript in parallel.

Workers (threads) are useful for performing CPU-intensive JavaScript operations. They will not help much with I/O-intensive work. Node.js’s built-in asynchronous I/O operations are more efficient than Workers can be.

Unlike child_process or cluster, worker_threads can share memory. They do so by transferring ArrayBuffer instances or sharing SharedArrayBuffer instances.

https://nodejs.org/api/worker_threads.html

## Reactive Programming & RXJS

RxJS is a library for functional reactive programming in JavaScript using Observables to make easier to compose asynchronous or callback-based code. Observables are a representation of any set of values over any amount of time. This is the most basic building block of RxJS.

<p align="center">
	<img src="./docs/observer-desing-pattern.png" width="600">
</p>

RxJS (and reactive programming in general) can be thought of as writing assembly lines in your software applications. It allows you to write software that is reusable, configurable, and asynchronous. These assembly lines can be chained together, split apart, configured slightly differently, or just used without any modification at all.

[Intro to RxJS](https://www.youtube.com/watch?v=flj-OprlogY)  
[RxJS: Mastering the Operators](https://www.youtube.com/watch?v=ou3oRHaUpQA)  
[learnrxjs.io](https://www.learnrxjs.io/)

## EOSIO Microforks

Due to the distributed nature of the blockchain and its high speed, there are times in which block producers can get slightly out of sync because of subsecond network latency, creating two or more competing versions of the original chain that share the same history up to a certain point. The blockchain code is programmed to quickly solve this problem taking the largest version as the ‘winning’ version of the blockchain, discarding all other versions. ( Chainbase, chain_kv, chainlib, chain plugin, fork db, producer plugin and net plugin are involved with switching forks internally. )

When this happens, and happens often, your queryable read databases have to rollback discarded blocks too. rxDemux will notify when these microforks occur, the hasura updater will rollback the changes on your read postgres database and all your application clients listening to postgres state through graphql subscription will get new state in real-time as well.

[Everything You Need to Know About Microforks by EOS Canada](https://www.youtube.com/watch?v=n-LRxhFEQg4)

## Usage

`yarn add @blockmatic/eosio-ship-reader`

```ts
const info = await fetch(
  'http://127.0.0.1:8888/v1/chain/get_info',
).then((res: any) => res.json())
console.log(info)

const eosioShipReaderConfig: EosioShipReaderConfig = {
  ws_url: 'ws://localhost:8080',
  ds_threads: 4,
  delta_whitelist: [
    'account_metadata',
    'contract_table',
    'contract_row',
    'contract_index64',
    'resource_usage',
    'resource_limits_state',
  ],
  table_rows: [
    { code: 'bitcashtests', scope: 'bitcashtests', table: 'appstates' },
    { code: 'bitcashtests', scope: 'bitcashtests', table: 'exfees' },
    { code: 'bitcashtests', scope: 'bitcashtests', table: 'fees' },
    { code: 'bitcashtests', scope: 'bitcashtests', table: 'accounts' },
    { code: 'bitcashtests', scope: 'bitcashtests', table: 'gpositions' },
    { code: 'bitcashtests', scope: 'bitcashtests', table: 'limits' },
    { code: 'bitcashtests', scope: 'bitcashtests', table: 'positions' },
    { code: 'bitcashtests', scope: 'bitcashtests', table: 'stat' },
  ],
  request: {
    start_block_num: info.head_block_num,
    end_block_num: 0xffffffff,
    max_messages_in_flight: 50,
    have_positions: [],
    irreversible_only: false,
    fetch_block: true,
    fetch_traces: true,
    fetch_deltas: true,
  },
}

const { start, blocks$, rows$, abis$ } = createEosioShipReader(
  eosioShipReaderConfig,
)

// stream of deserialized block data
blocks$.subscribe((blockData: EosioShipBlock) => {
  const { this_block, deltas } = blockData

  console.log(this_block.block_num)
})

// stream of whitelisted table row deltas
rows$.subscribe((rowDelta: EosioShipRowDelta) => {
  console.log(rowDelta)
})

// stream of smart contract abis
abis$.subscribe((abi: RpcInterfaces.Abi) => {
  console.log(abi)
})

// stream of whitelisted actions
actions$.subscribe((actions: EosioAction) => {
  console.log(action)
})

// start streaming
start()
```

See the `examples` directory.

## Contributing

Read the [contributing guidelines](https://developers.blockmatic.io) for details.

## Credits

This project leverages deserialization patterns from other projects such as EOSIO Contract API, Hyperion, Chronicle and EOSDac state reader.

## Contributors ✨

Thanks goes to these wonderful people ([emoji key](https://allcontributors.org/docs/en/emoji-key)):

<!-- ALL-CONTRIBUTORS-LIST:START - Do not remove or modify this section -->
<!-- prettier-ignore -->
<table>
  <tr>
    <td align="center"><a href="https://gaboesquivel.com"><img src="https://avatars0.githubusercontent.com/u/391270?v=4" width="100px;" alt="Gabo Esquivel"/><br /><sub><b>Gabo Esquivel</b></sub></a><br /><a href="https://github.com/blockmatic/eosio-ship-reader/commits?author=gaboesquivel" title="Code">💻</a> <a href="#talk-gaboesquivel" title="Talks">📢</a> <a href="#ideas-gaboesquivel" title="Ideas, Planning, & Feedback">🤔</a></td>
    <td align="center"><a href="https://fabianemilius.com"><img src="https://avatars3.githubusercontent.com/u/20770096?v=4" width="100px;" alt="Fabian Emilius"/><br /><sub><b>Fabian Emilius</b></sub></a><br /><a href="https://github.com/blockmatic/eosio-ship-reader/commits?author=fabian-emilius" title="Code">💻</a> <a href="#ideas-fabian-emilius" title="Ideas, Planning, & Feedback">🤔</a></td>
    <td align="center"><a href="https://medium.com/@cc32d9"><img src="https://avatars2.githubusercontent.com/u/40351024?v=4" width="100px;" alt="cc32d9"/><br /><sub><b>cc32d9</b></sub></a><br /><a href="#ideas-cc32d9" title="Ideas, Planning, & Feedback">🤔</a></td>
    <td align="center"><a href="https://eosdac.io"><img src="https://avatars2.githubusercontent.com/u/4223666?v=4" width="100px;" alt="Michael Yeates"/><br /><sub><b>Michael Yeates</b></sub></a><br /><a href="#ideas-michaeljyeates" title="Ideas, Planning, & Feedback">🤔</a></td>
    <td align="center"><a href="https://www.linkedin.com/in/igorls/"><img src="https://avatars2.githubusercontent.com/u/4753812?v=4" width="100px;" alt="Igor Lins e Silva"/><br /><sub><b>Igor Lins e Silva</b></sub></a><br /><a href="https://github.com/blockmatic/eosio-ship-reader/commits?author=igorls" title="Code">💻</a> <a href="#ideas-igorls" title="Ideas, Planning, & Feedback">🤔</a></td>
  </tr>
</table>

<!-- ALL-CONTRIBUTORS-LIST:END -->

This project follows the [all-contributors](https://github.com/all-contributors/all-contributors) specification. Contributions of any kind welcome!

## Blockmatic

Blockmatic is building a robust ecosystem of people and tools for the development of blockchain applications.

[blockmatic.io](https://blockmatic.io)

<!-- Please don't remove this: Grab your social icons from https://github.com/carlsednaoui/gitsocial -->

<!-- display the social media buttons in your README -->

[![Blockmatic Twitter][1.1]][1]
[![Blockmatic Facebook][2.1]][2]
[![Blockmatic Github][3.1]][3]

<!-- links to social media icons -->
<!-- no need to change these -->

<!-- icons with padding -->

[1.1]: http://i.imgur.com/tXSoThF.png 'twitter icon with padding'
[2.1]: http://i.imgur.com/P3YfQoD.png 'facebook icon with padding'
[3.1]: http://i.imgur.com/0o48UoR.png 'github icon with padding'

<!-- icons without padding -->

[1.2]: http://i.imgur.com/wWzX9uB.png 'twitter icon without padding'
[2.2]: http://i.imgur.com/fep1WsG.png 'facebook icon without padding'
[3.2]: http://i.imgur.com/9I6NRUm.png 'github icon without padding'

<!-- links to your social media accounts -->
<!-- update these accordingly -->

[1]: http://www.twitter.com/blockmatic_io
[2]: http://fb.me/blockmatic.io
[3]: http://www.github.com/blockmatic

<!-- Please don't remove this: Grab your social icons from https://github.com/carlsednaoui/gitsocial -->
