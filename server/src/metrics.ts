import { Counter, Gauge, Registry, collectDefaultMetrics } from 'prom-client'
import { monitorEventLoopDelay, performance } from 'node:perf_hooks'
import type { Match } from './match.ts'
import type { WsApi } from './ws.ts'

/** /metrics у форматі Prometheus: гравці, кімнати, повідомлення/с, байти/с, крок p99, ELU, пам'ять, відмови. */
export function createMetrics(
  getMatches: () => Iterable<Match>,
  getWs: () => WsApi | null,
) {
  const registry = new Registry()
  collectDefaultMetrics({ register: registry, prefix: 'dogfight_' })
  const lag = monitorEventLoopDelay({ resolution: 10 })
  lag.enable()
  let lastElu = performance.eventLoopUtilization()

  const rejections = new Counter({
    name: 'dogfight_rejections_total',
    help: 'Відхилені з’єднання/повідомлення за причиною',
    labelNames: ['reason'],
    registers: [registry],
  })
  const g = (name: string, help: string, collect: () => number): Gauge =>
    new Gauge({
      name,
      help,
      registers: [registry],
      collect() {
        this.set(collect())
      },
    })
  let prevMsgs = 0
  let prevBytesIn = 0
  let prevBytesOut = 0
  let prevT = performance.now()
  const rates = { msgs: 0, bytesIn: 0, bytesOut: 0 }
  const seenOut = new WeakMap<Match, number>()
  const updateRates = (): void => {
    const now = performance.now()
    const dt = Math.max(0.001, (now - prevT) / 1000)
    const ws = getWs()
    // лічильник монотонний: зростання по кожному матчу окремо, видалені кімнати не дають «мінус»
    let out = prevBytesOut
    for (const m of getMatches()) {
      const last = seenOut.get(m) ?? 0
      out += m.bytesOut - last
      seenOut.set(m, m.bytesOut)
    }
    rates.msgs = ((ws?.stats.messagesIn ?? 0) - prevMsgs) / dt
    rates.bytesIn = ((ws?.stats.bytesIn ?? 0) - prevBytesIn) / dt
    rates.bytesOut = (out - prevBytesOut) / dt
    prevMsgs = ws?.stats.messagesIn ?? 0
    prevBytesIn = ws?.stats.bytesIn ?? 0
    prevBytesOut = out
    prevT = now
  }
  g('dogfight_players', 'Гравці (люди) онлайн', () =>
    [...getMatches()].reduce((a, m) => a + m.players.size, 0),
  )
  g('dogfight_rooms', 'Кімнати з матчем', () => [...getMatches()].length)
  g(
    'dogfight_messages_per_second',
    'Вхідні повідомлення/с',
    () => (updateRates(), rates.msgs),
  )
  g('dogfight_bytes_in_per_second', 'Вхідні байти/с', () => rates.bytesIn)
  g('dogfight_bytes_out_per_second', 'Байти знімків/с', () => rates.bytesOut)
  g('dogfight_tick_p99_ms', 'Найгірший p99 тривалості кроку серед кімнат, мс', () =>
    Math.max(0, ...[...getMatches()].map((m) => m.stats().tickDurP99)),
  )
  g('dogfight_event_loop_utilization', 'ELU з попереднього скрейпу', () => {
    const e = performance.eventLoopUtilization(lastElu)
    lastElu = performance.eventLoopUtilization()
    return e.utilization
  })
  g(
    'dogfight_event_loop_delay_p99_ms',
    'Затримка циклу подій p99, мс',
    () => lag.percentile(99) / 1e6,
  )

  return { registry, rejections }
}
