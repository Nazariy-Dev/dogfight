/** Token bucket: capacity токенів, поповнення rate токенів/с. */
export function createTokenBucket({
  rate,
  capacity = rate,
  now = () => performance.now(),
}) {
  let tokens = capacity
  let last = now()
  return {
    take(n = 1) {
      const t = now()
      tokens = Math.min(capacity, tokens + ((t - last) / 1000) * rate)
      last = t
      if (tokens < n) return false
      tokens -= n
      return true
    },
    get tokens() {
      return tokens
    },
  }
}
