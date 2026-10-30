import { wrappedDelta } from './reconcile.ts'
import { wrapPi, type SnapEntity } from '../protocol/codec.ts'
import type { EntityId } from '../types.ts'

/** Мінімальна форма, яку вміє інтерполювати буфер (generic — придатний і для тестів). */
export interface Interpolatable {
  readonly id: EntityId | number
  readonly x: number
  readonly y: number
  readonly angle: number
}

interface Frame<T> {
  readonly t: number
  readonly byId: ReadonlyMap<number, T>
}

/** Буфер знімків: малюємо чужих у минулому (renderTime = now − delay) між двома знімками. */
export class SnapshotBuffer<T extends Interpolatable = SnapEntity> {
  readonly items: Frame<T>[] = []
  readonly max: number
  constructor(max = 60) {
    this.max = max
  }

  push(t: number, entities: readonly T[]): void {
    this.items.push({ t, byId: new Map(entities.map((e) => [e.id, e] as const)) })
    if (this.items.length > this.max) this.items.shift()
  }

  sample(renderTime: number, w: number, h: number): T[] {
    const it = this.items
    const last = it[it.length - 1]
    if (!last) return []
    const i = it.findIndex((s) => s.t > renderTime)
    if (i === -1) return [...last.byId.values()]
    const b = it[i]!
    const a = it[i - 1]
    if (!a) return [...b.byId.values()]
    const k = (renderTime - a.t) / (b.t - a.t)
    const out: T[] = []
    for (const [id, eb] of b.byId) {
      const ea = a.byId.get(id)
      if (!ea) {
        out.push(eb)
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
