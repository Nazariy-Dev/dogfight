/**
 * Пайплайн ассетів: fetchJson / loadImage / loadAudio / loadJson,
 * повтор з exponential backoff + jitter, loadAll з прогресом.
 * Кожна функція приймає AbortSignal і негайно зупиняється при abort.
 */

/** Помилка HTTP-статусу: окремий клас, щоб відрізняти 4xx від мережевих збоїв. */
export class HttpError extends Error {
  constructor(status, url) {
    super(`HTTP ${status} for ${url}`)
    this.name = 'HttpError'
    this.status = status
    this.url = url
  }
}

/** fetch не відхиляє проміс на 404 — перевіряємо ok самі. */
export async function fetchOk(url, { signal, fetchImpl = globalThis.fetch } = {}) {
  const res = await fetchImpl(url, { signal })
  if (!res.ok) throw new HttpError(res.status, url)
  return res
}

export async function fetchJson(url, opts = {}) {
  const res = await fetchOk(url, opts)
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch (err) {
    throw new SyntaxError(`Bad JSON in ${url}: ${err.message}`, { cause: err })
  }
}

/** Пауза, яку можна перервати сигналом. */
export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason)
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    function onAbort() {
      clearTimeout(t)
      reject(signal.reason)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** Чи має сенс повторювати: 4xx — ні (запит неправильний), JSON — ні, abort — ні. */
export function isRetryable(err) {
  if (err?.name === 'AbortError' || err?.name === 'TimeoutError') return false
  if (err instanceof HttpError)
    return err.status >= 500 || err.status === 408 || err.status === 429
  if (err instanceof SyntaxError) return false
  return true // мережеві збої (TypeError: Failed to fetch)
}

/**
 * Повтор з exponential backoff + «full jitter»: пауза випадкова в [0, base·2^n].
 * Jitter розносить повтори багатьох клієнтів у часі.
 */
export async function withRetry(
  fn,
  {
    attempts = 3,
    baseMs = 200,
    maxMs = 3000,
    signal,
    random = Math.random,
    onRetry,
  } = {},
) {
  let lastErr
  for (let i = 0; i < attempts; i++) {
    signal?.throwIfAborted()
    try {
      return await fn(i)
    } catch (err) {
      lastErr = err
      if (!isRetryable(err) || i === attempts - 1) throw err
      const delay = Math.round(random() * Math.min(maxMs, baseMs * 2 ** i))
      onRetry?.({ attempt: i + 1, delay, error: err })
      await sleep(delay, signal)
    }
  }
  throw lastErr
}

/** Обгортка callback-API зображення в проміс (браузер). */
export function loadImage(url, { signal, createImage = () => new Image() } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason)
    const img = createImage()
    const cleanup = () => signal?.removeEventListener('abort', onAbort)
    function onAbort() {
      img.src = '' // зупиняємо завантаження
      reject(signal.reason)
    }
    img.onload = () => {
      cleanup()
      resolve(img)
    }
    img.onerror = () => {
      cleanup()
      reject(new Error(`Image failed: ${url}`))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    img.src = url
  })
}

/**
 * Зображення через fetch (щоб мати статус 404 і retry), потім decode.
 * У браузері: blob → createImageBitmap.
 */
export async function loadImageFetched(url, opts = {}) {
  const res = await fetchOk(url, opts)
  const blob = await res.blob()
  return (opts.decodeImage ?? globalThis.createImageBitmap)(blob)
}

/** Звук: байти → decodeAudioData на екрані завантаження, не на першому пострілі. */
export async function loadAudio(audioCtx, url, opts = {}) {
  const res = await fetchOk(url, opts)
  const buf = await res.arrayBuffer()
  return audioCtx.decodeAudioData(buf)
}

export const loadJson = (url, opts) => fetchJson(url, opts)

/**
 * Завантажити все з маніфесту одночасно (Promise.all) з прогресом по кожному файлу.
 * Обов'язкові ассети (зображення, json) валять завантаження; звук — ні
 * (гра без звуку краще, ніж гра, що не стартує).
 */
export async function loadAll(
  manifest,
  { base = '', signal, onProgress = () => {}, audioCtx, retry = {}, loaders = {} } = {},
) {
  const img = loaders.image ?? ((u, o) => loadImageFetched(u, o))
  const snd = loaders.audio ?? ((u, o) => loadAudio(audioCtx, u, o))
  const json = loaders.json ?? ((u, o) => loadJson(u, o))

  const jobs = []
  const add = (group, key, path, load, optional = false) =>
    jobs.push({ group, key, url: base + path, load, optional })
  for (const [k, p] of Object.entries(manifest.images ?? {})) add('images', k, p, img)
  for (const [k, p] of Object.entries(manifest.json ?? {})) add('json', k, p, json)
  if (audioCtx || loaders.audio)
    for (const [k, p] of Object.entries(manifest.sounds ?? {}))
      add('sounds', k, p, snd, true)

  const total = jobs.length
  let done = 0
  const result = { images: {}, sounds: {}, json: {}, failed: [] }
  onProgress({ done, total, key: null })

  await Promise.all(
    jobs.map((job) =>
      withRetry(() => job.load(job.url, { signal }), { signal, ...retry })
        .then((value) => {
          result[job.group][job.key] = value
        })
        .catch((err) => {
          if (!job.optional || signal?.aborted) throw err
          result.failed.push({ key: job.key, error: err.message })
        })
        .finally(() => {
          done += 1
          onProgress({ done, total, key: job.key })
        }),
    ),
  )
  return result
}

/** Те саме, але послідовно — лише для порівняння часу в README. */
export async function loadAllSequential(manifest, opts = {}) {
  const t = { ...opts }
  const result = { images: {}, sounds: {}, json: {}, failed: [] }
  for (const group of ['images', 'json', 'sounds']) {
    for (const [k, p] of Object.entries(manifest[group] ?? {})) {
      const one = await loadAll({ [group]: { [k]: p } }, t)
      Object.assign(result[group], one[group])
      result.failed.push(...one.failed)
    }
  }
  return result
}
