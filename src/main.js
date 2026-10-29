import { createLoop } from './loop.js'
import { createInput, readControls } from './input.js'
import { World } from './sim/world.js'
import { Ship } from './sim/entity.js'
import { createCanvas } from './render/canvas.js'
import { createStarfield, drawBackground, drawHud, drawStars } from './render/draw.js'
import { drawWorld } from './render/scene.js'
import { drawLoading } from './render/loading.js'
import { fetchJson, loadAll } from './assets/loader.js'
import { GameBus } from './events.js'
import { createAudio } from './audio.js'
import { Lobby } from './ui/lobby.js'
import { mountLobbyView } from './ui/lobby-view.js'

// ?fault=404|slow|timeout|abort|badjson — галерея збоїв (README, Lab 3)
const params = new URLSearchParams(location.search)
const FAULT = params.get('fault')
const ui = document.querySelector('#ui')
const { ctx, size } = createCanvas(document.querySelector('#game'))
const audio = createAudio()
const bus = new GameBus()
audio.attach(bus)
window.__app = { state: 'loading', log: [], audio }
const log = (msg) => {
  window.__app.log.push(msg)
  console.log(msg)
}

function applyFault(manifest) {
  const m = structuredClone(manifest)
  if (FAULT === '404') m.images.ships = 'assets/missing-ships.png'
  if (FAULT === 'slow') m.images.rocks += '?delay=2500'
  if (FAULT === 'timeout' || FAULT === 'abort') m.images.rocks += '?delay=8000'
  if (FAULT === 'badjson') m.json.arena = 'assets/broken.json'
  return m
}

async function boot() {
  window.__app.state = 'loading'
  ui.innerHTML = ''
  const controller = new AbortController()
  // таймаут на все завантаження + окремий abort для демонстрації
  const signal = AbortSignal.any([
    controller.signal,
    AbortSignal.timeout(FAULT === 'timeout' ? 1500 : 15000),
  ])
  if (FAULT === 'abort') setTimeout(() => controller.abort(), 600)
  let progress = { done: 0, total: 1, key: null }
  const draw = () => drawLoading(ctx, size.w, size.h, progress)
  const t0 = performance.now()
  try {
    const manifest = applyFault(await fetchJson('assets/manifest.json', { signal }))
    const assets = await loadAll(manifest, {
      signal,
      audioCtx: audio.ctx,
      retry: { attempts: 3, baseMs: 150 },
      onProgress: (p) => {
        progress = p
        draw()
      },
    })
    for (const [k, buf] of Object.entries(assets.sounds)) audio.buffers[k] = buf
    if (assets.failed.length) log(`optional failed: ${JSON.stringify(assets.failed)}`)
    log(`loaded in ${Math.round(performance.now() - t0)} ms`)
    showLobby(assets)
  } catch (err) {
    const reason =
      err?.name === 'TimeoutError'
        ? 'таймаут мережі'
        : err?.name === 'AbortError'
          ? 'завантаження скасовано'
          : err.message
    log(`load failed: ${err?.name}: ${err?.message}`)
    progress = { ...progress, error: reason }
    draw()
    window.__app.state = 'error'
    ui.innerHTML = `<div class="overlay"><p>Не вдалося завантажити гру: ${reason}</p><button id="retry">Retry</button></div>`
    ui.querySelector('#retry').addEventListener('click', () => {
      params.delete('fault')
      history.replaceState(null, '', `?${params}`)
      location.reload()
    })
  }
}

function showLobby(assets) {
  window.__app.state = 'lobby'
  drawBackground(ctx, size.w, size.h)
  const lobby = new Lobby({ url: 'api/rooms.json', intervalMs: 4000, timeoutMs: 2500 })
  const unmount = mountLobbyView(ui, lobby)
  lobby.addEventListener('join', (e) => {
    unmount()
    audio.unlock() // клік по Join — жест користувача, AudioContext можна запускати
    startGame(assets, e.detail)
  })
  lobby.start()
  window.__app.lobby = lobby
}

function startGame(assets, { room, name }) {
  window.__app.state = 'game'
  const arena = { ...assets.json.arena, ...room.arena }
  const input = createInput(window)
  const world = new World({
    w: arena.w,
    h: arena.h,
    seed: 7,
    emit: (t, d) => bus.emit(t, d),
  })
  world.populate(arena)
  const player = world.spawn(new Ship({ x: 200, y: 360, owner: name }))
  world.spawn(new Ship({ x: 1000, y: 360, owner: 'dummy', color: '#ff9f7f' }))
  const stars = createStarfield(world.w, world.h)
  let lastEvent = ''
  for (const t of ['hit', 'exploded', 'picked']) bus.on(t, () => (lastEvent = t))

  const loop = createLoop({
    simulate(dt) {
      player.controls = readControls(input)
      world.step(dt)
      input.consume()
    },
    render(alpha, stats) {
      const k = Math.min(size.w / world.w, size.h / world.h)
      ctx.save()
      drawBackground(ctx, size.w, size.h)
      ctx.translate((size.w - world.w * k) / 2, (size.h - world.h * k) / 2)
      ctx.scale(k, k)
      drawStars(ctx, stars)
      drawWorld(ctx, world, alpha, assets.images)
      ctx.restore()
      drawHud(ctx, stats, [
        `room     ${room.id}`,
        `pilot    ${name}`,
        `score    ${player.score}`,
        `hp       ${player.hp}`,
        `audio    ${audio.ctx?.state ?? 'none'}`,
        `event    ${lastEvent}`,
      ])
    },
  })
  loop.start()
  Object.assign(window.__app, { world, player, loop })
}

boot()
