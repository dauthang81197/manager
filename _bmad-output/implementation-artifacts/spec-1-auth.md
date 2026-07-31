---
title: 'Auth (CAP-1 / FR-1 / story 1)'
type: 'feature'
created: '2026-07-30'
status: 'done'
baseline_commit: '3be60bdf80968eba0921a03dd2462f9f2593232d'
review_loop_iteration: 0
context: ['{project-root}/_bmad-output/planning-artifacts/prds/prd-my-notion-2026-07-29/prd.md', '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-my-notion-2026-07-29/ARCHITECTURE-SPINE.md', '{project-root}/_bmad-output/specs/spec-my-notion/SPEC.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** My Notion chưa có cơ chế xác thực nào — cần đăng ký/đăng nhập để bảo vệ workspace cá nhân trước khi bất kỳ tính năng nào khác có thể dùng được.

**Approach:** Scaffold hai app mới (`my-notion-backend` NestJS v11, `my-notion-frontend` Next.js 16.2) trong repo `my-notion` vừa tạo. Auth.js v5 (frontend) xử lý flow đăng nhập (Credentials + Google OAuth), custom `encode`/`decode` phát JWT ký HS256 dùng chung `AUTH_SECRET`. Mọi việc đọc/ghi user (kiểm tra mật khẩu, lockout, tạo/liên kết tài khoản Google) đi qua backend REST — Auth.js không tự query Postgres. Backend có Guard verify JWT cho REST + WS handshake.

## Boundaries & Constraints

**Always:**
- JWT ký HS256, secret dùng chung qua biến môi trường `AUTH_SECRET` giữa 2 app (spine AD-5) — không dùng JWE mặc định của Auth.js.
- Mật khẩu hash bằng argon2id, không lưu plaintext (spine AD-5 NFR).
- Auth.js `authorize()` (Credentials) và callback Google KHÔNG được query Postgres trực tiếp — phải gọi REST endpoint của backend (spine AD-1: backend là nguồn chân lý duy nhất).
- REST từ frontend sang backend đi qua Next.js Route Handlers, gắn `Authorization: Bearer <token>`.
- Repo: `my-notion-backend/` và `my-notion-frontend/` là 2 thư mục top-level trong 1 git repo `my-notion` (đã init sẵn tại `/Users/darius/project/exam/my-notion`), không dùng Nx/Turborepo.
- Sai mật khẩu 5 lần liên tiếp → khóa đăng nhập 15 phút (`locked_until` trên user).

**Ask First:**
- Nếu cần đổi khỏi Auth.js v5 sang thư viện khác (do Auth.js đang ở chế độ maintenance) → hỏi trước khi đổi.
- Google OAuth Client ID/Secret thật chưa có sẵn — hỏi người dùng cách cung cấp (biến môi trường `.env`, giá trị placeholder để dev trước).

**Never:**
- Không dùng Clerk/Auth0 hay bất kỳ auth SaaS vendor nào.
- Không xây 2FA hay giới hạn theo IP ở v1.
- Không implement WebSocket/realtime sync trong story này (thuộc story 5/CAP-10) — Guard chỉ cần verify JWT lúc handshake, chưa cần gateway thật.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Đăng ký mới | email + password hợp lệ, email chưa tồn tại | Tạo user, hash password, trả JWT | Email đã tồn tại → 409 |
| Đăng nhập đúng | email + password đúng | Trả JWT hợp lệ, reset `failed_login_attempts` về 0 | N/A |
| Đăng nhập sai | password sai, chưa đạt 5 lần | Tăng `failed_login_attempts` | Trả 401 |
| Đạt ngưỡng khóa | lần sai thứ 5 liên tiếp | Set `locked_until = now + 15p` | Trả 423 kèm thời điểm mở khóa |
| Đăng nhập khi đang khóa | request tới khi `locked_until > now` | Từ chối dù password đúng | Trả 423 |
| Đăng nhập Google lần đầu | callback Google hợp lệ, chưa có user | Tạo user mới với `google_id` | N/A |
| Đăng nhập Google, email đã tồn tại (đăng ký bằng password trước đó) | callback Google, email trùng user hiện có | Liên kết `google_id` vào user hiện có, trả JWT | N/A |
| Backend verify token | Request REST kèm Bearer token | Guard cho qua nếu chữ ký + hạn hợp lệ | Token sai/hết hạn → 401 |

</frozen-after-approval>

## Code Map

- `my-notion-backend/` -- scaffold mới (NestJS v11, chưa tồn tại)
- `my-notion-backend/prisma/schema.prisma` -- model `User` (id uuid, email, password_hash, google_id nullable, failed_login_attempts int default 0, locked_until timestamp nullable)
- `my-notion-backend/src/auth/auth.module.ts` -- wiring module
- `my-notion-backend/src/auth/auth.controller.ts` -- `POST /api/v1/auth/register`, `POST /api/v1/auth/verify-credentials` (internal, chỉ Auth.js authorize() gọi), `POST /api/v1/auth/oauth/google` (upsert theo google_id/email)
- `my-notion-backend/src/auth/auth.service.ts` -- hash argon2id, logic lockout, upsert user
- `my-notion-backend/src/auth/jwt.guard.ts` -- verify JWT HS256 (`AUTH_SECRET`) cho REST; expose hàm dùng lại được cho WS handshake ở story 5
- `my-notion-frontend/` -- scaffold mới (Next.js 16.2, App Router, chưa tồn tại)
- `my-notion-frontend/lib/auth.ts` -- cấu hình Auth.js v5: Credentials provider gọi `verify-credentials`, Google provider gọi `oauth/google`, custom `encode`/`decode` JWT HS256 dùng `AUTH_SECRET`
- `my-notion-frontend/app/api/auth/[...nextauth]/route.ts` -- Auth.js route handler
- `my-notion-frontend/app/(auth)/login/page.tsx`, `register/page.tsx` -- form UI

## Tasks & Acceptance

**Execution:**
- [x] `my-notion-backend` -- scaffold NestJS v11 (Express v5 adapter) + Prisma v7 -- khởi tạo backend theo spine
- [x] `my-notion-backend/prisma/schema.prisma` -- định nghĩa `User` -- lưu trạng thái đăng nhập/lockout
- [x] `my-notion-backend/src/auth/*` -- register, verify-credentials, oauth/google, guard -- logic xác thực nguồn chân lý ở backend (AD-1)
- [x] `my-notion-frontend` -- scaffold Next.js 16.2 App Router -- khởi tạo frontend theo spine
- [x] `my-notion-frontend/lib/auth.ts` + route handler -- cấu hình Auth.js v5 JWT HS256 gọi backend, không query DB trực tiếp
- [x] `my-notion-frontend/app/(auth)/*` -- form đăng ký/đăng nhập + nút Google
- [x] Unit test cho lockout (5 lần sai → 423, reset khi đúng) và verify-token (hạn/chữ ký) -- 23/23 test pass, khớp đủ 8 dòng I/O matrix

**Acceptance Criteria:**
- Given JWT hợp lệ chưa hết hạn, when gọi một REST endpoint có Guard, then request được xử lý bình thường (không 401).
- Given JWT hết hạn hoặc chữ ký sai, when gọi REST endpoint có Guard, then trả 401.
- Given user đăng nhập Google lần đầu bằng email đã đăng ký trước đó bằng password, when OAuth callback chạy, then tài khoản được liên kết (không tạo user trùng).

## Design Notes

Auth.js `authorize()`/callback Google chạy phía server trong Next.js nhưng KHÔNG được dùng Prisma trực tiếp — gọi HTTP tới backend (localhost trong dev, service URL trong Docker) để giữ đúng AD-1. JWT do Auth.js phát ra (qua custom encode) là cùng một token mà Route Handler forward tiếp cho backend qua `Authorization: Bearer` — không phát 2 token khác nhau.

## Verification

**Commands:**
- `cd my-notion-backend && npm run test` -- expected: toàn bộ unit test auth (lockout, verify-credentials, guard) pass
- `cd my-notion-backend && npm run build` -- expected: build không lỗi TypeScript
- `cd my-notion-frontend && npm run build` -- expected: build Next.js không lỗi

**Manual checks (if no CLI):**
- Đăng ký tài khoản mới qua UI, đăng nhập lại đúng/sai để quan sát lockout sau 5 lần.

## Suggested Review Order

**Ranh giới tin cậy backend/frontend (fix quan trọng nhất từ review)**

- Guard chặn gọi trực tiếp vào 2 endpoint nội bộ — trước bản vá này, ai cũng tạo/liên kết được tài khoản qua `oauth/google`.
  [`internal-api.guard.ts:23`](../../../my-notion/my-notion-backend/src/auth/internal-api.guard.ts#L23)

- Guard áp dụng lên đúng 2 endpoint nội bộ, không áp lên `register` (vẫn public).
  [`auth.controller.ts:40`](../../../my-notion/my-notion-backend/src/auth/auth.controller.ts#L40)

- Frontend gửi header bí mật khi gọi 2 endpoint đó.
  [`lib/auth.ts:33`](../../../my-notion/my-notion-frontend/lib/auth.ts#L33)

**Hợp đồng JWT xuyên 2 app (AD-5)**

- Nguồn chân lý cho thuật toán/claim JWT phía backend.
  [`jwt.util.ts:33`](../../../my-notion/my-notion-backend/src/auth/jwt.util.ts#L33)

- `encode`/`decode` phía frontend phải sinh/đọc đúng cùng 1 token — đây là điều bản vá #2 giờ có test chứng minh thay vì chỉ comment.
  [`lib/auth.ts:162`](../../../my-notion/my-notion-frontend/lib/auth.ts#L162)

- Test chứng minh token 2 chiều tương thích, bắt được nếu 1 bên lỡ đổi thuật toán/claim.
  [`jwt-cross-app.spec.ts:50`](../../../my-notion/my-notion-backend/src/auth/jwt-cross-app.spec.ts#L50)

**Lockout & race condition (dữ liệu người dùng)**

- Tăng bộ đếm sai mật khẩu bằng `increment` nguyên tử thay vì đọc-rồi-ghi (tránh race).
  [`auth.service.ts:104`](../../../my-notion/my-notion-backend/src/auth/auth.service.ts#L104)

- Bắt `P2002` (trùng unique constraint) cho cả đăng ký lẫn liên kết Google, thay vì để lỗi 500 thô.
  [`auth.service.ts:33`](../../../my-notion/my-notion-backend/src/auth/auth.service.ts#L33)

- Chuẩn hoá email (trim + lowercase) trước mọi lookup/ghi.
  [`auth.service.ts:26`](../../../my-notion/my-notion-backend/src/auth/auth.service.ts#L26)

- JwtGuard không còn tin mù payload đã decode — validate `sub`/`email` trước khi gán vào request.
  [`jwt.guard.ts:28`](../../../my-notion/my-notion-backend/src/auth/jwt.guard.ts#L28)

**Frontend chịu lỗi tốt hơn**

- `authorize()`/callback Google bọc try/catch quanh mọi `fetch` để không throw thẳng ra NextAuth.
  [`lib/auth.ts:69`](../../../my-notion/my-notion-frontend/lib/auth.ts#L69)

- Route đăng ký validate input trước khi forward, và không còn pass-through `null` body.
  [`route.ts:22`](../../../my-notion/my-notion-frontend/app/api/register/route.ts#L22)

**Phụ trợ**

- Port mặc định khớp lại giữa 2 app (`3001`).
  [`main.ts:19`](../../../my-notion/my-notion-backend/src/main.ts#L19)

- Model `User` — nguồn cho toàn bộ logic ở trên.
  [`schema.prisma:16`](../../../my-notion/my-notion-backend/prisma/schema.prisma#L16)
