// Заміри RTT до сервера гри (ЛР8).
// Запуск із кореня репозиторію після `npm install`:
//   node scripts/rtt.mjs https://dogfight-zn45.onrender.com [кількість=50]
// Міряє два значення:
//   1) ping/pong кадрами WebSocket — чиста мережева затримка;
//   2) input → snapshot з ackSeq — затримка, яку бачить гравець (з очікуванням тіку 30 Гц).
import WebSocket from 'ws'

const base = (process.argv[2] ?? 'http://localhost:8080').replace(/\/$/, '')
const N = Number(process.argv[3] ?? 50)
const wsUrl = base.replace(/^http/, 'ws') + '/ws'

const pct = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]
}
const fmt = (name, a) =>
  `${name.padEnd(22)} n=${a.length}  min=${Math.min(...a).toFixed(1)}  ` +
  `медіана=${pct(a, 50).toFixed(1)}  p95=${pct(a, 95).toFixed(1)}  max=${Math.max(...a).toFixed(1)} мс`

// Безкоштовний інстанс Render засинає — будимо його перед замірами.
const t0 = performance.now()
for (;;) {
  try {
    const r = await fetch(base + '/health')
    if (r.ok) break
  } catch {
    // сервер ще прокидається — пробуємо знову
  }
  if (performance.now() - t0 > 180_000) throw new Error('сервер не прокинувся за 3 хв')
  await new Promise((r) => setTimeout(r, 2000))
}
console.log(
  `Сервер: ${base}  (готовий через ${((performance.now() - t0) / 1000).toFixed(1)} с)`,
)

const rooms = await (await fetch(base + '/api/rooms')).json()
const room = (Array.isArray(rooms) ? rooms : rooms.rooms)[0]?.id
if (!room) throw new Error('на сервері немає кімнат')

const ws = new WebSocket(wsUrl, { headers: { Origin: base } })
await new Promise((res, rej) => {
  ws.once('open', res)
  ws.once('error', rej)
  ws.once('unexpected-response', (_q, r) => rej(new Error('HTTP ' + r.statusCode)))
})
ws.send(JSON.stringify({ v: 0, type: 'join', room, name: 'rtt-probe', codec: 'json' }))

const pingRtt = []
const gameRtt = []
const sentAt = new Map()
ws.on('message', (data, isBinary) => {
  if (isBinary) return
  let m
  try {
    m = JSON.parse(data.toString())
  } catch {
    return
  }
  if (m.type !== 'snapshot') return
  const s = sentAt.get(m.ackSeq)
  if (s !== undefined) {
    gameRtt.push(performance.now() - s)
    sentAt.delete(m.ackSeq)
  }
})

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
await sleep(500)
for (let seq = 1; seq <= N; seq++) {
  // ping/pong
  const p = performance.now()
  await new Promise((res) => {
    ws.once('pong', () => {
      pingRtt.push(performance.now() - p)
      res()
    })
    ws.ping()
  })
  // input → snapshot
  sentAt.set(seq, performance.now())
  ws.send(
    JSON.stringify({
      v: 0,
      type: 'input',
      seq,
      left: false,
      right: false,
      thrust: false,
      fire: false,
    }),
  )
  await sleep(200)
}
await sleep(500)
ws.close()

console.log(`Кімната: ${room}, заміри: ${N}, ${new Date().toISOString()}`)
console.log(fmt('ping/pong WebSocket', pingRtt))
if (gameRtt.length) console.log(fmt('input → snapshot', gameRtt))
process.exit(0)
