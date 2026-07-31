---
title: 'Upload ảnh cơ bản (CAP-9 / FR-9 / story 4)'
type: 'feature'
created: '2026-07-31'
status: 'done'
baseline_commit: '0ef81e4a793723edf26c60d8c18398e3000c222e'
review_loop_iteration: 0
context: ['{project-root}/_bmad-output/planning-artifacts/prds/prd-my-notion-2026-07-29/prd.md', '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-my-notion-2026-07-29/ARCHITECTURE-SPINE.md', '{project-root}/_bmad-output/specs/spec-my-notion/SPEC.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Node `image` đã được cấu hình trong editor từ story 3 nhưng chưa có cách nào chèn ảnh — ghi chú chỉ có chữ, chưa dùng được cho ảnh chụp màn hình/sơ đồ.

**Approach:** Thêm endpoint upload ở backend (lưu file lên local disk volume), trả về absolute URL, và UI chèn ảnh ở editor (nút chèn + paste/drop). Đóng nốt quyết định đang để ngỏ trong spine về nơi lưu ảnh.

## Boundaries & Constraints

**Always:**
- **Lưu ảnh trên local disk volume của server** (không S3/dịch vụ ngoài) — chốt quyết định đang để ngỏ ở spine `Deferred`, theo đúng constraint gốc "không phụ thuộc SaaS trả phí" + server Linux/Docker đã có sẵn.
- **Thư mục lưu ảnh phải nằm trong vòng backup của FR-14** — đây là ràng buộc spine đã nêu rõ kèm quyết định trên. Story này chưa xây cron backup (đó là story 6), nhưng phải: đặt file vào một thư mục xác định, cấu hình được qua env, và ghi rõ trong README/spec rằng story 6 bắt buộc phải phủ thư mục này.
- `src` của ảnh trong `content` luôn là **absolute URL do backend phục vụ** (spine AD-2) — không đường dẫn tương đối, không base64 nhúng.
- Mọi upload đi qua `JwtGuard`; ảnh gắn với `ownerId`; người dùng khác không truy cập được ảnh của người khác (404, không 403 — nhất quán với pages).
- Upload đi qua Next.js Route Handler proxy như mọi REST khác (AD-1/AD-5), không POST thẳng từ browser sang backend.
- Chỉ nhận định dạng ảnh thật (png/jpeg/gif/webp) và có giới hạn dung lượng rõ ràng — kiểm tra ở backend, không chỉ tin `accept` của input phía client.

**Ask First:**
- Nếu phát hiện việc phục vụ file tĩnh có xác thực buộc phải đổi cấu trúc route/hạ tầng đáng kể (vd cần reverse proxy riêng) → hỏi trước.

**Never:**
- Không dùng S3/cloud storage trả phí.
- Không resize/nén/tối ưu ảnh, không sinh thumbnail — ngoài phạm vi "upload cơ bản" của FR-9.
- Không xây trình quản lý media (danh sách/xoá ảnh đã upload) — chỉ chèn được ảnh vào Trang.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Upload ảnh hợp lệ | file png/jpeg/gif/webp trong giới hạn | Lưu file, trả absolute URL, chèn node `image` vào editor | N/A |
| Upload file không phải ảnh | vd `.pdf`, hoặc file đổi đuôi giả dạng ảnh | Từ chối | 400, không lưu file |
| Upload vượt giới hạn dung lượng | file lớn hơn mức cho phép | Từ chối | 413 (hoặc 400) kèm thông báo rõ |
| Xem ảnh sau khi tải lại Trang | `GET` URL ảnh đã lưu | Ảnh hiển thị đúng | N/A |
| Xem ảnh từ thiết bị/phiên khác của cùng user | đã đăng nhập, khác session | Ảnh hiển thị đúng | N/A |
| Truy cập ảnh của người dùng khác | URL ảnh thuộc user khác | Từ chối | 404 |
| Upload khi chưa đăng nhập | không có token hợp lệ | Từ chối | 401 |

</frozen-after-approval>

## Code Map

- `my-notion-backend/prisma/schema.prisma` -- model `Asset` (id uuid, ownerId, filename gốc, mimeType, sizeBytes, storagePath, createdAt) + migration
- `my-notion-backend/src/assets/assets.module.ts`, `assets.controller.ts`, `assets.service.ts` -- `POST /assets` (upload, multipart) và `GET /assets/:id` (phục vụ file, lọc ownerId)
- `my-notion-backend/src/assets/assets.constants.ts` -- danh sách mime cho phép + giới hạn dung lượng, dùng chung giữa code và test
- `my-notion-backend/.env.example` -- thêm biến trỏ thư mục lưu ảnh (vd `ASSET_STORAGE_DIR`)
- `my-notion-backend/README.md` -- ghi rõ thư mục ảnh phải nằm trong backup của story 6
- `my-notion-frontend/app/api/assets/route.ts` -- proxy `POST` upload
- `my-notion-frontend/app/api/assets/[id]/route.ts` -- proxy `GET` phục vụ ảnh
- `my-notion-frontend/components/editor.tsx` -- nút chèn ảnh + xử lý paste/drop, gọi upload rồi chèn node `image` với absolute URL
- `my-notion-backend/test/assets.e2e-spec.ts` -- e2e thật: upload/serve/cô lập theo user/từ chối file sai loại và quá lớn

## Tasks & Acceptance

**Execution:**
- [x] `schema.prisma` + migration -- model `Asset` -- gắn ảnh với owner, lưu metadata
- [x] `src/assets/*` -- upload + serve, validate mime/size thật ở backend (magic byte), lọc ownerId -- AD-1
- [x] `.env.example` + `README.md` -- biến thư mục lưu + ghi chú ràng buộc backup (story 6)
- [x] `app/api/assets/**` -- proxy upload/serve -- giữ boundary AD-1/AD-5
- [x] `components/editor.tsx` -- UI chèn ảnh (nút + paste/drop) -- chèn node `image` với absolute URL (AD-2)
- [x] Unit test + e2e test thật cho upload/serve/từ chối/cô lập theo user -- 92 unit + 20 e2e pass, khớp đủ 7/7 dòng I/O matrix; 6 kịch bản verify thêm bằng browser thật (gồm cả lỗ hổng `<IMG>` viết hoa đã vá)

**Acceptance Criteria:**
- Given một file không phải ảnh được đổi đuôi thành `.png`, when upload, then backend từ chối (không chỉ dựa vào phần mở rộng hay `Content-Type` do client khai).
- Given user A đã upload một ảnh, when user B gọi URL ảnh đó, then trả 404.
- Given một Trang có ảnh đã chèn, when tải lại Trang, then ảnh hiển thị đúng từ absolute URL đã lưu trong `content`.

## Design Notes

Ảnh phục vụ qua endpoint có xác thực (`GET /assets/:id`) chứ không phải static file server công khai — vì cần lọc theo `ownerId`. Trong `content`, `src` trỏ tới URL của endpoint này (absolute, theo AD-2), nên ảnh vẫn hiển thị đúng ở mọi thiết bị của cùng user.

## Verification

**Commands:**
- `cd my-notion-backend && npm run test` -- expected: unit test pass
- `cd my-notion-backend && npm run test:e2e` -- expected: e2e (gồm test upload mới) pass trên Postgres thật
- `cd my-notion-backend && npm run build` -- expected: build sạch
- `cd my-notion-frontend && npm run build && npm run lint` -- expected: sạch

**Manual checks (if no CLI):**
- Chèn 1 ảnh vào Trang, tải lại trang, xác nhận ảnh vẫn hiển thị.

## Suggested Review Order

**Chặn bytes lạ (nhóm bảo mật quan trọng nhất — đã verify bằng browser thật)**

- Bộ lọc ảnh dán từ ngoài giờ không phân biệt hoa/thường — trước đây `<IMG>` viết hoa (Word/Outlook) lọt thẳng qua.
  [`editor.tsx:591`](../../my-notion/my-notion-frontend/components/editor.tsx#L591)

- Xác thực loại ảnh bằng magic byte, không tin đuôi file hay Content-Type client khai.
  [`assets.constants.ts:66`](../../my-notion/my-notion-backend/src/assets/assets.constants.ts#L66)

- Chặn containment bằng `realpath` (trước đây chỉ so chuỗi, symlink lọt được), phục vụ file kèm CSP/Content-Disposition.
  [`assets.service.ts:348`](../../my-notion/my-notion-backend/src/assets/assets.service.ts#L348)

- Siết giới hạn multipart: `fields: 0`, `parts: 2` — trước đây chỉ giới hạn kích thước file, cho phép nhồi hàng triệu field text.
  [`assets.controller.ts:67`](../../my-notion/my-notion-backend/src/assets/assets.controller.ts#L67)

**Rò rỉ tài nguyên**

- Mở file **một lần** rồi `fstat` chính descriptor đó — bỏ TOCTOU khiến `Content-Length` lệch với body thật.
  [`assets.service.ts:312`](../../my-notion/my-notion-backend/src/assets/assets.service.ts#L312)

**Ràng buộc cho story 6**

- README ghi rõ backup **bắt buộc** phải phủ `ASSET_STORAGE_DIR` — `pg_dump` chỉ khôi phục row, không khôi phục bytes.
  [`README.md:69`](../../my-notion/my-notion-backend/README.md#L69)
