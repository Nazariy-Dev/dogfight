import { EventEmitter } from 'node:events'
import type { WebSocket } from 'ws'

export interface Player {
  readonly id: string
  readonly name: string
  readonly ws: WebSocket
}

export interface MatchEvent {
  t: number
  room: string
  type: 'join' | 'leave' | 'chat'
  player: string
  name?: string
  text?: string
}

/** Типізовані події кімнати: Node EventEmitter<T> перевіряє назву і аргументи. */
interface RoomEvents {
  join: [player: Player]
  leave: [player: Player]
  chat: [msg: { player: Player; text: string }]
  empty: []
  event: [e: MatchEvent]
}

export class Room extends EventEmitter<RoomEvents> {
  readonly id: string
  readonly name: string
  readonly maxPlayers: number
  readonly players = new Map<string, Player>()
  readonly createdAt = Date.now()

  constructor({
    id,
    name = id,
    maxPlayers = 8,
  }: {
    id: string
    name?: string
    maxPlayers?: number
  }) {
    super()
    this.id = id
    this.name = name
    this.maxPlayers = maxPlayers
  }
  get full(): boolean {
    return this.players.size >= this.maxPlayers
  }
  #record(e: Omit<MatchEvent, 't' | 'room'>): void {
    this.emit('event', { t: Date.now(), room: this.id, ...e })
  }
  join(player: Player): void {
    if (this.full) throw new Error('room full')
    this.players.set(player.id, player)
    this.emit('join', player)
    this.#record({ type: 'join', player: player.id, name: player.name })
  }
  leave(playerId: string): void {
    const p = this.players.get(playerId)
    if (!p) return
    this.players.delete(playerId)
    this.emit('leave', p)
    this.#record({ type: 'leave', player: p.id })
    if (this.players.size === 0) this.emit('empty')
  }
  chat(playerId: string, text: string): void {
    const p = this.players.get(playerId)
    if (!p) return
    this.emit('chat', { player: p, text })
    this.#record({ type: 'chat', player: p.id, text })
  }
  roster(): { id: string; name: string }[] {
    return [...this.players.values()].map((p) => ({ id: p.id, name: p.name }))
  }
  toJSON(): { id: string; name: string; players: number; max: number } {
    return {
      id: this.id,
      name: this.name,
      players: this.players.size,
      max: this.maxPlayers,
    }
  }
}

interface ManagerEvents {
  created: [room: Room]
  deleted: [room: Room]
}

export class RoomManager extends EventEmitter<ManagerEvents> {
  readonly rooms = new Map<string, Room>()
  readonly maxRooms: number
  readonly maxPlayersPerRoom: number
  readonly persistent: ReadonlySet<string>

  constructor({
    maxRooms = 50,
    maxPlayersPerRoom = 8,
    persistent = [],
  }: {
    maxRooms?: number
    maxPlayersPerRoom?: number
    persistent?: readonly string[]
  } = {}) {
    super()
    this.maxRooms = maxRooms
    this.maxPlayersPerRoom = maxPlayersPerRoom
    this.persistent = new Set(persistent)
    for (const id of persistent) this.create({ id })
  }
  create({ id, name }: { id: string; name?: string }): Room {
    const existing = this.rooms.get(id)
    if (existing) return existing
    if (this.rooms.size >= this.maxRooms) throw new Error('too many rooms')
    const room = new Room({ id, name: name ?? id, maxPlayers: this.maxPlayersPerRoom })
    room.on('empty', () => {
      if (this.persistent.has(id)) return
      this.rooms.delete(id)
      this.emit('deleted', room)
    })
    this.rooms.set(id, room)
    this.emit('created', room)
    return room
  }
  get(id: string): Room | undefined {
    return this.rooms.get(id)
  }
  list(): ReturnType<Room['toJSON']>[] {
    return [...this.rooms.values()].map((r) => r.toJSON())
  }
}
