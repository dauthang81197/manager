# my-notion-backend — multi-stage build.
#
# Both stages pin the SAME base image (node:22-slim, Debian-glibc). The
# Prisma generator in prisma/schema.prisma does not set `binaryTargets`, so
# it defaults to "native" — the query engine it produces is built for
# whatever OS/libc `npx prisma generate` ran on. Building on Debian-glibc and
# running on Alpine-musl (or vice versa) breaks the engine at runtime. Using
# the same base for both stages sidesteps that mismatch entirely instead of
# hand-declaring binaryTargets.
#
# No secret/env is baked in at build time (DATABASE_URL, AUTH_SECRET,
# INTERNAL_API_SECRET, ASSET_STORAGE_DIR, PUBLIC_APP_URL, ...) — those are
# injected at container start via `env_file` on the VPS compose file.

# ---- Builder ----
FROM node:22-slim AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Generates ./generated/prisma (per schema.prisma's custom `output`) using
# this stage's OS/libc — must match the runtime stage's, hence same base image.
RUN npx prisma generate
RUN npm run build

# ---- Runtime ----
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# `nest build` (tsc) already compiles ./generated/prisma alongside ./src into
# dist/generated + dist/src, so dist/ is self-contained for `require`
# resolution at runtime. `prisma/` (schema + migrations) and prisma.config.ts
# are copied separately because `npx prisma migrate deploy` (run by CMD
# below, not by tsc) needs the raw schema/migration SQL files, not compiled JS.
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/generated ./generated
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts

# Backend is never exposed to the Internet directly (spine AD-1/AD-5) — it
# only needs to be reachable on the shared Docker network by the frontend and
# by `docker compose` health/port mapping on the VPS, so no EXPOSE is required
# for correctness, but documents the app's listen port for tooling.
EXPOSE 3001

# Migration runs on every container start, before the server begins
# listening (main.ts's app.listen()). If migrate deploy fails, `&&` short-
# circuits: `node dist/src/main` never runs, so the container exits non-zero
# and does NOT come up silently serving the old schema.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/main"]
