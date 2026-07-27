# syntax=docker/dockerfile:1

<<<<<<< before updating
FROM node:24.17.0-slim AS base
||||||| last update
=======
# Keep the Node.js version in sync with .mise.toml.
FROM node:24.18.0-slim AS base
>>>>>>> after updating
WORKDIR /app
<<<<<<< before updating
RUN corepack enable
||||||| last update
=======
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# Node.js 25+ no longer bundles Corepack: https://github.com/nodejs/corepack
RUN npm install -g corepack@0.35.0 && npm cache clean --force && corepack enable
>>>>>>> after updating

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
<<<<<<< before updating
RUN pnpm install --frozen-lockfile
||||||| last update
=======
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile
>>>>>>> after updating

<<<<<<< before updating
# Local development stage (used by docker compose)
||||||| last update
=======
# Local development stage. Bind-mount the repo over /app (e.g. from
# docker compose, with an anonymous volume on /app/node_modules to keep
# this image's install instead of the host's) for live-reload without
# rebuilding the image.
>>>>>>> after updating
FROM base AS dev
COPY --from=deps /app/node_modules ./node_modules
CMD ["pnpm", "dev"]

FROM deps AS builder
<<<<<<< before updating
COPY . .
||||||| last update
=======
COPY tsconfig.json tsup.config.ts ./
COPY src ./src
>>>>>>> after updating
RUN pnpm run build

<<<<<<< before updating
# runAsUser/runAsGroup 1000 (node user) is enforced by the infra Deployment's
# securityContext, since kubelet can't verify runAsNonRoot against a
# non-numeric USER. Keep this image's node user at the default uid/gid 1000
# so the two stay in sync.
||||||| last update
=======
# Built fresh from `base`, not `builder`, so the runtime image doesn't inherit
# dev dependencies or source files left over from the build stage.
>>>>>>> after updating
FROM base AS runtime
ENV NODE_ENV=production
<<<<<<< before updating
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml otel-register.mjs ./
RUN pnpm install --frozen-lockfile --prod
||||||| last update
=======
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod
>>>>>>> after updating
COPY --from=builder /app/dist ./dist
<<<<<<< before updating
COPY drizzle ./drizzle
EXPOSE 8080
||||||| last update
=======
COPY otel-register.mjs ./
>>>>>>> after updating
USER node
<<<<<<< before updating
||||||| last update
=======
EXPOSE 8080
>>>>>>> after updating
CMD ["node", "--import", "./otel-register.mjs", "dist/index.js"]
<<<<<<< before updating

LABEL org.opencontainers.image.source=https://github.com/fohte/meshi
||||||| last update
=======
>>>>>>> after updating
