import { wrappedDelta } from './reconcile.js'
import { wrapPi } from '../protocol/codec.js'

/**
 * Буфер знімків для чужих сутностей. Малюємо в минулому: renderTime = now − delay,
 * і інтерполюємо між двома знімками, що його оточують.
 */
export class SnapshotBuffer {
  constructor({ max = 60 } = {}) {
    this.items = [] // { t, byId: Map }
    this.max = max
  }
  push(t, entities) {
    this.items.push({ t, byId: new Map(entities.map((e) => [e.id, e])) })
    if (this.items.length > this.max) this.items.shift()
  }
  /** Сутності в момент renderTime. Нові/зниклі між знімками — беремо з того знімка, де вони є. */
  sample(renderTime, w, h) {
    const it = this.items
    if (it.length === 0) return []
    let i = it.findIndex((s) => s.t > renderTime)
    if (i === -1) return [...it[it.length - 1].byId.values()] // немає нового — тримаємо останній
    if (i === 0) return [...it[0].byId.values()]
    const a = it[i - 1]
    const b = it[i]
    const k = (renderTime - a.t) / (b.t - a.t)
    const out = []
    for (const [id, eb] of b.byId) {
      const ea = a.byId.get(id)
      if (!ea) {
        out.push(eb) // з'явилась — без інтерполяції
        continue
      }
      const { dx, dy } = wrappedDelta(ea, eb, w, h)
      out.push({
        ...eb,
        x: (((ea.x + dx * k) % w) + w) % w,
        y: (((ea.y + dy * k) % h) + h) % h,
        angle: ea.angle + wrapPi(eb.angle - ea.angle) * k,
      })
    }
    return out
  }
}
