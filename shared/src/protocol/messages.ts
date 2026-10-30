import { z } from 'zod'
import { asSeq, type Seq } from '../types.ts'
import { KINDS, CodecError, wrapPi, type Codec, type Snapshot } from './codec.ts'
import { asEntityId, asTick } from '../types.ts'

/**
 * Протокол JSON: zod-схема — єдине джерело правди. Тип виводиться зі схеми,
 * розбір у рантаймі роблять ті самі схеми (типи після збірки стираються).
 */
export const PROTOCOL_VERSION = 0
const v0 = z.literal(PROTOCOL_VERSION)
const RoomId = z.string().regex(/^[a-z0-9-]{1,24}$/)
const SeqSchema = z
  .number()
  .int()
  .min(0)
  .max(0xffffffff)
  .transform((n): Seq => asSeq(n))

export const JoinMsg = z.object({
  v: v0,
  type: z.literal('join'),
  room: RoomId,
  name: z.string().min(1).max(16),
  codec: z.enum(['json', 'binary']).optional(),
})
export const ChatMsg = z.object({
  v: v0,
  type: z.literal('chat'),
  text: z.string().min(1).max(200),
})
export const LeaveMsg = z.object({ v: v0, type: z.literal('leave') })
export const InputMsg = z.object({
  v: v0,
  type: z.literal('input'),
  seq: SeqSchema,
  left: z.boolean(),
  right: z.boolean(),
  thrust: z.boolean(),
  fire: z.boolean(),
})

export const ClientMessage = z.discriminatedUnion('type', [
  JoinMsg,
  ChatMsg,
  LeaveMsg,
  InputMsg,
])
export type ClientMessage = z.infer<typeof ClientMessage>
export type ClientMessageType = ClientMessage['type']

/** Коди закриття WebSocket (4000–4999 — застосунок). */
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
  ORIGIN: 4009,
  TOO_MANY_CONNECTIONS: 4010,
} as const
export type CloseCode = (typeof CLOSE)[keyof typeof CLOSE]

// TextDecoder є і в браузері, і в Node; lib без DOM його не описує
declare const TextDecoder: new () => { decode(b: Uint8Array): string }
const utf8Decoder = new TextDecoder()

export type ParseResult<T> =
  { ok: true; msg: T } | { ok: false; code: CloseCode; reason: string }

/**
 * Розбір вхідного повідомлення. Приймає unknown і НІКОЛИ не кидає виняток:
 * повертає Result, а викликач логує і закриває сокет.
 */
export function parseClientMessage(
  data: unknown,
  maxBytes = 4096,
): ParseResult<ClientMessage> {
  let text: string
  if (typeof data === 'string') text = data
  else if (data instanceof Uint8Array) text = utf8Decoder.decode(data)
  else return { ok: false, code: CLOSE.BAD_MESSAGE, reason: 'not text' }
  // довжина рядка в UTF-16 ≤ байтів у UTF-8 ≤ 3·довжина: досить швидка й безпечна оцінка
  if (text.length > maxBytes) return { ok: false, code: CLOSE.TOO_BIG, reason: 'too big' }
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return { ok: false, code: CLOSE.BAD_MESSAGE, reason: 'invalid json' }
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json))
    return { ok: false, code: CLOSE.BAD_MESSAGE, reason: 'not an object' }
  if (!('v' in json) || json.v !== PROTOCOL_VERSION)
    return { ok: false, code: CLOSE.BAD_VERSION, reason: 'bad version' }
  const type = 'type' in json ? json.type : undefined
  if (!ClientMessage.options.some((o) => o.shape.type.value === type))
    return { ok: false, code: CLOSE.UNKNOWN_TYPE, reason: `unknown type ${String(type)}` }
  const r = ClientMessage.safeParse(json)
  if (!r.success)
    return {
      ok: false,
      code: CLOSE.BAD_MESSAGE,
      reason: `bad ${String(type)}: ${r.error.issues[0]?.message ?? ''}`,
    }
  return { ok: true, msg: r.data }
}

/** Повідомлення сервер → клієнт (JSON-частина протоколу). */
export const ServerMessage = z.discriminatedUnion('type', [
  z.object({
    v: v0,
    type: z.literal('welcome'),
    id: z.string(),
    room: RoomId,
    ship: z.number().int().nullable(),
    arena: z.object({ w: z.number(), h: z.number() }).nullable(),
    tickHz: z.number(),
  }),
  z.object({
    v: v0,
    type: z.literal('roster'),
    room: RoomId,
    players: z.array(z.object({ id: z.string(), name: z.string() })),
  }),
  z.object({
    v: v0,
    type: z.literal('chat'),
    from: z.string(),
    id: z.string(),
    text: z.string(),
    t: z.number(),
  }),
  z.object({ v: v0, type: z.literal('shutdown'), reason: z.string() }),
])
export type ServerMessage = z.infer<typeof ServerMessage>

/**
 * Omit над union «склеює» варіанти (лишаються лише спільні поля).
 * Дистрибутивний варіант застосовує Omit до кожного члена union окремо.
 */
export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never
export const out = (m: DistributiveOmit<ServerMessage, 'v'>): string =>
  JSON.stringify({ v: PROTOCOL_VERSION, ...m })

/** JSON-варіант знімка: та сама схема даних, що й бінарна, з перевіркою на вході. */
const SnapEntitySchema = z.object({
  id: z.number().int().min(0),
  kind: z.enum(KINDS),
  x: z.number(),
  y: z.number(),
  vx: z.number(),
  vy: z.number(),
  angle: z.number(),
  hp: z.number(),
  flags: z.number().int().min(0).max(15),
})
const SnapshotJson = z.object({
  type: z.literal('snapshot'),
  tick: z.number().int().min(0),
  ackSeq: z.number().int().min(0),
  entities: z.array(SnapEntitySchema),
})

export const jsonCodec: Codec = {
  name: 'json',
  encodeInput: (m) => JSON.stringify({ v: PROTOCOL_VERSION, type: 'input', ...m }),
  encodeSnapshot: (s) =>
    JSON.stringify({
      v: PROTOCOL_VERSION,
      type: 'snapshot',
      ...s,
      entities: s.entities.map((e) => ({ ...e, angle: wrapPi(e.angle) })),
    }),
  decodeSnapshot(data: unknown): Snapshot {
    if (typeof data !== 'string') throw new CodecError('json snapshot must be text')
    let raw: unknown
    try {
      raw = JSON.parse(data)
    } catch {
      throw new CodecError('invalid json')
    }
    const r = SnapshotJson.safeParse(raw)
    if (!r.success) throw new CodecError('bad snapshot')
    return {
      tick: asTick(r.data.tick),
      ackSeq: asSeq(r.data.ackSeq),
      entities: r.data.entities.map((e) => ({ ...e, id: asEntityId(e.id) })),
    }
  },
}
