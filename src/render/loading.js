/** Екран завантаження на canvas: справжній прогрес-бар і повідомлення про помилку. */
export function drawLoading(ctx, w, h, { done, total, key, error }) {
  ctx.fillStyle = '#0b1020'
  ctx.fillRect(0, 0, w, h)
  const bw = Math.min(480, w - 80)
  const x = (w - bw) / 2
  const y = h / 2
  ctx.strokeStyle = '#7fd1ff'
  ctx.strokeRect(x, y, bw, 18)
  ctx.fillStyle = error ? '#ff7a7a' : '#7fd1ff'
  ctx.fillRect(x + 2, y + 2, ((bw - 4) * done) / Math.max(1, total), 14)
  ctx.font = '16px ui-monospace, monospace'
  ctx.fillStyle = '#d6e4ff'
  ctx.textAlign = 'center'
  ctx.fillText(
    error
      ? `Помилка: ${error}`
      : `Завантаження ${done}/${total}${key ? ` — ${key}` : ''}`,
    w / 2,
    y - 14,
  )
  ctx.textAlign = 'left'
}
