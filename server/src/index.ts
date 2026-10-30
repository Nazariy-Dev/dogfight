import { loadConfig, type ServerConfig } from './config.ts'
import { createApp, makeLogger } from './app.ts'
import { simDebug } from '@dogfight/shared/sim/ship.ts'

// Експеримент Lab 5: SIM_NOISE=20 ламає детермінізм лише на сервері
simDebug.noise = Number(process.env.SIM_NOISE ?? 0)

const log = makeLogger(process.env.LOG_LEVEL)
let cfg: ServerConfig
try {
  cfg = loadConfig()
} catch (err: unknown) {
  log('error', err instanceof Error ? err.message : String(err))
  process.exit(1)
}

const app = createApp(cfg, { log })
app.server.listen(cfg.port, cfg.host, () => {
  const addr = app.server.address()
  log('info', 'listening', {
    port: typeof addr === 'object' && addr ? addr.port : cfg.port,
    staticDir: cfg.staticDir,
  })
})

let stopping = false
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    if (stopping) return
    stopping = true
    log('info', 'signal', { sig })
    setTimeout(() => {
      log('error', 'forced exit after 10s')
      process.exit(1)
    }, 10000).unref()
    void app.shutdown().then(() => process.exit(0))
  })
}
