export function drawBackground(ctx, w, h) {
  ctx.fillStyle = '#0b1020'
  ctx.fillRect(0, 0, w, h)
  ctx.strokeStyle = 'rgba(120,140,200,0.12)'
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let x = 0; x <= w; x += 64) {
    ctx.moveTo(x + 0.5, 0)
    ctx.lineTo(x + 0.5, h)
  }
  for (let y = 0; y <= h; y += 64) {
    ctx.moveTo(0, y + 0.5)
    ctx.lineTo(w, y + 0.5)
  }
  ctx.stroke()
}

/** Детермінований «зоряний пил» (без Math.random, щоб картинка не мерехтіла при resize). */
export function createStarfield(w, h, count = 120) {
  const stars = []
  let s = 12345
  const rnd = () => (s = (s * 1103515245 + 12345) >>> 0) / 2 ** 32
  for (let i = 0; i < count; i++)
    stars.push({ x: rnd() * w, y: rnd() * h, r: rnd() * 1.4 + 0.3 })
  return stars
}

export function drawStars(ctx, stars) {
  ctx.fillStyle = 'rgba(220,230,255,0.7)'
  for (const st of stars) {
    ctx.beginPath()
    ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2)
    ctx.fill()
  }
}

/** Корабель малюємо в початку координат носом вправо, а canvas зсуваємо й повертаємо. */
export function drawShip(ctx, ship, color = '#7fd1ff') {
  ctx.save()
  ctx.translate(ship.x, ship.y)
  ctx.rotate(ship.angle)
  if (ship.thrusting) {
    ctx.fillStyle = '#ffb347'
    ctx.beginPath()
    ctx.moveTo(-10, -5)
    ctx.lineTo(-22 - Math.random() * 6, 0) // мерехтіння полум'я — лише візуал, не симуляція
    ctx.lineTo(-10, 5)
    ctx.closePath()
    ctx.fill()
  }
  ctx.fillStyle = color
  ctx.strokeStyle = '#e8f6ff'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(16, 0)
  ctx.lineTo(-12, -10)
  ctx.lineTo(-7, 0)
  ctx.lineTo(-12, 10)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  ctx.restore()
}

export function drawHud(ctx, stats, extra = []) {
  const lines = [
    `steps/s  ${stats.stepsPerSecond}`,
    `frames/s ${stats.framesPerSecond}`,
    `frame ms ${stats.frameTimeMs.toFixed(1)}`,
    ...extra,
  ]
  ctx.font = '13px ui-monospace, Menlo, Consolas, monospace'
  ctx.fillStyle = 'rgba(0,0,0,0.45)'
  ctx.fillRect(8, 8, 190, 10 + lines.length * 17)
  ctx.fillStyle = '#d6f5d6'
  lines.forEach((l, i) => ctx.fillText(l, 16, 26 + i * 17))
}
