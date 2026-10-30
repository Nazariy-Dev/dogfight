import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import WebSocket from 'ws'
import { loadConfig } from '../src/config.js'
import { createApp } from '../src/app.js'

/** Підняти сервер на випадковому порту з тимчасовими каталогами. */
export async function startTestServer(env = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'dogfight-'))
  const staticDir = path.join(dir, 'static')
  await mkdir(staticDir)
  await writeFile(path.join(staticDir, 'index.html'), '<h1>ok</h1>')
  await writeFile(path.join(dir, 'secret.txt'), 'top secret')
  const cfg = loadConfig({
    PORT: '0',
    LOG_DIR: path.join(dir, 'logs'),
    STATIC_DIR: staticDir,
    ...env,
  })
  const logs = []
  const app = createApp(cfg, { log: (lvl, msg, f) => logs.push({ lvl, msg, ...f }) })
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r))
  const { port } = app.server.address()
  return {
    app,
    cfg,
    dir,
    logs,
    base: `http://127.0.0.1:${port}`,
    wsUrl: `ws://127.0.0.1:${port}/ws`,
  }
}

/** WebSocket-клієнт, що складає повідомлення в масив і вміє чекати потрібне. */
export function client(url) {
  const ws = new WebSocket(url)
  const inbox = []
  const waiters = []
  ws.on('message', (d) => {
    const m = JSON.parse(d.toString())
    inbox.push(m)
    for (const w of [...waiters])
      if (w.pred(m)) (waiters.splice(waiters.indexOf(w), 1), w.resolve(m))
  })
  const closed = new Promise((r) =>
    ws.on('close', (code, reason) => r({ code, reason: reason.toString() })),
  )
  return {
    ws,
    inbox,
    closed,
    opened: new Promise((r, j) => (ws.once('open', r), ws.once('error', j))),
    send: (m) => ws.send(typeof m === 'string' ? m : JSON.stringify({ v: 0, ...m })),
    waitFor(pred, ms = 2000) {
      const found = inbox.find(pred)
      if (found) return Promise.resolve(found)
      return new Promise((resolve, reject) => {
        const w = { pred, resolve }
        waiters.push(w)
        setTimeout(() => reject(new Error('timeout waiting for message')), ms)
      })
    },
  }
}
