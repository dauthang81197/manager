---
title: 'Block editor cơ bản + auto-save (CAP-4 / CAP-5 / FR-4 / FR-5 / story 3)'
type: 'feature'
created: '2026-07-31'
status: 'done'
baseline_commit: '44f34a0720eb7d91828b40be60a6041db4841e98'
review_loop_iteration: 0
context: ['{project-root}/_bmad-output/planning-artifacts/prds/prd-my-notion-2026-07-29/prd.md', '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-my-notion-2026-07-29/ARCHITECTURE-SPINE.md', '{project-root}/_bmad-output/specs/spec-my-notion/SPEC.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Trang hiện tại chỉ là placeholder trống (story 2) — chưa soạn thảo được nội dung gì. Đây là tính năng lõi biến My Notion từ "danh sách trang rỗng" thành công cụ dùng được thật.

**Approach:** Thêm Tiptap editor vào trang placeholder hiện có, dùng đúng node vocabulary v1 đã đóng băng ở spine AD-2 (paragraph, heading 1-3, bulletList/listItem, taskItem chuẩn Tiptap, image). Nội dung tự lưu (debounce) qua endpoint mới ở backend, đi qua Route Handler proxy như mọi thứ khác.

## Boundaries & Constraints

**Always:**
- Node vocabulary v1 đóng băng theo spine AD-2: `paragraph`, `heading` (level 1-3), `bulletList`/`listItem`, `taskItem`/`taskList` (chuẩn Tiptap, **không** tự tạo custom node riêng cho todo), `image` (attrs `src`, `alt`, `src` luôn absolute URL). Cấu hình Tiptap `StarterKit` + `TaskList`/`TaskItem` + `Image` — không thêm extension ngoài danh sách này.
- Backend không validate sâu cấu trúc nội dung Tiptap — chỉ lưu nguyên `content` như một JSON blob hợp lệ (đã có cột `content jsonb` từ story 2), lọc theo `ownerId` như mọi endpoint khác (404 không phải 403).
- Auto-save debounce ~800ms-1s sau khi ngừng gõ; gọi `PATCH /pages/:id/content` qua Route Handler proxy (không fetch thẳng từ client component, giữ đúng boundary AD-1/AD-5 đã lập từ story 1/2).
- Cần một cách hiển thị trạng thái lưu (vd "Đã lưu"/"Đang lưu…") để khớp NFR ngầm của FR-5 ("không mất nội dung" — người dùng cần biết trạng thái lưu).

**Ask First:**
- Không có quyết định nào cần hỏi thêm.

**Never:**
- Không xây kéo-thả sắp xếp block, slash command, hay chuyển đổi loại block — đó là story 7 (Phase 2).
- Không xây upload ảnh thật (story 4) — node `image` được cấu hình trong editor nhưng chưa có UI/endpoint upload; nếu cần minh hoạ node image trong test, dùng URL tĩnh giả định.
- Không xây đồng bộ đa thiết bị/realtime (story 5) — auto-save chỉ ghi lên server, chưa phát sự kiện cho phiên khác.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Mở Trang có nội dung | `GET /pages/:id` | Trả `content` đúng như đã lưu, editor hiển thị đúng định dạng từng loại block | `id` không tồn tại/không thuộc user → 404 |
| Gõ nội dung rồi dừng | Ngừng gõ ~800ms-1s | Tự động `PATCH /pages/:id/content`, UI hiện "Đã lưu" | Lưu thất bại → hiện lỗi, không âm thầm mất |
| Đóng ngay sau khi gõ (trong khoảng debounce) | Component unmount trước khi debounce bắn | Vẫn lưu được nội dung mới nhất trước khi rời trang | N/A |
| Toggle checkbox todo | Click checkbox trong `taskItem` | Trạng thái checked lưu lại như nội dung Block khác (qua auto-save) | N/A |
| Tải lại Trang sau khi lưu | `GET /pages/:id` sau khi đã `PATCH` | Nội dung/định dạng từng loại block giữ nguyên, không lẫn loại | N/A |
| Lưu content không hợp lệ (object rỗng bất thường) | `content` không phải object | 400 | N/A |

</frozen-after-approval>

## Code Map

- `my-notion-backend/src/pages/pages.controller.ts` -- thêm `GET :id` (trả full Page gồm `content`) và `PATCH :id/content`
- `my-notion-backend/src/pages/pages.service.ts` -- thêm `findOne(ownerId, id)` và `updateContent(ownerId, id, content)` -- atomic `updateMany` như `rename`/`remove` đã sửa ở story 2
- `my-notion-backend/src/pages/dto/update-content.dto.ts` -- validate `content` là object
- `my-notion-frontend/package.json` -- thêm `@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/extension-task-list`, `@tiptap/extension-task-item`, `@tiptap/extension-image`
- `my-notion-frontend/components/editor.tsx` -- Tiptap editor component, node vocabulary v1, hiển thị trạng thái lưu
- `my-notion-frontend/app/(app)/pages/[pageId]/page.tsx` -- thay placeholder bằng editor thật, load `content` qua `GET /api/pages/:id`, gọi auto-save
- `my-notion-frontend/app/api/pages/[id]/route.ts` -- thêm proxy `GET` (full page)
- `my-notion-frontend/app/api/pages/[id]/content/route.ts` -- proxy `PATCH` content

## Tasks & Acceptance

**Execution:**
- [x] `pages.controller.ts` + `pages.service.ts` -- `GET :id`, `PATCH :id/content` -- lọc ownerId, atomic update
- [x] `update-content.dto.ts` -- validate content là object -- chặn payload sai hình dạng
- [x] `components/editor.tsx` -- Tiptap với node vocabulary v1 đóng băng -- đúng AD-2 (đã tắt cả `hardBreak` và `link` sau review vì chúng lọt node/mark ngoài vocabulary)
- [x] `[pageId]/page.tsx` -- load content thật, gắn editor, auto-save debounce + trạng thái lưu -- thay placeholder
- [x] `app/api/pages/[id]/route.ts` + `.../content/route.ts` -- proxy GET/PATCH -- giữ boundary AD-1/AD-5
- [x] Unit test cho `findOne`/`updateContent` (lọc ownerId, 404, atomic update) -- 59 unit + 12 e2e pass, khớp đủ 6/6 dòng I/O matrix; 3 kịch bản mất dữ liệu verify thêm bằng browser thật

**Acceptance Criteria:**
- Given một Trang có `content` chứa cả 3 loại block (đoạn văn, heading, todo), when `GET /pages/:id`, then response trả đúng cấu trúc, không lẫn loại block nào.
- Given người dùng gõ nội dung rồi dừng gõ, when qua khoảng debounce, then `content` trên server được cập nhật đúng nội dung mới nhất.
- Given người dùng gọi `PATCH :id/content` với `pageId` thuộc user khác, when request chạy, then trả 404.

## Design Notes

Auto-save: debounce trong `editor.tsx` bằng `onUpdate` của Tiptap (setTimeout huỷ/đặt lại), cộng thêm flush ngay lúc unmount (dùng ref giữ nội dung mới nhất + gọi lưu trong cleanup của `useEffect`) để khớp I/O matrix "đóng ngay sau khi gõ". Trạng thái lưu là state đơn giản (`idle | saving | saved | error`), không cần thư viện ngoài.

## Verification

**Commands:**
- `cd my-notion-backend && npm run test` -- expected: toàn bộ unit test pass
- `cd my-notion-backend && npm run test:e2e` -- expected: e2e (bao gồm test mới cho content) pass trên Postgres thật
- `cd my-notion-backend && npm run build` -- expected: build không lỗi
- `cd my-notion-frontend && npm run build` -- expected: build không lỗi

**Manual checks (if no CLI):**
- Gõ đủ 3 loại block (đoạn văn, heading, todo) vào 1 Trang, tải lại trang, xác nhận nội dung/định dạng giữ nguyên.

## Suggested Review Order

**Chống mất dữ liệu (nhóm fix quan trọng nhất từ review — cả 3 đã verify bằng browser thật)**

- Chặn autosave khi Tiptap không đọc được node lạ, thay vì âm thầm xoá rồi ghi đè bản gốc.
  [`editor.tsx:209`](../../my-notion/my-notion-frontend/components/editor.tsx#L209)

- Flush lúc rời trang gác theo cờ "còn nội dung chưa lưu", không phải "có timer đang chờ" — cứu được cả trường hợp lần lưu trước đã thất bại.
  [`editor.tsx:164`](../../my-notion/my-notion-frontend/components/editor.tsx#L164)

- Bắt sự kiện đóng tab/refresh bằng `keepalive` (sendBeacon không dùng được vì chỉ hỗ trợ POST).
  [`editor.tsx:300`](../../my-notion/my-notion-frontend/components/editor.tsx#L300)

- Xếp hàng lần lưu (một request tại một thời điểm) để bản cũ không ghi đè bản mới.
  [`editor.tsx:182`](../../my-notion/my-notion-frontend/components/editor.tsx#L182)

**Đúng node vocabulary AD-2**

- Tắt `hardBreak` (Shift+Enter) và `link` — hai thứ lọt node/mark ngoài vocabulary đã đóng băng.
  [`editor.tsx:226`](../../my-notion/my-notion-frontend/components/editor.tsx#L226)

**Trạng thái & phiên đăng nhập**

- Thêm trạng thái "Chưa lưu"/"hết phiên"/"tạm dừng"; gõ tiếp không còn xoá mất cảnh báo lỗi.
  [`editor.tsx:56`](../../my-notion/my-notion-frontend/components/editor.tsx#L56)

**Backend**

- `PAGE_SELECT` bỏ `ownerId` khỏi response (trước đây rò ra browser).
  [`pages.service.ts:1`](../../my-notion/my-notion-backend/src/pages/pages.service.ts#L1)

- Nâng giới hạn body JSON lên 5mb, dùng chung giữa `main.ts` và e2e harness.
  [`body-limit.ts:1`](../../my-notion/my-notion-backend/src/common/body-limit.ts#L1)
