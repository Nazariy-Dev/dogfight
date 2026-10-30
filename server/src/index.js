import { loadConfig } from './config.js'
import { createApp, makeLogger } from './app.js'
import { simDebug } from '@dogfight/shared/sim/ship.js'

// Експеримент Lab 5: SIM_NOISE=20 ламає детермінізм лише на сервері
simDebug.noise = Number(process.env.SIM_NOISE ?? 0)

const log = makeLogger(process.env.LOG_LEVEL ?? 'info')
let cfg
try {
  cfg = loadConfig()
} catch (err) {
  log('error', err.message)
  process.exit(1)
}

const app = createApp(cfg, { log })
app.server.listen(cfg.port, cfg.host, () => {
  const { port } = app.server.address()
  log('info', 'listening', { port, staticDir: cfg.staticDir, logDir: cfg.logDir })
})

let stopping = false
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    if (stopping) return
    stopping = true
    log('info', 'signal', { sig })
    const force = setTimeout(() => {
      log('error', 'forced exit after 10s')
      process.exit(1)
    }, 10000)
    force.unref()
    await app.shutdown()
    process.exit(0)
  })
}
