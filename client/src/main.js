import { createLoop } from './loop.js'
import { createInput, readControls } from './input.js'
import { World } from '@dogfight/shared/sim/world.js'
import { Ship } from '@dogfight/shared/sim/entity.js'
import { createCanvas } from './render/canvas.js'
import { createStarfield, drawBackground, drawHud, drawStars } from './render/draw.js'
import { drawWorld } from './render/scene.js'
import { drawLoading } from './render/loading.js'
import { fetchJson, loadAll } from './assets/loader.js'
import { GameBus } from './events.js'
import { createAudio } from './audio.js'
import { Lobby } from './ui/lobby.js'
import { mountLobbyView } from './ui/lobby-view.js'
import { mountChat } from './ui/chat-view.js'
import { Connection, wsUrl } from './net/connection.js'
import { NetGame, SERVER_DT } from './net/netgame.js'
import { drawNetWorld, drawNetgraph } from './render/netscene.js'

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
  const lobby = new Lobby({ url: '/api/rooms', intervalMs: 4000, timeoutMs: 2500 })
  const unmount = mountLobbyView(ui, lobby)
  lobby.addEventListener('join', (e) => {
    unmount()
    audio.unlock() // клік по Join — жест користувача, AudioContext можна запускати
    startGame(assets, e.detail)
  })
  lobby.start()
  window.__app.lobby = lobby
}

// ?net=0 — стара локальна гра (Lab 1–4); інакше мережева з авторитетним сервером
const NET = params.get('net') !== '0'

function startGame(assets, opts) {
  if (NET) return startNetGame(assets, opts)
  return startLocalGame(assets, opts)
}

/** Lab 5: сервер рахує світ, клієнт шле input, передбачає себе й інтерполює інших. */
function startNetGame(assets, { room, name }) {
  window.__app.state = 'game'
  const codec = params.get('codec') === 'json' ? 'json' : 'binary'
  const lag = {
    latencyMs: Number(params.get('lat') ?? 0),
    jitterMs: Number(params.get('jit') ?? 0),
    dropRate: Number(params.get('drop') ?? 0),
  }
  const predict = params.get('predict') !== '0'
  const socket = new WebSocket(wsUrl())
  socket.binaryType = 'arraybuffer'
  const input = createInput(window)
  const stars = createStarfield(1280, 720)
  let game = null
  let roster = []
  let chat = []
  socket.addEventListener('open', () =>
    socket.send(JSON.stringify({ v: 0, type: 'join', room: room.id, name, codec })),
  )
  socket.addEventListener('message', (e) => {
    if (typeof e.data !== 'string') return
    const m = JSON.parse(e.data)
    if (m.type === 'welcome') {
      game = new NetGame({
        socket,
        shipId: m.ship,
        arena: m.arena,
        predict,
        codec,
        lag,
        interpDelay: Number(params.get('interp') ?? 100),
      })
      window.__app.net = game
    } else if (m.type === 'roster') roster = m.players.map((p) => p.name)
    else if (m.type === 'chat') chat = [...chat.slice(-3), `${m.from}: ${m.text}`]
  })
  socket.addEventListener('close', (e) => (window.__app.closed = e.code))

  const loop = createLoop({
    step: SERVER_DT,
    simulate() {
      if (!game) return
      game.step(readControls(input))
      input.consume()
    },
    render(_alpha, stats) {
      const k = Math.min(size.w / 1280, size.h / 720)
      ctx.save()
      drawBackground(ctx, size.w, size.h)
      ctx.translate((size.w - 1280 * k) / 2, (size.h - 720 * k) / 2)
      ctx.scale(k, k)
      drawStars(ctx, stars)
      if (game) drawNetWorld(ctx, game.view())
      ctx.restore()
      drawHud(ctx, stats, [
        `room     ${room.id}`,
        `pilot    ${name}`,
        `players  ${roster.join(', ')}`,
        ...chat,
      ])
      if (game)
        drawNetgraph(ctx, game.ng, size.w - 212, 8, [
          `codec    ${codec}`,
          `predict  ${predict ? 'on' : 'off'}`,
          `lag      ${lag.latencyMs}±${lag.jitterMs} ms, ${(lag.dropRate * 100).toFixed(0)}%`,
          `interp   ${game.interpDelay} ms`,
        ])
    },
  })
  loop.start()
  Object.assign(window.__app, { loop, socket })
}

function startLocalGame(assets, { room, name }) {
  window.__app.state = 'game'
  // Мережа (Lab 4): лише кімната і чат; кораблі поки локальні
  const conn = new Connection(wsUrl(), {
    onOpenMessages: () => [{ v: 0, type: 'join', room: room.id, name }],
  })
  mountChat(ui, conn)
  conn.connect()
  window.__app.conn = conn
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
