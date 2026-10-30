import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'

/** Асинхронний генератор: читає NDJSON рядок за рядком, файл повністю в пам'ять не потрапляє. */
export async function* readEvents(file: string): AsyncGenerator<unknown> {
  const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity })
  for await (const line of rl) {
    if (!line.trim()) continue
    try {
      const value: unknown = JSON.parse(line)
      yield value
    } catch {
      yield { type: 'corrupt', raw: line.slice(0, 80) }
    }
  }
}
