import {
  binaryCodec,
  type Codec,
  type SnapEntity,
  type Snapshot,
} from '@dogfight/shared/protocol/codec.ts'
import { jsonCodec } from '@dogfight/shared/protocol/messages.ts'
import { predictStep, reconcile, wrappedDelta } from '@dogfight/shared/net/reconcile.ts'
import { SnapshotBuffer } from '@dogfight/shared/net/interpolation.ts'
import { FLAG } from '@dogfight/shared/net/snapshot.ts'
import {
  asSeq,
  type Controls,
  type EntityId,
  type Input,
  type Seq,
} from '@dogfight/shared/types.ts'
import { createLagSim, type LagConfig } from './lagsim.ts'

export const SERVER_DT = 1 / 30

/** Передбачений власний корабель: знімок + змінні поля фізики. */
type MyShip = { -readonly [K in keyof SnapEntity]: SnapEntity[K] }

export interface Netgraph {
  rtt: number
  snapAge: number
  bytesPerSec: number
  pending: number
  correction: number
  corrections: number[]
}

/** Мережевий клієнт: input із seq, передбачення, звірка, згладжування, інтерполяція чужих. */
export class NetGame {
  readonly socket: WebSocket
  readonly shipId: EntityId
  readonly w: number
  readonly h: number
  readonly predict: boolean
  interpDelay: number
  readonly codec: Codec
  readonly lag: ReturnType<typeof createLagSim>
  seq = 0
  pending: Input[] = []
  me: MyShip | null = null
  offset = { x: 0, y: 0 }
  readonly buffer = new SnapshotBuffer<SnapEntity>()
  lastSnap: (Snapshot & { at: number }) | null = null
  readonly sentAt = new Map<Seq, number>()
  readonly ng: Netgraph = {
    rtt: 0,
    snapAge: 0,
    bytesPerSec: 0,
    pending: 0,
    correction: 0,
    corrections: [],
  }
  #bytesWin = 0
  #bytesT = performance.now()

  constructor({
    socket,
    shipId,
    arena,
    predict = true,
    interpDelay = 100,
    codec = 'binary',
    lag = {},
  }: {
    socket: WebSocket
    shipId: EntityId
    arena: { w: number; h: number }
    predict?: boolean
    interpDelay?: number
    codec?: 'binary' | 'json'
    lag?: Partial<LagConfig>
  }) {
    this.socket = socket
    this.shipId = shipId
    this.w = arena.w
    this.h = arena.h
    this.predict = predict
    this.interpDelay = interpDelay
    this.codec = codec === 'json' ? jsonCodec : binaryCodec
    this.lag = createLagSim(lag)
    socket.addEventListener('message', (e: MessageEvent<unknown>) =>
      this.lag.deliver(() => this.onMessage(e.data)),
    )
  }

  onMessage(data: unknown): void {
    if (typeof data === 'string') {
      if (!data.includes('"snapshot"')) return
      this.#bytesWin += data.length
    } else if (data instanceof ArrayBuffer) this.#bytesWin += data.byteLength
    else return
    this.onSnapshot(this.codec.decodeSnapshot(data))
  }

  onSnapshot(snap: Snapshot): void {
    const now = performance.now()
    this.lastSnap = { ...snap, at: now }
    this.buffer.push(now, snap.entities)
    const sent = this.sentAt.get(snap.ackSeq)
    if (sent !== undefined) {
      this.ng.rtt = now - sent
      for (const k of this.sentAt.keys()) if (k <= snap.ackSeq) this.sentAt.delete(k)
    }
    const mine = snap.entities.find((e) => e.id === this.shipId)
    if (!mine) return
    if (!this.predict || !this.me || mine.flags & FLAG.DEAD) {
      this.me = { ...mine }
      this.pending = this.pending.filter((p) => p.seq > snap.ackSeq)
      return
    }
    const before = { x: this.me.x, y: this.me.y }
    const r = reconcile(mine, snap.ackSeq, this.pending, SERVER_DT, this.w, this.h)
    this.pending = r.pending
    const { dx, dy, d } = wrappedDelta(r.state, before, this.w, this.h)
    this.ng.correction = d
    this.ng.corrections.push(d)
    if (this.ng.corrections.length > 300) this.ng.corrections.shift()
    if (d < 120) {
      this.offset.x += dx
      this.offset.y += dy
    } else this.offset = { x: 0, y: 0 }
    this.me = { ...mine, ...r.state }
  }

  step(controls: Controls): void {
    const inp: Input = { seq: asSeq(++this.seq), ...controls }
    this.sentAt.set(inp.seq, performance.now())
    const data = this.codec.encodeInput(inp)
    this.lag.deliver(() => {
      if (this.socket.readyState === 1) this.socket.send(data)
    })
    if (this.predict && this.me && !(this.me.flags & FLAG.DEAD)) {
      this.pending.push(inp)
      if (this.pending.length > 120) this.pending.shift()
      predictStep(this.me, inp, SERVER_DT, this.w, this.h)
      this.me.flags = controls.thrust
        ? this.me.flags | FLAG.THRUST
        : this.me.flags & ~FLAG.THRUST
    }
    const decay = Math.exp((-SERVER_DT / 0.1) * 3)
    this.offset.x *= decay
    this.offset.y *= decay
    const now = performance.now()
    if (now - this.#bytesT >= 1000) {
      this.ng.bytesPerSec = (this.#bytesWin * 1000) / (now - this.#bytesT)
      this.#bytesWin = 0
      this.#bytesT = now
    }
    this.ng.pending = this.pending.length
    this.ng.snapAge = this.lastSnap ? now - this.lastSnap.at : 0
  }

  view(): { others: SnapEntity[]; me: SnapEntity | null } {
    const t = performance.now() - this.interpDelay
    const others = this.buffer
      .sample(t, this.w, this.h)
      .filter((e) => e.id !== this.shipId)
    const me = this.me && {
      ...this.me,
      x: this.me.x + this.offset.x,
      y: this.me.y + this.offset.y,
    }
    return { others, me }
  }
}
