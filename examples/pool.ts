import { StaticPool } from 'node-worker-threads-pool'

const staticPool = new StaticPool({
  size: 4,
  task: (n: number) => n + 1,
})

staticPool.exec(1).then((result) => {
  console.log('result from thread pool:', result) // result will be 2.
})
