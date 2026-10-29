import { createLoop } from './loop.js'
import { createInput, readControls } from './input.js'
import { World } from './sim/world.js'
import { Ship } from './sim/entity.js'
import { createCanvas } from './render/canvas.js'
import { createStarfield, drawBackground, drawHud, drawStars } from './render/draw.js'
import { drawWorld } from './render/scene.js'

const input = createInput(window)
const params = new URLSearchParams(location.search)
const seed = Number(params.get('seed') || 7)

const events = []
const world = new World({ seed, emit: (type, detail) => events.push({ type, detail }) })
world.populate()

const player = world.spawn(new Ship({ x: 200, y: 360, owner: 'local' }))
// навчальна мішень: корабель без керування, щоб перевіряти влучання куль у кораблі
const dummy = world.spawn(new Ship({ x: 1000, y: 360, owner: 'dummy', color: '#ff9f7f' }))

const { ctx, size } = createCanvas(document.querySelector('#game'))
const stars = createStarfield(world.w, world.h)

function simulate(dt) {
  player.controls = readControls(input)
  world.step(dt)
  input.consume()
}

function render(alpha, stats) {
  // масштабуємо фіксовану арену 1280×720 під вікно
  const k = Math.min(size.w / world.w, size.h / world.h)
  ctx.save()
  drawBackground(ctx, size.w, size.h)
  ctx.translate((size.w - world.w * k) / 2, (size.h - world.h * k) / 2)
  ctx.scale(k, k)
  ctx.strokeStyle = 'rgba(127,209,255,0.35)'
  ctx.strokeRect(0, 0, world.w, world.h)
  drawStars(ctx, stars)
  drawWorld(ctx, world, alpha)
  ctx.restore()
  drawHud(ctx, stats, [
    `score    ${player.score}`,
    `hp       ${player.hp}${player.dead ? ' (respawn)' : ''}`,
    `entities ${world.size}`,
  ])
}

const loop = createLoop({ simulate, render })
loop.start()
window.__game = { world, player, dummy, events, loop }
