import { ServerMessage } from '@dogfight/shared/protocol/messages.ts'
import { Bus } from '../events.ts'

type ByType = { [M in ServerMessage as M['type']]: M }
export interface ConnectionEvents extends ByType {
  socket: WebSocket
  status: {
    status: 'idle' | 'connecting' | 'open' | 'closed' | 'reconnecting'
    attempt?: number
    delay?: number
    code?: number
    reason?: string
  }
}

/**
 * Обгортка WebSocket: черга send, розбір за type (zod-схема ServerMessage),
 * повторне підключення з backoff + jitter; onOpenMessages надсилається після кожного коннекту.
 */
export class Connection extends Bus<ConnectionEvents> {
  #ws: WebSocket | null = null
  #queue: string[] = []
  #attempt = 0
  #timer: ReturnType<typeof setTimeout> | undefined
  #closedByUser = false
  readonly url: string
  readonly WS: typeof WebSocket
  readonly baseMs: number
  readonly maxMs: number
  readonly random: () => number
  readonly onOpenMessages: () => object[]
  readonly binary: boolean
  status: ConnectionEvents['status']['status'] = 'idle'

  constructor(
    url: string,
    {
      WebSocketImpl = globalThis.WebSocket,
      baseMs = 300,
      maxMs = 8000,
      random = Math.random,
      onOpenMessages = () => [],
      binary = false,
    }: {
      binary?: boolean
      WebSocketImpl?: typeof WebSocket
      baseMs?: number
      maxMs?: number
      random?: () => number
      onOpenMessages?: () => object[]
    } = {},
  ) {
    super()
    this.url = url
    this.WS = WebSocketImpl
    this.baseMs = baseMs
    this.maxMs = maxMs
    this.random = random
    this.onOpenMessages = onOpenMessages
    this.binary = binary
  }

  connect(): this {
    this.#closedByUser = false
    this.#open()
    return this
  }

  #set(detail: ConnectionEvents['status']): void {
    this.status = detail.status
    this.emit('status', detail)
  }

  #open(): void {
    this.#set({ status: 'connecting', attempt: this.#attempt })
    const ws = new this.WS(this.url)
    if (this.binary) ws.binaryType = 'arraybuffer'
    this.#ws = ws
    this.emit('socket', ws)
    ws.onopen = () => {
      this.#attempt = 0
      this.#set({ status: 'open' })
      for (const m of this.onOpenMessages()) ws.send(JSON.stringify(m))
      const q = this.#queue
      this.#queue = []
      for (const m of q) ws.send(m)
    }
    ws.onmessage = (e: MessageEvent<unknown>) => {
      if (typeof e.data !== 'string') return
      let raw: unknown
      try {
        raw = JSON.parse(e.data)
      } catch {
        return
      }
      const r = ServerMessage.safeParse(raw)
      if (!r.success) return
      this.#dispatch(r.data)
    }
    ws.onclose = (e) => {
      this.#ws = null
      this.#set({ status: 'closed', code: e.code, reason: e.reason })
      if (this.#closedByUser || (e.code >= 4000 && e.code < 5000)) return
      this.#schedule()
    }
    ws.onerror = () => {}
  }

  /** Розсилка за type: вичерпний switch тримає назву і тип даних разом. */
  #dispatch(m: ServerMessage): void {
    switch (m.type) {
      case 'welcome':
        return this.emit('welcome', m)
      case 'roster':
        return this.emit('roster', m)
      case 'chat':
        return this.emit('chat', m)
      case 'shutdown':
        return this.emit('shutdown', m)
      default: {
        const never: never = m
        return never
      }
    }
  }

  #schedule(): void {
    const delay = Math.round(
      this.random() * Math.min(this.maxMs, this.baseMs * 2 ** this.#attempt),
    )
    this.#attempt += 1
    this.#set({ status: 'reconnecting', delay, attempt: this.#attempt })
    this.#timer = setTimeout(() => this.#open(), delay)
  }

  send(msg: object): void {
    const data = JSON.stringify({ v: 0, ...msg })
    if (this.#ws && this.#ws.readyState === 1) this.#ws.send(data)
    else this.#queue.push(data)
  }

  close(): void {
    this.#closedByUser = true
    clearTimeout(this.#timer)
    this.#ws?.close(1000, 'bye')
  }
}

export function wsUrl(path = '/ws'): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${location.host}${path}`
}
