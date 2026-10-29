import { fetchJson } from '../assets/loader.js'

/**
 * Lobby — лише дані й події, без DOM.
 * Події: "rooms" (detail: масив кімнат), "error" (detail: Error), "join" (detail: {room, name}).
 * Поки лобі видиме — оновлення за інтервалом; на кожен запит AbortSignal.timeout;
 * close() скасовує запит, що летить, і зупиняє таймер.
 */
export class Lobby extends EventTarget {
  #controller = null
  #timer = 0
  #inflight = null

  constructor({
    url = '/api/rooms',
    intervalMs = 5000,
    timeoutMs = 3000,
    fetchImpl,
  } = {}) {
    super()
    this.url = url
    this.intervalMs = intervalMs
    this.timeoutMs = timeoutMs
    this.fetchImpl = fetchImpl
    this.rooms = []
    this.open = false
  }

  start() {
    if (this.open) return
    this.open = true
    this.#controller = new AbortController()
    this.refresh()
    this.#timer = setInterval(() => this.refresh(), this.intervalMs)
  }

  /** Один запит. Якщо попередній ще летить — не дублюємо. */
  refresh() {
    if (!this.open) return Promise.resolve(this.rooms)
    if (this.#inflight) return this.#inflight
    const signal = AbortSignal.any([
      this.#controller.signal,
      AbortSignal.timeout(this.timeoutMs),
    ])
    this.#inflight = fetchJson(this.url, { signal, fetchImpl: this.fetchImpl })
      .then((rooms) => {
        if (!Array.isArray(rooms)) throw new TypeError('rooms: expected array')
        this.rooms = rooms
        this.dispatchEvent(new CustomEvent('rooms', { detail: rooms }))
        return rooms
      })
      .catch((err) => {
        // abort через close() — нормальне завершення, не помилка для користувача
        if (err?.name === 'AbortError' && !this.open) return this.rooms
        this.dispatchEvent(new CustomEvent('error', { detail: err }))
        return this.rooms
      })
      .finally(() => {
        this.#inflight = null
      })
    return this.#inflight
  }

  join(roomId, name) {
    const room = this.rooms.find((r) => r.id === roomId)
    if (!room) throw new Error(`No room ${roomId}`)
    const clean =
      String(name ?? '')
        .trim()
        .slice(0, 16) || 'pilot'
    this.close()
    this.dispatchEvent(new CustomEvent('join', { detail: { room, name: clean } }))
  }

  close() {
    this.open = false
    clearInterval(this.#timer)
    this.#controller?.abort()
  }
}
