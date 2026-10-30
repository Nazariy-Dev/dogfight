import { test } from 'vitest'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  HttpError,
  fetchJson,
  isRetryable,
  loadAll,
  sleep,
  withRetry,
  type FetchImpl,
  type Loader,
} from '../src/assets/loader.ts'
import { Lobby, type RoomInfo } from '../src/ui/lobby.ts'
import { GameBus } from '../src/events.ts'
import { asEntityId } from '@dogfight/shared/types.ts'

type Reply = Response | Error | ((signal: AbortSignal) => Promise<Response>)

/** Фейковий fetch: таблиця url → відповідь. */
function fakeFetch(table: Record<string, Reply>): FetchImpl {
  return async (url, init) => {
    const signal = init?.signal ?? new AbortController().signal
    signal.throwIfAborted()
    const r = table[url]
    if (r === undefined) return new Response('nope', { status: 404 })
    if (r instanceof Error) throw r
    return typeof r === 'function' ? r(signal) : r
  }
}
const hang = (signal: AbortSignal): Promise<Response> =>
  new Promise((_, rej) => signal.addEventListener('abort', () => rej(signal.reason)))

test('fetchJson: 404 → HttpError, а не «немає мережі»', async () => {
  await assert.rejects(
    fetchJson('/x', { fetchImpl: fakeFetch({}) }),
    (e: unknown) => e instanceof HttpError && e.status === 404,
  )
})

test('fetchJson: битий JSON → SyntaxError з назвою файлу', async () => {
  await assert.rejects(
    fetchJson('/a', { fetchImpl: fakeFetch({ '/a': new Response('{ "w": ') }) }),
    /Bad JSON in \/a/,
  )
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
  const delays: number[] = []
  const v = await withRetry(
    async () => {
      if (++n < 3) throw new HttpError(503, 'u')
      return 'ok'
    },
    {
      attempts: 3,
      baseMs: 10,
      random: () => 1,
      onRetry: (r) => void delays.push(r.delay),
    },
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
const ok: { image: Loader<string>; audio: Loader<string>; json: Loader<unknown> } = {
  image: async (u) => `img:${u}`,
  audio: async (u) => `snd:${u}`,
  json: async (u) => ({ u }),
}

test('loadAll: усі групи, прогрес 0..4, монотонний', async () => {
  const progress: number[] = []
  const r = await loadAll(manifest, {
    loaders: ok,
    onProgress: (p) => void progress.push(p.done),
  })
  assert.deepEqual(progress, [0, 1, 2, 3, 4])
  assert.equal(r.images.a, 'img:a.png')
  assert.equal(r.sounds.s, 'snd:s.wav')
  assert.deepEqual(r.json.j, { u: 'j.json' })
})

test('loadAll: файли стартують одночасно (Promise.all)', async () => {
  const started: string[] = []
  const slow: Loader<string> = async (u) => {
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
  const fail: Loader<string> = async () => {
    throw new HttpError(404, 'x')
  }
  const r = await loadAll(manifest, { loaders: { ...ok, audio: fail } })
  assert.equal(r.failed.length, 1)
  await assert.rejects(loadAll(manifest, { loaders: { ...ok, image: fail } }), HttpError)
})

test('loadAll: порожній маніфест', async () => {
  const r = await loadAll({}, { loaders: ok })
  assert.deepEqual(r, { images: {}, sounds: {}, json: {}, failed: [] })
})

test("Lobby: подія rooms, join з обрізаним ім'ям, close скасовує запит", async () => {
  const rooms: RoomInfo[] = [{ id: 'a', name: 'A', players: 0, max: 2 }]
  let seenSignal: AbortSignal | undefined
  const f = fakeFetch({
    '/r': async () => new Response(JSON.stringify(rooms)),
    '/slow': (signal) => {
      seenSignal = signal
      return hang(signal)
    },
  })
  const lobby = new Lobby({ url: '/r', fetchImpl: f, intervalMs: 10000 })
  const got = new Promise<RoomInfo[]>((r) => lobby.on('rooms', r, { once: true }))
  lobby.start()
  assert.deepEqual(await got, rooms)
  const joined = new Promise<{ name: string }>((r) => lobby.on('join', r))
  lobby.join('a', '   Nazar-the-very-long-pilot-name ')
  assert.equal((await joined).name, 'Nazar-the-very-l')
  assert.equal(lobby.open, false)
  assert.throws(() => lobby.join('zzz', 'x'), /No room/)

  const l2 = new Lobby({ url: '/slow', fetchImpl: f, intervalMs: 10000 })
  let errors = 0
  l2.on('error', () => void errors++)
  l2.start()
  const p = l2.refresh()
  l2.close()
  await p
  assert.equal(seenSignal?.aborted, true)
  assert.equal(errors, 0, 'abort при виході — не помилка')
})

test('Lobby: відповідь не тієї форми → подія error (zod)', async () => {
  const lobby = new Lobby({
    url: '/bad',
    fetchImpl: fakeFetch({ '/bad': new Response('[{"id":1}]') }),
    intervalMs: 10000,
  })
  const err = new Promise<unknown>((r) => lobby.on('error', r))
  lobby.start()
  assert.equal((await err) instanceof Error, true)
  lobby.close()
})

test('Lobby: таймаут запиту → подія error', async () => {
  const lobby = new Lobby({
    url: '/hang',
    fetchImpl: fakeFetch({ '/hang': hang }),
    timeoutMs: 30,
    intervalMs: 10000,
  })
  const err = new Promise<unknown>((r) => lobby.on('error', r))
  lobby.start()
  const e = await err
  assert.equal(e instanceof Error ? e.name : '', 'TimeoutError')
  lobby.close()
})

test('GameBus: on/emit/відписка, тип даних за назвою події', () => {
  const bus = new GameBus()
  const seen: number[] = []
  const off = bus.on('hit', (d) => void seen.push(d.target))
  bus.emit('hit', { target: asEntityId(1), by: -1 })
  off()
  bus.emit('hit', { target: asEntityId(2), by: -1 })
  assert.deepEqual(seen, [1])
})

test('sim/ не імпортує audio, HUD чи DOM', () => {
  for (const f of [
    'world.ts',
    'entity.ts',
    'behaviors.ts',
    'collision.ts',
    'ship.ts',
    'vector.ts',
  ]) {
    const src = readFileSync(
      new URL(`../../shared/src/sim/${f}`, import.meta.url),
      'utf8',
    )
    assert.doesNotMatch(src, /audio|hud|document\.|window\./, f)
  }
})
