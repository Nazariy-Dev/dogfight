import { drawShip } from './draw.js'
import { FLAG } from '@dogfight/shared/net/snapshot.js'

const COLORS = ['#ff9f7f', '#9fff8f', '#ffd36e', '#d79fff']
const PICK = ['#6ee7ff', '#ffe066', '#ff8fe0']

function drawEntity(ctx, e, mine) {
  switch (e.kind) {
    case 'ship':
      if (e.flags & FLAG.DEAD) return
      drawShip(
        ctx,
        { x: e.x, y: e.y, angle: e.angle, thrusting: !!(e.flags & FLAG.THRUST) },
        mine ? '#7fd1ff' : COLORS[e.id % COLORS.length],
      )
      if (e.flags & FLAG.SHIELD) {
        ctx.strokeStyle = 'rgba(110,231,255,0.7)'
        ctx.beginPath()
        ctx.arc(e.x, e.y, 20, 0, Math.PI * 2)
        ctx.stroke()
      }
      ctx.fillStyle = 'rgba(255,255,255,0.2)'
      ctx.fillRect(e.x - 16, e.y - 26, 32, 4)
      ctx.fillStyle = '#7CFC9A'
      ctx.fillRect(e.x - 16, e.y - 26, (32 * e.hp) / 100, 4)
      break
    case 'bullet':
      ctx.fillStyle = e.flags & FLAG.HOMING ? '#ff8fe0' : '#fff6b0'
      ctx.fillRect(e.x - 2, e.y - 2, 4, 4)
      break
    case 'asteroid': {
      const r = 10 + e.hp * 9
      ctx.strokeStyle = '#c9b28f'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(e.x, e.y, r, 0, Math.PI * 2)
      ctx.stroke()
      break
    }
    case 'pickup':
      ctx.strokeStyle = PICK[e.hp] ?? '#fff'
      ctx.strokeRect(e.x - 8, e.y - 8, 16, 16)
      break
    case 'explosion':
      ctx.fillStyle = '#ffb347'
      ctx.beginPath()
      ctx.arc(e.x, e.y, 14, 0, Math.PI * 2)
      ctx.fill()
      break
  }
}

export function drawNetWorld(ctx, view) {
  for (const e of view.others) drawEntity(ctx, e, false)
  if (view.me) drawEntity(ctx, view.me, true)
}

/** netgraph: RTT, вік знімка, байти/с, черга input, поправка + графік поправок. */
export function drawNetgraph(ctx, ng, x, y, extra = []) {
  const lines = [
    `rtt      ${ng.rtt.toFixed(0)} ms`,
    `snap age ${ng.snapAge.toFixed(0)} ms`,
    `down     ${(ng.bytesPerSec / 1024).toFixed(1)} KB/s`,
    `pending  ${ng.pending}`,
    `correct  ${ng.correction.toFixed(2)} px`,
    ...extra,
  ]
  ctx.fillStyle = 'rgba(0,0,0,0.5)'
  ctx.fillRect(x, y, 200, 14 + lines.length * 16 + 44)
  ctx.font = '12px ui-monospace, monospace'
  ctx.fillStyle = '#ffe6a6'
  lines.forEach((l, i) => ctx.fillText(l, x + 8, y + 16 + i * 16))
  const gy = y + 14 + lines.length * 16 + 36
  ctx.strokeStyle = '#ff9f7f'
  ctx.beginPath()
  const c = ng.corrections.slice(-180)
  c.forEach((v, i) => ctx.lineTo(x + 8 + i, gy - Math.min(32, v * 4)))
  ctx.stroke()
}
