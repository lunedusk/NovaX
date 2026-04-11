FROM node:20-bookworm-slim AS builder
WORKDIR /

COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM node:20-bookworm-slim AS runner
WORKDIR /

ENV NODE_ENV=production \
    TZ=UTC

COPY package*.json ./
RUN npm install --omit=dev
COPY --from=builder /. .

CMD ["node", "--import", "./core/dependency/index.mjs", "./index.js"]
