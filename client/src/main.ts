import { createLoop, type Loop } from './loop.ts'
import { createInput, readControls } from './input.ts'
import { World } from '@dogfight/shared/sim/world.ts'
import { Ship } from '@dogfight/shared/sim/entity.ts'
import { asEntityId } from '@dogfight/shared/types.ts'
import { createCanvas } from './render/canvas.ts'
import { createStarfield, drawBackground, drawHud, drawStars } from './render/draw.ts'
import { drawWorld, type Sprites } from './render/scene.ts'
import { drawLoading, type Progress } from './render/loading.ts'
import {
  fetchJson,
  loadAll,
  parseManifest,
  type Loaded,
  type Manifest,
} from './assets/loader.ts'
import { GameBus } from './events.ts'
import { createAudio } from './audio.ts'
import { Lobby, type RoomInfo } from './ui/lobby.ts'
import { mountLobbyView } from './ui/lobby-view.ts'
import { mountChat } from './ui/chat-view.ts'
import { Connection, wsUrl } from './net/connection.ts'
import { NetGame, SERVER_DT } from './net/netgame.ts'
import { drawNetWorld, drawNetgraph } from './render/netscene.ts'

/** Стан застосунку для автотестів і консолі. */
interface AppState {
  state: 'loading' | 'lobby' | 'game' | 'error'
  log: string[]
  audio: ReturnType<typeof createAudio>
  lobby?: Lobby
  net?: NetGame
  world?: World
  player?: Ship
  loop?: Loop
  socket?: WebSocket
  conn?: Connection
  closed?: number
  chat?: string[]
  frameTimes?: number[]
  notice?: string | undefined
}
declare global {
  interface Window {
    __app: AppState
  }
}

type Assets = Loaded<ImageBitmap, AudioBuffer>
interface Arena {
  w: number
  h: number
  asteroids: number
  homingAsteroids: number
}

const params = new URLSearchParams(location.search)
const FAULT = params.get('fault')
const NET = params.get('net') !== '0'

function el<E extends Element>(sel: string): E {
  const e = document.querySelector<E>(sel)
  if (!e) throw new Error(`missing ${sel}`)
  return e
}
const ui = el<HTMLDivElement>('#ui')
const { ctx, size } = createCanvas(el<HTMLCanvasElement>('#game'))
const audio = createAudio()
const bus = new GameBus()
audio.attach(bus)
const app: AppState = { state: 'loading', log: [], audio }
window.__app = app
const log = (msg: string): void => {
  app.log.push(msg)
  console.log(msg)
}

function applyFault(manifest: Manifest): Manifest {
  const m = structuredClone(manifest)
  m.images ??= {}
  m.json ??= {}
  if (FAULT === '404') m.images.ships = 'assets/missing-ships.png'
  if (FAULT === 'slow') m.images.rocks += '?delay=2500'
  if (FAULT === 'timeout' || FAULT === 'abort') m.images.rocks += '?delay=8000'
  if (FAULT === 'badjson') m.json.arena = 'assets/broken.json'
  return m
}

function readArena(raw: unknown): Arena {
  const def: Arena = { w: 1280, h: 720, asteroids: 5, homingAsteroids: 1 }
  if (typeof raw !== 'object' || raw === null) return def
  const num = (k: keyof Arena): number => {
    const v: unknown = Reflect.get(raw, k)
    return typeof v === 'number' && Number.isFinite(v) ? v : def[k]
  }
  return {
    w: num('w'),
    h: num('h'),
    asteroids: num('asteroids'),
    homingAsteroids: num('homingAsteroids'),
  }
}

async function boot(): Promise<void> {
  app.state = 'loading'
  ui.innerHTML = ''
  const controller = new AbortController()
  const signal = AbortSignal.any([
    controller.signal,
    AbortSignal.timeout(FAULT === 'timeout' ? 1500 : 15000),
  ])
  if (FAULT === 'abort') setTimeout(() => controller.abort(), 600)
  let progress: Progress = { done: 0, total: 1, key: null }
  const draw = (): void => drawLoading(ctx, size.w, size.h, progress)
  const t0 = performance.now()
  try {
    const manifest = applyFault(
      parseManifest(await fetchJson('assets/manifest.json', { signal })),
    )
    const assets = await loadAll<ImageBitmap, AudioBuffer>(manifest, {
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
  } catch (err: unknown) {
    const name = err instanceof Error ? err.name : 'Error'
    const message = err instanceof Error ? err.message : String(err)
    const reason =
      name === 'TimeoutError'
        ? 'таймаут мережі'
        : name === 'AbortError'
          ? 'завантаження скасовано'
          : message
    log(`load failed: ${name}: ${message}`)
    progress = { ...progress, error: reason }
    draw()
    app.state = 'error'
    ui.innerHTML = `<div class="overlay"><p>Не вдалося завантажити гру: ${reason}</p><button id="retry">Retry</button></div>`
    el<HTMLButtonElement>('#retry').addEventListener('click', () => {
      params.delete('fault')
      history.replaceState(null, '', `?${params.toString()}`)
      location.reload()
    })
  }
}

function showLobby(assets: Assets, notice?: string): void {
  app.state = 'lobby'
  app.notice = notice
  ui.innerHTML = ''
  drawBackground(ctx, size.w, size.h)
  const lobby = new Lobby({
    url: '/api/rooms',
    intervalMs: notice ? 1500 : 4000,
    timeoutMs: 2500,
  })
  const unmount = mountLobbyView(ui, lobby, notice)
  lobby.on('join', ({ room, name }) => {
    unmount()
    void audio.unlock() // клік по Join — жест користувача
    if (NET) startNetGame(assets, room, name)
    else startLocalGame(assets, room, name)
  })
  lobby.start()
  app.lobby = lobby
}

/** Lab 5+: сервер рахує світ, клієнт шле input, передбачає себе й інтерполює інших. */
function startNetGame(assetsRef: Assets, room: RoomInfo, name: string): void {
  app.state = 'game'
  const codec = params.get('codec') === 'json' ? 'json' : 'binary'
  const lag = {
    latencyMs: Number(params.get('lat') ?? 0),
    jitterMs: Number(params.get('jit') ?? 0),
    dropRate: Number(params.get('drop') ?? 0),
  }
  const predict = params.get('predict') !== '0'
  let socket: WebSocket | null = null
  const input = createInput(window)
  const stars = createStarfield(1280, 720)
  let game: NetGame | null = null
  let roster: string[] = []
  let chat: string[] = []
  // NetGame працює з сирим сокетом (бінарні знімки), Connection — з JSON-подіями
  const connWithRaw = new Connection(wsUrl(), {
    binary: true,
    onOpenMessages: () => [{ v: 0, type: 'join', room: room.id, name, codec }],
  })
  connWithRaw.on('socket', (ws) => (socket = ws))
  connWithRaw.on('welcome', (m) => {
    if (!socket || m.ship === null || !m.arena) return
    game = new NetGame({
      socket,
      shipId: asEntityId(m.ship),
      arena: m.arena,
      predict,
      codec,
      lag,
      interpDelay: Number(params.get('interp') ?? 100),
    })
    app.net = game
  })
  connWithRaw.on('roster', (m) => (roster = m.players.map((p) => p.name)))
  connWithRaw.on('chat', (m) => {
    chat = [...chat.slice(-3), `${m.from}: ${m.text}`]
    app.chat = chat
  })
  // Сервер зупинився або впав: повертаємо гравця в лобі з повідомленням.
  // Лобі саме опитує /api/rooms з backoff, тож щойно сервер підніметься — список з'явиться.
  let backToLobby = false
  const leave = (why: string): void => {
    if (backToLobby) return
    backToLobby = true
    connWithRaw.close()
    loop.stop()
    input.dispose()
    app.net = undefined
    showLobby(assetsRef, why)
  }
  connWithRaw.on('shutdown', () =>
    leave('Сервер перезапускається — оберіть кімнату ще раз'),
  )
  connWithRaw.on('status', (s) => {
    if (s.status === 'closed') app.closed = s.code
    if (s.status === 'closed' && s.code !== 1000)
      leave(`З'єднання втрачено (код ${s.code ?? '?'})`)
  })
  connWithRaw.connect()
  app.conn = connWithRaw

  const frameTimes: number[] = []
  app.frameTimes = frameTimes
  const loop = createLoop({
    step: SERVER_DT,
    onFrame: (_now, st) => {
      if (frameTimes.length < 20000) frameTimes.push(st.frameTimeMs)
    },
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
        `build    ${version}`,
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
  app.loop = loop
}

/** Lab 1–4: локальна гра (?net=0). */
function startLocalGame(assets: Assets, room: RoomInfo, name: string): void {
  app.state = 'game'
  const conn = new Connection(wsUrl(), {
    onOpenMessages: () => [{ v: 0, type: 'join', room: room.id, name }],
  })
  mountChat(ui, conn)
  conn.connect()
  app.conn = conn
  const arena = { ...readArena(assets.json.arena), ...room.arena }
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
  const sprites: Sprites = assets.images
  let lastEvent = ''
  for (const t of ['hit', 'exploded', 'picked'] as const) bus.on(t, () => (lastEvent = t))

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
      drawWorld(ctx, world, alpha, sprites)
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
  Object.assign(app, { world, player, loop })
}

// PWA: service worker лише в production-збірці
if ('serviceWorker' in navigator && import.meta.env.PROD)
  void navigator.serviceWorker.register('/sw.js')

// версія збірки (git SHA) з /health — у HUD
let version = '…'
void fetch('/health')
  .then((r) => r.json())
  .then((h: unknown) => {
    if (
      typeof h === 'object' &&
      h !== null &&
      'version' in h &&
      typeof h.version === 'string'
    )
      version = h.version
  })
  .catch(() => {})

void boot()
