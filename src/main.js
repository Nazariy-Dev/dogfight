import { createLoop } from './loop.js'
import { createInput, readControls } from './input.js'
import { cloneShip, createShip, integrate } from './sim/ship.js'
import { unwrapPrevious, wrap } from './sim/arena.js'
import { createCanvas } from './render/canvas.js'
import { interpolateShip } from './render/lerp.js'
import {
  createStarfield,
  drawBackground,
  drawHud,
  drawShip,
  drawStars,
} from './render/draw.js'

// Прапорці експериментів M4 (у звичайній грі не задані):
//   ?exp=busy      — busy-wait 100 мс у кожному 60-му кадрі
//   ?exp=interval  — setInterval(frame, 16) замість requestAnimationFrame
//   ?exp=variable  — змінний крок simulate(dt) замість акумулятора
//   ?autothrust=5  — тримати «газ» N секунд від першого кроку і записати позицію
const params = new URLSearchParams(location.search)
const EXP = params.get('exp')
const AUTO = Number(params.get('autothrust') || 0)

const input = createInput(window)
const ship = createShip()
let previous = cloneShip(ship)
let stars = []

const { ctx, size } = createCanvas(document.querySelector('#game'), {
  onResize: ({ w, h }) => {
    stars = createStarfield(w, h)
  },
})
// Фіксована стартова точка (не залежить від розміру вікна) — для порівнянь у M4.
ship.x = 400
ship.y = 300
previous = cloneShip(ship)

// Записи для вимірювань (читаються з консолі або з автотесту)
const probe = { frameTimes: [], simTime: 0, autoResult: null }
window.__probe = probe

function simulate(dt) {
  previous = cloneShip(ship)
  const controls = AUTO
    ? { thrust: probe.simTime < AUTO, left: false, right: false }
    : readControls(input)
  integrate(ship, controls, dt)
  probe.simTime += dt
  if (AUTO && !probe.autoResult && probe.simTime >= AUTO - 1e-9) {
    probe.autoResult = {
      t: +probe.simTime.toFixed(4),
      x: ship.x,
      y: ship.y,
      vx: ship.vx,
      vy: ship.vy,
    }
    console.log('autothrust', JSON.stringify(probe.autoResult))
  }
  wrap(ship, size.w, size.h)
  unwrapPrevious(previous, ship, size.w, size.h)
  input.consume()
}

let frameNo = 0
function render(alpha, stats) {
  frameNo += 1
  if (EXP === 'busy' && frameNo % 60 === 0) {
    const t = performance.now()
    while (performance.now() < t + 100) {
      /* навмисне блокування потоку */
    }
  }
  drawBackground(ctx, size.w, size.h)
  drawStars(ctx, stars)
  drawShip(ctx, interpolateShip(previous, ship, alpha, size.w, size.h))
  drawHud(ctx, stats, EXP ? [`exp      ${EXP}`] : [])
}

const loopOptions = { simulate, render, fixed: EXP !== 'variable' }
if (EXP === 'interval') {
  // setInterval(frame, 16): один таймер на весь час гри; timestamp беремо самі
  let iv = 0
  loopOptions.schedule = (cb) => {
    if (!iv) iv = setInterval(() => cb(performance.now()), 16)
    return iv
  }
  loopOptions.cancel = () => {
    clearInterval(iv)
    iv = 0
  }
}
loopOptions.onFrame = (_now, stats) => {
  if (probe.frameTimes.length < 100000) probe.frameTimes.push(stats.frameTimeMs)
}

const loop = createLoop(loopOptions)
window.__loop = loop
loop.start()
