---
title: "Adversarial Review — My Notion Architecture Spine"
reviews: '_bmad-output/planning-artifacts/architecture/architecture-my-notion-2026-07-29/ARCHITECTURE-SPINE.md'
against: '_bmad-output/planning-artifacts/prds/prd-my-notion-2026-07-29/prd.md'
type: adversarial-consistency-review
created: '2026-07-29'
---

# Adversarial Review — My Notion Architecture Spine

## Verdict

The spine's 7 ADs are individually sound but under-specify the **shared data shapes** and **event contracts** two independently-built units must agree on byte-for-byte; at least one finding (#1) is a literal self-contradiction inside the spine text itself, and two (#4, #6) are safety-relevant gaps not even acknowledged in "Deferred" — this spine is not yet safe to hand to two parallel stories without tightening.

Findings below are ordered by severity. Each names the two units in conflict, the divergent choice each could legitimately make while obeying the stated AD to the letter, and the concrete consequence.

---

## Finding 1 — The spine contradicts itself on what the WS payload contains (HIGH)

**Units in conflict:** backend `sync/` WS gateway (AD-4) vs frontend `ws-client.ts` + TanStack Query cache layer.

**The contradiction, verbatim from the spine:**
- Stack table: *"TanStack React Query — server-state cache, **invalidate** khi nhận WS event (AD-4)"* → implies the WS message is a bare **signal** ("something changed, go refetch via REST"), data itself stays authoritative only through REST responses.
- Consistency Conventions table: *"WS payload: `{ type, pageId, payload, updatedAt }`"* → the field is literally named `payload`, strongly implying the **actual changed data rides along** in the WS message, not just a pointer to refetch.

These are two different wire contracts. A backend dev implementing `sync/` per AD-4 could build either:
- (a) `payload: null` / omitted, WS is invalidation-only, gateway just broadcasts `{type:'page.updated', pageId, updatedAt}` and expects clients to `GET /api/v1/pages/:id`; or
- (b) `payload: <full content jsonb>`, gateway embeds the entire new Tiptap document (which for a large page could be tens of KB) in every broadcast, sent on every autosave debounce tick to every connected session.

A frontend dev reading only the Consistency Conventions row (not the Stack table) would write `ws-client.ts` to apply `payload` directly into editor/query-cache state — i.e., trust the WS message as the source of truth for content. If the gateway actually does (a), the editor on the receiving device renders `undefined` content or crashes on `payload.content.type`. If the gateway does (b) while the frontend was built expecting (a) (cache-invalidate-then-refetch), every keystroke-debounce autosave now double-fetches: once via the WS payload arriving, once via the React-Query invalidation firing a redundant GET — wasted bandwidth and a race between which write lands in the query cache last.

**Fix:** Pick one contract explicitly in AD-4 (or a new AD-4a): either "WS carries no page content, `payload` is null/omitted and clients must refetch," or "WS carries the full new `content` and receiving clients MUST NOT independently refetch." State it as a rule, not an implication, and update the Consistency Conventions row to match.

---

## Finding 2 — `view_schema`'s shape is gestured at, never specified (HIGH)

Directly confirms the reviewer's suspicion: **no schema (JSON Schema, TS interface, or even a worked example) for `view_schema` exists anywhere in the spine.** AD-7 says only: *"`pages.view_schema jsonb` lưu định nghĩa cột tuỳ chỉnh khi `view_type ≠ document`."* That is a one-clause gesture, not a contract.

**Units in conflict:** backend `pages/` module (owns the Prisma column + any server-side validation of it) vs frontend `components/database-view/` (owns rendering table/kanban/calendar from it) — plus a third, later consumer: whichever future story implements FR-13 (calendar).

Three concrete divergences, each fully AD-7-compliant:

1. **Column definition shape.** Backend dev (writing FR-11 first) might define `view_schema = { columns: [{ id, name, type }] }`. Frontend dev (writing FR-11's renderer independently, maybe from the same one-line AD text) might instead assume `view_schema = { fields: [{ key, label, dataType, options? }] }` — different key names, different nesting. Nothing forces them to converge except accidental agreement.
2. **Kanban's extra requirement.** FR-12 (kanban) needs to know *which column defines the swimlanes* — a `groupByColumnId`-shaped concept that table view (FR-11) doesn't need at all. AD-7's text never distinguishes per-`view_type` schema variants. A backend author who built `view_schema` for FR-11 alone has no field for this; whoever implements FR-12 either (a) migrates the schema and hopes no FR-11 story already shipped rows in the old shape, or (b) overloads an existing "columns" entry (e.g., "the first `select`-type column is implicitly the swimlane") — an invisible convention that a fresh dev reading only AD-7 would never guess.
3. **Calendar's extra requirement (FR-13).** Same problem again for "which column is the date column."

**Where do row *values* live?** AD-7 only says `view_schema` holds **column definitions** on the parent page. It never says where a child page's per-column **cell values** (the actual table row data — e.g. a "Status" select value, a "Due date") are stored. The ERD gives child pages only `title`, `content` (Tiptap doc, per AD-2), `view_type`, `view_schema`, `updated_at` — no `properties`/`cells` column. Backend `pages/` and frontend `database-view/` could each independently and defensibly decide: (a) cell values live inside the child's own `content.attrs` (repurposing the Tiptap doc root, in tension with AD-2's "content is a Tiptap document" contract), or (b) cell values live in the child's own `view_schema` field (re-purposing a field AD-7 defines as being for the *parent's* column-definitions, on the *child* row instead), or (c) a new untracked column gets added ad hoc. All three are "compliant" readings of AD-7's silence, and are mutually incompatible.

**Fix:** Add a companion schema doc (even a short JSON Schema or TS interface, versioned) for `view_schema`, covering: base column-definition shape, the `groupByColumnId`/`dateColumnId` extensions per `view_type`, and — critically — where per-row cell values are persisted. This is exactly the kind of shared-shape contract an AD is supposed to close.

---

## Finding 3 — Tiptap node/mark vocabulary is unspecified, breaking FR-15 and any future content consumer (HIGH)

**Units in conflict:** frontend `components/editor/` (owns which Tiptap extensions are enabled, hence which node/mark types can appear in `content`) vs backend `pages/` FR-15 markdown import/export endpoint, and eventually FR-16 full-text search indexing.

AD-2 only says `content jsonb` holds "nguyên văn Tiptap JSON document" — it never enumerates the node vocabulary (paragraph, heading levels, bulletList, taskList/taskItem vs. a custom todo node, image node attrs, code block, etc.), nor does it require frontend to publish that vocabulary anywhere backend can read it.

**Concrete scenario:** The FR-15 markdown exporter (backend `pages/`) is written against an assumed standard vocabulary: `paragraph`, `heading`, `bulletList`/`listItem`, `taskList`/`taskItem` (checked attr), `image` (src/alt). Independently, the FR-4 editor implementation (frontend, possibly built earlier or later, by "independent" stories per this exercise's premise) implements the todo block as a **custom node** `customTodo` with attrs `{done: boolean}` instead of Tiptap's built-in TaskItem — an equally valid choice, since AD-2 never pins the vocabulary. The exporter, never having seen `customTodo`, either throws on export or — worse — silently drops every todo block from the exported `.md`, and FR-15's "portability independent of backup" promise silently loses data with no error surfaced to the user (thang-hub finds out only when re-importing an old export and discovering the todos are gone).

The same gap will hit FR-16 (full-text search) later: whatever indexer walks the Tiptap JSON to extract text needs to know every node's text-bearing shape, and nothing publishes that contract.

**Fix:** AD-2 (or a companion doc) should enumerate the frozen v1 node/mark vocabulary the editor is allowed to emit, and require any addition to be a spine update, not a silent frontend change.

---

## Finding 4 — JWT expiry vs. an already-open WebSocket connection: not even in "Deferred" (HIGH)

AD-5 says the backend "verify JWT qua Guard riêng cho mọi API/WebSocket call" and the cookie is httpOnly. Nothing states what "verify... for every WebSocket call" *means operationally* once a socket is already connected: NestJS gateways typically authenticate once at the `handleConnection`/handshake step; they do not automatically re-validate the JWT on every subsequent frame unless someone explicitly wires that in.

**Units in conflict:** backend `auth/` (owns the JWT Guard contract) vs backend `sync/` (owns the long-lived WS connection lifecycle) — these are two backend modules that could each assume the other enforces expiry.

**Concrete scenario:** thang-hub leaves the phone's tab open overnight; the JWT's `exp` passes. The `auth/` guard correctly rejects the next REST call (401) once the cookie is stale — but the phone's *already-established* WebSocket, opened hours earlier while the JWT was still valid, has no per-message expiry check written anywhere in the spine, so it silently stays open and keeps receiving/emitting `page.updated` events indefinitely (until the socket happens to drop and reconnect). This produces two different divergent, both-compliant implementations:
- gateway dev interprets "verify JWT for every WS call" as handshake-time-only (simplest reading) → stale sessions keep working over WS but get silently rejected over REST, so an autosave PUT (FR-5, which goes over REST per AD-1) 401s while the WS channel looks alive, and if the frontend doesn't surface that 401 distinctly from a network blip, content typed on the phone is silently never persisted — a direct, silent violation of FR-5's "no data loss" guarantee and UJ-1.
- a different implementation could hard-disconnect the socket the instant `exp` passes (requiring a per-connection timer) — a legitimate but entirely different design, and nothing picks between them.

This is not listed in "Deferred" at all — it's a live gap that will bite the very first multi-day usage session.

**Fix:** Add an AD for token lifecycle: refresh strategy (sliding session vs. hard expiry), and explicit behavior for open WS connections on expiry (forced disconnect + required client reconnect-with-fresh-token, vs. grace period). At minimum, name it in Deferred with a flag that it must be resolved before FR-10 ships, since FR-10 is in MVP.

---

## Finding 5 — AD-4 only defines `page.updated`; page creation/deletion over WS is ungoverned, threatening FR-3 (HIGH)

**Units in conflict:** backend `sync/` gateway vs frontend sidebar tree component (FR-3 realizer).

AD-4's rule text defines exactly one event: `page.updated`, fired "khi một session khác ghi thành công." It says nothing about page **creation** or **deletion** — yet FR-2/FR-3's testable consequence is explicit: *"Sidebar phản ánh đúng cấu trúc cha-con hiện tại sau mỗi thay đổi (tạo/xóa/di chuyển Trang)"* across sessions is exactly what multi-device sync (FR-10/UJ-1) is supposed to guarantee.

**Concrete scenario:** Session A creates a new child page (FR-2) or deletes a subtree (cascade delete, FR-2's consequence). A backend dev following AD-4 to the letter has no event name to emit for this — "page.updated" doesn't fit "a page no longer exists" or "a page now exists." They could invent `page.created`/`page.deleted` ad hoc (not wrong, but not specified — naming, payload shape, and whether cascade-deletes emit one event per deleted page or one batch event are all undocumented). A frontend dev, meanwhile, building `ws-client.ts` strictly from AD-4's text, may only wire a listener for `page.updated` — because that's the only event name the spine names — and never handle tree-shape-changing events at all. Result: Session B's sidebar silently goes stale (missing new pages, or still showing deleted ones) until a manual full reload, directly failing FR-3's stated cross-session consequence, while both sides can point to full AD-4 compliance.

This gets worse under FR-15 (markdown import of a folder): a single import could create dozens of pages in one backend transaction — is that one event per page (event storm) or one batch event (a shape nobody defined)?

**Fix:** Extend AD-4 (or add AD-4b) to name the full event set (`page.created`, `page.updated`, `page.deleted`, and a batch/bulk variant for import), with payload shapes for each, explicitly covering the sidebar-tree-shape-change case.

---

## Finding 6 — No reconnect/offline catch-up protocol, contradicting an explicit PRD edge case (HIGH)

UJ-1 states an explicit edge case as a requirement: *"nếu laptop đang offline lúc thay đổi xảy ra, khi có mạng trở lại app phải tự đồng bộ lại đúng trạng thái mới nhất mà không tạo xung đột hay nhân đôi dữ liệu."* FR-10's consequence repeats this. AD-4 only describes **live broadcast to currently-connected sessions** — by definition it says nothing about a session that was disconnected when the change happened and thus never received the broadcast.

**Units in conflict:** backend `sync/` gateway, backend `pages/` REST API, and frontend `ws-client.ts` — three units, any one of which could assume a *different one of the other two* owns reconciliation-on-reconnect.

**Concrete scenario:** Phone goes offline; laptop (still connected) creates 3 new pages and edits 2 others; phone comes back online and its WebSocket reconnects. Backend gateway dev assumes: "reconnect just re-subscribes to future broadcasts, the REST layer is responsible for the client refetching current state on reconnect." Frontend dev assumes the opposite: "the WS gateway will replay any events missed while disconnected, like a message queue with backlog" (a very common realtime-system assumption) — but no such backlog/replay mechanism is specified or required anywhere, and NestJS's default in-process gateway (explicitly chosen in "Deferred" as sufficient without Redis) holds no missed-event log at all once a socket disconnects. Since neither AD-4 nor any other AD assigns this responsibility, it's entirely possible **no one builds it**, while every individual story remains AD-compliant — and the sidebar/task-list on the phone (the primary scenario in UJ-1!) simply shows stale data indefinitely after any offline period, exactly the failure UJ-1 calls out as unacceptable.

**Fix:** Add an AD for reconnect behavior: e.g., "on WS reconnect, client MUST perform a full REST refetch of the current page + page tree before trusting any further WS events," making REST (not WS backlog) the explicit catch-up mechanism — cheap given the current single-user, single-instance scale, but it must be *stated*, not assumed by either side.

---

## Finding 7 — WS broadcast includes the originating session; races with its own REST response (MEDIUM-HIGH)

AD-4: gateway "phát sự kiện `page.updated` tới **mọi session đã xác thực của cùng user**" — this literally includes the session that just made the write (no stated exclusion of the sender/originating socket).

**Units in conflict:** backend `sync/` gateway vs frontend autosave/editor integration (FR-5).

**Concrete scenario:** Session A's editor autosaves (FR-5 debounce) via `PUT /api/v1/pages/:id`. Two things now happen concurrently per the spine: (1) the REST call resolves with the new `updated_at` to A; (2) the gateway broadcasts `page.updated` to "every authenticated session of the user," which per AD-4's literal text includes A itself. If A's frontend applies Finding-1-style-(b) full-payload WS updates into the *same* editor/query-cache state the user is actively typing into, this either clobbers in-flight local edits made in the window between the PUT firing and the broadcast arriving, or — combined with React Query's "invalidate on WS event" behavior from the Stack table — triggers a refetch that races the in-flight PUT's own response, with no ordering guarantee about which lands in the cache last. A dev building the gateway per AD-4's literal text ("mọi session") has no reason to exclude the sender; a dev building the frontend, by default UX instinct, assumes self-echo is suppressed (as most realtime systems do) and writes no guard against processing your own broadcast — both fully "AD-4 compliant," yet the combination produces visible cursor jumps or a resurrected stale version of content the user just changed.

**Fix:** AD-4 should state explicitly whether the gateway excludes the originating socket/session from the broadcast (recommended: exclude by socket id, not just "same user"), and the frontend contract should state whether the client must ignore/dedupe WS events for its own recent writes (e.g., by comparing `updatedAt` against the last locally-known write timestamp).

---

## Finding 8 — Cascade delete: recursive-CTE app logic vs. FK constraint semantics is unstated (MEDIUM)

AD-3 mandates recursive CTE via `$queryRaw` for tree queries including cascade delete, but never states the **FK constraint mode** on `pages.parent_id` in `schema.prisma`, nor the **delete order**.

**Units in conflict:** whoever writes `schema.prisma`'s `parent_id` relation (`onDelete: Cascade` / `Restrict` / `SetNull` / `NoAction`) vs. whoever writes the `pages.service.ts` cascade-delete method that AD-3 says must use a recursive CTE.

**Concrete scenario:** The service-layer dev, following AD-3, writes a recursive CTE to compute the full descendant-id set of a page being deleted, then issues `DELETE FROM pages WHERE id IN (...)` for the whole set in one statement — this order-independent bulk delete works regardless of FK mode. But if a *different* implementation (equally consistent with AD-3's text, which only says "dùng recursive CTE... cascade delete," not the exact statement shape) instead deletes the parent row first and relies on the CTE purely to *display* the confirmation-dialog count (per FR-2's consequence: "xác nhận qua hộp thoại cảnh báo rõ số lượng Trang con"), the actual deletion order matters: if `schema.prisma` has `onDelete: Restrict` (Prisma's non-cascade default when unspecified) and the service deletes the parent before its still-extant children, the DB rejects the delete with a foreign-key violation on every tree deeper than one level — a production bug that would only surface once a real nested page tree exists, i.e. after FR-3's nested pages are actually in daily use.

**Fix:** State explicitly in AD-3 (or the Prisma schema itself, referenced by AD-3) whether `parent_id` has `ON DELETE CASCADE` at the DB level (making app-level ordering moot) or whether cascade is purely application-level (in which case, mandate bottom-up delete order and a single transaction).

---

## Finding 9 — No home for manual ordering (kanban card order, column order) (MEDIUM)

FR-12 (kanban) is fundamentally a drag-and-drop-between/within-columns feature — ordering *is* the feature. AD-7's ERD gives `pages` no `position`/`order` column, and `view_schema` per AD-7 is defined only as column *definitions*, not per-row ordering. Nothing states whether card order is derived from `created_at`, an implicit array-order inside `view_schema`, or a new column.

**Units in conflict:** backend `pages/` (persistence) vs frontend `database-view/` kanban renderer.

**Concrete scenario:** Frontend implements optimistic drag-reorder assuming a `position: number` field exists per page for in-column ordering; backend, having only the ERD's stated columns, has no such field and silently falls back to sorting by `updated_at` (which changes on ANY edit, including unrelated content edits) or `created_at` (which never reflects manual reordering at all) — so a user's manually-arranged kanban board silently re-shuffles itself the next time any card is edited, since the two components disagree on what "order" even means, with neither side technically violating AD-7 (which never mentions ordering).

**Fix:** Add an explicit ordering field/strategy to the AD-7 companion schema work from Finding 2 — this is Phase 2 scope, but should be decided before FR-12 stories are drafted, not discovered mid-implementation.

---

## Finding 10 — `view_type` conversion semantics undefined (LOW-MEDIUM)

AD-7 allows a page's `view_type` to be `document | table | kanban | calendar` but never states what happens when an existing `document`-type page (with real Tiptap content in its children, or with children that are themselves rich documents) is converted to `table`/`kanban`. Does the UI even allow converting a page that already has non-empty children? Does existing child `content` get preserved (just hidden behind the row view) or does the table/kanban renderer only ever show the column-derived values from Finding 2's still-undefined cell-value location, silently orphaning whatever the child pages' `content` field actually held? Backend (permissive: just flips the enum column) and frontend (assuming conversion is only offered on empty/new pages) could each build a different guard, leaving a gap where converting a populated page either destroys the appearance of existing content or silently ignores real note content sitting in children that are supposed to now behave as table rows.

**Fix:** Add a rule to AD-7 (or defer explicitly, naming it) for view_type transition rules: allowed only on childless pages, or fully defined coexistence of `content` and cell-values on the same child page.

---

## Finding 11 — Image URL representation inside `content` is unaddressed by any AD (LOW)

FR-9 storage backend (local disk vs S3) is explicitly Deferred — but one level up from that, AD-2 never states whether the `image` node's `src` attr inside `content` jsonb is an **absolute URL**, a **backend-relative path** (resolved against whatever origin the proxy in the structural diagram uses), or an opaque asset id. This matters independently of the storage backend decision: frontend `components/editor/` (choosing how to construct the `src` it writes into Tiptap's image node) and backend `pages/` upload endpoint (choosing what URL shape to return from the upload response) must agree on this today, before FR-9 storage location is even decided, otherwise images render on the device that uploaded them (same-origin relative path resolves) but 404 on other devices/sessions if the two ever disagree on absolute-vs-relative. It also directly affects FR-15 markdown export: a relative backend path embedded in an exported `.md` file is meaningless once the file leaves the app (no way to resolve it), while an absolute URL requiring the httpOnly auth cookie (AD-5) won't render in an external markdown viewer at all.

**Fix:** Note in AD-2 or a companion note that `src` must be an absolute, backend-served URL (or asset id resolved client-side), independent of and prior to resolving the Deferred local-disk-vs-S3 decision.

---

## Summary Table

| # | Finding | Units in conflict | Severity |
| --- | --- | --- | --- |
| 1 | WS payload contract self-contradicts (signal vs. full data) | `sync/` gateway vs `ws-client.ts`/React Query | HIGH |
| 2 | `view_schema` shape + cell-value location never specified | `pages/` vs `database-view/` (table/kanban/calendar) | HIGH |
| 3 | Tiptap node vocabulary unspecified | `components/editor/` vs `pages/` (FR-15 export), future FR-16 | HIGH |
| 4 | JWT expiry vs. open WS connection unhandled, not even Deferred | `auth/` Guard vs `sync/` gateway | HIGH |
| 5 | Only `page.updated` defined; create/delete broadcast ungoverned | `sync/` gateway vs sidebar (FR-3) | HIGH |
| 6 | No reconnect/offline catch-up protocol | `sync/` gateway vs `pages/` REST vs `ws-client.ts` | HIGH |
| 7 | Broadcast includes originating session; races own REST response | `sync/` gateway vs autosave (FR-5) integration | MEDIUM-HIGH |
| 8 | Cascade delete: FK mode vs. app-level CTE order unstated | `schema.prisma` FK vs `pages.service.ts` | MEDIUM |
| 9 | No field for kanban card/column ordering | `pages/` vs `database-view/` kanban | MEDIUM |
| 10 | `view_type` conversion semantics on populated pages undefined | `pages/` vs frontend conversion UI | LOW-MEDIUM |
| 11 | Image `src` shape (absolute/relative/auth) inside content unaddressed | `components/editor/` vs `pages/` upload endpoint | LOW |

## Recommended Next Step

Tighten AD-4 (split into WS payload contract, full event set, self-echo/sender-exclusion, and reconnect-catchup rule), and add a companion schema document for `view_schema` (Finding 2) plus a frozen Tiptap node vocabulary list (Finding 3) before any FR-10, FR-11/12, or FR-15 story is drafted — these three are exactly the shared-shape contracts two independently-built units cannot converge on by accident.
