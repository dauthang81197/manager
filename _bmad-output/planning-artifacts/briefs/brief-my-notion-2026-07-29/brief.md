---
title: "Product Brief: My Notion"
status: final
created: 2026-07-29
updated: 2026-07-29
---

# Product Brief: My Notion

## Executive Summary

My Notion là một workspace cá nhân kiểu Notion — ghi chú, task/todo, wiki, và planning dự án — do chính thang-hub tự xây và tự dùng, thay thế các công cụ bên ngoài hiện đang dùng cho những việc này. Sản phẩm là block-based editor với cây trang lồng nhau, tùy biến linh hoạt theo đúng cách thang-hub làm việc. Chạy như một web app trước (desktop sau), tự host trên server Linux sẵn có.

Động lực không phải là cạnh tranh với Notion, mà là hai điều rất cụ thể: (1) tránh chi phí subscription của các công cụ bên ngoài, và (2) có toàn quyền kiểm soát để thêm đúng tính năng mình cần, không bị giới hạn bởi tool của người khác. Đây là dự án cá nhân, không có áp lực thị trường — nên "thắng" ở đây nghĩa là thang-hub thực sự ngừng mở các app khác.

## The Problem

Hiện tại công việc cá nhân (ghi chú, task/todo, wiki, planning dự án) đang nằm rải rác ở nhiều tool/app bên ngoài — những tool này có thể phát sinh phí subscription theo thời gian, và không hoàn toàn khớp với cách thang-hub muốn tổ chức thông tin. Việc phải thích nghi với UX/giới hạn của tool người khác, thay vì tool thích nghi với mình, là điểm khó chịu chính.

## The Solution

Một block-based workspace tự xây, cụ thể:
- Trang (page) dạng cây lồng nhau, sidebar điều hướng
- Block editor cơ bản: đoạn văn, tiêu đề, list, todo — mở rộng dần sang slash command, kéo-thả, chuyển đổi loại block
- Database view (table, kanban, sau này thêm calendar) để phủ được cả ghi chú lẫn quản lý task/dự án trong cùng một hệ thống
- Tìm kiếm toàn văn, template, mention/comment ở các giai đoạn sau
- Đồng bộ mượt qua nhiều thiết bị (laptop, điện thoại, desktop app sau này) — không phải multi-user realtime collaboration, vì đây là công cụ cá nhân

## What Makes This Different

Vì tự host và tự kiểm soát toàn bộ stack, thang-hub có thể thêm bất kỳ tính năng riêng nào mình cần ngay khi cần, mà không phải chờ Notion (hay tool khác) hỗ trợ hoặc đợi họ ưu tiên request của mình.

## Who This Serves

Người dùng duy nhất: thang-hub, truy cập từ nhiều thiết bị (web trước, desktop sau). Không có persona thứ hai ở giai đoạn này — mọi quyết định scope ưu tiên đúng nhu cầu cá nhân, không cần tính đến người dùng khác.

## Success Criteria

- Ngừng mở các app/tool bên ngoài từng dùng cho ghi chú/task/wiki/planning cá nhân.
- Có đủ tính năng cần dùng hàng ngày — thước đo là "đủ dùng cho mình", không phải đối sánh feature-for-feature với Notion.
- Dữ liệu đồng bộ đúng, không mất, khi chuyển giữa các thiết bị.
- Không phát sinh chi phí subscription bên ngoài cho các nhu cầu mà My Notion đã thay thế.

## Scope

**Giai đoạn 1 — MVP (~19 ngày ước tính):** Đăng ký/đăng nhập, CRUD trang, cây trang lồng nhau, block editor cơ bản (đoạn văn/tiêu đề/bullet/todo), auto-save, sidebar điều hướng, upload ảnh cơ bản. Mục tiêu: có sản phẩm chạy được để bắt đầu dùng thật.

**Giai đoạn 2 — Nâng cao (~30 ngày ước tính):** Kéo-thả sắp xếp block, slash command, chuyển đổi loại block, database view (table, kanban), markdown import/export.
> **Đã xác nhận:** Kế hoạch tính năng gốc còn có "Chia sẻ trang & phân quyền" và "Realtime collaboration" ở giai đoạn này — đã loại khỏi scope chính vì sản phẩm chỉ dùng bởi một mình thang-hub trên nhiều thiết bị, không chia sẻ cho người khác. Hai mục này được giữ lại trong addendum như backlog cho tương lai nếu nhu cầu thay đổi.

**Giai đoạn 3 — Mở rộng (~18 ngày ước tính):** Comment trên block, mention, tìm kiếm toàn văn, template có sẵn, database view calendar, API công khai.

**Ngoài phạm vi (hiện tại):** Multi-tenant/nhiều người dùng khác nhau, chia sẻ trang cho người khác, realtime multi-user collaboration, mobile app native, public marketing site.

*Chi tiết đầy đủ từng tính năng (mô tả, công nghệ, ước tính ngày) nằm trong `addendum.md`, lấy từ kế hoạch tính năng do thang-hub cung cấp — dùng cho Epics/Stories và Sprint Planning ở bước sau.*

## Vision

Nếu thành công, My Notion thay thế hoàn toàn nhu cầu ghi chú/task/wiki/planning cá nhân của thang-hub trên cả web và desktop, tự host với chi phí hạ tầng tối thiểu (dùng lại server/Docker/Redis sẵn có). Vì đây cũng là dự án đầu tiên trong một hub BMad xử lý nhiều dự án cá nhân, cấu trúc và bài học từ My Notion (tách docs theo dự án, quy ước đặt tên) có thể trở thành khuôn mẫu cho các dự án cá nhân tiếp theo trong cùng hub.
