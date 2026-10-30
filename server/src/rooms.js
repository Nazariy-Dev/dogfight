import { EventEmitter } from 'node:events'

/**
 * Room — кімната з гравцями. Події:
 *   'join' (player), 'leave' (player), 'chat' ({player, text}), 'empty' (),
 *   'event' (запис для логу матчу).
 */
export class Room extends EventEmitter {
  constructor({ id, name = id, maxPlayers = 8 }) {
    super()
    this.id = id
    this.name = name
    this.maxPlayers = maxPlayers
    this.players = new Map() // playerId → { id, name, send }
    this.createdAt = Date.now()
  }
  get full() {
    return this.players.size >= this.maxPlayers
  }
  #record(type, data) {
    this.emit('event', { t: Date.now(), room: this.id, type, ...data })
  }
  join(player) {
    if (this.full) throw new Error('room full')
    this.players.set(player.id, player)
    this.emit('join', player)
    this.#record('join', { player: player.id, name: player.name })
  }
  leave(playerId) {
    const p = this.players.get(playerId)
    if (!p) return
    this.players.delete(playerId)
    this.emit('leave', p)
    this.#record('leave', { player: p.id })
    if (this.players.size === 0) this.emit('empty')
  }
  chat(playerId, text) {
    const p = this.players.get(playerId)
    if (!p) return
    this.emit('chat', { player: p, text })
    this.#record('chat', { player: p.id, text })
  }
  roster() {
    return [...this.players.values()].map((p) => ({ id: p.id, name: p.name }))
  }
  toJSON() {
    return {
      id: this.id,
      name: this.name,
      players: this.players.size,
      max: this.maxPlayers,
    }
  }
}

/** RoomManager створює, знаходить і видаляє кімнати (порожня кімната — видаляється). */
export class RoomManager extends EventEmitter {
  constructor({ maxRooms = 50, maxPlayersPerRoom = 8, persistent = [] } = {}) {
    super()
    this.rooms = new Map()
    this.maxRooms = maxRooms
    this.maxPlayersPerRoom = maxPlayersPerRoom
    this.persistent = new Set(persistent)
    for (const id of persistent) this.create({ id })
  }
  create({ id, name }) {
    if (this.rooms.has(id)) return this.rooms.get(id)
    if (this.rooms.size >= this.maxRooms) throw new Error('too many rooms')
    const room = new Room({ id, name, maxPlayers: this.maxPlayersPerRoom })
    room.on('empty', () => {
      if (this.persistent.has(id)) return
      this.rooms.delete(id)
      this.emit('deleted', room)
    })
    this.rooms.set(id, room)
    this.emit('created', room)
    return room
  }
  get(id) {
    return this.rooms.get(id)
  }
  list() {
    return [...this.rooms.values()].map((r) => r.toJSON())
  }
}
