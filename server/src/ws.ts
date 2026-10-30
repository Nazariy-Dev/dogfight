import { WebSocketServer, type WebSocket, type RawData } from 'ws'
import type { Server } from 'node:http'
import { randomUUID } from 'node:crypto'
import {
  CLOSE,
  out,
  parseClientMessage,
  type ClientMessage,
} from '@dogfight/shared/protocol/messages.ts'
import { decodeInput } from '@dogfight/shared/protocol/codec.ts'
import { assertNever } from '@dogfight/shared/types.ts'
import { createTokenBucket, type TokenBucket } from './ratelimit.ts'
import type { Player, Room, RoomManager } from './rooms.ts'
import type { Match } from './match.ts'
import type { ServerConfig } from './config.ts'
import type { Log } from './logger.ts'

interface SocketState {
  player: Player | null
  room: Room | null
  missedPongs: number
  readonly bucket: TokenBucket
  readonly inputBucket: TokenBucket
}

export interface WsStats {
  connections: number
  closedByReason: Record<string, number>
  droppedForSlow: number
  messagesIn: number
  bytesIn: number
}

export interface WsApi {
  readonly wss: WebSocketServer
  readonly stats: WsStats
  send(ws: WebSocket, data: ArrayBuffer | string, opts?: { critical?: boolean }): boolean
  closeAll(code?: number, reason?: string): Promise<void>
}

const toBytes = (data: RawData): Uint8Array =>
  Array.isArray(data)
    ? Buffer.concat(data)
    : data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : data

/** Життєвий цикл WebSocket: join-таймаут, перевірка кожного повідомлення, ліміти, heartbeat, slow client. */
export function attachWebSocket(
  server: Server,
  {
    rooms,
    cfg,
    log,
    matches,
  }: {
    rooms: RoomManager
    cfg: ServerConfig
    log: Log
    matches: ReadonlyMap<string, Match>
  },
): WsApi {
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: cfg.maxPayload })
  const stats: WsStats = {
    connections: 0,
    closedByReason: {},
    droppedForSlow: 0,
    messagesIn: 0,
    bytesIn: 0,
  }
  const states = new WeakMap<WebSocket, SocketState>()

  const closeWith = (ws: WebSocket, code: number, reason: string): void => {
    stats.closedByReason[reason] = (stats.closedByReason[reason] ?? 0) + 1
    log('warn', 'close', { code, reason, playerId: states.get(ws)?.player?.id })
    ws.close(code, reason)
  }

  const send: WsApi['send'] = (ws, data, { critical = false } = {}) => {
    if (ws.readyState !== ws.OPEN) return false
    if (ws.bufferedAmount > cfg.slowClientBytes) {
      if (!critical) {
        stats.droppedForSlow += 1
        return false
      }
      if (ws.bufferedAmount > cfg.slowClientBytes * 4) {
        closeWith(ws, CLOSE.SLOW_CLIENT, 'slow client')
        return false
      }
    }
    ws.send(data)
    return true
  }

  function handle(ws: WebSocket, state: SocketState, msg: ClientMessage): void {
    switch (msg.type) {
      case 'join': {
        if (state.player) return closeWith(ws, CLOSE.BAD_MESSAGE, 'already joined')
        let room = rooms.get(msg.room)
        try {
          room ??= rooms.create({ id: msg.room })
        } catch (err: unknown) {
          return closeWith(
            ws,
            CLOSE.ROOM_FULL,
            err instanceof Error ? err.message : 'cannot create',
          )
        }
        if (room.full) return closeWith(ws, CLOSE.ROOM_FULL, 'room full')
        const player: Player = { id: randomUUID().slice(0, 8), name: msg.name, ws }
        state.player = player
        state.room = room
        room.join(player)
        const match = matches.get(room.id)
        const ship = match?.addPlayer(player, { codec: msg.codec })
        log('info', 'join', { roomId: room.id, playerId: player.id })
        send(
          ws,
          out({
            type: 'welcome',
            id: player.id,
            room: room.id,
            ship: ship?.id ?? null,
            arena: match ? { w: match.world.w, h: match.world.h } : null,
            tickHz: 30,
          }),
          { critical: true },
        )
        return
      }
      case 'chat':
        if (!state.player || !state.room)
          return closeWith(ws, CLOSE.NOT_JOINED, 'not joined')
        return state.room.chat(state.player.id, msg.text)
      case 'input':
        if (!state.player || !state.room)
          return closeWith(ws, CLOSE.NOT_JOINED, 'not joined')
        matches.get(state.room.id)?.input(state.player.id, msg)
        return
      case 'leave':
        return ws.close(CLOSE.NORMAL, 'bye')
      default:
        return assertNever(msg, 'message type')
    }
  }

  wss.on('connection', (ws, req) => {
    stats.connections += 1
    const state: SocketState = {
      player: null,
      room: null,
      missedPongs: 0,
      bucket: createTokenBucket({ rate: cfg.msgPerSecond, capacity: cfg.msgPerSecond }),
      inputBucket: createTokenBucket({
        rate: cfg.inputPerSecond,
        capacity: cfg.inputPerSecond * 2,
      }),
    }
    states.set(ws, state)
    ws.on('error', (err) => log('warn', 'socket error', { err: err.message }))
    const joinTimer = setTimeout(() => {
      if (!state.player) closeWith(ws, CLOSE.JOIN_TIMEOUT, 'join timeout')
    }, cfg.joinTimeoutMs)
    ws.on('pong', () => (state.missedPongs = 0))

    ws.on('message', (data, isBinary) => {
      const bytes = toBytes(data)
      stats.messagesIn += 1
      stats.bytesIn += bytes.byteLength
      if (isBinary) {
        if (!state.inputBucket.take())
          return closeWith(ws, CLOSE.RATE_LIMIT, 'input rate limit')
        if (!state.player || !state.room)
          return closeWith(ws, CLOSE.NOT_JOINED, 'not joined')
        try {
          matches.get(state.room.id)?.input(state.player.id, decodeInput(bytes))
        } catch (err: unknown) {
          closeWith(
            ws,
            CLOSE.BAD_MESSAGE,
            err instanceof Error ? err.message : 'bad frame',
          )
        }
        return
      }
      const r = parseClientMessage(bytes, cfg.maxPayload)
      if (!r.ok) return closeWith(ws, r.code, r.reason)
      const bucket = r.msg.type === 'input' ? state.inputBucket : state.bucket
      if (!bucket.take()) return closeWith(ws, CLOSE.RATE_LIMIT, 'rate limit')
      handle(ws, state, r.msg)
    })

    ws.on('close', () => {
      clearTimeout(joinTimer)
      if (state.player && state.room) {
        matches.get(state.room.id)?.removePlayer(state.player.id)
        state.room.leave(state.player.id)
      }
      log('info', 'disconnect', {
        playerId: state.player?.id,
        ip: req.socket.remoteAddress,
      })
    })
  })

  const wireRoom = (room: Room): void => {
    const broadcastRoster = (): void => {
      const data = out({ type: 'roster', room: room.id, players: room.roster() })
      for (const p of room.players.values()) send(p.ws, data, { critical: true })
    }
    room.on('join', broadcastRoster)
    room.on('leave', broadcastRoster)
    room.on('chat', ({ player, text }) => {
      const data = out({
        type: 'chat',
        from: player.name,
        id: player.id,
        text,
        t: Date.now(),
      })
      for (const p of room.players.values()) send(p.ws, data)
    })
  }
  for (const r of rooms.rooms.values()) wireRoom(r)
  rooms.on('created', wireRoom)

  const hb = setInterval(() => {
    for (const ws of wss.clients) {
      const st = states.get(ws)
      if (!st) continue
      if (st.missedPongs >= 2) {
        stats.closedByReason.heartbeat = (stats.closedByReason.heartbeat ?? 0) + 1
        log('warn', 'heartbeat timeout', { playerId: st.player?.id })
        ws.terminate()
        continue
      }
      st.missedPongs += 1
      ws.ping()
    }
  }, cfg.heartbeatMs)
  hb.unref()

  return {
    wss,
    stats,
    send,
    closeAll(code = CLOSE.GOING_AWAY, reason = 'server shutdown') {
      clearInterval(hb)
      for (const ws of wss.clients) {
        send(ws, out({ type: 'shutdown', reason }), { critical: true })
        ws.close(code, reason)
      }
      return new Promise<void>((r) => wss.close(() => r()))
    },
  }
}
