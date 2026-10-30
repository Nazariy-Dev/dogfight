import { pino, type Logger } from 'pino'

export type Level = 'debug' | 'info' | 'warn' | 'error'
export type Log = (lvl: Level, msg: string, fields?: Record<string, unknown>) => void

/**
 * Логи — рядки JSON у stdout через pino (Lab 8). Поля roomId/playerId передаються в fields.
 * redact прибирає випадкові секрети з логів.
 */
export function createPino(
  level = process.env.LOG_LEVEL ?? 'info',
  dest?: NodeJS.WritableStream,
): Logger {
  return pino(
    {
      level: level === 'silent' ? 'silent' : level,
      base: { pid: process.pid },
      redact: [
        'password',
        'token',
        'secret',
        '*.password',
        '*.token',
        'headers.cookie',
        'headers.authorization',
      ],
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    dest ?? pino.destination({ sync: false }),
  )
}

export function makeLogger(
  level?: string,
  dest?: NodeJS.WritableStream,
): Log & { flush(): void } {
  const p = createPino(level, dest)
  const log: Log = (lvl, msg, fields = {}) => p[lvl](fields, msg)
  return Object.assign(log, { flush: () => p.flush() })
}
