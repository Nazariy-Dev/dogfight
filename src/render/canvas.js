/**
 * Canvas з урахуванням devicePixelRatio: буфер має фізичні пікселі,
 * а малюємо в CSS-пікселях через ctx.setTransform(dpr, …).
 * Без цього на екранах з dpr = 2 усе розмите.
 */
export function createCanvas(canvas, { onResize } = {}) {
  const ctx = canvas.getContext('2d')
  const size = { w: 0, h: 0, dpr: 1 }

  function resize() {
    const dpr = window.devicePixelRatio || 1
    const w = canvas.clientWidth || window.innerWidth
    const h = canvas.clientHeight || window.innerHeight
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    Object.assign(size, { w, h, dpr })
    onResize?.(size)
  }

  window.addEventListener('resize', resize)
  resize()
  return { ctx, size, resize }
}
