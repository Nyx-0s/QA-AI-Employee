# ConsentArk API + dashboard — one container (Phase 5).
# Multi-stage: pnpm build in the builder, runtime keeps only dist + prod deps
# (no dev toolchain, no source). Playwright browsers are NOT installed here:
# browser tasks need full Chromium — see docs/PHASE5-notes.md for the
# documented limitation and the compose profile that adds it.

# ── Stage 1: build ────────────────────────────────────────────────
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/dashboard/package.json apps/dashboard/
RUN pnpm install --frozen-lockfile

COPY packages/shared packages/shared
COPY apps/api apps/api
COPY apps/dashboard apps/dashboard
RUN pnpm --filter @consentark/shared build \
  && pnpm --filter @consentark/dashboard build \
  && pnpm --filter @consentark/api build

# ── Stage 2: runtime ──────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable

# Non-root user; DATA_DIR is chowned so SQLite + tokens live here.
RUN groupadd -r consentark && useradd -r -g consentark consentark \
  && mkdir -p /data && chown consentark:consentark /data

COPY --from=build /app/pnpm-workspace.yaml ./
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared/package.json packages/shared/
COPY --from=build /app/packages/shared/node_modules packages/shared/node_modules
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/api/package.json apps/api/
COPY --from=build /app/apps/api/node_modules apps/api/node_modules
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/dashboard/dist apps/dashboard/dist

USER consentark
WORKDIR /app/apps/api
ENV DATA_DIR=/data
# Serve the built dashboard from the API process (single container/port).
ENV DASHBOARD_DIST=/app/apps/dashboard/dist

EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]

# ── Target: runtime-browser (compose profile "browser") ─────────
# Same stack + Playwright Chromium so browser_task employees have hands.
# docker compose --profile browser up
FROM runtime AS runtime-browser
USER root
# Shared browser path (readable by the app user) — root installs, app runs.
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright
RUN npx playwright install --with-deps chromium \
  && chmod -R a+rX /opt/ms-playwright
USER consentark
