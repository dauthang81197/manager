# Deferred Work

- source_spec: `_bmad-output/implementation-artifacts/spec-1-auth.md`
  summary: Login trả 401 (sai mật khẩu/email lạ) vs 423 (khoá) khác nhau đủ để suy ra email có tồn tại hay không (user enumeration qua timing/status code).
  evidence: Với app cá nhân 1 người dùng, giá trị thực tế của việc "ẩn" email chủ sở hữu là thấp — chấp nhận rủi ro này ở v1, revisit nếu app được public rộng hơn.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-auth.md`
  summary: JWT đã phát hành trước khi tài khoản bị khoá vẫn còn hiệu lực tới khi hết hạn (lockout chỉ chặn đăng nhập mới, không thu hồi session đang có).
  evidence: Cần cơ chế revoke/blacklist token mới xử lý được — vượt phạm vi story 1; revisit cùng lúc với session management nếu cần.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-auth.md`
  summary: argon2 hash dùng tham số mặc định của thư viện (không tự pin memoryCost/timeCost/parallelism).
  evidence: Mặc định hiện tại đủ an toàn; chỉ đáng lo nếu một bản nâng cấp dependency âm thầm đổi default.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-auth.md`
  summary: HttpExceptionFilter spread mọi field phụ trong body của HttpException vào response, không có allowlist.
  evidence: Hiện tại chỉ có `lockedUntil` là field phụ hợp lệ; nếu sau này có exception mang field nhạy cảm sẽ vô tình lộ ra client.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-auth.md`
  summary: Không có rate limiting trên `/auth/register`.
  evidence: Chấp nhận được ở quy mô cá nhân hiện tại; cần xem lại nếu app tiếp xúc traffic không tin cậy.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-auth.md`
  summary: my-notion-frontend chưa có framework test nào (không Jest/Vitest+RTL) — luồng hiển thị thông báo khoá tài khoản (`friendlyError`) và cấu hình Auth.js chưa được test tự động.
  evidence: Chi phí dựng test framework cho 1 story chưa tương xứng; revisit khi logic frontend phức tạp hơn.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-auth.md`
  summary: Trang đăng ký bỏ qua token trả về từ `register()`, gọi lại `signIn('credentials', ...)` gửi lại mật khẩu để lấy session — dư 1 vòng round-trip.
  evidence: Không sai, chỉ kém tối ưu; không đáng sửa ngay.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-page-crud-tree.md`
  summary: Toàn bộ cây Trang được refetch lại mỗi khi điều hướng (Sidebar + trang placeholder đều tự fetch riêng, không cache chung).
  evidence: Chấp nhận được ở quy mô hiện tại; revisit khi đưa TanStack Query vào theo đúng stack đã chọn ở spine.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-page-crud-tree.md`
  summary: `getBearerToken` (lib/auth.ts) suy ra secureCookie từ header `x-forwarded-proto` nhưng chưa có test tự động nào — đây là lần thứ 2 đúng loại logic proxy/token này không có test (lần 1 ở story 1 đã từng gây bug thật, chỉ bắt được qua smoke test tay).
  evidence: Frontend vẫn chưa có framework test nào; nên ưu tiên dựng test framework sớm hơn dự kiến vì lỗi loại này đã lặp lại 2 lần.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-page-crud-tree.md`
  summary: Route Handler proxy (`app/api/pages/**`) chưa có test nào chạy qua thật logic gắn Bearer token / 401 / 204 no-body.
  evidence: Cùng nguyên nhân — frontend chưa có test infra; test backend hiện tại mock Prisma, không chạm tới tầng proxy.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-page-crud-tree.md`
  summary: Recursive CTE (`getTree`/`countDescendants`) không có giới hạn độ sâu.
  evidence: Rủi ro thấp với app cá nhân 1 người tự xây cây của mình; cân nhắc thêm giới hạn nếu sau này mở rộng hơn.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-page-crud-tree.md`
  summary: `getBearerToken` tin vào header `x-forwarded-proto` từ request mà không có gì đảm bảo reverse proxy thật sự ghi đè header này trước khi tới app.
  evidence: Phụ thuộc cấu hình hạ tầng reverse proxy thật (spine AD-6) khi triển khai thật — chưa dựng hạ tầng đó nên chưa kiểm chứng được.
- source_spec: `_bmad-output/implementation-artifacts/spec-3-block-editor-autosave.md`
  summary: Không có optimistic concurrency (version/If-Match) — 2 tab mở cùng Trang sẽ ghi đè nhau âm thầm (last-write-wins).
  evidence: Đúng thiết kế đã chốt ở spine AD-4 cho 1 người dùng; sẽ xử lý đúng chỗ ở story 5 (đồng bộ đa thiết bị) chứ không phải ở đây.
- source_spec: `_bmad-output/implementation-artifacts/spec-3-block-editor-autosave.md`
  summary: 4 Route Handler proxy gần như giống hệt nhau (token → 401 → params → forward), chưa tách helper chung.
  evidence: Trùng lặp có thật nhưng chưa gây lỗi; gom lại khi thêm proxy thứ 5-6.
- source_spec: `_bmad-output/implementation-artifacts/spec-3-block-editor-autosave.md`
  summary: Editor chưa có toolbar/slash-menu — chỉ tạo được heading/list/todo qua markdown input rule, không có gợi ý nào cho người dùng.
  evidence: Slash command là story 7 (Phase 2) theo đúng roadmap; nhưng cân nhắc thêm placeholder gợi ý cú pháp sớm hơn nếu thấy khó dùng.
- source_spec: `_bmad-output/implementation-artifacts/spec-3-block-editor-autosave.md`
  summary: Node `image` đã cấu hình trong editor nhưng chưa có cách nào chèn ảnh (chưa toolbar/paste/drop, chưa endpoint upload).
  evidence: Đúng scope — upload ảnh là story 4; node để sẵn để story 4 chỉ cần thêm UI/endpoint.
- source_spec: `_bmad-output/implementation-artifacts/spec-3-block-editor-autosave.md`
  summary: e2e test "3 loại block còn nguyên" thực chất chỉ chứng minh jsonb round-trip, không chứng minh Tiptap render đúng loại block sau reload.
  evidence: Phần render đã được verify bằng browser thật (Playwright) trong lần review này; test tự động cho phần đó cần frontend test infra (đã defer riêng).
