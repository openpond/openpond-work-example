FROM node:24.18.0-bookworm-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.13.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY vendor ./vendor
RUN pnpm install --frozen-lockfile
COPY . .
# Public build-only placeholder; the runtime requires its own secret.
RUN BETTER_AUTH_SECRET=build-only-placeholder-not-a-runtime-secret pnpm build

FROM node:24.18.0-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=127.0.0.1
ENV PORT=3000
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/scripts/initialize.mjs ./scripts/initialize.mjs
COPY --from=build --chown=node:node /app/scripts/data-snapshot.mjs ./scripts/data-snapshot.mjs
USER node
CMD ["sh", "-c", "node scripts/initialize.mjs && node node_modules/next/dist/bin/next start --hostname $HOSTNAME --port $PORT"]
