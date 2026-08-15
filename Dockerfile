# ##--- AI GENERATED FILE ---##
FROM node:20-bookworm-slim AS builder
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:20-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production \
    TZ=UTC

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/core ./core
COPY --from=builder /app/index.js ./
COPY --from=builder /app/index.d.ts* ./
COPY --from=builder /app/scripts ./scripts

COPY --from=builder /app/package.json ./
COPY --from=builder /app/plugins.txt* ./
COPY --from=builder /app/takebacks.json* ./
COPY --from=builder /app/takebacks.example.json* ./
COPY --from=builder /app/common.json* ./
COPY --from=builder /app/Dockerfile* ./
COPY --from=builder /app/docker-compose.yml* ./

COPY --from=builder /app/plugins ./plugins

RUN addgroup --system --gid 1001 novax \
 && adduser --system --uid 1001 --ingroup novax novax \
 && mkdir -p /app/.data /app/logs /app/configuration /app/plugins \
 && chown -R novax:novax /app

USER novax

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.APIPort||3000)+'/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "--import", "./core/dependency/index.mjs", "./index.js"]
