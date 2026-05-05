# Multi-stage Node 20 alpine. Final image ~80MB. Builds without
# requiring the rest of the monorepo — package.json + tsconfig +
# src are self-contained.

FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY --from=builder /app/dist ./dist

# Non-root user for the runtime process.
RUN addgroup -S app && adduser -S app -G app
USER app

EXPOSE 8080
CMD ["node", "dist/index.js"]
