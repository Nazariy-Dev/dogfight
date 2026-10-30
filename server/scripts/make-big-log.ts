// Синтетичний лог матчу ~200 МБ (через потік, без накопичення в пам'яті).
// node scripts/make-big-log.js <logDir> [MB]
import { createWriteStream } from 'node:fs'
import { mkdirSync } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import path from 'node:path'

const dir = process.argv[2] ?? './logs'
const mb = Number(process.argv[3] ?? 200)
mkdirSync(dir, { recursive: true })
const file = path.join(dir, `synthetic-${Date.now()}.ndjson`)
let written = 0
const limit = mb * 1024 * 1024
async function* lines() {
  for (let i = 0; written < limit; i++) {
    const s =
      JSON.stringify({
        t: 1760000000000 + i * 33,
        room: 'synthetic',
        type: 'snapshot',
        tick: i,
        ships: [{ id: 1, x: (i * 7) % 1280, y: (i * 3) % 720, a: i % 628 }],
      }) + '\n'
    written += s.length
    yield s
  }
}
await pipeline(Readable.from(lines()), createWriteStream(file))
console.log(path.basename(file, '.ndjson'), (written / 1048576).toFixed(1) + ' MB')
