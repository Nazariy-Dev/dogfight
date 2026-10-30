// Хаос-тести проти запущеного сервера: node bench/chaos.ts http://127.0.0.1:8080
// 1) клієнт зникає посеред матчу; 2) клієнт шле ~1000 битих кадрів/с — його відключають,
//    а час кроку в іншій кімнаті не зростає (дивимось /api/stats до і під час флуду).
import WebSocket from 'ws'
import { encodeInput } from '@dogfight/shared/protocol/codec.ts'
import { asSeq } from '@dogfight/shared/types.ts'

const base = process.argv[2] ?? 'http://127.0.0.1:8080'
const wsUrl = base.replace(/^http/, 'ws') + '/ws'
type Stats = {
  matches: { room: string; tickDurP99: number; lateP99: number; players: number }[]
}
const stats = async (): Promise<Stats> =>
  (await (await fetch(base + '/api/stats')).json()) as Stats
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function player(room: string, name: string): Promise<WebSocket> {
  const ws = new WebSocket(wsUrl)
  await new Promise((r) => ws.once('open', r))
  ws.send(JSON.stringify({ v: 0, type: 'join', room, name }))
  let seq = 0
  const t = setInterval(
    () =>
      ws.readyState === 1 &&
      ws.send(
        encodeInput({
          seq: asSeq(++seq),
          thrust: true,
          left: seq % 40 < 8,
          right: false,
          fire: seq % 5 === 0,
        }),
      ),
    33,
  )
  ws.on('close', () => clearInterval(t))
  return ws
}

// фон: кімната «calm» з 8 гравцями
const calm = await Promise.all(
  Array.from({ length: 8 }, (_, i) => player('chaos-calm', `c${i}`)),
)
await sleep(3000)
const before = (await stats()).matches.find((m) => m.room === 'chaos-calm')

// 1) клієнт зникає без close-фрейму
const ghost = await player('chaos-ghost', 'ghost')
await sleep(500)
ghost.terminate()
await sleep(500)
const afterGhost = (await stats()).matches.find((m) => m.room === 'chaos-ghost')
console.log(
  `1) client killed mid-match: room chaos-ghost ${afterGhost ? `players=${afterGhost.players}` : 'deleted (empty)'}`,
)

// 2) флуд битими кадрами
const bad = new WebSocket(wsUrl)
await new Promise((r) => bad.once('open', r))
bad.send(JSON.stringify({ v: 0, type: 'join', room: 'chaos-flood', name: 'flood' }))
await sleep(200)
let sent = 0
const flood = setInterval(() => {
  for (let i = 0; i < 10 && bad.readyState === 1; i++) {
    bad.send(new Uint8Array([7, 7, 7, 7]))
    sent++
  }
}, 10)
const closed = await new Promise<{ code: number; ms: number }>((r) => {
  const t0 = Date.now()
  bad.on('close', (code) => r({ code, ms: Date.now() - t0 }))
})
clearInterval(flood)
await sleep(3000)
const during = (await stats()).matches.find((m) => m.room === 'chaos-calm')
console.log(
  `2) garbage flood: sent ${sent} frames, closed with ${closed.code} after ${closed.ms} ms`,
)
console.log(
  `   calm room tick p99: before ${before?.tickDurP99} ms, after flood ${during?.tickDurP99} ms; late p99 ${before?.lateP99} -> ${during?.lateP99} ms`,
)
const m = await (await fetch(base + '/metrics')).text()
console.log(
  '   metrics:',
  m
    .split('\n')
    .filter((l) => l.startsWith('dogfight_rejections_total'))
    .join('; '),
)
for (const c of calm) c.close()
process.exit(0)
