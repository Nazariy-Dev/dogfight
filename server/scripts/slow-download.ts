// Повільний клієнт: качає реплей зі швидкістю ~rate КБ/с і паралельно знімає rss сервера.
// node scripts/slow-download.js <url> <serverPid> <rateKBs> <seconds> <out.csv>
import http from 'node:http'
import { readFileSync, writeFileSync } from 'node:fs'

const [url = '', pid = '', rateKB = '2048', seconds = '40', out = 'rss.csv'] =
  process.argv.slice(2)
const rssMB = () => {
  const m = /VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${pid}/status`, 'utf8'))
  return Number(m?.[1] ?? 0) / 1024
}
const rate = Number(rateKB) * 1024
const rows = ['t_s,rss_mb,downloaded_mb']
let got = 0
const t0 = Date.now()
const sampler = setInterval(
  () =>
    rows.push(
      `${((Date.now() - t0) / 1000).toFixed(1)},${rssMB().toFixed(1)},${(got / 1048576).toFixed(1)}`,
    ),
  500,
)

// читаємо лише стільки, скільки дозволяє «канал»; решта лишається в буферах TCP
const req = http.get(url, (res) => {
  res.pause()
  const tick = setInterval(() => {
    let budget = rate / 10
    let chunk
    while (budget > 0 && (chunk = res.read()) !== null) {
      got += chunk.length
      budget -= chunk.length
    }
  }, 100)
  res.on('end', () => clearInterval(tick))
  setTimeout(
    () => {
      clearInterval(tick)
      clearInterval(sampler)
      req.destroy()
      writeFileSync(out, rows.join('\n') + '\n')
      console.log(
        `downloaded ${(got / 1048576).toFixed(1)} MB in ${seconds}s; rss min/max ${Math.min(...rows.slice(1).map((r) => Number(r.split(',')[1])))}/${Math.max(...rows.slice(1).map((r) => Number(r.split(',')[1])))} MB`,
      )
      process.exit(0)
    },
    Number(seconds) * 1000,
  )
})
