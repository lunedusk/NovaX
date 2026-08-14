# ##--- AI GENERATED FILE ---##
FROM node:20-bookworm-slim AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json typedoc.json common.json ./
COPY src ./src
COPY plugins.txt* ./

RUN npm run build

FROM node:20-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production \
    TZ=UTC

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/core ./core
COPY --from=builder /app/index.js ./
COPY --from=builder /app/index.d.ts* ./
COPY --from=builder /app/common.json ./
COPY --from=builder /app/plugins.txt* ./
COPY --from=builder /app/scripts ./scripts

RUN addgroup --system --gid 1001 novax \
 && adduser --system --uid 1001 --ingroup novax novax \
 && chown -R novax:novax /app
USER novax

EXPOSE 3000
CMD ["node", "--import", "./core/dependency/index.mjs", "./index.js"]