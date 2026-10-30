import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'

/** Асинхронний генератор: читає NDJSON рядок за рядком, файл у пам'ять повністю не потрапляє. */
export async function* readEvents(file) {
  const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity })
  for await (const line of rl) {
    if (!line.trim()) continue
    try {
      yield JSON.parse(line)
    } catch {
      yield { type: 'corrupt', raw: line.slice(0, 80) }
    }
  }
}
