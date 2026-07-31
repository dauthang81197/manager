---
title: "Addendum: My Notion"
updated: 2026-07-29
---

# Addendum: My Notion

Nội dung kỹ thuật/hạ tầng do người dùng cung cấp trong lúc trao đổi brief — giữ nguyên chi tiết để đưa xuống Architecture/PRD sau này, không đưa vào brief chính (brief chỉ tập trung vào sản phẩm/vấn đề/scope).

## Đề xuất Tech Stack (do người dùng cung cấp)

**Frontend**
- React (hoặc Next.js nếu cần SSR + routing tiện)
- Editor block-based dùng thư viện có sẵn thay vì tự viết:
  - Tiptap (dựa trên ProseMirror) — linh hoạt, phổ biến nhất
  - hoặc BlockNote — dựng sẵn phong cách giống Notion, ra UI nhanh hơn
- State management: Zustand hoặc React Query (nếu cần đồng bộ server)
- Styling: Tailwind CSS

**Backend**
- Node.js (NestJS hoặc Express) hoặc Python (FastAPI) — tùy ngôn ngữ quen thuộc hơn

**Database**
- PostgreSQL — quan hệ cha-con giữa các trang, dùng adjacency list hoặc materialized path để lưu cây thư mục
- Nội dung block dạng JSON linh hoạt: cột `jsonb` trong Postgres, không cần NoSQL riêng

**Auth**
- NextAuth.js (nếu dùng Next.js) hoặc Clerk/Auth0 cho nhanh

**Realtime collaboration** (nếu làm)
- Yjs + Tiptap collaboration extension — chuẩn CRDT cho collab editing
- WebSocket server riêng hoặc dịch vụ như Liveblocks/Hocuspocus
- Câu hỏi mở: có thực sự cần multi-user CRDT collab không nếu chỉ 1 người dùng, hay chỉ cần đồng bộ đa thiết bị? (xem `.memlog.md`)

**Hạ tầng / Deploy**
- Deploy lên server Linux dùng Docker
- CI/CD từ GitHub
- Database, Redis và mọi thứ khác đã có sẵn trong container của server → không cần build thêm hạ tầng riêng

## Cấu trúc thư mục / tổ chức đa dự án

- Thư mục hiện tại (`my-manager`) là hub BMad xử lý nhiều dự án, không chỉ riêng dự án này
- Dự án này đặt tên **my-notion**, gồm 2 phần:
  - `my-notion-backend`
  - `my-notion-frontend`
- Docs/planning artifacts được tách riêng theo từng dự án con trong hub (brief này đã dùng slug `my-notion` cho run folder thay vì tên hub chung, theo đúng ý định tách docs)

## Kế hoạch tính năng chi tiết (do người dùng cung cấp — PDF)

Nguồn: `ke_hoach_tinh_nang_notion_clone.pdf`. Giữ nguyên chi tiết (mô tả, công nghệ, ước tính ngày) để dùng cho Epics/Stories và Sprint Planning sau này — brief chính chỉ tóm tắt scope theo giai đoạn.

### Giai đoạn 1 — MVP (7 tính năng, ~19 ngày) — mục tiêu: sản phẩm chạy được (tạo trang, soạn thảo, đăng nhập)

| # | Tính năng | Mô tả | Ưu tiên | Công nghệ | Thời gian |
|---|---|---|---|---|---|
| 1 | Đăng ký / đăng nhập | Xác thực qua email hoặc OAuth (Google) | Cao | Supabase Auth / NextAuth.js | 3 ngày |
| 2 | Tạo/xóa/đổi tên trang | CRUD cơ bản cho page, lưu bảng `pages` | Cao | PostgreSQL, REST API | 2 ngày |
| 3 | Cây trang lồng nhau | Trang con trong trang cha, hiển thị cây trên sidebar | Cao | PostgreSQL recursive CTE | 3 ngày |
| 4 | Block editor cơ bản | Đoạn văn, tiêu đề, bullet list, todo | Cao | Tiptap / BlockNote | 5 ngày |
| 5 | Tự động lưu | Lưu định kỳ/khi ngừng gõ, debounce request | Cao | React Query / debounce | 1 ngày |
| 6 | Sidebar điều hướng | Danh sách trang dạng cây, mở/thu gọn | Cao | React, Tailwind CSS | 3 ngày |
| 7 | Upload ảnh cơ bản | Chèn ảnh vào block, lưu storage | Trung bình | Supabase Storage / S3 | 2 ngày |

### Giai đoạn 2 — Nâng cao (8 tính năng, ~30 ngày) — mục tiêu: trải nghiệm giống Notion thật (database view, collaboration)

| # | Tính năng | Mô tả | Ưu tiên | Công nghệ | Thời gian |
|---|---|---|---|---|---|
| 8 | Kéo-thả sắp xếp block | Drag handle đổi vị trí block | Cao | Tiptap drag extension, fractional indexing | 3 ngày |
| 9 | Slash command ("/") | Gõ / mở menu chọn loại block | Cao | Tiptap Suggestion API | 3 ngày |
| 10 | Chuyển đổi loại block | Đổi đoạn văn ↔ heading/list, không mất nội dung | Trung bình | Tiptap custom commands | 2 ngày |
| 11 | Database view — Table | Trang con dạng bảng có cột tùy chỉnh | Cao | PostgreSQL, React Table | 5 ngày |
| 12 | Database view — Kanban | Cùng dữ liệu dạng thẻ kéo-thả theo cột trạng thái | Trung bình | dnd-kit / React DnD | 4 ngày |
| 13 | Chia sẻ trang & phân quyền | Share link, phân quyền view/edit | Cao | PostgreSQL RLS, JWT | 4 ngày |
| 14 | Realtime collaboration | Nhiều người sửa cùng lúc, thấy con trỏ nhau | Trung bình | Yjs, Hocuspocus/WebSocket | 7 ngày |
| 15 | Markdown import/export | Xuất .md, nhập .md có sẵn | Thấp | remark / unified.js | 2 ngày |

> **[ASSUMPTION — cần xác nhận]**: #13 và #14 giả định trước một nhu cầu chia sẻ/nhiều người dùng, nhưng brief chính đã xác nhận đây là sản phẩm cá nhân 1 người dùng và nhu cầu thật chỉ là **đồng bộ đa thiết bị**, không phải multi-user collaboration. Nếu không có kế hoạch chia sẻ với người khác, 2 mục này có thể lùi xuống Phase 3/backlog hoặc bỏ hẳn để rút ngắn ~11 ngày, thay bằng cơ chế sync đơn giản hơn (server lưu state + optimistic update, không cần Yjs/CRDT).

### Giai đoạn 3 — Mở rộng (6 tính năng, ~18 ngày) — mục tiêu: tính năng cộng đồng & mở rộng hệ sinh thái

| # | Tính năng | Mô tả | Ưu tiên | Công nghệ | Thời gian |
|---|---|---|---|---|---|
| 16 | Comment trên block | Bình luận gắn vào block cụ thể | Trung bình | PostgreSQL, WebSocket | 3 ngày |
| 17 | Mention (@user, @page) | Nhắc người dùng hoặc liên kết trang | Trung bình | Tiptap Mention extension | 2 ngày |
| 18 | Tìm kiếm toàn văn | Tìm nội dung trong tất cả trang workspace | Cao | PostgreSQL full-text search / Meilisearch | 4 ngày |
| 19 | Template có sẵn | Thư viện mẫu trang nhân bản nhanh | Thấp | PostgreSQL seed data | 2 ngày |
| 20 | Database view — Calendar | Hiển thị dữ liệu theo lịch dựa trên cột ngày | Thấp | React Big Calendar | 3 ngày |
| 21 | API công khai | Bên thứ ba truy cập/ghi dữ liệu qua API key | Thấp | REST API, API key management | 4 ngày |

**Tổng cộng: 21 tính năng, 67 ngày ước tính.**
