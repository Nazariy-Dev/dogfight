// Порівняння послідовного і паралельного завантаження маніфесту.
// Потрібен запущений `npm run preview` (порт 4173). node scripts/seq-vs-concurrent.js [delayMs]
import { fetchJson, fetchOk, loadAll, loadAllSequential } from '../src/assets/loader.js'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4173/'
const delay = Number(process.argv[2] ?? 200)
const bytes = async (url, o) => (await fetchOk(url, o)).arrayBuffer()
const loaders = { image: bytes, audio: bytes, json: (u, o) => fetchJson(u, o) }

const manifest = await fetchJson(BASE + 'assets/manifest.json')
// штучна затримка мережі на кожен файл
for (const g of ['images', 'sounds', 'json'])
  for (const k in manifest[g]) manifest[g][k] += `?delay=${delay}`

const files = Object.values(manifest)
  .filter((v) => typeof v === 'object')
  .flatMap(Object.keys).length
console.log(`файлів: ${files}, затримка на файл: ${delay} мс`)
for (const [name, fn] of [
  ['sequential await', loadAllSequential],
  ['Promise.all     ', loadAll],
]) {
  const runs = []
  for (let i = 0; i < 3; i++) {
    const t = performance.now()
    await fn(manifest, { base: BASE, loaders })
    runs.push(Math.round(performance.now() - t))
  }
  console.log(`${name}: ${runs.join(' / ')} мс`)
}
