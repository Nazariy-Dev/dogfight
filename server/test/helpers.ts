import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import WebSocket from 'ws'
import { loadConfig, type ServerConfig } from '../src/config.ts'
import { createApp, type App } from '../src/app.ts'

export interface TestServer {
  app: App
  cfg: ServerConfig
  dir: string
  logs: Record<string, unknown>[]
  base: string
  wsUrl: string
}

/** Сервер на випадковому порту з тимчасовими каталогами. */
export async function startTestServer(
  env: Record<string, string> = {},
): Promise<TestServer> {
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
  const logs: Record<string, unknown>[] = []
  const app = createApp(cfg, { log: (lvl, msg, f) => void logs.push({ lvl, msg, ...f }) })
  await new Promise<void>((r) => app.server.listen(0, '127.0.0.1', r))
  const addr = app.server.address()
  const port = typeof addr === 'object' && addr ? addr.port : 0
  return {
    app,
    cfg,
    dir,
    logs,
    base: `http://127.0.0.1:${port}`,
    wsUrl: `ws://127.0.0.1:${port}/ws`,
  }
}

export type Msg = Record<string, unknown> & { type?: unknown }

export interface TestClient {
  ws: WebSocket
  inbox: Msg[]
  binary: Buffer[]
  closed: Promise<{ code: number; reason: string }>
  opened: Promise<unknown>
  send(m: string | Record<string, unknown>): void
  waitFor(pred: (m: Msg) => boolean, ms?: number): Promise<Msg>
}

/** WebSocket-клієнт, що складає повідомлення в масив і вміє чекати потрібне. */
export function client(url: string, headers: Record<string, string> = {}): TestClient {
  const ws = new WebSocket(url, { headers })
  const inbox: Msg[] = []
  const binary: Buffer[] = []
  const waiters: { pred: (m: Msg) => boolean; resolve: (m: Msg) => void }[] = []
  ws.on('message', (d: Buffer, isBinary: boolean) => {
    if (isBinary) return void binary.push(d)
    const m = JSON.parse(d.toString()) as Msg // cast: тестовий клієнт, сервер — довірене джерело
    inbox.push(m)
    for (const w of [...waiters])
      if (w.pred(m)) {
        waiters.splice(waiters.indexOf(w), 1)
        w.resolve(m)
      }
  })
  ws.on('error', () => {})
  const closed = new Promise<{ code: number; reason: string }>((r) =>
    ws.on('close', (code, reason) => r({ code, reason: reason.toString() })),
  )
  return {
    ws,
    inbox,
    binary,
    closed,
    opened: new Promise((r, j) => {
      ws.once('open', r)
      ws.once('error', j)
    }),
    send: (m) => ws.send(typeof m === 'string' ? m : JSON.stringify({ v: 0, ...m })),
    waitFor(pred, ms = 2000) {
      const found = inbox.find(pred)
      if (found) return Promise.resolve(found)
      return new Promise((resolve, reject) => {
        waiters.push({ pred, resolve })
        setTimeout(() => reject(new Error('timeout waiting for message')), ms)
      })
    },
  }
}
