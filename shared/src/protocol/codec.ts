/**
 * Бінарний протокол v1 (little-endian).
 * Input, 7 байтів: u8 version | u8 type=1 | u32 seq | u8 buttons (bit0 left, bit1 right, bit2 thrust, bit3 fire)
 * Snapshot, 12 + 25·N: u8 version | u8 type=2 | u32 tick | u32 ackSeq | u16 count,
 *   далі на сутність: u32 id | u8 kind | f32 x | f32 y | f32 vx | f32 vy | i16 angle | u8 hp | u8 flags
 * Кут: round(wrapPi(a)/π·32767), крок ≈ 9,6e-5 рад.
 */
import {
  asEntityId,
  asSeq,
  asTick,
  type EntityId,
  type Input,
  type Seq,
  type Tick,
} from '../types.ts'
import type { EntityKind } from '../sim/entity.ts'

export const VERSION = 1
export const T_INPUT = 1
export const T_SNAPSHOT = 2
export const KINDS = [
  'ship',
  'bullet',
  'asteroid',
  'explosion',
  'pickup',
] as const satisfies readonly EntityKind[]
export const INPUT_BYTES = 7
export const SNAP_HEADER = 12
export const ENTITY_BYTES = 25
const ANGLE_SCALE = 32767 / Math.PI
const U32 = 0xffffffff

/** Запис сутності в знімку — readonly, бо знімок лише читають. */
export interface SnapEntity {
  readonly id: EntityId
  readonly kind: EntityKind
  readonly x: number
  readonly y: number
  readonly vx: number
  readonly vy: number
  readonly angle: number
  readonly hp: number
  readonly flags: number
}
export interface Snapshot {
  readonly tick: Tick
  readonly ackSeq: Seq
  readonly entities: readonly SnapEntity[]
}

export class CodecError extends Error {
  constructor(msg: string) {
    super(msg)
    this.name = 'CodecError'
  }
}

export const wrapPi = (a: number): number => {
  const t = (((a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
  return t - Math.PI
}
export const quantizeAngle = (a: number): number => Math.round(wrapPi(a) * ANGLE_SCALE)
export const dequantizeAngle = (q: number): number => q / ANGLE_SCALE

const checkU32 = (n: number, what: string): void => {
  if (!Number.isInteger(n) || n < 0 || n > U32)
    throw new CodecError(`${what} out of range: ${n}`)
}
const checkFinite = (n: number, what: string): void => {
  if (!Number.isFinite(n)) throw new CodecError(`${what} is not finite`)
}

export function encodeInput(m: Input): ArrayBuffer {
  checkU32(m.seq, 'seq')
  const buf = new ArrayBuffer(INPUT_BYTES)
  const v = new DataView(buf)
  v.setUint8(0, VERSION)
  v.setUint8(1, T_INPUT)
  v.setUint32(2, m.seq, true)
  v.setUint8(
    6,
    (m.left ? 1 : 0) | (m.right ? 2 : 0) | (m.thrust ? 4 : 0) | (m.fire ? 8 : 0),
  )
  return buf
}

function view(buf: unknown): DataView {
  if (buf instanceof ArrayBuffer) return new DataView(buf)
  if (ArrayBuffer.isView(buf))
    return new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  throw new CodecError('not a buffer')
}

function header(v: DataView, type: number): void {
  if (v.byteLength < 2) throw new CodecError('too short')
  if (v.getUint8(0) !== VERSION) throw new CodecError(`bad version ${v.getUint8(0)}`)
  if (v.getUint8(1) !== type) throw new CodecError(`bad type ${v.getUint8(1)}`)
}

export function decodeInput(buf: unknown): Input {
  const v = view(buf)
  if (v.byteLength !== INPUT_BYTES) throw new CodecError(`input length ${v.byteLength}`)
  header(v, T_INPUT)
  const b = v.getUint8(6)
  if (b > 15) throw new CodecError('bad buttons')
  return {
    seq: asSeq(v.getUint32(2, true)),
    left: !!(b & 1),
    right: !!(b & 2),
    thrust: !!(b & 4),
    fire: !!(b & 8),
  }
}

export function encodeSnapshot(s: Snapshot): ArrayBuffer {
  checkU32(s.tick, 'tick')
  checkU32(s.ackSeq, 'ackSeq')
  if (s.entities.length > 0xffff) throw new CodecError('too many entities')
  const buf = new ArrayBuffer(SNAP_HEADER + ENTITY_BYTES * s.entities.length)
  const v = new DataView(buf)
  v.setUint8(0, VERSION)
  v.setUint8(1, T_SNAPSHOT)
  v.setUint32(2, s.tick, true)
  v.setUint32(6, s.ackSeq, true)
  v.setUint16(10, s.entities.length, true)
  let o = SNAP_HEADER
  for (const e of s.entities) {
    const k = KINDS.indexOf(e.kind)
    if (k < 0) throw new CodecError(`unknown kind ${String(e.kind)}`)
    checkU32(e.id, 'id')
    for (const [n, val] of [
      ['x', e.x],
      ['y', e.y],
      ['vx', e.vx],
      ['vy', e.vy],
      ['angle', e.angle],
    ] as const)
      checkFinite(val, n)
    v.setUint32(o, e.id, true)
    v.setUint8(o + 4, k)
    v.setFloat32(o + 5, e.x, true)
    v.setFloat32(o + 9, e.y, true)
    v.setFloat32(o + 13, e.vx, true)
    v.setFloat32(o + 17, e.vy, true)
    v.setInt16(o + 21, quantizeAngle(e.angle), true)
    v.setUint8(o + 23, Math.max(0, Math.min(255, Math.round(e.hp))))
    v.setUint8(o + 24, e.flags & 15)
    o += ENTITY_BYTES
  }
  return buf
}

export function decodeSnapshot(buf: unknown): Snapshot {
  const v = view(buf)
  if (v.byteLength < SNAP_HEADER) throw new CodecError('snapshot too short')
  header(v, T_SNAPSHOT)
  const count = v.getUint16(10, true)
  if (v.byteLength !== SNAP_HEADER + count * ENTITY_BYTES)
    throw new CodecError(
      `length ${v.byteLength} != ${SNAP_HEADER + count * ENTITY_BYTES}`,
    )
  const entities: SnapEntity[] = []
  let o = SNAP_HEADER
  for (let i = 0; i < count; i++) {
    const kind = KINDS[v.getUint8(o + 4)]
    if (kind === undefined) throw new CodecError(`bad kind ${v.getUint8(o + 4)}`)
    const flags = v.getUint8(o + 24)
    if (flags > 15) throw new CodecError('bad flags')
    entities.push({
      id: asEntityId(v.getUint32(o, true)),
      kind,
      x: v.getFloat32(o + 5, true),
      y: v.getFloat32(o + 9, true),
      vx: v.getFloat32(o + 13, true),
      vy: v.getFloat32(o + 17, true),
      angle: dequantizeAngle(v.getInt16(o + 21, true)),
      hp: v.getUint8(o + 23),
      flags,
    })
    o += ENTITY_BYTES
  }
  return {
    tick: asTick(v.getUint32(2, true)),
    ackSeq: asSeq(v.getUint32(6, true)),
    entities,
  }
}

/** Codec: два кодеки з однаковим інтерфейсом, вибір — прапорцем. */
export interface Codec {
  readonly name: 'binary' | 'json'
  encodeInput(m: Input): ArrayBuffer | string
  encodeSnapshot(s: Snapshot): ArrayBuffer | string
  decodeSnapshot(data: unknown): Snapshot
}
export const binaryCodec: Codec = {
  name: 'binary',
  encodeInput,
  encodeSnapshot,
  decodeSnapshot,
}
