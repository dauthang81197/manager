---
id: SPEC-my-notion
companions: ['../../planning-artifacts/prds/prd-my-notion-2026-07-29/prd.md', '../../planning-artifacts/architecture/architecture-my-notion-2026-07-29/ARCHITECTURE-SPINE.md']
sources: ['../../planning-artifacts/briefs/brief-my-notion-2026-07-29/brief.md', '../../planning-artifacts/briefs/brief-my-notion-2026-07-29/addendum.md', '../../planning-artifacts/prds/prd-my-notion-2026-07-29/addendum.md']
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# SPEC: My Notion

## Why

thang-hub's personal work (ghi chú, task/todo, wiki, planning dự án) hiện rải rác trên nhiều tool bên ngoài — tool đó có thể phát sinh phí subscription và không khớp cách thang-hub muốn tổ chức thông tin. My Notion là một vision to realize: một workspace cá nhân kiểu Notion, tự xây và tự host, để thang-hub có toàn quyền tuỳ biến và ngừng phụ thuộc app khác. Đây là dự án cá nhân cho một người dùng duy nhất — không có áp lực thị trường; "thắng" nghĩa là thang-hub thực sự dùng nó hàng ngày thay vì mở lại tool cũ.

## Capabilities

- **CAP-1**
  - **intent:** Người dùng đăng ký/đăng nhập bằng email + mật khẩu hoặc Google OAuth.
  - **success:** Đăng nhập thành công tạo phiên hợp lệ; sai mật khẩu 5 lần liên tiếp khóa tạm đăng nhập 15 phút.
- **CAP-2**
  - **intent:** Người dùng tạo, đổi tên, xóa một Trang.
  - **success:** Xóa Trang cha cascade xóa toàn bộ Trang con sau khi xác nhận qua hộp thoại; không có thùng rác/undo.
- **CAP-3**
  - **intent:** Người dùng xem và điều hướng cây Trang lồng nhau qua sidebar.
  - **success:** Sidebar phản ánh đúng cấu trúc cha-con hiện tại sau mọi thay đổi (tạo/xóa/di chuyển Trang).
- **CAP-4**
  - **intent:** Người dùng soạn thảo Block loại đoạn văn, tiêu đề, bullet list, todo trong một Trang.
  - **success:** Mỗi loại Block render đúng định dạng qua reload; checkbox todo giữ đúng trạng thái.
- **CAP-5**
  - **intent:** Nội dung Trang tự lưu khi người dùng ngừng gõ, không cần thao tác Save thủ công.
  - **success:** Đóng app ngay sau khi gõ vẫn không mất nội dung trong khoảng debounce.
- **CAP-6** *(Phase 2)*
  - **intent:** Người dùng kéo-thả để đổi vị trí Block trong Trang.
  - **success:** Thứ tự mới được lưu và giữ nguyên qua reload.
- **CAP-7** *(Phase 2)*
  - **intent:** Gõ "/" mở menu chọn nhanh loại Block để chèn.
  - **success:** Loại Block chọn được chèn đúng vị trí con trỏ.
- **CAP-8** *(Phase 2)*
  - **intent:** Đổi một Block từ loại này sang loại khác mà không mất nội dung.
  - **success:** Nội dung text giữ nguyên sau khi chuyển đổi loại Block.
- **CAP-9**
  - **intent:** Người dùng chèn ảnh vào một Block, ảnh lưu trên storage.
  - **success:** Ảnh hiển thị đúng sau reload và khi mở từ thiết bị khác.
- **CAP-10**
  - **intent:** Thay đổi ở một thiết bị phản ánh gần-tức-thời trên các thiết bị khác đang mở của cùng người dùng, qua kênh đẩy thời gian thực (không phải multi-user collaboration).
  - **success:** Sửa trên máy A, máy B thấy thay đổi mà không cần tải lại thủ công; thiết bị offline khi có thay đổi, lúc online lại tự đồng bộ đúng trạng thái mới nhất, không nhân đôi dữ liệu hay xung đột im lặng.
- **CAP-11** *(Phase 2)*
  - **intent:** Hiển thị một tập Trang con dưới dạng bảng với cột tùy chỉnh.
  - **success:** Cột hiển thị đúng theo định nghĩa cột của Trang.
- **CAP-12** *(Phase 2)*
  - **intent:** Hiển thị cùng dữ liệu dạng thẻ kéo-thả theo cột trạng thái (kanban).
  - **success:** Kéo thẻ sang cột khác cập nhật đúng trạng thái, giữ đúng thứ tự sau reload.
- **CAP-13** *(Phase 3)*
  - **intent:** Hiển thị dữ liệu theo lịch dựa trên một cột kiểu ngày tháng.
  - **success:** Sự kiện hiển thị đúng ngày tương ứng trên lịch.
- **CAP-14**
  - **intent:** Toàn bộ dữ liệu Workspace được sao lưu định kỳ, khôi phục được nếu mất dữ liệu gốc.
  - **success:** Backup chạy hàng ngày, giữ 7 bản gần nhất; khôi phục thành công từ bất kỳ bản nào trong 7 bản.
- **CAP-15** *(Phase 2)*
  - **intent:** Xuất một Trang ra file `.md`, nhập file `.md` có sẵn thành Trang mới.
  - **success:** Nội dung export/import không mất block todo hoặc ảnh, khớp đúng node vocabulary v1.
- **CAP-16** *(Phase 3)*
  - **intent:** Tìm kiếm nội dung trong tất cả Trang của Workspace.
  - **success:** Kết quả trả về chứa đúng từ khóa tìm kiếm.
- **CAP-17** *(Phase 3)*
  - **intent:** Người dùng gắn bình luận vào một Block cụ thể.
  - **success:** Bình luận hiển thị đúng gắn với Block, không sửa nội dung gốc.
- **CAP-18** *(Phase 3)*
  - **intent:** Gõ "@" để chèn liên kết nhanh tới một Trang khác.
  - **success:** Click vào mention điều hướng đúng tới Trang được liên kết.
- **CAP-19** *(Phase 3)*
  - **intent:** Thư viện mẫu Trang dựng sẵn để nhân bản nhanh.
  - **success:** Tạo Trang mới từ template giữ đúng cấu trúc mẫu.
- **CAP-20** *(Phase 3)*
  - **intent:** Cho phép chương trình do thang-hub tự viết đọc/ghi dữ liệu qua API key.
  - **success:** Request kèm API key hợp lệ đọc/ghi đúng dữ liệu; request thiếu/sai key bị từ chối.

## Constraints

- Không phụ thuộc dịch vụ SaaS trả phí cho năng lực lõi (auth, hosting) — tự host, tự kiểm soát là lý do chính dự án tồn tại; loại trừ các lựa chọn như Clerk/Auth0.
- Phải chạy trên hạ tầng Linux server hiện có (Docker, PostgreSQL sẵn có, CI/CD qua GitHub Actions) — không dựng hạ tầng mới, không thêm dịch vụ cloud trả phí.
- Một người phát triển duy nhất (thang-hub vừa là PM vừa dev) — quy trình và tooling phải phù hợp quy mô solo, không kéo theo overhead của một nhóm (vd không cần monorepo tooling như Nx/Turborepo).

## Non-goals

- Không hỗ trợ nhiều người dùng/nhiều workspace (multi-tenant).
- Không có chia sẻ Trang cho người khác xem/sửa (share link, phân quyền theo người dùng).
- Không có realtime multi-user collaboration (nhiều người sửa cùng lúc, con trỏ người khác) — phân biệt rõ với CAP-10, chỉ đồng bộ giữa các thiết bị của cùng một người dùng.
- Không xây mobile app native (dùng qua trình duyệt trên di động).
- Desktop app chưa nằm trong roadmap hiện tại — sẽ định nghĩa scope riêng sau khi bản web ổn định.
- Không có trang giới thiệu/marketing công khai.

## Success signal

thang-hub thực sự dùng My Notion hàng ngày thay cho các tool cũ sau khi MVP chạy, và không có sự cố mất dữ liệu kể từ khi backup tự động (CAP-14) hoạt động. Không lấy số lượng tính năng đã build làm thước đo tiến độ — thêm tính năng Phase 2/3 trong khi MVP chưa được dùng thật hàng ngày là dấu hiệu đi sai hướng.

## Assumptions

- CAP-1: không cần 2FA hay giới hạn IP ở v1.
- CAP-10: cơ chế kỹ thuật là WebSocket broadcast tín hiệu + last-write-wins (không CRDT) — chi tiết đầy đủ ở companion ARCHITECTURE-SPINE.md (AD-4).
- CAP-11/12/13: mô hình dữ liệu cụ thể cho view_schema (cột theo từng loại view, nơi lưu giá trị ô, thứ tự kanban) chưa thiết kế — xem `Deferred` trong ARCHITECTURE-SPINE.md, cần một companion schema riêng trước khi bắt đầu các capability này.
- CAP-14: tần suất/retention mặc định daily/7 bản là giá trị đề xuất, chưa qua thực tế kiểm chứng.

## Open Questions

- CAP-9/CAP-14: lưu trữ ảnh dùng local disk hay S3-compatible storage — chưa chốt (xem ARCHITECTURE-SPINE.md Deferred); ảnh hưởng trực tiếp tới việc backup có phủ được ảnh hay không.
- CAP-16: công cụ tìm kiếm toàn văn (Postgres full-text search vs Meilisearch) chưa chốt — quyết định khi bắt đầu Phase 3.
