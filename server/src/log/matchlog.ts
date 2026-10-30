import { Transform, Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createWriteStream, mkdirSync } from 'node:fs'
import path from 'node:path'
import { on } from 'node:events'
import type { Room } from '../rooms.ts'

/** Object-mode Transform: подія-об'єкт → рядок NDJSON. */
export function toNdjson(): Transform {
  return new Transform({
    writableObjectMode: true,
    transform(event: unknown, _enc, cb) {
      try {
        cb(null, JSON.stringify(event) + '\n')
      } catch (err: unknown) {
        cb(err instanceof Error ? err : new Error(String(err)))
      }
    },
  })
}

export interface MatchLog {
  readonly file: string
  readonly done: Promise<void>
  stop(): void
}

/**
 * Лог матчу: on(room, 'event') → Transform → файл через pipeline.
 * Підписка синхронна, тому перша подія (join) не губиться.
 */
export function startMatchLog(room: Room, logDir: string): MatchLog {
  mkdirSync(logDir, { recursive: true })
  const file = path.join(logDir, `${room.id}-${Date.now()}.ndjson`)
  const ac = new AbortController()
  const events = on(room, 'event', { signal: ac.signal })
  const source = Readable.from(
    (async function* (): AsyncGenerator<unknown> {
      try {
        // on() типізує аргументи як any[]; Transform нижче приймає unknown, тож каст не потрібен
        for await (const args of events) yield args[0]
      } catch (err: unknown) {
        if (!(err instanceof Error && err.name === 'AbortError')) throw err
      }
    })(),
  )
  const done = pipeline(source, toNdjson(), createWriteStream(file, { flags: 'a' }))
  return { file, done, stop: () => ac.abort() }
}
