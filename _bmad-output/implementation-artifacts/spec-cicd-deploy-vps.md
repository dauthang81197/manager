---
title: 'CI/CD: build & deploy Docker backend/frontend lên VPS qua GitHub Actions'
type: 'feature'
created: '2026-08-02'
status: 'done'
baseline_commit: '01ad4e5f586f1990eb688e094c4a55e02dec1760'
review_loop_iteration: 0
context: ['{project-root}/_bmad-output/planning-artifacts/architecture/architecture-my-notion-2026-07-29/ARCHITECTURE-SPINE.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `my-notion-backend` và `my-notion-frontend` chưa có cách build & deploy tự động — VPS đã có sẵn Postgres, Redis, Docker và reverse proxy, chỉ còn thiếu pipeline đưa 2 app lên. Spine AD-6 đã chốt: GitHub Actions build & deploy Docker image riêng cho mỗi thư mục, trigger theo path-filter.

**Approach:** Thêm Dockerfile multi-stage (Debian-based, frontend dùng Next.js `standalone` output) cho mỗi app, 2 GitHub Actions workflow build & push image lên GHCR khi push nhánh `develop` (path-filtered theo thư mục), sau đó SSH vào VPS để `docker compose pull && up -d` đúng service trong file compose đã có sẵn trên VPS. Prisma migration chạy tự động lúc container backend khởi động.

## Boundaries & Constraints

**Always:**
- Builder và runtime stage của backend Dockerfile dùng cùng base Debian-glibc (`node:22-slim`) — Prisma generator không khai `binaryTargets` (mặc định `native`), nên build/runtime khác hệ (vd Alpine/musl) sẽ vỡ query engine.
- Frontend bật `output: 'standalone'` trong `next.config.ts` để runtime stage chỉ copy `.next/standalone` + `.next/static` + `public`, không cần `npm install` lúc chạy.
- Không bake secret/env nào vào lúc build image — mọi biến (`DATABASE_URL`, `AUTH_SECRET`, `INTERNAL_API_SECRET`, `BACKEND_URL`, `PUBLIC_APP_URL`, `ASSET_STORAGE_DIR`...) là server-side runtime env, inject qua `env_file` lúc container start (frontend không có `NEXT_PUBLIC_*` nào).
- `ASSET_STORAGE_DIR` của backend container mount vào bind-mount cố định trên host VPS (không phải anonymous volume) — story 6 (FR-14 backup) sẽ archive trực tiếp thư mục đó trên host.
- CMD của backend container chạy `npx prisma migrate deploy` trước khi start server, để mỗi deploy tự áp schema mới nhất.
- Mỗi workflow chỉ trigger theo `paths:` đúng thư mục app tương ứng, push nhánh `develop`.
- Backend không expose port ra ngoài Internet (AD-1/AD-5: browser không gọi thẳng backend) — chỉ cần chung Docker network với frontend.

**Ask First:** đổi nhánh trigger từ `develop` sang `main` sau này; chuyển sang build trực tiếp trên VPS thay vì qua GHCR.

**Never:** không sửa file `docker-compose.yml` thật trên VPS (ngoài tầm với agent) — chỉ cung cấp snippet mẫu; không implement FR-14 (backup) hay FR-10 (realtime WS) ở đây, chỉ chuẩn bị container để 2 story đó cắm vào sau; không thêm test/lint gate vào workflow deploy.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Path-filter đúng | Commit chỉ sửa `my-notion-backend/**`, push `develop` | Chỉ `backend-deploy.yml` chạy | `frontend-deploy.yml` không trigger |
| Migration tự động | Backend container restart với image mới | `prisma migrate deploy` chạy xong rồi mới `listen()` | Migration lỗi → process exit non-zero, container không lên (không silently serve schema cũ) |
| GHCR package private mặc định | Lần push image đầu tiên lên GHCR | VPS `docker compose pull` thành công | Nếu 403 → do package chưa set public, cần đổi trong GitHub package settings (ghi trong DEPLOYMENT.md) |

</frozen-after-approval>

## Code Map

- `my-notion/my-notion-backend/prisma/schema.prisma:4-8` -- generator custom output `../generated/prisma`, không `binaryTargets` → ràng buộc base image.
- `my-notion/my-notion-backend/src/main.ts:29` -- `app.listen(process.env.PORT ?? 3001)`, không có CORS/global prefix ảnh hưởng container.
- `my-notion/my-notion-backend/package.json:8-21` -- scripts hiện có: `build` (`nest build`), `start:prod` (`node dist/src/main`) — không có script `prisma generate`, phải thêm vào Dockerfile.
- `my-notion/my-notion-backend/README.md:76-104` -- `ASSET_STORAGE_DIR` phải nằm trong backup set, layout `<dir>/<ownerId>/<assetId>.<ext>`.
- `my-notion/my-notion-frontend/next.config.ts` -- chưa có `output`, cần thêm `standalone`.
- `my-notion/my-notion-frontend/.env.local.example` / `my-notion-backend/.env.example` -- danh sách biến cần có trong `.env` thật trên VPS.
- `.github/workflows/` -- chưa tồn tại, tạo mới 2 file.

## Tasks & Acceptance

**Execution:**
- [x] `my-notion/my-notion-backend/Dockerfile` -- multi-stage: builder (`npm ci`, `npx prisma generate`, `npm run build`) → runtime (`npm ci --omit=dev`, copy `dist/`, `generated/prisma/`, `prisma/`; `CMD npx prisma migrate deploy && node dist/src/main`) trên `node:22-slim` cả 2 stage -- image tối giản, tự migrate mỗi deploy.
- [x] `my-notion/my-notion-backend/.dockerignore` -- ignore `node_modules`, `dist`, `generated`, `var`, `.env*`, `coverage` -- giảm context, tránh leak file local.
- [x] `my-notion/my-notion-frontend/next.config.ts` -- thêm `output: 'standalone'` -- bắt buộc cho runtime stage nhẹ.
- [x] `my-notion/my-notion-frontend/Dockerfile` -- multi-stage: builder (`npm ci`, `npm run build`) → runtime (copy `.next/standalone`, `.next/static`, `public`; `CMD node server.js`) trên `node:22-slim` -- theo đúng standalone output.
- [x] `my-notion/my-notion-frontend/.dockerignore` -- ignore `node_modules`, `.next`, `.env*`, `coverage`.
- [x] `.github/workflows/backend-deploy.yml` -- trigger `push: develop` + `paths: my-notion/my-notion-backend/**`; build & push `ghcr.io/${{ github.repository_owner }}/my-notion-backend:latest,{sha}` (permissions `packages: write`); SSH (`appleboy/ssh-action`, secrets `SSH_HOST`/`SSH_USER`/`SSH_PRIVATE_KEY`/`DEPLOY_PATH`) chạy `cd $DEPLOY_PATH && docker compose pull backend && docker compose up -d backend`.
- [x] `.github/workflows/frontend-deploy.yml` -- tương tự, `paths: my-notion/my-notion-frontend/**`, image `ghcr.io/.../my-notion-frontend`.
- [x] `my-notion/DEPLOYMENT.md` -- liệt kê 4 GitHub Secrets cần tạo; snippet service `backend`/`frontend` mẫu để dán vào `docker-compose.yml` trên VPS (`image`, `env_file: .env`, `volumes` bind-mount `ASSET_STORAGE_DIR`, `networks` chung với postgres/redis hiện có, `restart: unless-stopped`); note set GHCR package visibility = public sau lần push đầu.

**Acceptance Criteria:**
- Given commit chỉ đổi file trong `my-notion/my-notion-backend/`, when push `develop`, then chỉ `backend-deploy.yml` chạy.
- Given image backend mới deploy, when container start, then `prisma migrate deploy` chạy trước `main.ts` listen — migration lỗi thì container không lên (không serve schema cũ lặng lẽ).
- Given `next.config.ts` có `output: 'standalone'`, when build image frontend runtime chỉ copy `.next/standalone` (không `npm install`), then `node server.js` phục vụ được trang mà không lỗi module-not-found.

## Design Notes

**Native Prisma binary + GHCR visibility:** không set `binaryTargets` nghĩa là engine build ra khớp hệ điều hành lúc `prisma generate` chạy — dùng chung `node:22-slim` cho builder lẫn runtime là cách rẻ nhất để tránh mismatch, thay vì khai `binaryTargets` thủ công. GHCR package theo mặc định **private** dù repo public, cho tới khi người dùng vào Package settings đổi visibility → public — nếu bỏ qua bước này, `docker compose pull` trên VPS sẽ 403 dù không cần `docker login`.

## Verification

**Commands:**
- `cd my-notion/my-notion-backend && docker build -t my-notion-backend:test .` -- expected: build xong, không lỗi prisma engine.
- `cd my-notion/my-notion-frontend && docker build -t my-notion-frontend:test .` -- expected: build xong với standalone output.
- `docker run --rm -p 3000:3000 my-notion-frontend:test` rồi `curl -sf localhost:3000` -- expected: trả HTML 200, không crash vì thiếu module.

## Suggested Review Order

**Base image & tương thích Prisma engine**

- Cả 2 stage backend dùng chung `node:22-slim` để khớp Prisma native engine, tránh vỡ khi build/run khác glibc/musl.
  [`Dockerfile:16`](../../my-notion/my-notion-backend/Dockerfile#L16)

- `CMD` chạy `prisma migrate deploy` trước khi start server — mỗi deploy tự áp schema mới, lỗi thì container không lên.
  [`Dockerfile:57`](../../my-notion/my-notion-backend/Dockerfile#L57)

**Frontend standalone output**

- Bật `output: "standalone"` để runtime stage không cần `npm install`, chỉ copy file đã trace sẵn.
  [`next.config.ts:7`](../../my-notion/my-notion-frontend/next.config.ts#L7)

- Placeholder secret chỉ tồn tại ở builder stage — không lọt sang runtime/container thật.
  [`Dockerfile:24`](../../my-notion/my-notion-frontend/Dockerfile#L24)

**Pipeline deploy: an toàn khi chạy song song & khi container crash**

- `concurrency` group chặn 2 deploy cùng nhánh chạy song song, không hủy deploy đang chạy dở.
  [`backend-deploy.yml:20`](../../.github/workflows/backend-deploy.yml#L20)

- Script SSH: `set -euo pipefail` + quote path — `pull` lỗi thì dừng, không chạy `up -d` trên image cũ/sai thư mục.
  [`backend-deploy.yml:74`](../../.github/workflows/backend-deploy.yml#L74)

- Kiểm tra container còn "running" sau 5s, fail job + in log nếu crash-loop thay vì báo xanh giả.
  [`backend-deploy.yml:82`](../../.github/workflows/backend-deploy.yml#L82)

- Cùng pattern áp cho frontend, path-filter riêng theo thư mục.
  [`frontend-deploy.yml:74`](../../.github/workflows/frontend-deploy.yml#L74)

**Tài liệu vận hành**

- Snippet compose mẫu: `depends_on` healthcheck Postgres, bind-mount `ASSET_STORAGE_DIR`, không expose port backend.
  [`DEPLOYMENT.md:59`](../../my-notion/DEPLOYMENT.md#L59)

- Lệnh rollback thủ công cụ thể theo tag sha.
  [`DEPLOYMENT.md:136`](../../my-notion/DEPLOYMENT.md#L136)

**Peripherals**

- `.dockerignore` backend/frontend loại `node_modules`/`dist`/`.next`/`.env*` khỏi build context.
  [`.dockerignore:1`](../../my-notion/my-notion-backend/.dockerignore#L1)
