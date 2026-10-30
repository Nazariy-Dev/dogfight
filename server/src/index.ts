import { loadConfig, type ServerConfig } from './config.ts'
import { createApp } from './app.ts'
import { makeLogger } from './logger.ts'
import { simDebug } from '@dogfight/shared/sim/ship.ts'

// Експеримент Lab 5: SIM_NOISE=20 ламає детермінізм лише на сервері
simDebug.noise = Number(process.env.SIM_NOISE ?? 0)

const log = makeLogger(process.env.LOG_LEVEL)

// Невідома помилка = стан процесу невідомий: записати стек і завершитись (платформа перезапустить).
// Порожній обробник, що «глушить» помилку, не ставимо.
const crash = (kind: string) => (err: unknown) => {
  log('error', kind, {
    err: err instanceof Error ? { message: err.message, stack: err.stack } : String(err),
  })
  log.flush()
  process.exit(1)
}
process.on('uncaughtException', crash('uncaughtException'))
process.on('unhandledRejection', crash('unhandledRejection'))

let cfg: ServerConfig
try {
  cfg = loadConfig()
} catch (err: unknown) {
  log('error', err instanceof Error ? err.message : String(err))
  log.flush()
  process.exit(1)
}

const app = createApp(cfg, { log })
app.server.listen(cfg.port, cfg.host, () => {
  const addr = app.server.address()
  log('info', 'listening', {
    port: typeof addr === 'object' && addr ? addr.port : cfg.port,
    version: cfg.gitSha,
    allowedOrigins: cfg.allowedOrigins,
  })
})

let stopping = false
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    if (stopping) return
    stopping = true
    const t0 = performance.now()
    log('info', 'signal', { sig })
    setTimeout(() => {
      log('error', 'forced exit after 10s')
      log.flush()
      process.exit(1)
    }, 10000).unref()
    void app.shutdown().then(() => {
      log('info', 'exit', { code: 0, shutdownMs: Math.round(performance.now() - t0) })
      log.flush()
      process.exit(0)
    })
  })
}
