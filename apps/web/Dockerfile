# Frontend image (spec §3.1, §19.1, §19.5). Build context is the REPO ROOT so the
# monorepo workspace (@lot/shared, convex/_generated) is available to the build.
#
#   docker build -f apps/web/Dockerfile -t lot-web .
#
# No hostname is baked in: the entrypoint writes /runtime-config.json from the
# PUBLIC_* env at container start, so a domain change needs only a restart (§19.5).

# ── build ────────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS build
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

# Manifests first for layer caching.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile

# Sources. convex/_generated is committed and imported by the web app (@cvx/*).
COPY packages/shared packages/shared
COPY convex/_generated convex/_generated
COPY apps/web apps/web
RUN pnpm --filter @stwrd/web build

# ── runtime ──────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /repo/apps/web/dist ./dist
COPY apps/web/node-server.mjs ./node-server.mjs
COPY apps/web/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "node-server.mjs"]
