FROM node:24-alpine AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /workspace

COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm db:generate && pnpm --filter @nimbus/api build
RUN CI=true pnpm --filter @nimbus/api deploy --legacy --prod /opt/nimbus-api
RUN packages/db/node_modules/.bin/prisma generate --schema=/opt/nimbus-api/node_modules/@nimbus/db/prisma/schema.prisma

FROM node:24-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S nimbus && adduser -S -G nimbus nimbus
COPY --from=build --chown=nimbus:nimbus /opt/nimbus-api/ ./
USER nimbus
EXPOSE 10000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||10000)+'/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
