# syntax=docker/dockerfile:1

FROM node:24.17.0-slim AS base
WORKDIR /app
RUN corepack enable

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# Local development stage (used by docker compose)
FROM base AS dev
COPY --from=deps /app/node_modules ./node_modules
CMD ["pnpm", "dev"]

FROM deps AS builder
COPY . .
RUN pnpm run build

# runAsUser/runAsGroup 1000 (node user) is enforced by the infra Deployment's
# securityContext, since kubelet can't verify runAsNonRoot against a
# non-numeric USER. Keep this image's node user at the default uid/gid 1000
# so the two stay in sync.
FROM base AS runtime
ENV NODE_ENV=production
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml otel-register.mjs ./
RUN pnpm install --frozen-lockfile --prod
COPY --from=builder /app/dist ./dist
COPY drizzle ./drizzle
EXPOSE 8080
USER node
CMD ["node", "--import", "./otel-register.mjs", "dist/index.js"]

LABEL org.opencontainers.image.source=https://github.com/fohte/meshi
