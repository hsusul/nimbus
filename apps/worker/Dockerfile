FROM node:24-alpine AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /workspace

COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm db:generate && pnpm --filter @nimbus/worker build
RUN CI=true pnpm --filter @nimbus/worker deploy --legacy --prod /opt/nimbus-worker
RUN packages/db/node_modules/.bin/prisma generate --schema=/opt/nimbus-worker/node_modules/@nimbus/db/prisma/schema.prisma

FROM node:24-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S nimbus && adduser -S -G nimbus nimbus
COPY --from=build --chown=nimbus:nimbus /opt/nimbus-worker/ ./
USER nimbus
CMD ["node", "dist/index.js"]
