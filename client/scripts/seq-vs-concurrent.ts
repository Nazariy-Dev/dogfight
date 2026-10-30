// Послідовне vs паралельне завантаження маніфесту.
// Потрібен запущений сервер (порт 8080) або `npm run preview` (4173). node scripts/seq-vs-concurrent.ts [delayMs]
import {
  fetchJson,
  fetchOk,
  loadAll,
  loadAllSequential,
  parseManifest,
  type Loader,
} from '../src/assets/loader.ts'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4173/'
const delay = Number(process.argv[2] ?? 200)
const bytes: Loader<ArrayBuffer> = async (url, o) => (await fetchOk(url, o)).arrayBuffer()
const loaders = { image: bytes, audio: bytes, json: (u: string) => fetchJson(u) }

const manifest = parseManifest(await fetchJson(BASE + 'assets/manifest.json'))
for (const g of ['images', 'sounds', 'json'] as const) {
  const group = manifest[g] ?? {}
  for (const k of Object.keys(group)) group[k] += `?delay=${delay}`
}
const files =
  Object.keys(manifest.images ?? {}).length +
  Object.keys(manifest.sounds ?? {}).length +
  Object.keys(manifest.json ?? {}).length
console.log(`файлів: ${files}, затримка на файл: ${delay} мс`)
const runs: [string, typeof loadAll][] = [
  ['sequential await', loadAllSequential],
  ['Promise.all     ', loadAll],
]
for (const [name, fn] of runs) {
  const times: number[] = []
  for (let i = 0; i < 3; i++) {
    const t = performance.now()
    await fn(manifest, { base: BASE, loaders })
    times.push(Math.round(performance.now() - t))
  }
  console.log(`${name}: ${times.join(' / ')} мс`)
}
