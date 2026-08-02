# my-notion-frontend — multi-stage build using Next.js `output: "standalone"`
# (next.config.ts). No secret/env is baked in at build time — this app has no
# `NEXT_PUBLIC_*` vars, so every runtime var (AUTH_SECRET, INTERNAL_API_SECRET,
# BACKEND_URL, AUTH_GOOGLE_ID/SECRET, ...) is injected at container start via
# `env_file` on the VPS compose file, never at `docker build` time.

# ---- Builder ----
FROM node:22-slim AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# lib/auth.ts throws at module-eval time if AUTH_SECRET / INTERNAL_API_SECRET
# are unset, and `next build`'s "Collecting page data" step imports every
# route module (including the auth routes) to statically analyze it — so the
# build fails without *some* value present. These are placeholders for this
# RUN step only: a multi-stage build's ENV never crosses the `FROM runtime`
# boundary below, so they never reach the runtime image or a real container.
# The actual secrets are injected at container start via `env_file` on the VPS
# — see my-notion/DEPLOYMENT.md.
ENV AUTH_SECRET="build-placeholder-not-a-real-secret"
ENV INTERNAL_API_SECRET="build-placeholder-not-a-real-secret"
RUN npm run build

# ---- Runtime ----
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
# Standalone's server.js binds to this host; without it, some Next versions
# default to localhost-only inside the container, which is unreachable
# through the Docker network / port mapping.
ENV HOSTNAME="0.0.0.0"

# `output: "standalone"` traces the minimal set of node_modules the server
# actually needs into .next/standalone, so no `npm install` (dev or prod) is
# required in this stage at all.
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

EXPOSE 3000

CMD ["node", "server.js"]
