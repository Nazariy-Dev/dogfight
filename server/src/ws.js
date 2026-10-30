import { WebSocketServer } from 'ws'
import { randomUUID } from 'node:crypto'
import { CLOSE, out, validate } from './protocol.js'
import { createTokenBucket } from './ratelimit.js'
import { decodeInput } from '@dogfight/shared/protocol/codec.js'

/**
 * Життєвий цикл WebSocket-з'єднання:
 *  - чекаємо join не довше joinTimeoutMs;
 *  - кожне повідомлення проходить validate(), інакше close з кодом;
 *  - token bucket на частоту повідомлень;
 *  - ping кожні heartbeatMs, два пропущені pong — terminate;
 *  - якщо bufferedAmount завеликий — некритичні повідомлення (chat) не шлемо.
 */
export function attachWebSocket(
  server,
  { rooms, cfg, log = () => {}, matches = new Map() },
) {
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: cfg.maxPayload })
  const stats = { connections: 0, closedByReason: {}, droppedForSlow: 0 }

  const closeWith = (ws, code, reason) => {
    stats.closedByReason[reason] = (stats.closedByReason[reason] ?? 0) + 1
    log('warn', 'close', { code, reason, player: ws.state?.player?.id })
    ws.close(code, reason)
  }

  /** Надіслати, враховуючи повільного клієнта. critical = roster/system. */
  const send = (ws, data, { critical = false } = {}) => {
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

  wss.on('connection', (ws, req) => {
    stats.connections += 1
    const state = {
      player: null,
      room: null,
      missedPongs: 0,
      bucket: createTokenBucket({ rate: cfg.msgPerSecond, capacity: cfg.msgPerSecond }),
      // input іде 30 разів/с; окремий бакет із запасом на jitter мережі
      inputBucket: createTokenBucket({
        rate: cfg.inputPerSecond,
        capacity: cfg.inputPerSecond * 2,
      }),
    }
    ws.state = state
    // Без слухача 'error' помилка сокета (наприклад, битий фрейм) звалила б процес
    ws.on('error', (err) =>
      log('warn', 'socket error', { err: err.message, code: err.code }),
    )

    const joinTimer = setTimeout(() => {
      if (!state.player) closeWith(ws, CLOSE.JOIN_TIMEOUT, 'join timeout')
    }, cfg.joinTimeoutMs)

    ws.on('pong', () => (state.missedPongs = 0))

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        if (!state.inputBucket.take())
          return closeWith(ws, CLOSE.RATE_LIMIT, 'input rate limit')
        // бінарний input (Lab 5): лише після join
        if (!state.player) return closeWith(ws, CLOSE.NOT_JOINED, 'not joined')
        let inp
        try {
          inp = decodeInput(data)
        } catch (err) {
          return closeWith(ws, CLOSE.BAD_MESSAGE, err.message)
        }
        matches.get(state.room.id)?.input(state.player.id, inp)
        return
      }
      const r = validate(data, { maxBytes: cfg.maxPayload })
      const isInput = r.ok && r.msg.type === 'input'
      if (!(isInput ? state.inputBucket : state.bucket).take())
        return closeWith(ws, CLOSE.RATE_LIMIT, 'rate limit')
      if (!r.ok) return closeWith(ws, r.code, r.reason)
      const msg = r.msg

      if (msg.type === 'join') {
        if (state.player) return closeWith(ws, CLOSE.BAD_MESSAGE, 'already joined')
        let room = rooms.get(msg.room)
        try {
          room ??= rooms.create({ id: msg.room })
        } catch (err) {
          return closeWith(ws, CLOSE.ROOM_FULL, err.message)
        }
        if (room.full) return closeWith(ws, CLOSE.ROOM_FULL, 'room full')
        clearTimeout(joinTimer)
        const player = { id: randomUUID().slice(0, 8), name: msg.name, ws }
        state.player = player
        state.room = room
        room.join(player)
        const ship = matches.get(room.id)?.addPlayer(player, { codec: msg.codec })
        const match = matches.get(room.id)
        send(
          ws,
          out('welcome', {
            id: player.id,
            room: room.id,
            ship: ship?.id,
            arena: match ? { w: match.world.w, h: match.world.h } : null,
            tickHz: 30,
          }),
          { critical: true },
        )
        return
      }
      if (!state.player) return closeWith(ws, CLOSE.NOT_JOINED, 'not joined')
      if (msg.type === 'chat') state.room.chat(state.player.id, msg.text)
      else if (msg.type === 'input')
        matches.get(state.room.id)?.input(state.player.id, msg)
      else if (msg.type === 'leave') ws.close(CLOSE.NORMAL, 'bye')
    })

    ws.on('close', () => {
      clearTimeout(joinTimer)
      if (state.player && state.room) {
        matches.get(state.room.id)?.removePlayer(state.player.id)
        state.room.leave(state.player.id)
      }
      log('info', 'disconnect', {
        player: state.player?.id,
        ip: req.socket.remoteAddress,
      })
    })
  })

  // Розсилка подій кімнати її гравцям
  const wireRoom = (room) => {
    const broadcastRoster = () => {
      const data = out('roster', { room: room.id, players: room.roster() })
      for (const p of room.players.values()) send(p.ws, data, { critical: true })
    }
    room.on('join', broadcastRoster)
    room.on('leave', broadcastRoster)
    room.on('chat', ({ player, text }) => {
      const data = out('chat', { from: player.name, id: player.id, text, t: Date.now() })
      for (const p of room.players.values()) send(p.ws, data)
    })
  }
  for (const r of rooms.rooms.values()) wireRoom(r)
  rooms.on('created', wireRoom)

  // Heartbeat
  const hb = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.state.missedPongs >= 2) {
        stats.closedByReason.heartbeat = (stats.closedByReason.heartbeat ?? 0) + 1
        log('warn', 'heartbeat timeout', { player: ws.state.player?.id })
        ws.terminate()
        continue
      }
      ws.state.missedPongs += 1
      ws.ping()
    }
  }, cfg.heartbeatMs)
  hb.unref()

  return {
    wss,
    stats,
    send,
    /** Закрити всі сокети кодом 1001 (сервер іде) */
    closeAll(code = CLOSE.GOING_AWAY, reason = 'server shutdown') {
      clearInterval(hb)
      for (const ws of wss.clients) {
        send(ws, out('shutdown', { reason }), { critical: true })
        ws.close(code, reason)
      }
      return new Promise((r) => wss.close(r))
    },
  }
}
