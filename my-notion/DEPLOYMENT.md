# Deployment (CI/CD → VPS)

How `my-notion-backend` and `my-notion-frontend` get from a `git push` to
running containers on the VPS. See `.github/workflows/backend-deploy.yml` and
`.github/workflows/frontend-deploy.yml` for the actual pipelines, and each
app's `Dockerfile` for the image build.

## 1. GitHub Secrets to create

Repo → Settings → Secrets and variables → Actions → New repository secret.
Both workflows read the same four secrets:

| Secret | Value |
| --- | --- |
| `SSH_HOST` | VPS hostname or IP the runner SSHes into. |
| `SSH_USER` | SSH user on the VPS (needs permission to run `docker compose` in `DEPLOY_PATH`, typically a member of the `docker` group). |
| `SSH_PRIVATE_KEY` | Private key matching a public key already in that user's `~/.ssh/authorized_keys` on the VPS. Generate a dedicated deploy keypair — don't reuse a personal key. |
| `DEPLOY_PATH` | Absolute path on the VPS to the directory containing the real `docker-compose.yml` (the one with Postgres/Redis/reverse proxy already defined). |

No `GHCR` login secret is needed — both workflows push using the workflow's
own `GITHUB_TOKEN` (scoped by the `packages: write` permission already set in
each workflow file).

## 2. GHCR package visibility (first push only)

The **first** time each workflow pushes an image, GitHub creates the GHCR
package as **private by default**, even though this repo is public. Until you
change that, the VPS's `docker compose pull` will fail with `403 Forbidden`
(no `docker login` involved, it's a visibility setting, not a credentials
problem).

Fix once, after the first successful build:

1. GitHub → your profile/org → **Packages** → `my-notion-backend` (and
   separately `my-notion-frontend`).
2. Package settings → **Change visibility** → **Public**.

(Alternative: keep it private and `docker login ghcr.io` on the VPS with a PAT
that has `read:packages` — more setup, not required if public is acceptable
for your use case.)

## 3. Service snippets for the VPS `docker-compose.yml`

This repo does **not** touch the real `docker-compose.yml` on the VPS (out of
reach for CI, and it already defines Postgres/Redis/the reverse proxy). Add
services shaped like this to it — adjust `<owner>` (lowercase GitHub
username/org), the shared network name, and the host bind-mount path:

```yaml
services:
  backend:
    # `${BACKEND_IMAGE_TAG:-latest}` (rather than a hardcoded `:latest`) is
    # what makes the one-liner rollback under "Manual rollback" below work —
    # it lets you pin the tag for a single `pull`/`up` invocation without
    # editing this file.
    image: ghcr.io/<owner>/my-notion-backend:${BACKEND_IMAGE_TAG:-latest}
    env_file:
      - ./my-notion-backend.env # DATABASE_URL, AUTH_SECRET, INTERNAL_API_SECRET, PORT, ASSET_STORAGE_DIR, PUBLIC_APP_URL — see my-notion-backend/.env.example
    depends_on:
      # On a VPS reboot, every `restart: unless-stopped` container starts at
      # once — without this, backend can win the race against Postgres and
      # fail its `prisma migrate deploy` before the DB is accepting
      # connections. This assumes the *existing* postgres service on the VPS
      # already has (or you add) a `healthcheck:` block, e.g.:
      #   healthcheck:
      #     test: ["CMD-SHELL", "pg_isready -U <db_user>"]
      #     interval: 5s
      #     timeout: 3s
      #     retries: 10
      postgres:
        condition: service_healthy
    volumes:
      # Bind-mount (NOT a named/anonymous volume) so story 6's FR-14 backup
      # job can archive this directory directly on the host by path.
      - /srv/my-notion/assets:/app/var/assets
    networks:
      - my-notion-net # same network as the existing postgres/redis services
    restart: unless-stopped
    # No `ports:` — backend is never reached directly from the Internet
    # (spine AD-1/AD-5); only the frontend and (if used) the reverse proxy
    # need it, both over the Docker network.

  frontend:
    image: ghcr.io/<owner>/my-notion-frontend:${FRONTEND_IMAGE_TAG:-latest}
    env_file:
      - ./my-notion-frontend.env # AUTH_SECRET, INTERNAL_API_SECRET, BACKEND_URL, AUTH_GOOGLE_ID/SECRET — see my-notion-frontend/.env.local.example
    networks:
      - my-notion-net
    restart: unless-stopped
    ports:
      - '3000:3000' # or wire through the existing reverse proxy instead

networks:
  my-notion-net:
    external: true # or drop `external` and define it here if it doesn't exist yet
```

Notes:

- `ASSET_STORAGE_DIR` inside the container must equal the mount's *container*
  side (e.g. `/app/var/assets` above) — set it to that same path in
  `my-notion-backend.env`.
- `AUTH_SECRET` and `INTERNAL_API_SECRET` must be **byte-identical** between
  the two `.env` files (spine AD-5) — generate them once and copy into both.
- Neither image bakes in any secret or environment value at build time; every
  variable above is injected only when the container starts, via `env_file`.
- Backend's `CMD` runs `npx prisma migrate deploy` before starting the
  server on every container start/restart — a `docker compose up -d backend`
  after a deploy always applies the latest schema, and a failed migration
  exits the container instead of quietly serving the old schema.

## 4. Trigger behavior

- Each workflow only runs on `push` to `develop`, filtered by `paths:` to its
  own app folder — a commit touching only `my-notion-backend/**` does not
  trigger `frontend-deploy.yml`, and vice versa.
- Both images are tagged `:latest` and `:<git-sha>` on every run; the VPS
  deploy step always pulls/runs `:latest`. Use the `:<sha>` tag if you ever
  need to pin/roll back manually on the VPS.

### Manual rollback

`docker compose pull`/`up` always use whatever tag is in the `image:` line of
the compose file — you can't hand an image ref to those commands directly.
The `${BACKEND_IMAGE_TAG:-latest}` / `${FRONTEND_IMAGE_TAG:-latest}`
substitution in the snippet above exists so a rollback doesn't require
editing the compose file: `docker compose` reads env var overrides from the
shell (or a `.env` file in the same directory), so setting the var inline for
one command pins that one invocation to a specific tag.

To roll `backend` back to a known-good commit, SSH into the VPS, `cd` into
`DEPLOY_PATH`, and run (swap in the actual SHA from a previous successful
Actions run — the same value the workflow tagged the image with):

```bash
BACKEND_IMAGE_TAG=<sha> docker compose pull backend && BACKEND_IMAGE_TAG=<sha> docker compose up -d backend
```

Same shape for `frontend`, using `FRONTEND_IMAGE_TAG` instead. Note this only
lasts until the next `develop` push redeploys `:latest` — for a rollback that
sticks, edit the compose file's `image:` line (or a persisted `.env` next to
it) to the SHA instead of relying on a one-off shell var.
