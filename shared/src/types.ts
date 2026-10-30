/**
 * Branded-типи: у рантаймі це звичайні числа, але компілятор не дасть
 * передати номер кроку туди, де чекають id сутності, чи seq замість tick.
 */
declare const brand: unique symbol
export type Brand<T, B extends string> = T & { readonly [brand]: B }

export type EntityId = Brand<number, 'EntityId'>
export type Tick = Brand<number, 'Tick'>
export type Seq = Brand<number, 'Seq'>

// Єдині місця, де число «стає» branded-типом (перевірка — у викликача або в zod-схемі)
export const asEntityId = (n: number): EntityId => n as EntityId // cast 1/4: конструктор бренду
export const asTick = (n: number): Tick => n as Tick // cast 2/4: конструктор бренду
export const asSeq = (n: number): Seq => n as Seq // cast 3/4: конструктор бренду

/** Кнопки гравця: усе, що клієнт може повідомити серверу. */
export interface Controls {
  readonly left: boolean
  readonly right: boolean
  readonly thrust: boolean
  readonly fire: boolean
}
export const NO_CONTROLS: Controls = {
  left: false,
  right: false,
  thrust: false,
  fire: false,
}

export interface Input extends Controls {
  readonly seq: Seq
}

/** Перевірка вичерпності switch: новий варіант union без обробника — помилка tsc. */
export function assertNever(x: never, what = 'value'): never {
  throw new Error(`Unhandled ${what}: ${JSON.stringify(x)}`)
}
