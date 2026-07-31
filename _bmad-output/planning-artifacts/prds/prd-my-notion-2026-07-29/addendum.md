---
title: "Addendum: PRD My Notion"
updated: 2026-07-29
---

# Addendum: PRD My Notion

Chi tiết kỹ thuật/triển khai hỗ trợ các FR trong `prd.md` — không thuộc PRD chính vì đây là "cách làm" (implementation), không phải "năng lực" (capability). Xem thêm tech stack đầy đủ + roadmap gốc 21 tính năng ở [addendum của Product Brief](../../briefs/brief-my-notion-2026-07-29/addendum.md).

## FR-10 — Đồng bộ đa thiết bị (Multi-Device Sync)

- **Quyết định (đã xác nhận):** realtime push đưa vào MVP ngay từ đầu, không lùi sang Phase 2 — chấp nhận MVP dài hơn ước tính gốc.
- Triển khai: WebSocket đơn giản (không cần Yjs/CRDT vì chỉ một người dùng) — server broadcast sự kiện thay đổi tới các Session khác cùng user đang mở cùng Trang/Workspace. Có thể tái dùng thư viện WebSocket sẵn có (Socket.IO, hoặc Hocuspocus nếu sau này muốn nâng cấp lên CRDT thật cho mục đích khác) thay vì tự viết giao thức riêng.
- Cơ chế giải xung đột: last-write-wins theo timestamp server-side — chấp nhận được vì xác suất 2 thiết bị sửa đúng cùng block cùng lúc bởi cùng một người là rất thấp.

## FR-14 — Backup

- Đề xuất: cron job dump PostgreSQL định kỳ (daily) lên storage riêng (S3/volume khác với DB chính), retention 7 bản gần nhất — điều chỉnh theo xác nhận ở PRD §8.
- Không cần UI export thủ công cho user ở v1 (đã có Markdown import/export FR-15 đóng vai trò portability thủ công riêng, phục vụ mục đích khác — di chuyển từng Trang, không phải khôi phục toàn bộ).

## Ghi chú khác

- Toàn bộ đề xuất tech stack (FE, BE, DB, Auth, hạ tầng Docker/CI-CD) và cấu trúc thư mục multi-project (`my-notion-backend` / `my-notion-frontend`) đã ghi ở addendum của Brief — không lặp lại ở đây, PRD/Architecture sau này tham chiếu trực tiếp.
