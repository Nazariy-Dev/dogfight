import { createServer } from 'node:http'
import { RoomManager } from './rooms.js'
import { attachWebSocket } from './ws.js'
import { listReplays, readBody, sendJson, serveStatic, streamReplay } from './http.js'
import { startMatchLog } from './log/matchlog.js'

const ROOM_ID = /^[a-z0-9-]{1,24}$/

/** Простий логер: JSON-рядок у stdout (у Lab 8 його замінить pino). */
export function makeLogger(level = 'info', write = (s) => process.stdout.write(s)) {
  const order = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 }
  return (lvl, msg, fields = {}) => {
    if (order[lvl] < order[level]) return
    write(JSON.stringify({ t: new Date().toISOString(), lvl, msg, ...fields }) + '\n')
  }
}

/**
 * Збирає HTTP + WebSocket сервер. Не слухає порт — це робить index.js,
 * тому тести можуть підняти сервер на випадковому порту.
 */
export function createApp(
  cfg,
  { log = makeLogger(process.env.LOG_LEVEL ?? 'info') } = {},
) {
  const rooms = new RoomManager({
    maxRooms: cfg.maxRooms,
    maxPlayersPerRoom: cfg.maxPlayersPerRoom,
    persistent: ['lobby'],
  })
  const matchLogs = new Map()

  // Лог матчу для кожної кімнати
  const startLog = (room) => {
    try {
      const ml = startMatchLog(room, cfg.logDir)
      matchLogs.set(room.id, ml)
      ml.done.catch((err) =>
        log('error', 'matchlog failed', { room: room.id, err: err.message }),
      )
    } catch (err) {
      log('error', 'matchlog start failed', { room: room.id, err: err.message })
    }
  }
  for (const r of rooms.rooms.values()) startLog(r)
  rooms.on('created', (r) => startLog(r))
  rooms.on('deleted', (r) => {
    matchLogs.get(r.id)?.stop()
    matchLogs.delete(r.id)
  })

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x')
    try {
      if (url.pathname === '/health')
        return sendJson(res, 200, { ok: true, uptime: process.uptime() })
      if (url.pathname === '/api/rooms' && req.method === 'GET')
        return sendJson(res, 200, rooms.list())
      if (url.pathname === '/api/rooms' && req.method === 'POST') {
        let body
        try {
          body = JSON.parse(await readBody(req, 1024))
        } catch (err) {
          return sendJson(res, err.status ?? 400, {
            error: err.status ? err.message : 'invalid json',
          })
        }
        if (!body || typeof body.id !== 'string' || !ROOM_ID.test(body.id))
          return sendJson(res, 400, { error: 'id must match ' + ROOM_ID })
        if (rooms.get(body.id)) return sendJson(res, 409, { error: 'exists' })
        try {
          const room = rooms.create({
            id: body.id,
            name: String(body.name ?? body.id).slice(0, 32),
          })
          return sendJson(res, 201, room.toJSON())
        } catch (err) {
          return sendJson(res, 429, { error: err.message })
        }
      }
      if (url.pathname === '/api/replays')
        return sendJson(res, 200, await listReplays(cfg.logDir))
      if (url.pathname.startsWith('/api/replays/'))
        return await streamReplay(
          res,
          cfg.logDir,
          url.pathname.slice('/api/replays/'.length),
        )
      if (url.pathname === '/api/slow') {
        // Навмисне блокування циклу подій на 300 мс (демонстрація для README)
        const t = Date.now()
        while (Date.now() - t < 300) {
          /* busy */
        }
        return sendJson(res, 200, { blockedMs: Date.now() - t })
      }
      if (url.pathname.startsWith('/api/'))
        return sendJson(res, 404, { error: 'no such api' })
      if (req.method !== 'GET' && req.method !== 'HEAD')
        return sendJson(res, 405, { error: 'method' })
      return await serveStatic(req, res, cfg.staticDir)
    } catch (err) {
      log('error', 'request failed', { url: req.url, err: err.message })
      if (!res.headersSent) sendJson(res, 500, { error: 'internal' })
      else res.destroy()
    }
  })

  const ws = attachWebSocket(server, { rooms, cfg, log })

  /** Плавна зупинка: не приймати нових, закрити сокети, дописати логи. */
  async function shutdown() {
    log('info', 'shutdown start')
    server.close()
    await ws.closeAll()
    for (const ml of matchLogs.values()) ml.stop()
    await Promise.allSettled([...matchLogs.values()].map((m) => m.done))
    server.closeAllConnections?.()
    log('info', 'shutdown done')
  }

  return { server, rooms, ws, shutdown, matchLogs }
}
