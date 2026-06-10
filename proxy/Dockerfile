# @synapcores/widget-proxy — production image.
# Small Node 20 base, no build step (pure JS, no transpile), runs as a
# non-root user, listens on PORT (default 5060). The widget bundle path
# is configurable via WIDGET_BUNDLE_PATH; default points at /app/widget-dist
# which the compose layer mounts from the host build output.

FROM node:20-alpine

WORKDIR /app

# Install only production deps. The proxy has two: ws + cookie.
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

COPY src ./src

# Run as a non-root user — the proxy doesn't need to write anywhere on
# disk (config is read-only at /app/projects.json, bundle is read-only
# at /app/widget-dist).
RUN addgroup -S sc && adduser -S sc -G sc && chown -R sc:sc /app
USER sc

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=5060
ENV WIDGET_BUNDLE_PATH=/app/widget-dist/widget.js
ENV PROXY_PROJECTS=/app/projects.json

EXPOSE 5060

# The healthcheck probes /health — the proxy returns 200 with project count.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O - http://127.0.0.1:${PORT}/health >/dev/null || exit 1

CMD ["node", "src/server.js"]
