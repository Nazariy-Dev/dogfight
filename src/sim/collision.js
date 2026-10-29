/**
 * Система колізій «коло – коло». Наївний перебір O(n²) – окрема функція,
 * яку пізніше можна замінити просторовим хешем, не чіпаючи World.
 * Повертає масив пар [a, b] сутностей, що перетинаються.
 */
export function circlesOverlap(a, b) {
  const dx = a.pos.x - b.pos.x
  const dy = a.pos.y - b.pos.y
  const r = a.radius + b.radius
  return dx * dx + dy * dy < r * r
}

export function naivePairs(entities) {
  const list = entities.filter((e) => e.alive && e.radius > 0 && !e.dead)
  const pairs = []
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      if (circlesOverlap(list[i], list[j])) pairs.push([list[i], list[j]])
    }
  }
  return pairs
}
