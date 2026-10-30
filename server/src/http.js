import { createReadStream } from 'node:fs'
import { stat, readdir } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import path from 'node:path'

const MIME = {
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

export function sendJson(res, status, body) {
  const data = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': MIME['.json'],
    'content-length': Buffer.byteLength(data),
  })
  res.end(data)
}

/** Тіло запиту з обмеженням розміру (захист від гігабайтного POST). */
export function readBody(req, limit = 4096) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > limit) {
        // далі тіло не збираємо; відповідь 413 надішле обробник
        req.removeAllListeners('data')
        req.resume()
        reject(Object.assign(new Error('body too large'), { status: 413 }))
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/**
 * Безпечний шлях усередині root: decodeURIComponent, normalize і перевірка префікса.
 * Повертає null для спроб вийти за межі каталогу (../, %2e%2e, абсолютні шляхи, \0).
 */
export function safeJoin(root, urlPath) {
  let p
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

export async function serveStatic(req, res, root) {
  // перевіряємо СИРИЙ шлях: new URL() вже «з'їдає» /../ і помилка сховалася б
  const rawPath = (req.url ?? '').split('?')[0]
  if (rawPath.split('/').includes('..') || /%2e%2e|%2f|%5c/i.test(rawPath)) {
    return sendJson(res, 400, { error: 'bad path' })
  }
  const url = new URL(req.url, 'http://x')
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
    if (req.method === 'HEAD') return res.end()
    await pipeline(createReadStream(file), res)
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR')
      return sendJson(res, 404, { error: 'not found' })
    if (!res.headersSent) sendJson(res, 500, { error: 'internal' })
    else res.destroy(err)
  }
}

/** Віддати файл реплею потоком: pipeline(readStream, res), без readFile. */
export async function streamReplay(res, logDir, id) {
  if (!/^[a-z0-9-]+-\d+$/.test(id)) return sendJson(res, 400, { error: 'bad id' })
  const file = path.join(logDir, `${id}.ndjson`)
  try {
    const st = await stat(file)
    res.writeHead(200, { 'content-type': MIME['.ndjson'], 'content-length': st.size })
    await pipeline(createReadStream(file), res)
  } catch (err) {
    if (err.code === 'ENOENT') return sendJson(res, 404, { error: 'no replay' })
    // клієнт обірвав завантаження — це не помилка сервера
    if (err.code !== 'ERR_STREAM_PREMATURE_CLOSE') throw err
  }
}

export async function listReplays(logDir) {
  try {
    return (await readdir(logDir))
      .filter((f) => f.endsWith('.ndjson'))
      .map((f) => f.slice(0, -7))
  } catch {
    return []
  }
}
