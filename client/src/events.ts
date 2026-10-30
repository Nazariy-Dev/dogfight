import type { WorldEvents } from '@dogfight/shared/sim/world.ts'

/** Події гри для UI: ті самі, що емітить World. */
export type GameEvents = WorldEvents

/**
 * Типізована шина на EventTarget. K extends keyof E пов'язує назву події з типом даних:
 * bus.emit('hit', {...}) перевіряє поля саме для 'hit'.
 */
export class Bus<E extends object> extends EventTarget {
  emit<K extends keyof E & string>(type: K, detail: E[K]): void {
    this.dispatchEvent(new CustomEvent(type, { detail }))
  }
  on<K extends keyof E & string>(
    type: K,
    fn: (detail: E[K]) => void,
    opts?: AddEventListenerOptions,
  ): () => void {
    const h = (e: Event): void => {
      if (e instanceof CustomEvent) fn(e.detail)
    }
    this.addEventListener(type, h, opts)
    return () => this.removeEventListener(type, h)
  }
}

export class GameBus extends Bus<GameEvents> {}
