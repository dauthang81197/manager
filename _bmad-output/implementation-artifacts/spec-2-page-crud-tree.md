---
title: 'Quản lý Trang - CRUD, cây, sidebar (CAP-2 / CAP-3 / FR-2 / FR-3 / story 2)'
type: 'feature'
created: '2026-07-31'
status: 'done'
baseline_commit: '793cfb718d1d072fccbc3b44760f76ec4df92d1b'
review_loop_iteration: 0
context: ['{project-root}/_bmad-output/planning-artifacts/prds/prd-my-notion-2026-07-29/prd.md', '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-my-notion-2026-07-29/ARCHITECTURE-SPINE.md', '{project-root}/_bmad-output/specs/spec-my-notion/SPEC.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Chưa có cách nào tạo/quản lý Trang — đây là nền tảng bắt buộc trước khi có thể xây block editor (story 3), đồng bộ (story 5), hay database view (story 8/9) vì tất cả đều thao tác trên Trang.

**Approach:** Thêm module `pages` ở `my-notion-backend` (CRUD + đọc cây qua recursive CTE theo spine AD-3), và một layout đã đăng nhập ở `my-notion-frontend` với sidebar hiển thị cây, tái dùng `JwtGuard` từ story 1. Toàn bộ nội dung Trang (`content`), kiểu hiển thị (`view_type`/`view_schema`) đã có sẵn trong schema (theo ERD của spine) nhưng KHÔNG được dùng ở story này — chỉ CRUD + cây.

## Boundaries & Constraints

**Always:**
- Backend là nguồn chân lý (AD-1); mọi REST endpoint mới bọc `JwtGuard` (tái dùng từ story 1), không tạo cơ chế auth riêng.
- Bảng `pages`: `parent_id` tự tham chiếu, `onDelete: Cascade` ở cấp DB (spine AD-3) — không tự issue nhiều lệnh DELETE theo thứ tự con-trước-cha ở tầng service.
- Recursive CTE (Prisma `$queryRaw`) chỉ dùng để **đọc** cây và **đếm** số Trang con cho hộp thoại xác nhận xoá — không dùng để thực hiện việc xoá.
- Mọi Trang thuộc về đúng 1 `owner_id` (user hiện tại từ JWT); mọi query/mutation phải lọc theo `owner_id` — Trang không thuộc user hiện tại trả 404 (không lộ tồn tại), dù hiện tại chỉ có 1 user.
- REST từ browser đi qua Next.js Route Handlers (đọc session Auth.js, gắn `Authorization: Bearer`) — không fetch thẳng từ client component ra backend (cùng rule đã áp dụng ở story 1).
- Model `Page` tạo đủ theo ERD của spine (`content jsonb`, `view_type`, `view_schema`) dù story này không dùng — tránh migration lại ở story 3/8/9.

**Ask First:**
- Không có quyết định nào cần hỏi thêm — mọi thứ đã có trong PRD/spine.

**Never:**
- Không xây block editor / soạn thảo `content` (story 3). Trang mới có `content` mặc định rỗng (`{}` hoặc tài liệu Tiptap rỗng).
- Không xây database view (story 8/9). `view_type` luôn mặc định `document`, `view_schema` luôn `null` ở story này.
- Không xây kéo-thả sắp xếp thứ tự Trang trong sidebar — FR-3 không yêu cầu thứ tự tuỳ chỉnh, hiển thị theo `created_at`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Tạo Trang gốc | `parentId: null` | Tạo Page mới, `parent_id = null` | N/A |
| Tạo Trang con | `parentId` hợp lệ, thuộc user hiện tại | Tạo Page con | `parentId` không tồn tại/không thuộc user → 404 |
| Đổi tên Trang | `title` mới hợp lệ | Cập nhật `title` | `title` rỗng → 400 |
| Đếm Trang con trước xoá | `GET /pages/:id/descendants-count` | Trả số lượng descendant (đệ quy) | `id` không tồn tại/không thuộc user → 404 |
| Xoá Trang cha có con | `DELETE /pages/:id` | Cascade xoá toàn bộ Trang con (FK ở DB) | N/A |
| Xoá Trang không tồn tại/không thuộc user | `DELETE /pages/:id` | — | 404 |
| Lấy cây Trang | `GET /pages/tree` | Trả cấu trúc cha-con lồng nhau đúng, chỉ của user hiện tại | N/A |

</frozen-after-approval>

## Code Map

- `my-notion-backend/prisma/schema.prisma` -- thêm model `Page` (id uuid, parentId nullable self-relation `onDelete: Cascade`, ownerId, title, content jsonb default rỗng, viewType default "document", viewSchema nullable jsonb, createdAt, updatedAt) + migration mới
- `my-notion-backend/src/pages/pages.module.ts` -- wiring module
- `my-notion-backend/src/pages/pages.controller.ts` -- `GET tree`, `POST /`, `PATCH /:id`, `GET /:id/descendants-count`, `DELETE /:id`, tất cả `@UseGuards(JwtGuard)`
- `my-notion-backend/src/pages/pages.service.ts` -- CRUD + recursive CTE (đọc cây, đếm descendant) qua `$queryRaw`, lọc theo `ownerId`
- `my-notion-backend/src/pages/dto/create-page.dto.ts`, `rename-page.dto.ts` -- validate input
- `my-notion-frontend/app/(app)/layout.tsx` -- layout đã đăng nhập, redirect `/login` nếu không có session, chứa Sidebar
- `my-notion-frontend/components/sidebar.tsx` -- hiển thị cây Trang, mở/thu gọn, click chuyển Trang, nút tạo/xoá/đổi tên
- `my-notion-frontend/app/(app)/pages/[pageId]/page.tsx` -- trang rỗng placeholder hiển thị `title` (nội dung thật ở story 3)
- `my-notion-frontend/app/api/pages/route.ts` -- proxy `GET tree` + `POST` (đọc session, gắn Bearer, forward backend)
- `my-notion-frontend/app/api/pages/[id]/route.ts` -- proxy `PATCH`, `DELETE`
- `my-notion-frontend/app/api/pages/[id]/descendants-count/route.ts` -- proxy đếm descendant

## Tasks & Acceptance

**Execution:**
- [x] `my-notion-backend/prisma/schema.prisma` -- thêm model `Page` theo ERD spine -- nền tảng dữ liệu cho mọi tính năng sau
- [x] `my-notion-backend/src/pages/*` -- CRUD + recursive CTE (cây, đếm descendant), lọc theo ownerId -- logic nguồn chân lý ở backend (AD-1)
- [x] `my-notion-frontend/app/(app)/layout.tsx` + `components/sidebar.tsx` -- layout đã đăng nhập + sidebar cây -- UI điều hướng (FR-3)
- [x] `my-notion-frontend/app/(app)/pages/[pageId]/page.tsx` -- trang placeholder -- điểm neo cho story 3
- [x] `my-notion-frontend/app/api/pages/**` -- Route Handler proxy toàn bộ CRUD -- giữ boundary REST-qua-Route-Handler (AD-5)
- [x] Unit test cho pages.service (cascade delete, đếm descendant, lọc ownerId, cây lồng nhau đúng cấu trúc) -- 18 unit test + 4 e2e test thật với Postgres (cascade delete/CTE verify trực tiếp trên DB, không chỉ mock), 54/54 unit + 5/5 e2e pass, khớp đủ 7/7 dòng I/O matrix

**Acceptance Criteria:**
- Given một Trang cha có 2 Trang con, when gọi `DELETE /pages/:parentId`, then cả 3 Trang biến mất khỏi DB (cascade).
- Given user A gọi API với `pageId` thuộc user khác (giả lập), when gọi bất kỳ endpoint pages nào, then trả 404 chứ không phải dữ liệu hay 403.
- Given cây Trang có 3 cấp lồng nhau, when gọi `GET /pages/tree`, then response phản ánh đúng cấu trúc cha-con ở cả 3 cấp.

## Design Notes

Route Handler proxy pattern lặp lại từ story 1 (`/api/register`): mỗi route đọc session Auth.js server-side (`auth()`), lấy JWT, gọi `backendApiUrl(...)` kèm `Authorization: Bearer`. `pages.service.ts` dùng cùng helper chuẩn hoá lỗi (`HttpExceptionFilter` đã có từ story 1) — không tạo cơ chế lỗi riêng.

## Verification

**Commands:**
- `cd my-notion-backend && npm run test` -- expected: toàn bộ unit test (cũ + mới) pass
- `cd my-notion-backend && npm run build` -- expected: build không lỗi TypeScript
- `cd my-notion-frontend && npm run build` -- expected: build Next.js không lỗi

**Manual checks (if no CLI):**
- Tạo vài Trang lồng nhau qua UI, xoá Trang cha, xác nhận Trang con biến mất theo trên sidebar.

## Suggested Review Order

**Race condition & cascade delete (fix quan trọng nhất từ review)**

- Đổi từ check-rồi-sửa (2 bước, có race) sang `updateMany`/`deleteMany` nguyên tử lọc theo `id + ownerId`.
  [`pages.service.ts:84`](../../my-notion/my-notion-backend/src/pages/pages.service.ts#L84)

- E2e test thật chạy trên Postgres thật — chứng minh cascade delete hoạt động ở tầng DB, không chỉ mock `prisma.page.delete` được gọi.
  [`pages.e2e-spec.ts:79`](../../my-notion/my-notion-backend/test/pages.e2e-spec.ts#L79)

- E2e test thật cho recursive CTE `getTree` — chứng minh SQL đúng cú pháp, không chỉ test logic ráp cây phía JS.
  [`pages.e2e-spec.ts:117`](../../my-notion/my-notion-backend/test/pages.e2e-spec.ts#L117)

- Model `Page` — nền tảng dữ liệu, cascade `onDelete: Cascade` khai báo ở đây.
  [`schema.prisma:37`](../../my-notion/my-notion-backend/prisma/schema.prisma#L37)

**Sidebar: xử lý lỗi & tương tác**

- Chặn race Escape/blur khi huỷ đổi tên (trước đây Escape có thể vô tình submit).
  [`sidebar.tsx:317`](../../my-notion/my-notion-frontend/components/sidebar.tsx#L317)

- Kiểm tra `res.ok` cho mọi thao tác tạo/đổi tên/xoá, không còn âm thầm nuốt lỗi.
  [`sidebar.tsx:122`](../../my-notion/my-notion-frontend/components/sidebar.tsx#L122)

- Hộp thoại xác nhận xoá không còn hiểu nhầm "đếm lỗi" thành "0 trang con".
  [`sidebar.tsx:165`](../../my-notion/my-notion-frontend/components/sidebar.tsx#L165)

**Điểm neo cho các story sau**

- Trang landing `/` trong nhóm route `(app)` — trước đây không có, giờ đã có state rỗng đúng chỗ.
  [`app/(app)/page.tsx:1`](../../my-notion/my-notion-frontend/app/(app)/page.tsx#L1)

- Trang placeholder Trang — nơi story 3 sẽ gắn block editor vào.
  [`[pageId]/page.tsx:43`](../../my-notion/my-notion-frontend/app/(app)/pages/[pageId]/page.tsx#L43)
