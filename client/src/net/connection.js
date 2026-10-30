/**
 * Обгортка WebSocket: черга send, поки з'єднання не відкрите, розбір
 * повідомлень за type і повторне підключення з дедалі довшою паузою
 * (exponential backoff + jitter). Після реконекту join надсилається знову.
 */
export class Connection extends EventTarget {
  #ws = null
  #queue = []
  #attempt = 0
  #timer = 0
  #closedByUser = false

  constructor(
    url,
    {
      WebSocketImpl = globalThis.WebSocket,
      baseMs = 300,
      maxMs = 8000,
      random = Math.random,
      onOpenMessages = () => [],
    } = {},
  ) {
    super()
    this.url = url
    this.WS = WebSocketImpl
    this.baseMs = baseMs
    this.maxMs = maxMs
    this.random = random
    this.onOpenMessages = onOpenMessages // що слати після кожного (ре)коннекту, наприклад join
    this.status = 'idle'
  }

  connect() {
    this.#closedByUser = false
    this.#open()
    return this
  }

  #set(status, detail) {
    this.status = status
    this.dispatchEvent(new CustomEvent('status', { detail: { status, ...detail } }))
  }

  #open() {
    this.#set('connecting', { attempt: this.#attempt })
    const ws = new this.WS(this.url)
    this.#ws = ws
    ws.onopen = () => {
      this.#attempt = 0
      this.#set('open')
      for (const m of this.onOpenMessages()) ws.send(JSON.stringify(m))
      const q = this.#queue
      this.#queue = []
      for (const m of q) ws.send(m)
    }
    ws.onmessage = (e) => {
      let msg
      try {
        msg = JSON.parse(e.data)
      } catch {
        return
      }
      if (msg && typeof msg.type === 'string')
        this.dispatchEvent(new CustomEvent(msg.type, { detail: msg }))
    }
    ws.onclose = (e) => {
      this.#ws = null
      this.#set('closed', { code: e.code, reason: e.reason })
      // коди 4xxx від сервера (помилка протоколу, кімната повна) — не перепідключаємось
      if (this.#closedByUser || (e.code >= 4000 && e.code < 5000)) return
      this.#schedule()
    }
    ws.onerror = () => {} // деталі прийдуть у close
  }

  #schedule() {
    const delay = Math.round(
      this.random() * Math.min(this.maxMs, this.baseMs * 2 ** this.#attempt),
    )
    this.#attempt += 1
    this.#set('reconnecting', { delay, attempt: this.#attempt })
    this.#timer = setTimeout(() => this.#open(), delay)
  }

  send(msg) {
    const data = JSON.stringify({ v: 0, ...msg })
    if (this.#ws && this.#ws.readyState === 1) this.#ws.send(data)
    else this.#queue.push(data)
  }

  close() {
    this.#closedByUser = true
    clearTimeout(this.#timer)
    this.#ws?.close(1000, 'bye')
  }
}

export function wsUrl(path = '/ws') {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${location.host}${path}`
}
