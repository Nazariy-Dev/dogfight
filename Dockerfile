# syntax=docker/dockerfile:1
# ---------- stage 1: збірка (dev-залежності, Vite, tsc) ----------
FROM node:22-alpine AS build
WORKDIR /app
# спочатку лише маніфести: шар npm ci кешується, поки lockfile не змінився
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY client/package.json client/
COPY server/package.json server/
RUN npm ci
COPY . .
RUN npm run typecheck && npm run build
# лише production-залежності для фінального образу
RUN npm ci --omit=dev --workspace server --include-workspace-root=false

# ---------- stage 2: запуск ----------
FROM node:22-alpine AS run
ENV NODE_ENV=production PORT=8080 LOG_DIR=/tmp/logs STATIC_DIR=/app/client/dist
ARG GIT_SHA=dev
ENV GIT_SHA=$GIT_SHA
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/shared/package.json ./shared/
COPY --from=build /app/shared/src ./shared/src
COPY --from=build /app/server/package.json ./server/
COPY --from=build /app/server/src ./server/src
COPY --from=build /app/client/dist ./client/dist
# не root
USER node
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/health || exit 1
# exec-форма: PID 1 — сам node, тож SIGTERM від `docker stop` дійде до процесу
CMD ["node", "server/src/index.ts"]
