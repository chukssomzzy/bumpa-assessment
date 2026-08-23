# ---- build ----
FROM node:24-alpine AS builder
WORKDIR /app
COPY package*.json ./
# --ignore-scripts: husky's `prepare` hook has no .git here and is irrelevant to the image.
# Cache mount: npm's download/extract cache survives across builds even though
# the layer itself doesn't, so an unchanged package-lock.json reinstalls from
# disk instead of the network.
RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts
COPY tsconfig*.json nest-cli.json ./
COPY src ./src
RUN npm run build

# ---- runtime ----
FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apk add --no-cache dumb-init
COPY package*.json ./
# --ignore-scripts again: without it, npm runs `prepare` -> husky is absent in a
# production install -> the image fails to build. `npm cache clean` is dropped:
# with the cache mounted rather than baked into this layer, there is nothing
# in the image layer for it to shrink.
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --ignore-scripts
COPY --from=builder /app/dist ./dist
USER node
# dumb-init as PID 1 so SIGTERM reaches Nest and enableShutdownHooks() can let an
# in-flight payout finish rather than being killed mid-transfer.
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main"]
