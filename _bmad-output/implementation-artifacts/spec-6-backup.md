---
title: 'Backup dữ liệu tự động (FR-14 / story 6)'
type: 'feature'
created: '2026-08-02'
status: 'done'
baseline_commit: '47737a1a6a3959ac51f105ad10829e5b8cfbe080'
review_loop_iteration: 0
context: ['{project-root}/_bmad-output/planning-artifacts/architecture/architecture-my-notion-2026-07-29/ARCHITECTURE-SPINE.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Dữ liệu duy nhất của app (Postgres DB `manager` + ảnh trong `ASSET_STORAGE_DIR`) chưa có backup nào — mất VPS/ổ đĩa là mất vĩnh viễn, không có bản sao ở nơi khác. FR-14 xếp việc này vào cuối MVP vì rủi ro mất dữ liệu cá nhân được đánh giá "load-bearing ngay từ ngày đầu".

**Approach:** Viết script bash chạy qua cron **trên VPS host** (spine xếp FR-14 là "infra cron, ngoài 2 app" — không đóng gói vào Docker image backend/frontend): mỗi ngày `pg_dump` DB + `tar` thư mục ảnh, nén, giữ 7 bản gần nhất, kèm script restore riêng và tài liệu hướng dẫn trong `DEPLOYMENT.md`.

## Boundaries & Constraints

**Always:**
- Mỗi lần chạy backup cả DB lẫn `ASSET_STORAGE_DIR` cùng lúc (spine: ảnh lưu local disk bắt buộc nằm trong vòng backup cùng `pg_dump`, không được để riêng).
- Giữ đúng 7 bản gần nhất (daily), tự xoá bản cũ hơn — nhưng **chỉ xoá sau khi bản mới nhất tạo thành công**; nếu `pg_dump`/`tar` lỗi, giữ nguyên mọi bản cũ, không dọn dẹp gì cả.
- Lưu backup vào thư mục khác với nơi Postgres/ảnh đang chạy thật (không ghi đè lên chính dữ liệu gốc).
- Mật khẩu Postgres đọc từ file env riêng (không hardcode trong script, không truyền qua tham số dòng lệnh lộ ra `ps`/history).
- Cron chạy trên VPS host qua `docker exec postgres_db pg_dump ...` (Postgres nằm ở container `postgres_db`, ngoài phạm vi compose của my-notion) — không cài thêm `pg_dump` riêng trên host.

**Ask First:** đẩy bản backup ra ngoài VPS (S3/nơi khác) — hiện thiết kế lưu local trên VPS (khác thư mục), chấp nhận rủi ro "VPS chết mất cả 2" ở v1 theo đúng mức chấp nhận rủi ro đã áp dụng cho các quyết định khác trong dự án.

**Never:** không tự sửa file `docker-compose.yml` thật trên VPS; không tự động chạy restore (luôn cần người xác nhận thủ công, chỉ định rõ bản nào); không thêm UI export cho user (đã có FR-15 markdown export ở phạm vi khác).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Chạy đúng lịch | Cron trigger `backup.sh` | Có thêm 1 file dump DB mới + 1 file tar ảnh mới; tổng số bản backup ≤ 7 | N/A |
| DB không kết nối được | `postgres_db` down/`pg_dump` lỗi | Log lỗi rõ ràng, thoát non-zero | Không xoá bản backup cũ nào |
| Hết dung lượng đĩa giữa chừng | Ghi file dump/tar dở dang thì hết chỗ | Không để lại file tạm dở dang đè lên chu trình retention | Xoá file tạm dở dang trước khi thoát lỗi |

</frozen-after-approval>

## Code Map

- `my-notion/my-notion-backend/README.md:76-104` -- ràng buộc: `ASSET_STORAGE_DIR` phải nằm trong backup set cùng DB dump, layout `<dir>/<ownerId>/<assetId>.<ext>`.
- `_bmad-output/planning-artifacts/prds/prd-my-notion-2026-07-29/addendum.md:16-19` -- đề xuất gốc: cron `pg_dump` daily, retention 7 bản, storage riêng khác DB chính.
- `ARCHITECTURE-SPINE.md:124,128,192,204` -- FR-14 map vào "infra cron (ngoài 2 app)"; ảnh local disk bắt buộc nằm trong vòng backup.
- `my-notion/DEPLOYMENT.md` -- tài liệu vận hành VPS hiện có (secrets, compose snippet) — thêm mục Backup vào đây, giữ 1 nguồn duy nhất cho vận hành.
- **Thực tế VPS** (ghi lại từ phiên deploy trước, không nằm trong repo): Postgres container `postgres_db` (postgres:14) network `database_default`, DB `manager`, user riêng `manager_app_1` (superuser `postgres` bị `pg_hba.conf` chặn network login). Bind-mount ảnh: host `/root/manager/data/assets` ↔ container `/app/var/assets`. Thư mục compose: `/root/manager` (`backend.env`/`frontend.env` tách riêng).

## Tasks & Acceptance

**Execution:**
- [x] `my-notion/backup/backup.sh` -- `docker exec postgres_db pg_dump -U manager_app_1 manager | gzip` ra file `manager-<ngày>.sql.gz`; `tar czf` thư mục bind-mount ảnh ra `assets-<ngày>.tar.gz`; cả 2 ghi vào thư mục backup riêng; sau khi cả 2 thành công mới rotate xoá bản > 7 ngày -- gộp DB+ảnh cùng 1 lần chạy, atomic theo đúng Boundaries.
- [x] `my-notion/backup/restore.sh` -- nhận tên bản backup làm tham số bắt buộc (không tự đoán bản mới nhất); `gunzip | psql` nạp lại DB, giải nén ảnh vào đúng thư mục -- luôn cần chỉ định rõ bản nào, tránh restore nhầm.
- [x] `my-notion/DEPLOYMENT.md` -- thêm mục "Backup tự động (FR-14)": vị trí lưu backup, dòng crontab cần thêm trên VPS, file env chứa mật khẩu Postgres cho script, cách kiểm tra backup đã chạy đúng, cách restore -- đủ để người vận hành tự thao tác trên VPS thật.

**Acceptance Criteria:**
- Given cron chạy đúng lịch, when `backup.sh` hoàn tất không lỗi, then có đúng 1 bản dump DB mới + 1 bản tar ảnh mới, tổng số bản backup không vượt quá 7.
- Given `pg_dump` thất bại (DB không kết nối được), when `backup.sh` chạy, then thoát non-zero kèm log lỗi rõ ràng và mọi bản backup cũ vẫn còn nguyên.
- Given 1 bản backup cụ thể đã có, when chạy `restore.sh <tên-bản>`, then DB và thư mục ảnh được khôi phục đúng nội dung của bản đó.

## Design Notes

**Vì sao `docker exec` thay vì cài `pg_dump` trên host:** Postgres chạy trong container `postgres_db` không thuộc compose của my-notion (dùng chung cho nhiều project khác trên VPS) — `docker exec postgres_db pg_dump ...` tái dùng đúng client `pg_dump` version khớp server (14) có sẵn trong container đó, tránh lệch version nếu host cài bản khác.

## Verification

**Commands:**
- `bash -n my-notion/backup/backup.sh` -- expected: không lỗi cú pháp.
- `bash -n my-notion/backup/restore.sh` -- expected: không lỗi cú pháp.

**Manual checks (không có Docker/Postgres thật trong sandbox này):**
- Sau khi merge, chạy thử `backup.sh` một lần thủ công trên VPS thật, xác nhận 2 file mới xuất hiện đúng thư mục backup và nội dung dump mở được bằng `zcat | head`.
- Chạy thử `restore.sh` với bản vừa tạo trên 1 DB test (không phải `manager` thật) để xác nhận khôi phục đúng trước khi tin tưởng dùng lúc khẩn cấp.

## Suggested Review Order

**Backup: đúng logic atomic + tự rotate**

- Entry point — `pg_dump` thêm `--clean --if-exists`, sửa đúng lỗi nghiêm trọng review tìm ra: thiếu cờ này thì restore luôn fail vì DB đích đã có sẵn schema (do `prisma migrate deploy` chạy trước).
  [`backup.sh:104`](../../my-notion/backup/backup.sh#L104)

- Publish 2 file atomically rồi mới rotate — thất bại ở bước dump/tar không bao giờ đụng tới backup cũ.
  [`backup.sh:116`](../../my-notion/backup/backup.sh#L116)

- Validate `RETENTION_COUNT` là số nguyên dương trước khi dùng — tránh rotate xoá nhầm bản vừa tạo nếu bị set 0/âm.
  [`backup.sh:56`](../../my-notion/backup/backup.sh#L56)

- Dọn file `.tmp.*` mồ côi từ lần chạy bị SIGKILL trước đó — trap `EXIT` không bắt được SIGKILL nên cần quét đầu mỗi lần chạy.
  [`backup.sh:80`](../../my-notion/backup/backup.sh#L80)

**Restore: thật sự overwrite như tài liệu mô tả**

- Xoá file ảnh cũ trước khi giải nén — nếu không, ảnh upload sau lần backup vẫn còn sót lại, trái với lời cảnh báo "OVERWRITES".
  [`restore.sh:80`](../../my-notion/backup/restore.sh#L80)

- Validate `BACKUP_DATE` đúng định dạng `YYYY-MM-DD` trước khi ghép vào đường dẫn — chặn path traversal qua tham số dòng lệnh.
  [`restore.sh:48`](../../my-notion/backup/restore.sh#L48)

- Bắt gõ lại đúng ngày để xác nhận trước khi restore — không có chế độ tự động, đúng ràng buộc "Never tự restore" của spec.
  [`restore.sh:64`](../../my-notion/backup/restore.sh#L64)

**Vận hành trên VPS**

- Mục Backup mới trong tài liệu vận hành: setup 1 lần, dòng crontab, cách verify, cách restore — đủ để tự thao tác trên VPS thật.
  [`DEPLOYMENT.md:144`](../../my-notion/DEPLOYMENT.md#L144)

**Peripherals**

- `.gitignore` loại bỏ file mật khẩu Postgres, thư mục backup thật, và log — không lọt secret/dữ liệu vào git.
  [`.gitignore:5`](../../my-notion/.gitignore#L5)
