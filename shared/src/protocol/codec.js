/**
 * Бінарний протокол v1 (little-endian). Специфікація:
 *
 * Input (клієнт → сервер), 7 байтів:
 *   u8 version | u8 type=1 | u32 seq | u8 buttons (bit0 left, bit1 right, bit2 thrust, bit3 fire)
 *
 * Snapshot (сервер → клієнт), 12 + 25·N байтів:
 *   u8 version | u8 type=2 | u32 tick | u32 ackSeq | u16 count
 *   далі count записів по 25 байтів:
 *   u32 id | u8 kind | f32 x | f32 y | f32 vx | f32 vy | i16 angle | u8 hp | u8 flags
 *   angle квантований: round(wrapPi(a) / π · 32767), крок ≈ 0,0055° (9,6e-5 рад)
 *   flags: bit0 thrusting, bit1 dead, bit2 shield, bit3 homing
 */
export const VERSION = 1
export const T_INPUT = 1
export const T_SNAPSHOT = 2
export const KINDS = ['ship', 'bullet', 'asteroid', 'explosion', 'pickup']
export const INPUT_BYTES = 7
export const SNAP_HEADER = 12
export const ENTITY_BYTES = 25
const ANGLE_SCALE = 32767 / Math.PI

export class CodecError extends Error {
  constructor(msg) {
    super(msg)
    this.name = 'CodecError'
  }
}

export const wrapPi = (a) => {
  const t = (((a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
  return t - Math.PI
}
export const quantizeAngle = (a) => Math.round(wrapPi(a) * ANGLE_SCALE)
export const dequantizeAngle = (q) => q / ANGLE_SCALE

export function encodeInput({ seq, left, right, thrust, fire }) {
  const buf = new ArrayBuffer(INPUT_BYTES)
  const v = new DataView(buf)
  v.setUint8(0, VERSION)
  v.setUint8(1, T_INPUT)
  v.setUint32(2, seq >>> 0, true)
  v.setUint8(6, (left ? 1 : 0) | (right ? 2 : 0) | (thrust ? 4 : 0) | (fire ? 8 : 0))
  return buf
}

function view(buf) {
  if (buf instanceof ArrayBuffer) return new DataView(buf)
  if (ArrayBuffer.isView(buf))
    return new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  throw new CodecError('not a buffer')
}

function header(v, type) {
  if (v.byteLength < 2) throw new CodecError('too short')
  if (v.getUint8(0) !== VERSION) throw new CodecError(`bad version ${v.getUint8(0)}`)
  if (v.getUint8(1) !== type) throw new CodecError(`bad type ${v.getUint8(1)}`)
}

export function decodeInput(buf) {
  const v = view(buf)
  if (v.byteLength !== INPUT_BYTES) throw new CodecError(`input length ${v.byteLength}`)
  header(v, T_INPUT)
  const b = v.getUint8(6)
  if (b > 15) throw new CodecError('bad buttons')
  return {
    seq: v.getUint32(2, true),
    left: !!(b & 1),
    right: !!(b & 2),
    thrust: !!(b & 4),
    fire: !!(b & 8),
  }
}

export function encodeSnapshot({ tick, ackSeq, entities }) {
  const buf = new ArrayBuffer(SNAP_HEADER + ENTITY_BYTES * entities.length)
  const v = new DataView(buf)
  v.setUint8(0, VERSION)
  v.setUint8(1, T_SNAPSHOT)
  v.setUint32(2, tick >>> 0, true)
  v.setUint32(6, ackSeq >>> 0, true)
  v.setUint16(10, entities.length, true)
  let o = SNAP_HEADER
  for (const e of entities) {
    const k = KINDS.indexOf(e.kind)
    if (k < 0) throw new CodecError(`unknown kind ${e.kind}`)
    v.setUint32(o, e.id, true)
    v.setUint8(o + 4, k)
    v.setFloat32(o + 5, e.x, true)
    v.setFloat32(o + 9, e.y, true)
    v.setFloat32(o + 13, e.vx, true)
    v.setFloat32(o + 17, e.vy, true)
    v.setInt16(o + 21, quantizeAngle(e.angle), true)
    v.setUint8(o + 23, Math.max(0, Math.min(255, Math.round(e.hp ?? 0))))
    v.setUint8(o + 24, e.flags ?? 0)
    o += ENTITY_BYTES
  }
  return buf
}

export function decodeSnapshot(buf) {
  const v = view(buf)
  if (v.byteLength < SNAP_HEADER) throw new CodecError('snapshot too short')
  header(v, T_SNAPSHOT)
  const count = v.getUint16(10, true)
  if (v.byteLength !== SNAP_HEADER + count * ENTITY_BYTES)
    throw new CodecError(
      `length ${v.byteLength} != ${SNAP_HEADER + count * ENTITY_BYTES}`,
    )
  const entities = new Array(count)
  let o = SNAP_HEADER
  for (let i = 0; i < count; i++) {
    const k = v.getUint8(o + 4)
    if (k >= KINDS.length) throw new CodecError(`bad kind ${k}`)
    const flags = v.getUint8(o + 24)
    if (flags > 15) throw new CodecError('bad flags')
    entities[i] = {
      id: v.getUint32(o, true),
      kind: KINDS[k],
      x: v.getFloat32(o + 5, true),
      y: v.getFloat32(o + 9, true),
      vx: v.getFloat32(o + 13, true),
      vy: v.getFloat32(o + 17, true),
      angle: dequantizeAngle(v.getInt16(o + 21, true)),
      hp: v.getUint8(o + 23),
      flags,
    }
    o += ENTITY_BYTES
  }
  return { tick: v.getUint32(2, true), ackSeq: v.getUint32(6, true), entities }
}

/** JSON-кодек з тим самим інтерфейсом — для порівняння (прапорець ?codec=json). */
export const jsonCodec = {
  encodeInput: (m) => JSON.stringify({ v: 0, type: 'input', ...m }),
  decodeInput: (s) => JSON.parse(s),
  encodeSnapshot: (s) => JSON.stringify({ v: 0, type: 'snapshot', ...s }),
  decodeSnapshot: (s) => JSON.parse(s),
}
export const binaryCodec = { encodeInput, decodeInput, encodeSnapshot, decodeSnapshot }
