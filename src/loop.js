/**
 * createLoop — ігровий цикл з фіксованим кроком симуляції (Fix Your Timestep).
 *
 * Браузер викликає frame() через requestAnimationFrame перед кожним paint.
 * Реальний час між кадрами накопичується в accumulator, а симуляція
 * виконується цілими кроками `step` (за замовчуванням 1/60 с). Тому кількість
 * кроків за секунду не залежить від частоти монітора.
 *
 * Дельта кадру обмежена `maxFrame` (0,25 с): після довгої паузи (вкладка
 * у фоні, зупинка в дебагері) цикл не намагається «наздогнати» сотні кроків
 * і не потрапляє у «спіраль смерті».
 *
 * render(alpha) отримує частку кроку, що лишилась в акумуляторі (0 ≤ alpha < 1),
 * і інтерполює стан між попереднім і поточним кроком.
 *
 * Планувальник і годинник можна підмінити (для тестів з фейковими таймерами
 * і для експерименту з setInterval).
 */
export function createLoop({
  step = 1 / 60,
  maxFrame = 0.25,
  simulate,
  render,
  fixed = true,
  schedule = (cb) => requestAnimationFrame(cb),
  cancel = (id) => cancelAnimationFrame(id),
  onFrame = () => {},
} = {}) {
  let handle = 0
  let running = false
  let last = -1
  let accumulator = 0

  // лічильники за поточну секунду і значення за попередню (для HUD)
  let windowStart = -1
  let stepsInWindow = 0
  let framesInWindow = 0
  const stats = { stepsPerSecond: 0, framesPerSecond: 0, frameTimeMs: 0, steps: 0 }

  function frame(now) {
    if (!running) return
    const dt = last < 0 ? 0 : (now - last) / 1000
    last = now
    stats.frameTimeMs = dt * 1000
    if (windowStart < 0) windowStart = now

    if (fixed) {
      accumulator += Math.min(dt, maxFrame)
      while (accumulator >= step) {
        simulate(step)
        accumulator -= step
        stepsInWindow += 1
        stats.steps += 1
      }
      render(accumulator / step, stats)
    } else {
      // Експеримент 3: змінний крок — один simulate(dt) на кадр
      if (dt > 0) {
        simulate(Math.min(dt, maxFrame))
        stepsInWindow += 1
        stats.steps += 1
      }
      render(1, stats)
    }
    framesInWindow += 1

    if (now - windowStart >= 1000) {
      const sec = (now - windowStart) / 1000
      stats.stepsPerSecond = Math.round(stepsInWindow / sec)
      stats.framesPerSecond = Math.round(framesInWindow / sec)
      stepsInWindow = 0
      framesInWindow = 0
      windowStart = now
    }
    onFrame(now, stats)
    handle = schedule(frame)
  }

  return {
    start() {
      if (running) return
      running = true
      last = -1
      accumulator = 0
      windowStart = -1
      handle = schedule(frame)
    },
    stop() {
      running = false
      cancel(handle)
    },
    get running() {
      return running
    },
    stats,
  }
}
