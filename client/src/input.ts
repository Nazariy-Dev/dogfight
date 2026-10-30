import type { Controls } from '@dogfight/shared/types.ts'

export interface Input {
  isDown(code: string): boolean
  justPressed(code: string): boolean
  consume(): void
  dispose(): void
}

/** Подія з полем code (KeyboardEvent у браузері або Event з полями в тестах Node). */
type KeyLike = Event & { code: string; repeat?: boolean }
const isKey = (e: Event): e is KeyLike => 'code' in e && typeof e.code === 'string'

/** Стан клавіатури в замиканні: Set-и приватні, назовні — лише функції. */
export function createInput(target: EventTarget): Input {
  const down = new Set<string>()
  const pressed = new Set<string>()

  const onKeyDown = (e: Event): void => {
    if (!isKey(e)) return
    if (!e.repeat && !down.has(e.code)) pressed.add(e.code)
    down.add(e.code)
  }
  const onKeyUp = (e: Event): void => {
    if (isKey(e)) down.delete(e.code)
  }
  const onBlur = (): void => down.clear()

  target.addEventListener('keydown', onKeyDown)
  target.addEventListener('keyup', onKeyUp)
  target.addEventListener('blur', onBlur)

  return {
    isDown: (code) => down.has(code),
    justPressed: (code) => pressed.has(code),
    consume: () => pressed.clear(),
    dispose() {
      target.removeEventListener('keydown', onKeyDown)
      target.removeEventListener('keyup', onKeyUp)
      target.removeEventListener('blur', onBlur)
    },
  }
}

export function readControls(input: Input): Controls {
  return {
    left: input.isDown('ArrowLeft') || input.isDown('KeyA'),
    right: input.isDown('ArrowRight') || input.isDown('KeyD'),
    thrust: input.isDown('ArrowUp') || input.isDown('KeyW'),
    fire: input.isDown('Space'),
  }
}
