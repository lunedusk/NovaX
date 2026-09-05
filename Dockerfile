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
COPY --from=builder /app/plugins ./plugins
COPY --from=builder /app/package.json ./
COPY --from=builder /app/plugins.txt* ./
COPY --from=builder /app/takebacks.json* ./
COPY --from=builder /app/takebacks.example.json* ./
COPY --from=builder /app/common.json* ./

RUN addgroup --system --gid 1001 zene \
 && adduser --system --uid 1001 --ingroup zene zene \
 && mkdir -p /app/.data /app/logs /app/configuration /app/plugins \
 && chown -R zene:zene /app

USER zene

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.APIPort||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--import", "./core/dependency/index.mjs", "./index.js"]