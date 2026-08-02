# syntax=docker/dockerfile:1

# Keep the Node.js version in sync with .mise.toml.
FROM node:24.18.0-slim AS base
WORKDIR /app
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# Node.js 25+ no longer bundles Corepack: https://github.com/nodejs/corepack
RUN npm install -g corepack@0.35.0 && npm cache clean --force && corepack enable

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY web/package.json ./web/package.json
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

# Local development stage. Bind-mount the repo over /app (e.g. from
# docker compose, with an anonymous volume on /app/node_modules to keep
# this image's install instead of the host's) for live-reload without
# rebuilding the image.
FROM base AS dev
COPY --from=deps /app/node_modules ./node_modules
CMD ["pnpm", "dev"]

FROM deps AS builder
COPY tsconfig.json tsup.config.ts ./
COPY src ./src
RUN pnpm run build

FROM deps AS web-builder
COPY web ./web
RUN pnpm --filter web run build

# Built fresh from `base`, not `builder`, so the runtime image doesn't inherit
# dev dependencies or source files left over from the build stage.
FROM base AS runtime
ENV NODE_ENV=production
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY web/package.json ./web/package.json
# --filter meshi: the server only serves web/dist's already-built static
# files, so web's own dependencies (react, vite, ...) don't belong here.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter meshi
COPY --from=builder /app/dist ./dist
<<<<<<< before updating
# Served by Hono's serveStatic (src/app.ts) from the same relative path.
COPY --from=web-builder /app/web/dist ./web/dist
COPY drizzle ./drizzle
COPY otel-register.mjs ./
# runAsUser/runAsGroup 1000 (node user) is enforced by the infra Deployment's
# securityContext, since kubelet can't verify runAsNonRoot against a
# non-numeric USER. Keep this image's node user at the default uid/gid 1000
# so the two stay in sync.
||||||| last update
COPY otel-register.mjs ./
=======
>>>>>>> after updating
USER node
EXPOSE 8080
CMD ["node", "--import", "@fohte/service-kit/otel-register", "dist/index.js"]
