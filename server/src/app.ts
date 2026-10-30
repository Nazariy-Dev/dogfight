import { createServer, type Server } from 'node:http'
import { RoomManager, type Room } from './rooms.ts'
import { attachWebSocket, type WsApi } from './ws.ts'
import {
  HttpError,
  listReplays,
  readBody,
  sendJson,
  serveStatic,
  streamReplay,
} from './http.ts'
import { startMatchLog, type MatchLog } from './log/matchlog.ts'
import { Match } from './match.ts'
import { makeLogger, type Log } from './logger.ts'
import type { ServerConfig } from './config.ts'
import { z } from 'zod'

export { makeLogger }

const CreateRoom = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,24}$/),
  name: z.string().max(32).optional(),
})

export interface App {
  readonly server: Server
  readonly rooms: RoomManager
  readonly ws: WsApi
  readonly matches: Map<string, Match>
  readonly matchLogs: Map<string, MatchLog>
  shutdown(): Promise<void>
}

/** HTTP + WebSocket сервер. Порт не слухає — це робить index.ts (тести беруть випадковий порт). */
export function createApp(
  cfg: ServerConfig,
  { log = makeLogger(process.env.LOG_LEVEL) }: { log?: Log } = {},
): App {
  const rooms = new RoomManager({
    maxRooms: cfg.maxRooms,
    maxPlayersPerRoom: cfg.maxPlayersPerRoom,
    persistent: ['lobby'],
  })
  const matchLogs = new Map<string, MatchLog>()
  const matches = new Map<string, Match>()
  let wsApi: WsApi | null = null

  const onRoom = (room: Room): void => {
    try {
      const ml = startMatchLog(room, cfg.logDir)
      matchLogs.set(room.id, ml)
      ml.done.catch((err: unknown) =>
        log('error', 'matchlog failed', { roomId: room.id, err: String(err) }),
      )
    } catch (err: unknown) {
      log('error', 'matchlog start failed', { roomId: room.id, err: String(err) })
    }
    matches.set(
      room.id,
      new Match({
        room: room.id,
        seed: 1 + matches.size,
        send: (p, data) => wsApi?.send(p.ws, data),
      }),
    )
  }
  for (const r of rooms.rooms.values()) onRoom(r)
  rooms.on('created', onRoom)
  rooms.on('deleted', (r) => {
    matchLogs.get(r.id)?.stop()
    matchLogs.delete(r.id)
    matches.get(r.id)?.stop()
    matches.delete(r.id)
  })

  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://x')
      try {
        if (url.pathname === '/health')
          return sendJson(res, 200, { ok: true, uptime: process.uptime() })
        if (url.pathname === '/api/rooms' && req.method === 'GET')
          return sendJson(res, 200, rooms.list())
        if (url.pathname === '/api/rooms' && req.method === 'POST') {
          let body: unknown
          try {
            body = JSON.parse(await readBody(req, 1024))
          } catch (err: unknown) {
            if (err instanceof HttpError)
              return sendJson(res, err.status, { error: err.message })
            return sendJson(res, 400, { error: 'invalid json' })
          }
          const p = CreateRoom.safeParse(body)
          if (!p.success)
            return sendJson(res, 400, { error: 'id must match /^[a-z0-9-]{1,24}$/' })
          if (rooms.get(p.data.id)) return sendJson(res, 409, { error: 'exists' })
          try {
            return sendJson(
              res,
              201,
              rooms.create({ id: p.data.id, name: p.data.name ?? p.data.id }).toJSON(),
            )
          } catch (err: unknown) {
            return sendJson(res, 429, {
              error: err instanceof Error ? err.message : 'limit',
            })
          }
        }
        if (url.pathname === '/api/stats')
          return sendJson(res, 200, {
            matches: [...matches.values()].map((m) => m.stats()),
            ws: wsApi?.stats,
          })
        if (url.pathname === '/api/replays')
          return sendJson(res, 200, await listReplays(cfg.logDir))
        if (url.pathname.startsWith('/api/replays/'))
          return await streamReplay(
            res,
            cfg.logDir,
            url.pathname.slice('/api/replays/'.length),
          )
        if (url.pathname === '/api/slow') {
          const t = Date.now()
          while (Date.now() - t < 300) {
            /* навмисне блокування циклу подій (демонстрація Lab 4) */
          }
          return sendJson(res, 200, { blockedMs: Date.now() - t })
        }
        if (url.pathname.startsWith('/api/'))
          return sendJson(res, 404, { error: 'no such api' })
        if (req.method !== 'GET' && req.method !== 'HEAD')
          return sendJson(res, 405, { error: 'method' })
        return await serveStatic(req, res, cfg.staticDir)
      } catch (err: unknown) {
        log('error', 'request failed', { url: req.url, err: String(err) })
        if (!res.headersSent) sendJson(res, 500, { error: 'internal' })
        else res.destroy()
      }
    })()
  })

  const ws = attachWebSocket(server, { rooms, cfg, log, matches })
  wsApi = ws

  async function shutdown(): Promise<void> {
    log('info', 'shutdown start')
    server.close()
    await ws.closeAll()
    for (const m of matches.values()) m.stop()
    for (const ml of matchLogs.values()) ml.stop()
    await Promise.allSettled([...matchLogs.values()].map((m) => m.done))
    server.closeAllConnections()
    log('info', 'shutdown done')
  }

  return { server, rooms, ws, shutdown, matchLogs, matches }
}
