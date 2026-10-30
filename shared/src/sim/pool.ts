/**
 * Пул об'єктів: замість new на кожну частинку беремо готовий об'єкт і повертаємо після використання.
 * Зменшує кількість короткоживучих алокацій і, отже, роботу збирача сміття.
 */
export class Pool<T> {
  readonly #free: T[] = []
  readonly #create: () => T
  created = 0
  constructor(create: () => T, prefill = 0) {
    this.#create = create
    for (let i = 0; i < prefill; i++) this.#free.push(this.#make())
  }
  #make(): T {
    this.created += 1
    return this.#create()
  }
  acquire(): T {
    return this.#free.pop() ?? this.#make()
  }
  release(obj: T): void {
    this.#free.push(obj)
  }
  get available(): number {
    return this.#free.length
  }
}
