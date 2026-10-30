import { createReadStream } from 'node:fs'
import { stat, readdir } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'

const MIME: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
  '.ico': 'image/x-icon',
  '.ndjson': 'application/x-ndjson',
  '.webmanifest': 'application/manifest+json',
}

/** Помилка з HTTP-статусом (наприклад, 413 для завеликого тіла). */
export class HttpError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const errCode = (err: unknown): string | undefined =>
  err instanceof Error && 'code' in err && typeof err.code === 'string'
    ? err.code
    : undefined

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(data),
  })
  res.end(data)
}

/** Тіло запиту з обмеженням розміру. */
export function readBody(req: IncomingMessage, limit = 4096): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > limit) {
        req.removeAllListeners('data')
        req.resume()
        reject(new HttpError(413, 'body too large'))
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** Безпечний шлях усередині root або null. */
export function safeJoin(root: string, urlPath: string): string | null {
  let p: string
  try {
    p = decodeURIComponent(urlPath)
  } catch {
    return null
  }
  if (p.includes('\0')) return null
  const full = path.resolve(root, '.' + path.posix.normalize('/' + p))
  const rootResolved = path.resolve(root)
  if (full !== rootResolved && !full.startsWith(rootResolved + path.sep)) return null
  return full
}

export async function serveStatic(
  req: IncomingMessage,
  res: ServerResponse,
  root: string,
): Promise<void> {
  // перевіряємо СИРИЙ шлях: new URL() вже «з'їдає» /../
  const rawPath = (req.url ?? '').split('?')[0] ?? ''
  if (rawPath.split('/').includes('..') || /%2e%2e|%2f|%5c/i.test(rawPath)) {
    return sendJson(res, 400, { error: 'bad path' })
  }
  const url = new URL(req.url ?? '/', 'http://x')
  let file = safeJoin(root, url.pathname)
  if (!file) return sendJson(res, 400, { error: 'bad path' })
  try {
    let st = await stat(file)
    if (st.isDirectory()) {
      file = path.join(file, 'index.html')
      st = await stat(file)
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
      'content-length': st.size,
    })
    if (req.method === 'HEAD') return void res.end()
    await pipeline(createReadStream(file), res)
  } catch (err: unknown) {
    const code = errCode(err)
    if (code === 'ENOENT' || code === 'ENOTDIR')
      return sendJson(res, 404, { error: 'not found' })
    if (!res.headersSent) sendJson(res, 500, { error: 'internal' })
    else res.destroy()
  }
}

/** Віддати реплей потоком: pipeline(readStream, res), без readFile. */
export async function streamReplay(
  res: ServerResponse,
  logDir: string,
  id: string,
): Promise<void> {
  if (!/^[a-z0-9-]+-\d+$/.test(id)) return sendJson(res, 400, { error: 'bad id' })
  const file = path.join(logDir, `${id}.ndjson`)
  try {
    const st = await stat(file)
    res.writeHead(200, {
      'content-type': MIME['.ndjson'] ?? 'text/plain',
      'content-length': st.size,
    })
    await pipeline(createReadStream(file), res)
  } catch (err: unknown) {
    const code = errCode(err)
    if (code === 'ENOENT') return sendJson(res, 404, { error: 'no replay' })
    if (code !== 'ERR_STREAM_PREMATURE_CLOSE') throw err
  }
}

export async function listReplays(logDir: string): Promise<string[]> {
  try {
    return (await readdir(logDir))
      .filter((f) => f.endsWith('.ndjson'))
      .map((f) => f.slice(0, -7))
  } catch {
    return []
  }
}
