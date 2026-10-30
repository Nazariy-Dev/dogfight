import {
  collidable,
  circlesOverlap,
  type CollisionSystem,
  type Pair,
} from './collision.ts'
import type { Entity } from './entity.ts'

/**
 * Просторовий хеш на рівномірній сітці: арена ділиться на клітинки cell×cell,
 * сутність записується в клітинку свого центру, а пари шукаються в клітинці та 8 сусідніх.
 * Працює, поки діаметр будь-якої сутності не більший за cell. Клітинки — масиви,
 * які перевикористовуються між кроками (менше алокацій).
 */
export function spatialHashPairs(cell = 96, w = 1280, h = 720): CollisionSystem {
  const cols = Math.ceil(w / cell)
  const rows = Math.ceil(h / cell)
  const grid: Entity[][] = Array.from({ length: cols * rows }, () => [])
  return (entities) => {
    for (const c of grid) c.length = 0
    for (const e of entities) {
      if (!collidable(e)) continue
      const cx = Math.min(cols - 1, Math.max(0, Math.floor(e.pos.x / cell)))
      const cy = Math.min(rows - 1, Math.max(0, Math.floor(e.pos.y / cell)))
      grid[cy * cols + cx]!.push(e)
    }
    const pairs: Pair[] = []
    for (let cy = 0; cy < rows; cy++)
      for (let cx = 0; cx < cols; cx++) {
        const here = grid[cy * cols + cx]!
        if (here.length === 0) continue
        // пари всередині клітинки
        for (let i = 0; i < here.length; i++)
          for (let j = i + 1; j < here.length; j++) push(pairs, here[i]!, here[j]!)
        // з сусідами «вперед» (праворуч і рядок нижче), щоб кожна пара клітинок — один раз
        for (const [dx, dy] of NEIGHBOURS) {
          const nx = cx + dx
          const ny = cy + dy
          if (nx < 0 || nx >= cols || ny >= rows) continue
          const there = grid[ny * cols + nx]!
          for (const a of here) for (const b of there) push(pairs, a, b)
        }
      }
    // порядок пар — як у наївному проході, щоб обидві системи давали однаковий світ
    pairs.sort((p, q) => p[0].id - q[0].id || p[1].id - q[1].id)
    return pairs
  }
}

const NEIGHBOURS = [
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
] as const

function push(pairs: Pair[], a: Entity, b: Entity): void {
  if (circlesOverlap(a, b)) pairs.push(a.id < b.id ? [a, b] : [b, a])
}
