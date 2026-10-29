import { lerp, lerpAngle } from './lerp.js'
import { drawShip } from './draw.js'

/** Позиція сутності між попереднім і поточним кроком. */
function at(e, alpha) {
  return {
    x: lerp(e.prev.x, e.pos.x, alpha),
    y: lerp(e.prev.y, e.pos.y, alpha),
    angle: lerpAngle(e.prev.angle, e.angle, alpha),
  }
}

function drawAsteroid(ctx, e, p) {
  ctx.save()
  ctx.translate(p.x, p.y)
  ctx.rotate(p.angle)
  ctx.strokeStyle = e.homing ? '#ff8f8f' : '#c9b28f'
  ctx.lineWidth = 2
  ctx.beginPath()
  const n = 9
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2
    const r = e.radius * (0.82 + 0.18 * Math.sin(i * 2.7 + e.id))
    ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r)
  }
  ctx.stroke()
  ctx.restore()
}

const PICKUP_COLORS = { shield: '#6ee7ff', rapid: '#ffe066', homing: '#ff8fe0' }

export function drawWorld(ctx, world, alpha) {
  for (const e of world) {
    const p = at(e, alpha)
    switch (e.kind) {
      case 'ship':
        if (e.dead) break
        drawShip(ctx, { ...p, thrusting: e.thrusting }, e.color)
        if (e.shield > 0) {
          ctx.strokeStyle = 'rgba(110,231,255,0.7)'
          ctx.beginPath()
          ctx.arc(p.x, p.y, e.radius + 6, 0, Math.PI * 2)
          ctx.stroke()
        }
        // смужка HP
        ctx.fillStyle = 'rgba(255,255,255,0.2)'
        ctx.fillRect(p.x - 16, p.y - 26, 32, 4)
        ctx.fillStyle = '#7CFC9A'
        ctx.fillRect(p.x - 16, p.y - 26, (32 * e.hp) / 100, 4)
        break
      case 'bullet':
        ctx.fillStyle = e.homing ? '#ff8fe0' : '#fff6b0'
        ctx.beginPath()
        ctx.arc(p.x, p.y, e.radius, 0, Math.PI * 2)
        ctx.fill()
        break
      case 'asteroid':
        drawAsteroid(ctx, e, p)
        break
      case 'pickup':
        ctx.save()
        ctx.translate(p.x, p.y)
        ctx.rotate(p.angle)
        ctx.strokeStyle = PICKUP_COLORS[e.pickup.effect] ?? '#fff'
        ctx.lineWidth = 2
        ctx.strokeRect(-8, -8, 16, 16)
        ctx.restore()
        break
      case 'explosion': {
        const k = Math.max(0, e.ttl / e.life)
        ctx.fillStyle = e.color
        ctx.globalAlpha = k
        for (const q of e.particles)
          ctx.fillRect(e.pos.x + q.x - 1.5, e.pos.y + q.y - 1.5, 3, 3)
        ctx.globalAlpha = 1
        break
      }
    }
  }
}
