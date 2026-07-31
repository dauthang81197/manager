---
title: "PRD: My Notion"
status: final
created: 2026-07-29
updated: 2026-07-29
---

# PRD: My Notion
*Working title — confirm.*

## 0. Document Purpose

PRD này dành cho thang-hub (vừa là PM vừa là dev duy nhất của dự án) và cho các bước downstream (Architecture, Epics/Stories, Sprint Planning). Xây trên nền [Product Brief final](../../briefs/brief-my-notion-2026-07-29/brief.md) — không lặp lại nội dung brief, chỉ tham chiếu. Cấu trúc: Glossary định nghĩa thuật ngữ dùng xuyên suốt, Features nhóm theo nhóm chức năng với FR đánh số toàn cục (FR-1…FR-N), giả định gắn `[ASSUMPTION]` inline và tổng hợp lại ở §9. Chi tiết công nghệ/triển khai (tech stack, cấu trúc thư mục, roadmap ngày công gốc) nằm ở `addendum.md` của brief và của PRD này — PRD chỉ mô tả năng lực (capability), không mô tả cách làm (implementation).

## 1. Vision

My Notion là workspace cá nhân kiểu Notion để thang-hub gom toàn bộ ghi chú, task/todo, wiki, và planning dự án cá nhân vào một chỗ do chính mình xây và kiểm soát — thay thế các tool bên ngoài đang dùng rải rác, tránh chi phí subscription, và có toàn quyền thêm đúng tính năng mình cần. Sản phẩm là block-based editor với cây trang lồng nhau, database view linh hoạt (table/kanban/calendar), chạy trên web trước rồi desktop sau, tự host trên hạ tầng server Linux sẵn có.

Khác với Notion, My Notion không cần phục vụ nhiều người dùng hay use-case đa dạng — mọi quyết định scope ưu tiên đúng một việc: giúp thang-hub dùng được hàng ngày trên nhiều thiết bị mà không phải mở app khác.

## 2. Target User

### 2.1 Jobs To Be Done

- Ghi lại ý tưởng/ghi chú nhanh, có cấu trúc (trang lồng nhau) thay vì rải rác nhiều app.
- Quản lý task/todo cá nhân theo dạng danh sách hoặc kanban.
- Lưu trữ wiki cá nhân (kiến thức, tài liệu tham khảo) dễ tìm lại.
- Lên kế hoạch (planning) cho các dự án cá nhân — bao gồm cả các dự án BMad khác trong cùng hub.
- Tiếp tục công việc liền mạch khi đổi thiết bị (laptop ⇄ điện thoại ⇄ desktop sau này), không lo mất đồng bộ.
- Đây là dự án cá nhân, xây bởi chính người dùng duy nhất — JTBD của "người xây" và "người dùng" là một.

### 2.2 Non-Users (v1)

- Bất kỳ ai khác ngoài thang-hub — không có chia sẻ trang, không có workspace nhiều người dùng trong v1.

### 2.3 Key User Journeys

- **UJ-1. thang-hub cập nhật task trên điện thoại, thấy ngay trên laptop.**
  - **Persona + context:** thang-hub, đang review lại việc cần làm trong lúc di chuyển, mở app trên điện thoại.
  - **Entry state:** đã đăng nhập sẵn (session còn hiệu lực) trên cả điện thoại và laptop, laptop đang mở sẵn workspace ở nhà.
  - **Path:** Mở app trên điện thoại → vào trang task list (database view) → tick hoàn thành 1 task, đổi trạng thái 1 task khác sang "Đang làm" → đóng app.
  - **Climax:** Khi ngồi lại laptop, trang task list đã phản ánh đúng thay đổi vừa làm trên điện thoại mà không cần bấm refresh thủ công.
  - **Resolution:** thang-hub tiếp tục làm việc trên laptop với dữ liệu đúng nhất, không phải tự hỏi "cái này đã lưu chưa".
  - **Edge case:** nếu laptop đang offline lúc thay đổi xảy ra, khi có mạng trở lại app phải tự đồng bộ lại đúng trạng thái mới nhất mà không tạo xung đột hay nhân đôi dữ liệu.

- **UJ-2. thang-hub viết nhanh một ghi chú và tổ chức nó vào đúng chỗ.** *(JTBD restated)* thang-hub mở một trang con dưới workspace "Ghi chú", gõ nội dung bằng block editor (heading, bullet, todo), nội dung tự lưu — không cần bấm "Save".

## 3. Glossary

- **Workspace** — toàn bộ không gian dữ liệu của thang-hub trong My Notion; ở v1 chỉ có một workspace, một chủ sở hữu.
- **Page (Trang)** — đơn vị nội dung cơ bản, có thể chứa Block, có thể có Trang con (nested).
- **Block** — đơn vị soạn thảo trong một Trang (đoạn văn, tiêu đề, bullet, todo, ảnh...).
- **Database View** — cách hiển thị một tập Trang con dưới dạng Table, Kanban, hoặc Calendar.
- **Session** — một phiên đăng nhập trên một thiết bị/trình duyệt cụ thể.
- **Sync Event** — một thay đổi dữ liệu (tạo/sửa/xóa Page hoặc Block) cần được phản ánh tới các Session khác của cùng Workspace.

## 4. Features

### 4.1 Authentication & Account *(MVP)*

**Description:** thang-hub đăng nhập bằng email/mật khẩu hoặc Google OAuth để truy cập Workspace của mình từ bất kỳ thiết bị nào. `[ASSUMPTION: không cần 2FA hay giới hạn IP ở v1 — xác nhận từ hội thoại]`.

**Functional Requirements:**

#### FR-1: Đăng ký / đăng nhập
Người dùng có thể đăng ký và đăng nhập bằng email + mật khẩu, hoặc qua Google OAuth.

**Consequences (testable):**
- Sai mật khẩu 5 lần liên tiếp → khóa tạm đăng nhập trong 15 phút. `[ASSUMPTION: giá trị mặc định, có thể chỉnh sau]`
- Sau đăng nhập, session còn hiệu lực trên thiết bị đó cho tới khi đăng xuất hoặc hết hạn.

**Feature-specific NFRs:**
- Mật khẩu lưu dạng hash (không lưu plaintext); toàn bộ traffic qua HTTPS.

### 4.2 Page Management *(MVP)*

**Description:** Quản lý Trang dạng cây lồng nhau, hiển thị trên sidebar. Realizes UJ-2.

**Functional Requirements:**

#### FR-2: CRUD Trang
Người dùng có thể tạo, đổi tên, xóa một Trang.

**Consequences (testable):**
- Xóa một Trang cha sẽ xóa toàn bộ Trang con bên dưới (cascade), sau khi người dùng xác nhận qua hộp thoại cảnh báo rõ số lượng Trang con sẽ bị xóa. `[ASSUMPTION: không có thùng rác/undo ở v1 — xóa là xóa hẳn]`

#### FR-3: Cây trang lồng nhau & Sidebar điều hướng
Người dùng thấy toàn bộ Trang dạng cây trên sidebar, có thể mở/thu gọn, click để chuyển Trang.

**Consequences (testable):**
- Sidebar phản ánh đúng cấu trúc cha-con hiện tại sau mỗi thay đổi (tạo/xóa/di chuyển Trang).

### 4.3 Block Editor

**Description:** Soạn thảo nội dung Trang theo Block. MVP có các loại block cơ bản; Phase 2 bổ sung thao tác nâng cao. Realizes UJ-2.

**Functional Requirements:**

#### FR-4: Block editor cơ bản *(MVP)*
Người dùng soạn thảo Block loại đoạn văn, tiêu đề, bullet list, todo trong một Trang.

**Consequences (testable):**
- Mỗi loại Block (đoạn văn, tiêu đề, bullet, todo) render đúng định dạng khi tải lại Trang, không lẫn loại này thành loại khác.
- Block todo có checkbox bật/tắt được, trạng thái được lưu lại như nội dung Block khác.

#### FR-5: Tự động lưu *(MVP)*
Nội dung Trang tự lưu định kỳ hoặc khi người dùng ngừng gõ, không cần thao tác "Save" thủ công.

**Consequences (testable):**
- Đóng app/tắt trình duyệt ngay sau khi gõ vẫn không mất nội dung đã gõ trong khoảng debounce.

#### FR-6: Kéo-thả sắp xếp Block *(Phase 2)*
Người dùng kéo-thả để đổi vị trí Block trong Trang.

#### FR-7: Slash command *(Phase 2)*
Gõ "/" mở menu chọn nhanh loại Block.

#### FR-8: Chuyển đổi loại Block *(Phase 2)*
Đổi một Block từ loại này sang loại khác (vd đoạn văn → heading) mà không mất nội dung.

**Notes:** `[NON-GOAL for MVP]` FR-6 đến FR-8 không cần cho bản dùng thật đầu tiên — MVP dùng được với block editor cơ bản + auto-save là đủ để bắt đầu dùng hàng ngày.

### 4.4 Media *(MVP)*

**Functional Requirements:**

#### FR-9: Upload ảnh cơ bản
Người dùng chèn ảnh vào một Block, ảnh được lưu trên storage và hiển thị lại đúng vị trí.

**Consequences (testable):**
- Ảnh vẫn hiển thị đúng sau khi tải lại Trang hoặc mở từ thiết bị khác.

### 4.5 Multi-Device Sync

**Description:** Đây là điểm khác biệt quan trọng nhất so với "chỉ lưu trên server" thông thường: khi thang-hub sửa trên một thiết bị, các Session khác đang mở cùng Workspace phải thấy thay đổi mà không cần thao tác thủ công — đúng như hành vi UJ-1 và như trải nghiệm đã quan sát ở Notion. Đây **không phải** multi-user realtime collaboration (không có nhiều người cùng sửa, không cần con trỏ người khác) — chỉ là đồng bộ giữa các Session của **cùng một** người dùng.

**Functional Requirements:**

#### FR-10: Đồng bộ tức thời giữa các thiết bị (realtime push)
Khi một Session thay đổi dữ liệu, các Session khác đang mở của cùng Workspace nhận được thay đổi gần như ngay lập tức qua kênh đẩy thời gian thực — không cần người dùng tự bấm tải lại. Realizes UJ-1.

`[DECISION: đã xác nhận — realtime push (không phải chỉ tải-khi-mở-lại) đưa thẳng vào MVP ngay từ đầu, chấp nhận MVP kéo dài hơn ước tính ~19 ngày ban đầu trong brief để có trải nghiệm giống Notion thật ngay từ bản đầu tiên. Ước tính thời gian MVP cần tính lại ở bước Sprint Planning.]`

**Consequences (testable):**
- Trường hợp một Session offline khi thay đổi xảy ra ở Session khác: khi có mạng lại, dữ liệu đồng bộ về đúng trạng thái mới nhất, không tạo bản sao/không xung đột im lặng.

**Feature-specific NFRs:**
- Vì chỉ một người dùng thao tác (hiếm khi đúng cùng một block cùng lúc từ 2 thiết bị), không cần cơ chế giải xung đột kiểu CRDT (Yjs) — dùng "ghi đè theo lần lưu gần nhất" (last-write-wins) là đủ. Cơ chế cụ thể → addendum.

### 4.6 Database Views *(Phase 2, Calendar ở Phase 3)*

**Description:** Hiển thị một tập Trang con dưới nhiều dạng để phủ cả nhu cầu ghi chú lẫn quản lý task/dự án.

**Functional Requirements:**

#### FR-11: Database view — Table
Hiển thị Trang con dạng bảng với cột tùy chỉnh.

#### FR-12: Database view — Kanban
Hiển thị cùng dữ liệu dạng thẻ kéo-thả theo cột trạng thái.

#### FR-13: Database view — Calendar *(Phase 3)*
Hiển thị dữ liệu theo lịch dựa trên cột ngày tháng.

### 4.7 Backup & Portability

**Description:** thang-hub xác nhận cần có backup để phòng mất dữ liệu — đây là dữ liệu cá nhân duy nhất không có bản sao ở nơi khác một khi đã rời bỏ tool cũ.

**Functional Requirements:**

#### FR-14: Backup dữ liệu tự động *(MVP)*
Toàn bộ dữ liệu Workspace được sao lưu định kỳ (daily), giữ 7 bản gần nhất, có thể khôi phục nếu mất dữ liệu gốc. `[ASSUMPTION: tần suất/retention mặc định — điều chỉnh dễ dàng sau nếu cần]`. Đưa vào cuối MVP thay vì chờ Phase 2. Cơ chế kỹ thuật (dump DB, nơi lưu) → addendum.

#### FR-15: Markdown import/export *(Phase 2)*
Xuất Trang ra file `.md`, nhập file `.md` có sẵn thành Trang mới. Cung cấp một lớp portability độc lập với backup hệ thống.

### 4.8 Search *(Phase 3)*

#### FR-16: Tìm kiếm toàn văn
Tìm nội dung trong tất cả Trang của Workspace.

### 4.9 Mở rộng *(Phase 3 — ưu tiên thấp)*

**Functional Requirements:**

#### FR-17: Comment trên Block
Người dùng gắn bình luận vào một Block cụ thể để ghi chú thêm mà không sửa nội dung gốc.

#### FR-18: Mention (@page)
Gõ @ để chèn liên kết nhanh tới một Trang khác. *(Mention người dùng khác không áp dụng — chỉ có một người dùng.)*

#### FR-19: Template có sẵn
Thư viện mẫu Trang dựng sẵn để nhân bản nhanh (vd mẫu ghi chú họp, mẫu kế hoạch dự án).

#### FR-20: API công khai
Cho phép chương trình khác (do thang-hub tự viết) đọc/ghi dữ liệu qua API key, phục vụ tự động hóa cá nhân.

**Notes:** Nhóm này ưu tiên thấp, chỉ nên bắt đầu sau khi Giai đoạn 1 và 2 đã dùng ổn định trong thực tế.

## 5. Non-Goals (Explicit)

- Không hỗ trợ nhiều người dùng/nhiều workspace (multi-tenant) trong v1.
- Không có chia sẻ Trang cho người khác xem/sửa (share link, phân quyền theo người dùng).
- Không có realtime multi-user collaboration (nhiều người sửa cùng lúc, con trỏ người khác) — phân biệt rõ với FR-10 (đồng bộ đa thiết bị của cùng một người).
- Không xây mobile app native trong v1 (web trước, desktop sau; mobile dùng qua trình duyệt).
- Desktop app chưa nằm trong roadmap 3 giai đoạn hiện tại (§6) — sẽ định nghĩa scope riêng sau khi bản web ổn định.
- Không có trang giới thiệu/marketing công khai — đây là công cụ nội bộ cho một người dùng.

## 6. MVP Scope

### 6.1 In Scope
- FR-1 (Đăng ký/đăng nhập), FR-2 (CRUD Trang), FR-3 (Cây trang & sidebar), FR-4 (Block editor cơ bản), FR-5 (Auto-save), FR-9 (Upload ảnh cơ bản)
- FR-10 (Đồng bộ tức thời đa thiết bị, realtime push qua WebSocket) — đưa vào MVP ngay từ đầu *(quyết định đã xác nhận, xem §4.5)*, làm MVP kéo dài hơn ước tính gốc ~19 ngày
- FR-14 (Backup tự động) — đưa vào cuối MVP thay vì Phase 2, vì rủi ro mất dữ liệu cá nhân là load-bearing ngay từ ngày đầu dùng thật

### 6.2 Out of Scope for MVP
- FR-6, FR-7, FR-8 (thao tác block nâng cao) → Phase 2
- FR-11, FR-12 (database view) → Phase 2
- FR-15 (markdown import/export) → Phase 2
- FR-13, FR-16 đến FR-20 → Phase 3

## 7. Success Metrics

**Primary**
- **SM-1**: Sau khi MVP chạy, thang-hub thực sự dùng My Notion hàng ngày thay vì mở lại tool cũ (tự đánh giá qua cảm nhận sử dụng, không cần công cụ đo). Validates FR-1 đến FR-5, FR-9.
- **SM-2**: Không có sự cố mất dữ liệu kể từ khi có FR-14 (backup). Validates FR-14.

**Counter-metrics (do not optimize)**
- **SM-C1**: Không lấy "số tính năng đã build" làm thước đo tiến độ — tránh việc cứ thêm tính năng ở Phase 2/3 vì "có trong roadmap" trong khi MVP còn chưa được dùng thật hàng ngày. Counterbalances SM-1.

## 8. Open Questions

Không còn open question nào chưa giải quyết — các mục còn lại ở vòng thảo luận trước đã được chốt bằng giá trị mặc định hợp lý, đánh dấu `[ASSUMPTION]` tại chỗ (xem §9). Có thể điều chỉnh bất cứ lúc nào nếu thực tế phát sinh khác.

## 9. Assumptions Index

- §4.1 (FR-1) — Không cần 2FA hay giới hạn IP ở v1.
- §4.1 (FR-1) — Khóa đăng nhập tạm 15 phút sau 5 lần sai mật khẩu liên tiếp (giá trị mặc định).
- §4.2 (FR-2) — Xóa Trang cha cascade xóa toàn bộ Trang con, có xác nhận trước; không có thùng rác/undo ở v1.
- §4.5 (FR-10, NFR) — Dùng last-write-wins thay vì CRDT vì chỉ một người dùng thao tác.
- §4.7 (FR-14) — Backup daily, giữ 7 bản (retention mặc định); đưa vào cuối MVP thay vì Phase 2.
