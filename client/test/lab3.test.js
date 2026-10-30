import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  HttpError,
  fetchJson,
  isRetryable,
  loadAll,
  sleep,
  withRetry,
} from '../src/assets/loader.js'
import { Lobby } from '../src/ui/lobby.js'
import { GameBus } from '../src/events.js'
import { readFileSync } from 'node:fs'

// Фейковий fetch: таблиця url → відповідь
function fakeFetch(table, calls = []) {
  return async (url, { signal } = {}) => {
    calls.push(url)
    signal?.throwIfAborted()
    const r = typeof table[url] === 'function' ? await table[url](signal) : table[url]
    if (r === undefined) return new Response('nope', { status: 404 })
    if (r instanceof Error) throw r
    return r
  }
}

test('fetchJson: 404 → HttpError, а не «немає мережі»', async () => {
  const f = fakeFetch({})
  await assert.rejects(
    fetchJson('/x', { fetchImpl: f }),
    (e) => e instanceof HttpError && e.status === 404,
  )
})

test('fetchJson: битий JSON → SyntaxError з назвою файлу', async () => {
  const f = fakeFetch({ '/a': new Response('{ "w": ') })
  await assert.rejects(fetchJson('/a', { fetchImpl: f }), /Bad JSON in \/a/)
})

test('isRetryable: 4xx ні, 5xx так, abort ні, мережа так', () => {
  assert.equal(isRetryable(new HttpError(404, 'u')), false)
  assert.equal(isRetryable(new HttpError(503, 'u')), true)
  assert.equal(isRetryable(new HttpError(429, 'u')), true)
  assert.equal(isRetryable(new DOMException('x', 'AbortError')), false)
  assert.equal(isRetryable(new DOMException('x', 'TimeoutError')), false)
  assert.equal(isRetryable(new TypeError('fetch failed')), true)
})

test('withRetry: 503, 503, 200 → успіх з третьої спроби, паузи ростуть', async () => {
  let n = 0
  const delays = []
  const v = await withRetry(
    async () => {
      if (++n < 3) throw new HttpError(503, 'u')
      return 'ok'
    },
    { attempts: 3, baseMs: 10, random: () => 1, onRetry: (r) => delays.push(r.delay) },
  )
  assert.equal(v, 'ok')
  assert.deepEqual(delays, [10, 20])
})

test('withRetry: на 404 не повторює', async () => {
  let n = 0
  await assert.rejects(
    withRetry(
      async () => {
        n++
        throw new HttpError(404, 'u')
      },
      { attempts: 5, baseMs: 1 },
    ),
  )
  assert.equal(n, 1)
})

test('withRetry: abort під час паузи зупиняє повтори', async () => {
  const c = new AbortController()
  let n = 0
  const p = withRetry(
    async () => {
      n++
      throw new TypeError('net')
    },
    { attempts: 5, baseMs: 1000, random: () => 1, signal: c.signal },
  )
  setTimeout(() => c.abort(), 20)
  await assert.rejects(p, { name: 'AbortError' })
  assert.equal(n, 1)
})

test('sleep: вже скасований сигнал — одразу reject', async () => {
  await assert.rejects(sleep(10, AbortSignal.abort()), { name: 'AbortError' })
})

const manifest = {
  images: { a: 'a.png', b: 'b.png' },
  sounds: { s: 's.wav' },
  json: { j: 'j.json' },
}
const okLoaders = (calls) => ({
  image: async (u) => (calls.push(u), `img:${u}`),
  audio: async (u) => (calls.push(u), `snd:${u}`),
  json: async (u) => (calls.push(u), { u }),
})

test('loadAll: усі групи, прогрес 0..4, монотонний', async () => {
  const progress = []
  const r = await loadAll(manifest, {
    loaders: okLoaders([]),
    onProgress: (p) => progress.push(p.done),
  })
  assert.deepEqual(progress, [0, 1, 2, 3, 4])
  assert.equal(r.images.a, 'img:a.png')
  assert.equal(r.sounds.s, 'snd:s.wav')
  assert.deepEqual(r.json.j, { u: 'j.json' })
})

test('loadAll: файли стартують одночасно (Promise.all)', async () => {
  const started = []
  const slow = async (u) => {
    started.push(u)
    await sleep(30)
    return u
  }
  const t = performance.now()
  await loadAll(manifest, { loaders: { image: slow, audio: slow, json: slow } })
  assert.ok(performance.now() - t < 80, 'паралельно ≈ 30 мс, а не 120')
  assert.equal(started.length, 4)
})

test('loadAll: відсутній звук не валить гру, відсутнє зображення — валить', async () => {
  const fail = async () => {
    throw new HttpError(404, 'x')
  }
  const r = await loadAll(manifest, { loaders: { ...okLoaders([]), audio: fail } })
  assert.equal(r.failed.length, 1)
  await assert.rejects(
    loadAll(manifest, { loaders: { ...okLoaders([]), image: fail } }),
    HttpError,
  )
})

test('loadAll: порожній маніфест', async () => {
  const r = await loadAll({}, { loaders: okLoaders([]) })
  assert.deepEqual(r, { images: {}, sounds: {}, json: {}, failed: [] })
})

test("Lobby: подія rooms, join з обрізаним ім'ям, close скасовує запит", async () => {
  const rooms = [{ id: 'a', name: 'A', players: 0, max: 2 }]
  let seenSignal
  const f = fakeFetch({
    '/r': () => new Response(JSON.stringify(rooms)),
    '/slow': (signal) => {
      seenSignal = signal
      return new Promise((_, rej) =>
        signal.addEventListener('abort', () => rej(signal.reason)),
      )
    },
  })
  const lobby = new Lobby({ url: '/r', fetchImpl: f, intervalMs: 10000 })
  const got = new Promise((r) =>
    lobby.addEventListener('rooms', (e) => r(e.detail), { once: true }),
  )
  lobby.start()
  assert.deepEqual(await got, rooms)
  const joined = new Promise((r) => lobby.addEventListener('join', (e) => r(e.detail)))
  lobby.join('a', '   Nazar-the-very-long-pilot-name ')
  assert.deepEqual((await joined).name, 'Nazar-the-very-l')
  assert.equal(lobby.open, false)
  assert.throws(() => lobby.join('zzz', 'x'), /No room/)

  const l2 = new Lobby({ url: '/slow', fetchImpl: f, intervalMs: 10000 })
  let errors = 0
  l2.addEventListener('error', () => errors++)
  l2.start()
  const p = l2.refresh() // той самий запит, не дубль
  l2.close()
  await p
  assert.equal(seenSignal.aborted, true)
  assert.equal(errors, 0, 'abort при виході — не помилка')
})

test('Lobby: таймаут запиту → подія error', async () => {
  const f = fakeFetch({
    '/hang': (signal) =>
      new Promise((_, rej) => signal.addEventListener('abort', () => rej(signal.reason))),
  })
  const lobby = new Lobby({
    url: '/hang',
    fetchImpl: f,
    timeoutMs: 30,
    intervalMs: 10000,
  })
  const err = new Promise((r) => lobby.addEventListener('error', (e) => r(e.detail)))
  lobby.start()
  assert.equal((await err).name, 'TimeoutError')
  lobby.close()
})

test('GameBus: on/emit/відписка', () => {
  const bus = new GameBus()
  const seen = []
  const off = bus.on('hit', (d) => seen.push(d.id))
  bus.emit('hit', { id: 1 })
  off()
  bus.emit('hit', { id: 2 })
  assert.deepEqual(seen, [1])
})

test('sim/ не імпортує audio, HUD чи DOM', () => {
  for (const f of [
    'world.js',
    'entity.js',
    'behaviors.js',
    'collision.js',
    'ship.js',
    'vector.js',
  ]) {
    const src = readFileSync(
      new URL(`../../shared/src/sim/${f}`, import.meta.url),
      'utf8',
    )
    assert.doesNotMatch(src, /audio|hud|document\.|window\./, f)
  }
})
