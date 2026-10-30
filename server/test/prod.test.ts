import { afterAll, expect, test } from 'vitest'
import { spawn } from 'node:child_process'
import WebSocket from 'ws'
import { startTestServer, client } from './helpers.ts'
import { originAllowed, IpLimiter } from '../src/origin.ts'
import { loadConfig } from '../src/config.ts'

const srv = await startTestServer({
  ALLOWED_ORIGINS: 'https://dogfight.example',
  ALLOW_NO_ORIGIN: '1',
  MAX_CONNECTIONS_PER_IP: '3',
  GIT_SHA: 'abc1234',
})
afterAll(() => srv.app.shutdown())

test('originAllowed і IpLimiter', () => {
  expect(originAllowed('https://a', [], false)).toBe(true)
  expect(originAllowed('https://evil', ['https://a'], true)).toBe(false)
  expect(originAllowed(undefined, ['https://a'], false)).toBe(false)
  const l = new IpLimiter(2)
  expect([l.acquire('x'), l.acquire('x'), l.acquire('x')]).toEqual([true, true, false])
  l.release('x')
  expect(l.acquire('x')).toBe(true)
})

test('конфіг: ALLOWED_ORIGINS має бути списком URL', () => {
  expect(() => loadConfig({ ALLOWED_ORIGINS: 'not a url' })).toThrow(/ALLOWED_ORIGINS/)
  expect(
    loadConfig({ ALLOWED_ORIGINS: 'https://a.com, https://b.com' }).allowedOrigins,
  ).toEqual(['https://a.com', 'https://b.com'])
})

test('/health з версією, /ready, /metrics у форматі Prometheus', async () => {
  expect(await (await fetch(srv.base + '/health')).json()).toMatchObject({
    ok: true,
    version: 'abc1234',
  })
  expect((await fetch(srv.base + '/ready')).status).toBe(200)
  const m = await (await fetch(srv.base + '/metrics')).text()
  for (const name of [
    'dogfight_players',
    'dogfight_rooms',
    'dogfight_tick_p99_ms',
    'dogfight_event_loop_utilization',
    'dogfight_process_resident_memory_bytes',
  ])
    expect(m).toContain(name)
})

test('Origin: чужий сайт отримує 403 на рукостисканні, свій — проходить', async () => {
  const bad = new WebSocket(srv.wsUrl, { headers: { origin: 'https://evil.example' } })
  const status = await new Promise<number>((r) =>
    bad.on('unexpected-response', (_req, res) => r(res.statusCode ?? 0)),
  )
  expect(status).toBe(403)
  const good = client(srv.wsUrl, { origin: 'https://dogfight.example' })
  await good.opened
  good.ws.close()
  const m = await (await fetch(srv.base + '/metrics')).text()
  expect(m).toMatch(/dogfight_rejections_total\{reason="origin"\} [1-9]/)
})

test('ліміт з’єднань з однієї IP: четверте — 429', async () => {
  const cs = [client(srv.wsUrl), client(srv.wsUrl), client(srv.wsUrl)]
  await Promise.all(cs.map((c) => c.opened))
  const fourth = new WebSocket(srv.wsUrl)
  const status = await new Promise<number>((r) =>
    fourth.on('unexpected-response', (_req, res) => r(res.statusCode ?? 0)),
  )
  expect(status).toBe(429)
  for (const c of cs) c.ws.close()
  await Promise.all(cs.map((c) => c.closed))
  const again = client(srv.wsUrl)
  await again.opened // слоти звільнились
  again.ws.close()
})

test('SIGTERM: shutdown-повідомлення, код 1001, вихід 0 швидше ніж за 10 с', async () => {
  const port = 18000 + Math.floor(Math.random() * 1000)
  const proc = spawn(process.execPath, ['src/index.ts'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: {
      ...process.env,
      PORT: String(port),
      LOG_LEVEL: 'info',
      LOG_DIR: srv.dir + '/sig',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let out = ''
  proc.stdout.on('data', (d: Buffer) => (out += d.toString()))
  await new Promise<void>((r) =>
    proc.stdout.on('data', () => out.includes('listening') && r()),
  )
  const c = client(`ws://127.0.0.1:${port}/ws`)
  await c.opened
  c.send({ type: 'join', room: 'sig', name: 'S' })
  await c.waitFor((m) => m.type === 'welcome')
  const t0 = Date.now()
  proc.kill('SIGTERM')
  const closed = await c.closed
  const code = await new Promise<number | null>((r) => proc.on('exit', r))
  expect(c.inbox.some((m) => m.type === 'shutdown')).toBe(true)
  expect(closed.code).toBe(1001)
  expect(code).toBe(0)
  expect(Date.now() - t0).toBeLessThan(10000)
  const lines = out
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as { msg: string })
  expect(lines.map((l) => l.msg)).toEqual(
    expect.arrayContaining(['signal', 'shutdown start', 'shutdown done', 'exit']),
  )
}, 20000)
