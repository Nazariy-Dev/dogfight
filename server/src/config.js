import path from 'node:path'

/**
 * Конфіг з process.env з перевіркою. Помилка в конфігу — падіння на старті
 * з зрозумілим повідомленням, а не дивна поведінка під навантаженням.
 */
export function loadConfig(env = process.env) {
  const errors = []
  const int = (name, def, min, max) => {
    const raw = env[name]
    if (raw === undefined || raw === '') return def
    const n = Number(raw)
    if (!Number.isInteger(n) || n < min || n > max) {
      errors.push(`${name} must be an integer in [${min}, ${max}], got "${raw}"`)
      return def
    }
    return n
  }
  const cfg = {
    port: int('PORT', 8080, 0, 65535),
    host: env.HOST || '0.0.0.0',
    logDir: path.resolve(env.LOG_DIR || './logs'),
    staticDir: path.resolve(
      env.STATIC_DIR || new URL('../../client/dist', import.meta.url).pathname,
    ),
    maxRooms: int('MAX_ROOMS', 50, 1, 10000),
    maxPlayersPerRoom: int('MAX_PLAYERS_PER_ROOM', 8, 1, 64),
    maxPayload: int('MAX_PAYLOAD', 4096, 64, 1 << 20),
    msgPerSecond: int('MSG_PER_SECOND', 20, 1, 1000),
    inputPerSecond: int('INPUT_PER_SECOND', 40, 1, 1000),
    joinTimeoutMs: int('JOIN_TIMEOUT_MS', 5000, 100, 60000),
    heartbeatMs: int('HEARTBEAT_MS', 15000, 50, 120000),
    slowClientBytes: int('SLOW_CLIENT_BYTES', 256 * 1024, 1024, 64 << 20),
  }
  if (errors.length) throw new Error(`Invalid config:\n  ${errors.join('\n  ')}`)
  return Object.freeze(cfg)
}
