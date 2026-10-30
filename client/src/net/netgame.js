import {
  decodeSnapshot,
  encodeInput,
  jsonCodec,
} from '@dogfight/shared/protocol/codec.js'
import { predictStep, reconcile, wrappedDelta } from '@dogfight/shared/net/reconcile.js'
import { SnapshotBuffer } from '@dogfight/shared/net/interpolation.js'
import { FLAG } from '@dogfight/shared/net/snapshot.js'
import { createLagSim } from './lagsim.js'

export const SERVER_DT = 1 / 30

/**
 * Мережевий клієнт гри.
 *  - кожен крок (30 Гц) шле input із seq;
 *  - predict=true: власний корабель рухається одразу (та сама integrate, що на сервері);
 *  - на знімку: reconcile — стан сервера + повторне програвання непідтверджених input;
 *  - поправку згладжуємо приблизно за 100 мс;
 *  - чужі сутності — інтерполяція в минулому на interpDelay мс.
 */
export class NetGame {
  constructor({
    socket,
    shipId,
    arena,
    predict = true,
    interpDelay = 100,
    codec = 'binary',
    lag = {},
  }) {
    this.socket = socket // сирий WebSocket з binaryType='arraybuffer'
    this.shipId = shipId
    this.w = arena.w
    this.h = arena.h
    this.predict = predict
    this.interpDelay = interpDelay
    this.codec = codec
    this.lag = createLagSim(lag)
    this.seq = 0
    this.pending = []
    this.me = null // передбачений стан
    this.offset = { x: 0, y: 0 } // візуальна поправка, що згасає
    this.buffer = new SnapshotBuffer()
    this.lastSnap = null
    this.sentAt = new Map() // seq → час відправки (для RTT)
    this.ng = {
      rtt: 0,
      snapAge: 0,
      bytesIn: 0,
      bytesPerSec: 0,
      pending: 0,
      correction: 0,
      corrections: [],
    }
    this._bytesWin = 0
    this._bytesT = performance.now()
    socket.addEventListener('message', (e) =>
      this.lag.deliver(() => this.onMessage(e.data)),
    )
  }

  onMessage(data) {
    if (typeof data === 'string') {
      const m = JSON.parse(data)
      if (m.type !== 'snapshot') return
      this._bytesWin += data.length
      return this.onSnapshot(m)
    }
    this._bytesWin += data.byteLength
    this.onSnapshot(decodeSnapshot(data))
  }

  onSnapshot(snap) {
    const now = performance.now()
    this.lastSnap = { ...snap, at: now }
    this.buffer.push(now, snap.entities)
    if (this.sentAt.has(snap.ackSeq)) {
      this.ng.rtt = now - this.sentAt.get(snap.ackSeq)
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
    // згладжування: малюємо зі зсувом, який згасає за ~100 мс
    if (d < 120) {
      this.offset.x += dx
      this.offset.y += dy
    } else this.offset = { x: 0, y: 0 } // великий стрибок (респаун) — без згладжування
    this.me = { ...mine, ...r.state }
  }

  /** Один клієнтський крок 30 Гц: відправити input і передбачити. */
  step(controls) {
    const inp = { seq: ++this.seq, ...controls }
    this.sentAt.set(inp.seq, performance.now())
    const data = this.codec === 'json' ? jsonCodec.encodeInput(inp) : encodeInput(inp)
    this.lag.deliver(() => this.socket.readyState === 1 && this.socket.send(data))
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
    if (now - this._bytesT >= 1000) {
      this.ng.bytesPerSec = (this._bytesWin * 1000) / (now - this._bytesT)
      this._bytesWin = 0
      this._bytesT = now
    }
    this.ng.pending = this.pending.length
    this.ng.snapAge = this.lastSnap ? now - this.lastSnap.at : 0
  }

  /** Що малювати: чужі — з буфера в минулому, свій — передбачений + поправка. */
  view() {
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
