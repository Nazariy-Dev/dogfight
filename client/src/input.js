/**
 * createInput — стан клавіатури, захований у замиканні.
 *
 * `down` і `pressed` — приватні Set: ззовні до них не дістатися, лише через
 * повернені функції. isDown — рівень (клавіша зараз затиснута),
 * justPressed — фронт (клавішу натиснули з моменту останнього consume()).
 * consume() викликається наприкінці кроку симуляції, тож одне натискання
 * дає рівно один justPressed навіть якщо в кадрі кілька кроків.
 */
export function createInput(target) {
  const down = new Set()
  const pressed = new Set()

  function onKeyDown(e) {
    if (!e.repeat && !down.has(e.code)) pressed.add(e.code)
    down.add(e.code)
  }
  function onKeyUp(e) {
    down.delete(e.code)
  }
  // при втраті фокусу keyup може не прийти — відпускаємо все
  function onBlur() {
    down.clear()
  }

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

/** Ігрові дії з клавіш: відокремлює фізику від конкретної розкладки. */
export function readControls(input) {
  return {
    left: input.isDown('ArrowLeft') || input.isDown('KeyA'),
    right: input.isDown('ArrowRight') || input.isDown('KeyD'),
    thrust: input.isDown('ArrowUp') || input.isDown('KeyW'),
    fire: input.isDown('Space'),
  }
}
