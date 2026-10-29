/**
 * Шина подій гри на EventTarget + CustomEvent.
 * Симуляція викликає bus.emit(...), а звук і HUD підписуються.
 * sim/ не імпортує ні audio.js, ні hud.js.
 */
export class GameBus extends EventTarget {
  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }))
  }
  on(type, fn, opts) {
    const h = (e) => fn(e.detail)
    this.addEventListener(type, h, opts)
    return () => this.removeEventListener(type, h)
  }
}
