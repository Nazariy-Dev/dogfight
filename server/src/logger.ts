export type Level = 'debug' | 'info' | 'warn' | 'error'
export type Log = (lvl: Level, msg: string, fields?: Record<string, unknown>) => void

const ORDER: Record<Level | 'silent', number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 99,
}

/** Простий логер: рядок JSON у stdout (у Lab 8 замінено на pino). */
export function makeLogger(
  level: string = 'info',
  write = (s: string) => void process.stdout.write(s),
): Log {
  const min = isLevel(level) ? ORDER[level] : ORDER.info
  return (lvl, msg, fields = {}) => {
    if (ORDER[lvl] < min) return
    write(JSON.stringify({ t: new Date().toISOString(), lvl, msg, ...fields }) + '\n')
  }
}

const isLevel = (s: string): s is keyof typeof ORDER => Object.hasOwn(ORDER, s)
