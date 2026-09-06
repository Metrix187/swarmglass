# swarmglass — single small image, no build step (node strips the types itself)
FROM node:24-alpine

# tini for clean signal handling; wget for the healthcheck (busybox has it)
RUN apk add --no-cache tini

WORKDIR /app
ENV NODE_ENV=production \
    SWARMGLASS_ENV=production \
    SWARMGLASS_DATA_DIR=/data \
    SWARMGLASS_PUBLIC_HOST=0.0.0.0 \
    SWARMGLASS_CONSOLE_HOST=0.0.0.0

# no runtime dependencies at all — package.json is copied for the version string only
COPY package.json ./
COPY src ./src
COPY seed ./seed
COPY config ./config
COPY assets ./assets
COPY tools ./tools

# the honeypot runs as an unprivileged user with a read-only root fs (see compose); /data is the only writable path
RUN addgroup -S swarmglass && adduser -S -G swarmglass -h /app swarmglass \
    && mkdir -p /data && chown -R swarmglass:swarmglass /data /app
USER swarmglass
VOLUME ["/data"]

EXPOSE 8080 8081
# the console's /healthz is never recorded; probing the public listener would write the container's own
# heartbeat into the telemetry as a "visitor"
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O - http://127.0.0.1:8081/healthz >/dev/null 2>&1 || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "--disable-warning=ExperimentalWarning", "src/main.ts"]
