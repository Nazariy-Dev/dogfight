/**
 * Пайплайн ассетів: fetchJson / loadImage / loadAudio / loadJson, повтор з backoff + jitter,
 * loadAll з прогресом. Кожна функція приймає AbortSignal.
 */
export type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>

export interface LoadOpts {
  signal?: AbortSignal | undefined
  fetchImpl?: FetchImpl | undefined
}

export class HttpError extends Error {
  readonly status: number
  readonly url: string
  constructor(status: number, url: string) {
    super(`HTTP ${status} for ${url}`)
    this.name = 'HttpError'
    this.status = status
    this.url = url
  }
}

export async function fetchOk(
  url: string,
  { signal, fetchImpl = globalThis.fetch }: LoadOpts = {},
): Promise<Response> {
  const res = await fetchImpl(url, signal ? { signal } : {})
  if (!res.ok) throw new HttpError(res.status, url)
  return res
}

/** JSON із мережі — unknown: тип з'являється лише після перевірки у викликача. */
export async function fetchJson(url: string, opts: LoadOpts = {}): Promise<unknown> {
  const res = await fetchOk(url, opts)
  const text = await res.text()
  try {
    const value: unknown = JSON.parse(text)
    return value
  } catch (err: unknown) {
    throw new SyntaxError(
      `Bad JSON in ${url}: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    )
  }
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason)
    const onAbort = (): void => {
      clearTimeout(t)
      reject(signal?.reason)
    }
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

const errName = (err: unknown): string | undefined =>
  err instanceof Error ? err.name : undefined

export function isRetryable(err: unknown): boolean {
  const name = errName(err)
  if (name === 'AbortError' || name === 'TimeoutError') return false
  if (err instanceof HttpError)
    return err.status >= 500 || err.status === 408 || err.status === 429
  if (err instanceof SyntaxError) return false
  return true
}

export interface RetryOpts {
  attempts?: number
  baseMs?: number
  maxMs?: number
  signal?: AbortSignal | undefined
  random?: () => number
  onRetry?: (r: { attempt: number; delay: number; error: unknown }) => void
}

/** Повтор з exponential backoff + full jitter. Generic: тип результату береться з fn. */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  {
    attempts = 3,
    baseMs = 200,
    maxMs = 3000,
    signal,
    random = Math.random,
    onRetry,
  }: RetryOpts = {},
): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    signal?.throwIfAborted()
    try {
      return await fn(i)
    } catch (err: unknown) {
      lastErr = err
      if (!isRetryable(err) || i === attempts - 1) throw err
      const delay = Math.round(random() * Math.min(maxMs, baseMs * 2 ** i))
      onRetry?.({ attempt: i + 1, delay, error: err })
      await sleep(delay, signal)
    }
  }
  throw lastErr
}

export async function loadImageFetched(
  url: string,
  opts: LoadOpts & { decodeImage?: (b: Blob) => Promise<ImageBitmap> } = {},
): Promise<ImageBitmap> {
  const res = await fetchOk(url, opts)
  const blob = await res.blob()
  return (opts.decodeImage ?? createImageBitmap)(blob)
}

export async function loadAudio(
  audioCtx: BaseAudioContext,
  url: string,
  opts: LoadOpts = {},
): Promise<AudioBuffer> {
  const res = await fetchOk(url, opts)
  return audioCtx.decodeAudioData(await res.arrayBuffer())
}

export const loadJson = (url: string, opts?: LoadOpts): Promise<unknown> =>
  fetchJson(url, opts)

export interface Manifest {
  images?: Record<string, string>
  sounds?: Record<string, string>
  json?: Record<string, string>
}

export function parseManifest(raw: unknown): Manifest {
  const isRec = (v: unknown): v is Record<string, string> =>
    typeof v === 'object' &&
    v !== null &&
    Object.values(v).every((x) => typeof x === 'string')
  if (typeof raw !== 'object' || raw === null)
    throw new TypeError('manifest: expected object')
  const m: Manifest = {}
  for (const k of ['images', 'sounds', 'json'] as const) {
    const v: unknown = k in raw ? Reflect.get(raw, k) : undefined
    if (v === undefined) continue
    if (!isRec(v)) throw new TypeError(`manifest.${k}: expected map of urls`)
    m[k] = v
  }
  return m
}

type Group = keyof Manifest
export interface Loaded<I = unknown, S = unknown> {
  images: Record<string, I>
  sounds: Record<string, S>
  json: Record<string, unknown>
  failed: { key: string; error: string }[]
}
export type Loader<T> = (url: string, opts: LoadOpts) => Promise<T>

export interface LoadAllOpts<I, S> {
  base?: string
  signal?: AbortSignal
  onProgress?: (p: { done: number; total: number; key: string | null }) => void
  audioCtx?: BaseAudioContext | null
  retry?: RetryOpts
  loaders?: { image?: Loader<I>; audio?: Loader<S>; json?: Loader<unknown> }
}

/** Promise.all з прогресом; обов'язкові — зображення і json, звук — необов'язковий. */
export async function loadAll<I = ImageBitmap, S = AudioBuffer>(
  manifest: Manifest,
  {
    base = '',
    signal,
    onProgress = () => {},
    audioCtx,
    retry = {},
    loaders = {},
  }: LoadAllOpts<I, S> = {},
): Promise<Loaded<I, S>> {
  const ctx = audioCtx
  const img: Loader<unknown> = loaders.image ?? ((u, o) => loadImageFetched(u, o))
  const snd: Loader<unknown> | null =
    loaders.audio ?? (ctx ? (u, o) => loadAudio(ctx, u, o) : null)
  const json: Loader<unknown> = loaders.json ?? loadJson

  const jobs: {
    group: Group
    key: string
    url: string
    load: Loader<unknown>
    optional: boolean
  }[] = []
  const add = (group: Group, load: Loader<unknown>, optional = false): void => {
    for (const [key, p] of Object.entries(manifest[group] ?? {}))
      jobs.push({ group, key, url: base + p, load, optional })
  }
  add('images', img)
  add('json', json)
  if (snd) add('sounds', snd, true)

  const total = jobs.length
  let done = 0
  const result: Loaded<unknown, unknown> = {
    images: {},
    sounds: {},
    json: {},
    failed: [],
  }
  onProgress({ done, total, key: null })

  await Promise.all(
    jobs.map((job) =>
      withRetry(() => job.load(job.url, { signal }), { signal, ...retry })
        .then((value) => {
          result[job.group][job.key] = value
        })
        .catch((err: unknown) => {
          if (!job.optional || signal?.aborted) throw err
          result.failed.push({
            key: job.key,
            error: err instanceof Error ? err.message : String(err),
          })
        })
        .finally(() => {
          done += 1
          onProgress({ done, total, key: job.key })
        }),
    ),
  )
  return result as Loaded<I, S> // cast 4/4: значення кожної групи прийшли з відповідного Loader<I>/<S>
}

export async function loadAllSequential<I, S>(
  manifest: Manifest,
  opts: LoadAllOpts<I, S> = {},
): Promise<Loaded<I, S>> {
  const result: Loaded<I, S> = { images: {}, sounds: {}, json: {}, failed: [] }
  for (const group of ['images', 'json', 'sounds'] as const) {
    for (const [k, p] of Object.entries(manifest[group] ?? {})) {
      const one = await loadAll<I, S>({ [group]: { [k]: p } }, opts)
      Object.assign(result[group], one[group])
      result.failed.push(...one.failed)
    }
  }
  return result
}
