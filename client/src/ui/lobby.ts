import { z } from 'zod'
import { fetchJson, type FetchImpl } from '../assets/loader.ts'
import { Bus } from '../events.ts'

/** Кімната з API — перевіряємо схемою, бо відповідь сервера теж «зовнішній» вхід. */
export const RoomSchema = z.object({
  id: z.string(),
  name: z.string(),
  players: z.number(),
  max: z.number(),
  arena: z
    .object({ asteroids: z.number(), homingAsteroids: z.number() })
    .partial()
    .optional(),
})
export type RoomInfo = z.infer<typeof RoomSchema>

/**
 * Lobby — дані й події без DOM: 'rooms' (RoomInfo[]), 'error' (Error), 'join' ({room, name}).
 * Оновлення за інтервалом, AbortSignal.timeout на кожен запит, close() скасовує запит.
 */
export interface LobbyEvents {
  rooms: RoomInfo[]
  error: unknown
  join: { room: RoomInfo; name: string }
}

export class Lobby extends Bus<LobbyEvents> {
  #controller: AbortController | null = null
  #timer: ReturnType<typeof setInterval> | undefined
  #inflight: Promise<RoomInfo[]> | null = null
  readonly url: string
  readonly intervalMs: number
  readonly timeoutMs: number
  readonly fetchImpl: FetchImpl | undefined
  rooms: RoomInfo[] = []
  open = false

  constructor({
    url = '/api/rooms',
    intervalMs = 5000,
    timeoutMs = 3000,
    fetchImpl,
  }: {
    url?: string
    intervalMs?: number
    timeoutMs?: number
    fetchImpl?: FetchImpl
  } = {}) {
    super()
    this.url = url
    this.intervalMs = intervalMs
    this.timeoutMs = timeoutMs
    this.fetchImpl = fetchImpl
  }

  start(): void {
    if (this.open) return
    this.open = true
    this.#controller = new AbortController()
    void this.refresh()
    this.#timer = setInterval(() => void this.refresh(), this.intervalMs)
  }

  refresh(): Promise<RoomInfo[]> {
    if (!this.open || !this.#controller) return Promise.resolve(this.rooms)
    if (this.#inflight) return this.#inflight
    const signal = AbortSignal.any([
      this.#controller.signal,
      AbortSignal.timeout(this.timeoutMs),
    ])
    this.#inflight = fetchJson(this.url, { signal, fetchImpl: this.fetchImpl })
      .then((raw) => {
        const rooms = z.array(RoomSchema).parse(raw)
        this.rooms = rooms
        this.emit('rooms', rooms)
        return rooms
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError' && !this.open)
          return this.rooms
        this.emit('error', err)
        return this.rooms
      })
      .finally(() => {
        this.#inflight = null
      })
    return this.#inflight
  }

  async create(id: string): Promise<boolean> {
    try {
      const res = await (this.fetchImpl ?? fetch)(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id }),
        signal: AbortSignal.timeout(this.timeoutMs),
      })
      if (res.ok) await this.refresh()
      return res.ok
    } catch {
      return false
    }
  }

  join(roomId: string, name: unknown): void {
    const room = this.rooms.find((r) => r.id === roomId)
    if (!room) throw new Error(`No room ${roomId}`)
    const clean =
      String(name ?? '')
        .trim()
        .slice(0, 16) || 'pilot'
    this.close()
    this.emit('join', { room, name: clean })
  }

  close(): void {
    this.open = false
    clearInterval(this.#timer)
    this.#controller?.abort()
  }
}
