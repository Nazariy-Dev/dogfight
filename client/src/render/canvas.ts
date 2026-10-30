export interface CanvasSize {
  w: number
  h: number
  dpr: number
}

/** Canvas з урахуванням devicePixelRatio: буфер у фізичних пікселях, малюємо в CSS-пікселях. */
export function createCanvas(
  canvas: HTMLCanvasElement,
  { onResize }: { onResize?: (s: CanvasSize) => void } = {},
): { ctx: CanvasRenderingContext2D; size: CanvasSize; resize: () => void } {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D is not supported')
  const size: CanvasSize = { w: 0, h: 0, dpr: 1 }

  function resize(): void {
    const dpr = window.devicePixelRatio || 1
    const w = canvas.clientWidth || window.innerWidth
    const h = canvas.clientHeight || window.innerHeight
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0)
    Object.assign(size, { w, h, dpr })
    onResize?.(size)
  }

  window.addEventListener('resize', resize)
  resize()
  return { ctx, size, resize }
}
