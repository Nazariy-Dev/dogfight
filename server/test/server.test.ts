import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { request } from 'node:http'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { parseClientMessage, CLOSE } from '@dogfight/shared/protocol/messages.ts'
import { loadConfig } from '../src/config.ts'
import { createTokenBucket } from '../src/ratelimit.ts'
import { safeJoin } from '../src/http.ts'
import { Room, RoomManager } from '../src/rooms.ts'
import { readEvents } from '../src/log/replay.ts'
import { startTestServer, client, type Msg } from './helpers.ts'

const srv = await startTestServer({
  JOIN_TIMEOUT_MS: '300',
  MSG_PER_SECOND: '10',
  HEARTBEAT_MS: '100',
})
after(() => srv.app.shutdown())

// Сирий HTTP-запит (fetch нормалізує ../ у шляху, тому для traversal — node:http)
function raw(
  pathname: string,
  { method = 'GET', body }: { method?: string; body?: string } = {},
): Promise<{ status: number | undefined; body: string; type: string | undefined }> {
  return new Promise((resolve, reject) => {
    const u = new URL(srv.base)
    const req = request(
      { host: u.hostname, port: u.port, path: pathname, method },
      (res) => {
        let data = ''
        res.on('data', (c) => (data += c))
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            body: data,
            type: res.headers['content-type'],
          }),
        )
      },
    )
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

// код закриття або 'ok' — щоб тест читався одним рядком
const validate = (raw: string): { ok: boolean; code: number | 'ok' } => {
  const r = parseClientMessage(raw)
  return { ok: r.ok, code: r.ok ? 'ok' : r.code }
}

test('parseClientMessage: правильні й неправильні повідомлення', () => {
  assert.equal(validate('{"v":0,"type":"join","room":"a","name":"N"}').ok, true)
  assert.equal(validate('not json').code, CLOSE.BAD_MESSAGE)
  assert.equal(validate('[1,2]').code, CLOSE.BAD_MESSAGE)
  assert.equal(validate('null').code, CLOSE.BAD_MESSAGE)
  assert.equal(validate('{"v":1,"type":"chat","text":"x"}').code, CLOSE.BAD_VERSION)
  assert.equal(validate('{"v":0,"type":"hack"}').code, CLOSE.UNKNOWN_TYPE)
  assert.equal(validate('{"v":0,"type":"__proto__"}').code, CLOSE.UNKNOWN_TYPE)
  assert.equal(validate('{"v":0,"type":"chat","text":""}').code, CLOSE.BAD_MESSAGE)
  assert.equal(
    validate('{"v":0,"type":"join","room":"../x","name":"N"}').code,
    CLOSE.BAD_MESSAGE,
  )
  assert.deepEqual(parseClientMessage('x'.repeat(5000), 4096), {
    ok: false,
    code: CLOSE.TOO_BIG,
    reason: 'too big',
  })
})

test('loadConfig: значення за замовчуванням і помилки', () => {
  assert.equal(loadConfig({}).port, 8080)
  assert.throws(() => loadConfig({ PORT: 'abc' }), /PORT must be valid/)
  assert.throws(
    () => loadConfig({ PORT: '70000', MAX_ROOMS: '0' }),
    /PORT.*\n.*MAX_ROOMS/s,
  )
})

test('token bucket: 3 одразу, потім чекати', () => {
  let t = 0
  const b = createTokenBucket({ rate: 3, now: () => t })
  assert.deepEqual([b.take(), b.take(), b.take(), b.take()], [true, true, true, false])
  t = 340
  assert.equal(b.take(), true)
})

test('safeJoin відсікає вихід за корінь', () => {
  assert.equal(safeJoin('/srv', '/a/b.js'), path.resolve('/srv/a/b.js'))
  assert.equal(safeJoin('/srv', '/../etc/passwd'), path.resolve('/srv/etc/passwd'))
  assert.equal(safeJoin('/srv', '/%2e%2e/%2e%2e/x'), path.resolve('/srv/x'))
  assert.equal(safeJoin('/srv', '/%E0%A4%A'), null)
  assert.equal(safeJoin('/srv', '/a%00.js'), null)
})

test('HTTP: /health, /api/rooms GET і POST, статика, 404, traversal', async () => {
  assert.equal((await raw('/health')).status, 200)
  const list = JSON.parse((await raw('/api/rooms')).body) as { id: string }[]
  assert.ok(list.some((r) => r.id === 'lobby'))
  assert.equal(
    (await raw('/api/rooms', { method: 'POST', body: '{"id":"arena-1"}' })).status,
    201,
  )
  assert.equal(
    (await raw('/api/rooms', { method: 'POST', body: '{"id":"arena-1"}' })).status,
    409,
  )
  assert.equal(
    (await raw('/api/rooms', { method: 'POST', body: '{"id":"BAD ID"}' })).status,
    400,
  )
  assert.equal(
    (await raw('/api/rooms', { method: 'POST', body: 'x'.repeat(5000) })).status,
    413,
  )
  assert.equal((await raw('/api/rooms', { method: 'POST', body: '{oops' })).status, 400)
  const idx = await raw('/')
  assert.equal(idx.body, '<h1>ok</h1>')
  assert.match(idx.type ?? '', /text\/html/)
  assert.equal((await raw('/nope.js')).status, 404)
  assert.equal((await raw('/../secret.txt')).status, 400)
  assert.equal((await raw('/%2e%2e/secret.txt')).status, 400)
  assert.equal((await raw('/api/unknown')).status, 404)
})

test('WS: двоє в кімнаті бачать roster і чат', async () => {
  const a = client(srv.wsUrl)
  const b = client(srv.wsUrl)
  await Promise.all([a.opened, b.opened])
  a.send({ type: 'join', room: 'r1', name: 'Alice' })
  await a.waitFor((m) => m.type === 'welcome')
  b.send({ type: 'join', room: 'r1', name: 'Bob' })
  const players = (m: Msg): { name: string }[] =>
    Array.isArray(m.players) ? m.players : []
  const r = await a.waitFor((m) => m.type === 'roster' && players(m).length === 2)
  assert.deepEqual(
    players(r)
      .map((p) => p.name)
      .sort(),
    ['Alice', 'Bob'],
  )
  b.send({ type: 'chat', text: 'привіт' })
  const c = await a.waitFor((m) => m.type === 'chat')
  assert.equal(c.from, 'Bob')
  assert.equal(c.text, 'привіт')
  b.ws.close()
  const r2 = await a.waitFor((m) => m.type === 'roster' && players(m).length === 1)
  assert.equal(players(r2)[0]?.name, 'Alice')
  a.ws.close()
  await a.closed
  await new Promise((res) => setTimeout(res, 20))
  assert.equal(srv.app.rooms.get('r1'), undefined, 'порожня кімната видалена')
})

const BAD: [string, string | Record<string, unknown>, number][] = [
  ['битий JSON', '{oops', CLOSE.BAD_MESSAGE],
  ['невідомий тип', { type: 'teleport' }, CLOSE.UNKNOWN_TYPE],
  ['інша версія', JSON.stringify({ v: 9, type: 'chat', text: 'x' }), CLOSE.BAD_VERSION],
  ['chat до join', { type: 'chat', text: 'x' }, CLOSE.NOT_JOINED],
]
for (const [name, payload, code] of BAD) {
  test(`WS: ${name} → close ${code}`, async () => {
    const c = client(srv.wsUrl)
    await c.opened
    c.send(payload)
    assert.equal((await c.closed).code, code)
  })
}

test('WS: завелике повідомлення → 1009 (maxPayload)', async () => {
  const c = client(srv.wsUrl)
  await c.opened
  c.send({ type: 'chat', text: 'x'.repeat(10000) })
  assert.equal((await c.closed).code, 1009)
})

test('WS: без join за 300 мс → 4003', async () => {
  const c = client(srv.wsUrl)
  await c.opened
  const t = Date.now()
  assert.equal((await c.closed).code, CLOSE.JOIN_TIMEOUT)
  assert.ok(Date.now() - t >= 250)
})

test('WS: ліміт частоти (10/с) → 4004', async () => {
  const c = client(srv.wsUrl)
  await c.opened
  c.send({ type: 'join', room: 'spam', name: 'S' })
  for (let i = 0; i < 30; i++) c.send({ type: 'chat', text: 'spam ' + i })
  assert.equal((await c.closed).code, CLOSE.RATE_LIMIT)
})

test('WS: кімната на 2 гравці — третій отримує 4005', async () => {
  const s2 = await startTestServer({ MAX_PLAYERS_PER_ROOM: '2' })
  const cs = [client(s2.wsUrl), client(s2.wsUrl), client(s2.wsUrl)]
  await Promise.all(cs.map((c) => c.opened))
  for (const [i, c] of cs.entries()) {
    c.send({ type: 'join', room: 'duel', name: 'P' + i })
    if (i < 2) await c.waitFor((m) => m.type === 'welcome')
  }
  assert.equal((await cs[2]!.closed).code, CLOSE.ROOM_FULL)
  await s2.app.shutdown()
})

test('WS: клієнт без pong розривається heartbeat-ом', async () => {
  const c = client(srv.wsUrl)
  await c.opened
  c.send({ type: 'join', room: 'hb', name: 'Z' })
  await c.waitFor((m) => m.type === 'welcome')
  // «завислий» клієнт: не відповідає на ping (autoPong вимкнути можна лише при створенні,
  // тому перехоплюємо службовий метод)
  Object.assign(c.ws, { pong: () => {} })
  const r = await c.closed
  assert.equal(r.code, 1006) // terminate без close-фрейму
})

test('лог матчу пишеться NDJSON і читається реплеєм', async () => {
  const a = client(srv.wsUrl)
  await a.opened
  a.send({ type: 'join', room: 'logged', name: 'L' })
  await a.waitFor((m) => m.type === 'welcome')
  a.send({ type: 'chat', text: 'gg' })
  await a.waitFor((m) => m.type === 'chat')
  a.ws.close()
  await a.closed
  await new Promise((r) => setTimeout(r, 50))
  const files = (await readdir(srv.cfg.logDir)).filter((f) => f.startsWith('logged-'))
  assert.equal(files.length, 1)
  const file = path.join(srv.cfg.logDir, files[0] ?? '')
  const events: unknown[] = []
  for await (const e of readEvents(file))
    events.push(typeof e === 'object' && e !== null && 'type' in e ? e.type : null)
  assert.deepEqual(events, ['join', 'chat', 'leave'])
  const id = files[0]!.replace('.ndjson', '')
  const res = await fetch(`${srv.base}/api/replays/${id}`)
  assert.equal(res.status, 200)
  assert.equal((await res.text()).trim().split('\n').length, 3)
  assert.equal((await fetch(`${srv.base}/api/replays/..%2f..%2fx`)).status, 400)
  assert.equal((await readFile(file, 'utf8')).endsWith('\n'), true)
})

test('Room/RoomManager: events і ліміт кімнат', () => {
  const room = new Room({ id: 'x', maxPlayers: 1 })
  const seen: string[] = []
  room.on('join', () => seen.push('join'))
  room.on('empty', () => seen.push('empty'))
  const fakeWs = {} as never // cast: Room не торкається ws
  room.join({ id: 'p', name: 'P', ws: fakeWs })
  assert.throws(() => room.join({ id: 'q', name: 'Q', ws: fakeWs }), /full/)
  room.leave('p')
  room.leave('p') // повторно — без помилки
  assert.deepEqual(seen, ['join', 'empty'])
  const rm = new RoomManager({ maxRooms: 1 })
  rm.create({ id: 'a' })
  assert.throws(() => rm.create({ id: 'b' }), /too many rooms/)
})
