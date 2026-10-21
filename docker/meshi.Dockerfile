# syntax=docker/dockerfile:1

# Keep the Node.js version in sync with .mise.toml.
FROM node:26.8.2-slim AS base
WORKDIR /app
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# Node.js 25+ no longer bundles Corepack: https://github.com/nodejs/corepack
RUN npm install -g corepack@0.35.0 && npm cache clean --force && corepack enable

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY server/package.json ./server/package.json
COPY web/package.json ./web/package.json
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

# Local development stage. Bind-mount the repo over /app and keep the workspace
# install in named volumes so the host's node_modules cannot replace it.
FROM deps AS dev
CMD ["pnpm", "--filter", "server", "run", "dev"]

FROM deps AS builder
COPY server ./server
COPY web ./web
RUN pnpm --filter server run build \
    && pnpm --filter web run build \
    && pnpm --filter server --prod deploy /deploy

# Keep the deployed package's production dependencies at /app/node_modules;
# runtime paths consumed by infra remain /app/dist, /app/drizzle and /app/web/dist.
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=builder /deploy ./
COPY --from=builder /app/web/dist ./web/dist
# runAsUser/runAsGroup 1000 (node user) is enforced by the infra Deployment's
# securityContext, since kubelet can't verify runAsNonRoot against a
# non-numeric USER. Keep this image's node user at the default uid/gid 1000
# so the two stay in sync.
USER node
EXPOSE 8080
CMD ["node", "--import", "@fohte/service-kit/otel-register", "dist/index.js"]
