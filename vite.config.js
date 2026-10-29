import { defineConfig } from 'vite'

/**
 * Middleware для перевірки збоїв: будь-який запит з ?delay=мс відповідає із затримкою.
 * Працює і в `vite` (dev), і у `vite preview`.
 */
function delayMiddleware(req, _res, next) {
  const m = /[?&]delay=(\d+)/.exec(req.url ?? '')
  if (!m) return next()
  req.url = req.url.replace(/[?&]delay=\d+/, '')
  setTimeout(next, Math.min(Number(m[1]), 30000))
}

export default defineConfig({
  // без SPA-fallback: відсутній файл має давати 404, а не index.html
  appType: 'mpa',
  plugins: [
    {
      name: 'dogfight-delay',
      configureServer: (s) => void s.middlewares.use(delayMiddleware),
      configurePreviewServer: (s) => void s.middlewares.use(delayMiddleware),
    },
  ],
})
