import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createWriteStream } from 'node:fs'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { on } from 'node:events'
import { Readable } from 'node:stream'

/** Object-mode Transform: подія-об'єкт → рядок NDJSON. */
export function toNdjson() {
  return new Transform({
    writableObjectMode: true,
    transform(event, _enc, cb) {
      try {
        cb(null, JSON.stringify(event) + '\n')
      } catch (err) {
        cb(err)
      }
    },
  })
}

/**
 * Лог матчу кімнати: Readable.from(events.on(room, 'event')) → Transform → файл.
 * pipeline сам тримає backpressure і закриває потоки при помилці.
 * Підписка синхронна: перша подія (join) не губиться. Повертає { file, done, stop }.
 */
export function startMatchLog(room, logDir) {
  mkdirSync(logDir, { recursive: true })
  const file = path.join(logDir, `${room.id}-${Date.now()}.ndjson`)
  const ac = new AbortController()
  // on() підписується одразу при виклику і буферизує події, тому нічого не губиться,
  // навіть якщо потік почне читати пізніше
  const events = on(room, 'event', { signal: ac.signal })
  const source = Readable.from(
    (async function* () {
      try {
        for await (const [event] of events) yield event
      } catch (err) {
        if (err.name !== 'AbortError') throw err
      }
    })(),
  )
  const done = pipeline(source, toNdjson(), createWriteStream(file, { flags: 'a' }))
  return { file, done, stop: () => ac.abort() }
}
