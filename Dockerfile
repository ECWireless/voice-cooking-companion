FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable

FROM base AS deps
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod=false

FROM deps AS build
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
RUN pnpm run build

FROM deps AS prod-deps
RUN pnpm prune --prod

FROM base AS runtime
COPY package.json pnpm-lock.yaml ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY public ./public
COPY docs ./docs
COPY hardware ./hardware
EXPOSE 3000
CMD ["node", "dist/src/server.js"]
