/**
 * Протокол v0: JSON-повідомлення { v: 0, type, ... }.
 * validate() — ручна перевірка форми кожного вхідного повідомлення.
 * Повертає { ok: true, msg } або { ok: false, code, reason }.
 */
export const PROTOCOL_VERSION = 0

// Коди закриття WebSocket (4000–4999 — для застосунку)
export const CLOSE = {
  NORMAL: 1000,
  GOING_AWAY: 1001,
  TOO_BIG: 1009,
  BAD_MESSAGE: 4000,
  UNKNOWN_TYPE: 4001,
  BAD_VERSION: 4002,
  JOIN_TIMEOUT: 4003,
  RATE_LIMIT: 4004,
  ROOM_FULL: 4005,
  NOT_JOINED: 4006,
  SLOW_CLIENT: 4007,
  HEARTBEAT: 4008,
}

const isStr = (v, min, max) => typeof v === 'string' && v.length >= min && v.length <= max
const ROOM_ID = /^[a-z0-9-]{1,24}$/

const SCHEMAS = {
  join: (m) => isStr(m.name, 1, 16) && typeof m.room === 'string' && ROOM_ID.test(m.room),
  chat: (m) => isStr(m.text, 1, 200),
  leave: () => true,
}

export function validate(raw, { maxBytes = 4096 } = {}) {
  const size = typeof raw === 'string' ? Buffer.byteLength(raw) : raw.length
  if (size > maxBytes) return { ok: false, code: CLOSE.TOO_BIG, reason: 'too big' }
  let msg
  try {
    msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8'))
  } catch {
    return { ok: false, code: CLOSE.BAD_MESSAGE, reason: 'invalid json' }
  }
  if (msg === null || typeof msg !== 'object' || Array.isArray(msg))
    return { ok: false, code: CLOSE.BAD_MESSAGE, reason: 'not an object' }
  if (msg.v !== PROTOCOL_VERSION)
    return { ok: false, code: CLOSE.BAD_VERSION, reason: 'bad version' }
  const check = Object.hasOwn(SCHEMAS, msg.type) ? SCHEMAS[msg.type] : null
  if (!check)
    return { ok: false, code: CLOSE.UNKNOWN_TYPE, reason: `unknown type ${msg.type}` }
  if (!check(msg))
    return { ok: false, code: CLOSE.BAD_MESSAGE, reason: `bad ${msg.type}` }
  return { ok: true, msg }
}

export const out = (type, body = {}) =>
  JSON.stringify({ v: PROTOCOL_VERSION, type, ...body })
