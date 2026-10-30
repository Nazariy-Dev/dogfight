// Демонстрація бага з this: node scripts/this-bug.js
import { World } from '../src/sim/world.js'
import { Ship } from '../src/sim/entity.js'

const world = new World({ seed: 1 })
const ship = world.spawn(new Ship({ x: 100, y: 100 }))
const keys = new EventTarget() // замість window у браузері

function press() {
  const e = new Event('keydown')
  e.code = 'Space'
  keys.dispatchEvent(e)
}
function tryFire(label, handler) {
  ship.cooldown = 0
  keys.addEventListener('keydown', handler)
  try {
    press()
    console.log(
      `${label.padEnd(28)} -> куль у світі: ${[...world.ofKind('bullet')].length}`,
    )
  } catch (err) {
    console.log(`${label.padEnd(28)} -> ${err.constructor.name}: ${err.message}`)
  }
  keys.removeEventListener('keydown', handler)
}

// EventTarget ловить виняток зі слухача і передає його в process 'uncaughtException';
// щоб побачити помилку, перехоплюємо її тут
process.on('uncaughtException', (err) =>
  console.log(
    `${'  (наївно) помилка:'.padEnd(28)} -> ${err.constructor.name}: ${err.message}`,
  ),
)

tryFire('1) addEventListener(ship.fire)', ship.fire)
await new Promise((r) => setTimeout(r, 0))
tryFire('2) () => ship.fire()', () => ship.fire())
tryFire('3) ship.fire.bind(ship)', ship.fire.bind(ship))
const bare = ship.fire
try {
  bare()
} catch (err) {
  console.log(
    `${'4) const f = ship.fire; f()'.padEnd(28)} -> ${err.constructor.name}: ${err.message}`,
  )
}
