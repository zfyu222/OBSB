# Self-hosted LiveSync CLI 1.0.30, built from the pinned release source.
FROM node:22-slim@sha256:4d676821dff059fd00d277ee4261ef34ea712317fed0737c03941481b5760c96 AS builder

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build -w self-hosted-livesync-cli

FROM node:22-slim@sha256:4d676821dff059fd00d277ee4261ef34ea712317fed0737c03941481b5760c96 AS runtime-deps
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /deps
COPY src/apps/cli/package.json ./package.json
RUN npm pkg delete devDependencies \
    && npm install --omit=dev

FROM node:22-slim@sha256:4d676821dff059fd00d277ee4261ef34ea712317fed0737c03941481b5760c96
WORKDIR /app
COPY --from=runtime-deps /deps/node_modules ./node_modules
COPY --from=builder /build/src/apps/cli/dist ./dist
COPY src/apps/cli/docker-entrypoint.sh /usr/local/bin/livesync-cli
RUN chmod 755 /usr/local/bin/livesync-cli
VOLUME ["/data"]
ENTRYPOINT ["livesync-cli"]
