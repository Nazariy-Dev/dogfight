export interface Progress {
  done: number
  total: number
  key: string | null
  error?: string
}

/** Екран завантаження на canvas: справжній прогрес-бар і повідомлення про помилку. */
export function drawLoading(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  p: Progress,
): void {
  ctx.fillStyle = '#0b1020'
  ctx.fillRect(0, 0, w, h)
  const bw = Math.min(480, w - 80)
  const x = (w - bw) / 2
  const y = h / 2
  ctx.strokeStyle = '#7fd1ff'
  ctx.strokeRect(x, y, bw, 18)
  ctx.fillStyle = p.error ? '#ff7a7a' : '#7fd1ff'
  ctx.fillRect(x + 2, y + 2, ((bw - 4) * p.done) / Math.max(1, p.total), 14)
  ctx.font = '16px ui-monospace, monospace'
  ctx.fillStyle = '#d6e4ff'
  ctx.textAlign = 'center'
  ctx.fillText(
    p.error
      ? `Помилка: ${p.error}`
      : `Завантаження ${p.done}/${p.total}${p.key ? ` — ${p.key}` : ''}`,
    w / 2,
    y - 14,
  )
  ctx.textAlign = 'left'
}
