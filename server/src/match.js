import { World } from '@dogfight/shared/sim/world.js'
import { Ship } from '@dogfight/shared/sim/entity.js'
import { worldToEntities } from '@dogfight/shared/net/snapshot.js'
import { binaryCodec, jsonCodec } from '@dogfight/shared/protocol/codec.js'
import { createTicker, percentile } from './timer.js'

export const TICK_HZ = 30
export const DT = 1 / TICK_HZ
const COLORS = [
  '#7fd1ff',
  '#ff9f7f',
  '#9fff8f',
  '#ffd36e',
  '#d79fff',
  '#6effe0',
  '#ff7ad1',
  '#b8c4ff',
]

/**
 * Авторитетний матч кімнати: сервер сам рахує світ 30 разів/с.
 * Клієнт надсилає лише input (кнопки + seq), координати від клієнта не приймаються.
 */
export class Match {
  constructor({ room, seed = 1, send, log = () => {} }) {
    this.room = room
    this.world = new World({ seed })
    this.world.populate({ asteroids: 4, homingAsteroids: 0 })
    this.players = new Map() // playerId → { ship, queue, lastSeq, lastInput, codec }
    this.send = send // (player, data) => void
    this.log = log
    this.bytesOut = 0
    this.ticker = createTicker(1000 / TICK_HZ, () => this.tick())
  }

  addPlayer(player, { codec = 'binary' } = {}) {
    const p = this.world.safeSpot()
    const ship = this.world.spawn(
      new Ship({
        x: p.x,
        y: p.y,
        owner: player.id,
        color: COLORS[this.players.size % COLORS.length],
      }),
    )
    this.players.set(player.id, {
      player,
      ship,
      queue: [],
      lastSeq: 0,
      lastInput: { left: false, right: false, thrust: false, fire: false },
      codec: codec === 'json' ? jsonCodec : binaryCodec,
    })
    if (this.players.size === 1) this.ticker.start()
    return ship
  }

  removePlayer(playerId) {
    const st = this.players.get(playerId)
    if (!st) return
    this.world.despawn(st.ship.id)
    this.players.delete(playerId)
    if (this.players.size === 0) this.ticker.stop()
  }

  /** Input від клієнта: перевірка seq (лише зростає), обмеження черги. */
  input(playerId, inp) {
    const st = this.players.get(playerId)
    if (!st) return false
    const lastQueued = st.queue.length ? st.queue[st.queue.length - 1].seq : st.lastSeq
    if (!Number.isInteger(inp.seq) || inp.seq <= lastQueued) return false // дубль або старий
    st.queue.push(inp)
    if (st.queue.length > 8) st.queue.splice(0, st.queue.length - 8) // клієнт «спамить» — лишаємо свіжі
    return true
  }

  tick() {
    // кожен крок застосовуємо рівно один input кожного гравця (або повторюємо останній)
    for (const st of this.players.values()) {
      const inp = st.queue.shift()
      if (inp) {
        st.lastInput = inp
        st.lastSeq = inp.seq
      }
      st.ship.controls = st.lastInput
    }
    this.world.step(DT)
    const entities = worldToEntities(this.world)
    for (const st of this.players.values()) {
      const data = st.codec.encodeSnapshot({
        tick: this.world.tick,
        ackSeq: st.lastSeq,
        entities,
      })
      this.bytesOut +=
        typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength
      this.send(st.player, data)
    }
  }

  stats() {
    const s = this.ticker.stats
    return {
      room: this.room,
      players: this.players.size,
      tick: this.world.tick,
      ticks: s.ticks,
      skipped: s.skipped,
      tickDurP99: +percentile(s.durMs, 0.99).toFixed(3),
      lateP50: +percentile(s.lateMs, 0.5).toFixed(3),
      lateP99: +percentile(s.lateMs, 0.99).toFixed(3),
      bytesOut: this.bytesOut,
    }
  }

  stop() {
    this.ticker.stop()
  }
}
