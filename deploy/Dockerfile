FROM node:24-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /workspace

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm -F @bookmark-assistant/server build

FROM base AS runtime
ENV NODE_ENV=production SELF_HOSTED=true PORT=3333
COPY --from=build --chown=node:node /workspace /workspace
WORKDIR /workspace/packages/server
USER node
EXPOSE 3333
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD node -e "fetch('http://127.0.0.1:3333/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "scripts/start-self-hosted.mjs"]
