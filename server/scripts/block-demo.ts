// Що буде, якщо HTTP-обробник займе цикл подій на 300 мс.
// Два клієнти в кімнаті переписуються кожні 50 мс; посередині — GET /api/slow.
// node scripts/block-demo.js http://127.0.0.1:8080
import WebSocket from 'ws'

const base = process.argv[2] ?? 'http://127.0.0.1:8080'
const wsUrl = base.replace('http', 'ws') + '/ws'
const open = (name: string): Promise<WebSocket> =>
  new Promise((resolve) => {
    const ws = new WebSocket(wsUrl)
    ws.on('open', () => {
      ws.send(JSON.stringify({ v: 0, type: 'join', room: 'block-demo', name }))
      resolve(ws)
    })
  })
const a = await open('A')
const b = await open('B')
await new Promise((r) => setTimeout(r, 200))
const sent = new Map<string, { t: number; at: number }>()
const lat: { at: number; ms: number }[] = []
b.on('message', (d: Buffer) => {
  const m = JSON.parse(d.toString()) as { type: string; text: string }
  const s = sent.get(m.text)
  if (m.type === 'chat' && s) lat.push({ at: s.at, ms: Date.now() - s.t })
})
const t0 = Date.now()
let i = 0
const iv = setInterval(() => {
  const text = 'm' + i++
  sent.set(text, { t: Date.now(), at: Date.now() - t0 })
  a.send(JSON.stringify({ v: 0, type: 'chat', text }))
}, 100)
setTimeout(async () => {
  const t = Date.now()
  const r = (await fetch(base + '/api/slow').then((x) => x.json())) as {
    blockedMs: number
  }
  console.log(
    `/api/slow at ${t - t0} ms, blocked ${r.blockedMs} ms, response after ${Date.now() - t} ms`,
  )
}, 500)
setTimeout(() => {
  clearInterval(iv)
  for (const l of lat)
    console.log(
      `chat sent at ${String(l.at).padStart(4)} ms -> delivered in ${String(l.ms).padStart(3)} ms`,
    )
  a.close()
  b.close()
}, 1300)
