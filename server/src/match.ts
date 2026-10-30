import { World } from '@dogfight/shared/sim/world.ts'
import { Ship } from '@dogfight/shared/sim/entity.ts'
import { worldToEntities } from '@dogfight/shared/net/snapshot.ts'
import { binaryCodec, type Codec } from '@dogfight/shared/protocol/codec.ts'
import { jsonCodec } from '@dogfight/shared/protocol/messages.ts'
import {
  asSeq,
  NO_CONTROLS,
  type Controls,
  type Input,
  type Seq,
} from '@dogfight/shared/types.ts'
import { createTicker, percentile, type Ticker } from './timer.ts'
import { Bot } from './bot.ts'
import { spatialHashPairs } from '@dogfight/shared/sim/spatial.ts'
import { naivePairs } from '@dogfight/shared/sim/collision.ts'
import type { Player } from './rooms.ts'

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
] as const

interface PlayerState {
  readonly player: Player
  readonly ship: Ship
  readonly queue: Input[]
  lastSeq: Seq
  lastInput: Controls
  readonly codec: Codec
}

export interface MatchStats {
  room: string
  players: number
  bots: number
  entities: number
  tick: number
  ticks: number
  skipped: number
  tickDurP50: number
  tickDurP99: number
  lateP50: number
  lateP99: number
  bytesOut: number
}

/** Авторитетний матч кімнати: сервер сам рахує світ 30 разів/с, від клієнта — лише input. */
export class Match {
  readonly room: string
  readonly world: World
  readonly players = new Map<string, PlayerState>()
  readonly bots: { bot: Bot; ship: Ship }[] = []
  readonly send: (player: Player, data: ArrayBuffer | string) => void
  bytesOut = 0
  readonly ticker: Ticker

  constructor({
    room,
    seed = 1,
    send,
    collisions = 'spatial',
    asteroids = 4,
  }: {
    room: string
    seed?: number
    send: Match['send']
    collisions?: 'naive' | 'spatial'
    asteroids?: number
  }) {
    this.room = room
    // Lab 7: O(n²) замінено просторовим хешем (вибір лишено для заміру до/після)
    this.world = new World({
      seed,
      collide: collisions === 'naive' ? naivePairs : spatialHashPairs(),
    })
    this.world.populate({ asteroids, homingAsteroids: 0 })
    this.send = send
    this.ticker = createTicker(1000 / TICK_HZ, () => this.tick())
  }

  addPlayer(
    player: Player,
    { codec = 'binary' }: { codec?: 'binary' | 'json' | undefined } = {},
  ): Ship {
    const p = this.world.safeSpot()
    const color = COLORS[this.players.size % COLORS.length] ?? COLORS[0]
    const ship = this.world.spawn(new Ship({ x: p.x, y: p.y, owner: player.id, color }))
    this.players.set(player.id, {
      player,
      ship,
      queue: [],
      lastSeq: asSeq(0),
      lastInput: NO_CONTROLS,
      codec: codec === 'json' ? jsonCodec : binaryCodec,
    })
    if (this.players.size === 1) this.ticker.start()
    return ship
  }

  /** Додати n ботів: той самий шлях, що й людина — Ship + controls щокроку. */
  addBots(n: number): number {
    for (let i = 0; i < n; i++) {
      const p = this.world.safeSpot()
      const ship = this.world.spawn(
        new Ship({
          x: p.x,
          y: p.y,
          owner: `bot-${this.bots.length + 1}`,
          color: '#bbbbbb',
        }),
      )
      this.bots.push({ bot: new Bot(), ship })
    }
    this.ticker.start()
    return this.bots.length
  }

  removePlayer(playerId: string): void {
    const st = this.players.get(playerId)
    if (!st) return
    this.world.despawn(st.ship.id)
    this.players.delete(playerId)
    if (this.players.size === 0 && this.bots.length === 0) this.ticker.stop()
  }

  /** Input: seq лише зростає, черга обмежена. */
  input(playerId: string, inp: Input): boolean {
    const st = this.players.get(playerId)
    if (!st) return false
    const lastQueued = st.queue.at(-1)?.seq ?? st.lastSeq
    if (inp.seq <= lastQueued) return false
    st.queue.push(inp)
    if (st.queue.length > 8) st.queue.splice(0, st.queue.length - 8)
    return true
  }

  tick(): void {
    for (const st of this.players.values()) {
      const inp = st.queue.shift()
      if (inp) {
        st.lastInput = inp
        st.lastSeq = inp.seq
      }
      st.ship.controls = st.lastInput
    }
    for (const b of this.bots) b.ship.controls = b.bot.next(this.world, b.ship)
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

  stats(): MatchStats {
    const s = this.ticker.stats
    return {
      room: this.room,
      players: this.players.size,
      bots: this.bots.length,
      entities: this.world.size,
      tick: this.world.tick,
      ticks: s.ticks,
      skipped: s.skipped,
      tickDurP50: +percentile(s.durMs, 0.5).toFixed(3),
      tickDurP99: +percentile(s.durMs, 0.99).toFixed(3),
      lateP50: +percentile(s.lateMs, 0.5).toFixed(3),
      lateP99: +percentile(s.lateMs, 0.99).toFixed(3),
      bytesOut: this.bytesOut,
    }
  }

  stop(): void {
    this.ticker.stop()
  }
}
