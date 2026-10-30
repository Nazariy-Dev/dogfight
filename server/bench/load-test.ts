// Навантаження: N клієнтів (ws, без браузера) в кімнатах по 8, кожен шле input 30/с за сценарієм.
// node bench/load-test.ts http://127.0.0.1:8080 "8,32,64,128" 15
import WebSocket from 'ws'
import { encodeInput } from '@dogfight/shared/protocol/codec.ts'
import { asSeq } from '@dogfight/shared/types.ts'

const base = process.argv[2] ?? 'http://127.0.0.1:8080'
const steps = (process.argv[3] ?? '8,32,64,128').split(',').map(Number)
const secs = Number(process.argv[4] ?? 15)
const wsUrl = base.replace(/^http/, 'ws') + '/ws'

interface Stats {
  matches: {
    room: string
    tickDurP99: number
    lateP99: number
    players: number
    entities: number
  }[]
  process?: { rssMB: number; elu: number }
}

async function connect(
  i: number,
  prefix: string,
): Promise<{ ws: WebSocket; bytes: () => number }> {
  const ws = new WebSocket(wsUrl)
  let bytes = 0
  ws.on('message', (d: Buffer) => (bytes += d.length))
  await new Promise<void>((res, rej) => {
    ws.once('open', () => res())
    ws.once('error', rej)
  })
  ws.send(
    JSON.stringify({
      v: 0,
      type: 'join',
      room: `${prefix}-${Math.floor(i / 8)}`,
      name: `load${i}`,
    }),
  )
  let seq = 0
  const t = setInterval(() => {
    if (ws.readyState !== 1) return clearInterval(t)
    seq++
    ws.send(
      encodeInput({
        seq: asSeq(seq),
        thrust: seq % 4 !== 0,
        left: (seq + i) % 90 < 20,
        right: false,
        fire: seq % 6 === 0,
      }),
    )
  }, 1000 / 30)
  ws.on('close', () => clearInterval(t))
  return { ws, bytes: () => bytes }
}

console.log(
  'clients | rooms | tick p99 max, ms | late p99 max, ms | ELU | RSS, MB | down KB/s per client',
)
for (const n of steps) {
  const prefix = `load${n}`
  const clients = await Promise.all(
    Array.from({ length: n }, (_, i) => connect(i, prefix)),
  )
  await new Promise((r) => setTimeout(r, secs * 1000))
  const s = (await (await fetch(base + '/api/stats')).json()) as Stats
  const mine = s.matches.filter((m) => m.room.startsWith(prefix + '-'))
  const tickP99 = Math.max(...mine.map((m) => m.tickDurP99))
  const lateP99 = Math.max(...mine.map((m) => m.lateP99))
  const kbs = clients.reduce((a, c) => a + c.bytes(), 0) / n / secs / 1024
  console.log(
    `${String(n).padStart(7)} | ${String(mine.length).padStart(5)} | ${tickP99.toFixed(2).padStart(16)} | ${lateP99.toFixed(2).padStart(16)} | ${s.process?.elu.toFixed(2)} | ${s.process?.rssMB.toFixed(0)} | ${kbs.toFixed(1)}`,
  )
  for (const c of clients) c.ws.close()
  await new Promise((r) => setTimeout(r, 1500))
}
process.exit(0)
