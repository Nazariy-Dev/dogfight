/** Ділення за модулем, що завжди дає значення в [0, m). */
export function mod(a, m) {
  return ((a % m) + m) % m
}

/** «Загортання» країв: вилетів праворуч — з'явився ліворуч. */
export function wrap(obj, w, h) {
  obj.x = mod(obj.x, w)
  obj.y = mod(obj.y, h)
  return obj
}

/**
 * Після загортання попередній стан лежить на іншому краю арени, і
 * інтерполяція протягнула б корабель через увесь екран. Зсуваємо
 * prev на ширину/висоту, щоб відрізок prev→cur був коротким.
 */
export function unwrapPrevious(prev, cur, w, h) {
  if (cur.x - prev.x > w / 2) prev.x += w
  else if (prev.x - cur.x > w / 2) prev.x -= w
  if (cur.y - prev.y > h / 2) prev.y += h
  else if (prev.y - cur.y > h / 2) prev.y -= h
}
