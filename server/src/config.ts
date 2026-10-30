import path from 'node:path'
import { z } from 'zod'

/** Конфіг з оточення через zod: типи, межі, значення за замовчуванням. */
const intEnv = (def: number, min: number, max: number) =>
  z.coerce.number().int().min(min).max(max).default(def)

export const ConfigSchema = z.object({
  PORT: intEnv(8080, 0, 65535),
  HOST: z.string().default('0.0.0.0'),
  LOG_DIR: z.string().default('./logs'),
  STATIC_DIR: z.string().default(new URL('../../client/dist', import.meta.url).pathname),
  MAX_ROOMS: intEnv(50, 1, 10000),
  MAX_PLAYERS_PER_ROOM: intEnv(8, 1, 64),
  MAX_PAYLOAD: intEnv(4096, 64, 1 << 20),
  MSG_PER_SECOND: intEnv(20, 1, 1000),
  INPUT_PER_SECOND: intEnv(40, 1, 1000),
  JOIN_TIMEOUT_MS: intEnv(5000, 100, 60000),
  HEARTBEAT_MS: intEnv(15000, 50, 120000),
  SLOW_CLIENT_BYTES: intEnv(256 * 1024, 1024, 64 << 20),
})

export interface ServerConfig {
  readonly port: number
  readonly host: string
  readonly logDir: string
  readonly staticDir: string
  readonly maxRooms: number
  readonly maxPlayersPerRoom: number
  readonly maxPayload: number
  readonly msgPerSecond: number
  readonly inputPerSecond: number
  readonly joinTimeoutMs: number
  readonly heartbeatMs: number
  readonly slowClientBytes: number
}

export function loadConfig(
  env: Record<string, string | undefined> = process.env,
): ServerConfig {
  // порожній рядок у .env трактуємо як «не задано»
  const clean = Object.fromEntries(
    Object.entries(env).filter(([, v]) => v !== undefined && v !== ''),
  )
  const r = ConfigSchema.safeParse(clean)
  if (!r.success) {
    const lines = r.error.issues.map(
      (i) => `${i.path.join('.')} must be valid: ${i.message}`,
    )
    throw new Error(`Invalid config:\n  ${lines.join('\n  ')}`)
  }
  const c = r.data
  return Object.freeze({
    port: c.PORT,
    host: c.HOST,
    logDir: path.resolve(c.LOG_DIR),
    staticDir: path.resolve(c.STATIC_DIR),
    maxRooms: c.MAX_ROOMS,
    maxPlayersPerRoom: c.MAX_PLAYERS_PER_ROOM,
    maxPayload: c.MAX_PAYLOAD,
    msgPerSecond: c.MSG_PER_SECOND,
    inputPerSecond: c.INPUT_PER_SECOND,
    joinTimeoutMs: c.JOIN_TIMEOUT_MS,
    heartbeatMs: c.HEARTBEAT_MS,
    slowClientBytes: c.SLOW_CLIENT_BYTES,
  })
}
