---
review: version-verification
target: ARCHITECTURE-SPINE.md (My Notion)
date: 2026-07-29
scope: verify every committed technology/version claim in the Stack table (and version claims elsewhere) was web-researched, not asserted from stale training data
scale-note: solo/hobby project — calibrated to catch genuinely stale/wrong claims, not to pad with pedantry
---

# Version Verification Review — ARCHITECTURE-SPINE.md

## Method

Read the Stack table (lines 82-96) and cross-referenced every entry against `.memlog.md`'s "(version)" entries dated 2026-07-29 (today). For entries with an existing memlog verification, spot-checked a sample with fresh WebSearch to confirm the memlog claim itself is accurate (not just present). For entries with no memlog verification, ran fresh WebSearch directly.

## Per-item verification status

| Stack item | Spine claim | Verified in memlog? | My spot-check | Status |
| --- | --- | --- | --- | --- |
| Node.js | 24 (Active LTS, 2026-07) | Yes — memlog line 9 | Confirmed: Node 24 is Active LTS as of July 2026; Node 26 is Current, enters LTS Oct 2026. Matches spine exactly. | OK |
| NestJS | v11 (Express v5 adapter) | Yes — memlog line 9 | Confirmed: v11.1.28 is latest (published Jul 8, 2026), no v12 exists yet; Express v5 is the default adapter in v11. Matches. | OK |
| Next.js | 16.2.x (React 19.2, Turbopack) | Yes — memlog line 9 | Confirmed: Next.js 16.2 is real, released Mar 18, 2026, Turbopack-focused release. Matches. | OK |
| Tiptap | @tiptap/core, @tiptap/react ~3.29.x | Yes — memlog line 22 (3.29.1/3.29.2) | Not independently re-checked (memlog gives specific patch numbers, internally consistent, same-day timestamp) | OK (accepted on memlog evidence) |
| Prisma ORM | v7.4.x | Yes — memlog line 22 (v7.4.2) | Confirmed: v7.4.0 released Feb 11 2026, v7.4.1 Feb 19, v7.4.2 Feb 27 2026 — real, "bug fixes and quality improvements" patch line. Matches. | OK |
| PostgreSQL | 18.4 | Yes — memlog line 9 | Confirmed: PostgreSQL 18.4 released May 14, 2026 (security + bug-fix release). Matches. | OK |
| Auth.js (NextAuth) | v5 | Yes — memlog line 22, with a caveat noted | Confirmed the merger is real **and materially understated** — see Finding 1 below | **FLAGGED** |
| Tailwind CSS | "latest 4.x — pin version chính xác lúc scaffold" | **No** — no memlog entry for Tailwind at all | Fresh search: latest is 4.3.3 (Jul 16, 2026); no v5 exists. Tailwind v4 is still the current major. | Unverified in memlog, but claim itself holds up — see Finding 2 |
| TanStack React Query | no version pinned, described qualitatively | **No** — no memlog entry | Fresh search: latest is @tanstack/react-query@5.101.2 (release train dated Jun 27 2026). Package/ecosystem alive and active. | Unverified in memlog, no discrepancy found — see Finding 2 |
| Zustand | no version pinned, described qualitatively | **No** — no memlog entry | Fresh search: latest is 5.0.14 (published ~May 28, 2026). Package alive and active. | Unverified in memlog, no discrepancy found — see Finding 2 |
| Docker + GitHub Actions | — (no version) | N/A — not version-sensitive | Not applicable; no claim to verify | OK |

## Findings

### Finding 1 — Auth.js v5 choice: memlog understates a real, dated ecosystem risk (Medium)

The memlog (line 22) does flag the Better Auth situation, but frames it softly: *"Auth.js v5 ổn định từ cuối 2024, production-ready 2026 — LƯU Ý: có tin Auth.js đang sáp nhập vào 'Better Auth', cần theo dõi khi implement, chưa ảnh hưởng tới việc dùng v5 hiện tại"* ("stable since late 2024, production-ready 2026 — note: there's news Auth.js is merging into Better Auth, worth monitoring, doesn't affect current v5 use").

A fresh web search shows this is understated on two counts:

1. **The merger is not a rumor to "monitor" — it's a completed, ~10-month-old event.** Auth.js/NextAuth was announced as folded into Better Auth in September 2025. Since then Auth.js has been in security-patch-only maintenance mode: no new features, and the main contributor left the project in January 2025. Current ecosystem guidance (multiple 2026 sources) explicitly states: *do not start a new project with Auth.js/NextAuth* — Better Auth is the recommended path for new projects, and migration guides from NextAuth → Better Auth are now a common genre of blog post.
2. **Auth.js v5 has never left beta.** It has been in beta since October 2023 and, as of this writing (Jul 2026), still has no stable release — it is being used in production only informally, on the strength of "it's stable enough even though it's still tagged beta."

This project (AD-5) is a **brand-new** project starting now, choosing self-hosted Auth.js v5 specifically over Clerk/Auth0 to avoid vendor/subscription lock-in. That reasoning is sound and doesn't change — Auth.js remains free, self-hosted, and will keep receiving security patches for the foreseeable future, which may be perfectly adequate for a solo hobby app. But the spine is adopting a library that (a) has never shipped a stable major version and (b) the ecosystem consensus in mid-2026 explicitly discourages for new projects. That's a meaningfully different risk posture than "stable since 2024, note pending, no impact" implies. This should be re-surfaced as a real decision point (stick with Auth.js v5 knowing it's maintenance-only/perpetual-beta, or consider Better Auth — which is the actual current successor and would need its own version-verification pass) rather than a footnote.

**Recommendation:** Update AD-5 or its memlog trail to state plainly that Auth.js v5 is in maintenance/security-only mode post-merger and still beta-tagged, and that this was a conscious accepted-risk choice (not just "doesn't affect current use, will monitor").

### Finding 2 — Tailwind CSS, TanStack Query, and Zustand were never run through a memlog verification entry (Low)

Unlike Node.js, NestJS, Next.js, PostgreSQL, Tiptap, Prisma, and Auth.js — each of which has an explicit `(version)` memlog entry dated 2026-07-29 — these three stack rows have no corresponding verification entry at all:

- **Tailwind CSS** — spine text is deliberately non-committal ("latest 4.x — pin exact version at scaffold time"), which is a reasonable way to defer a version pin, but it was still never checked whether "4.x" is even still the current major. My spot-check confirms it is (4.3.3 released Jul 16, 2026, no v5 yet), so the claim happens to be correct — but this was luck/reasonable-default, not verification.
- **TanStack React Query** and **Zustand** — the spine names both only qualitatively (role in the architecture, no version), which is actually the safer move since no version can go stale. My spot-check confirms both packages are alive and actively releasing in 2026 (React Query 5.101.2, Zustand 5.0.14), so there's no hidden staleness — but their continued existence/fit was never actually confirmed anywhere in the trail before this review.

**Recommendation (low priority, given hobby scale):** No spine changes needed — none of the three turned up wrong or stale. If you want the memlog to be a complete audit trail, add one short `(version)` entry noting Tailwind 4.x / React Query 5.x / Zustand 5.x were checked and are current as of 2026-07-29. Not blocking.

## Summary

Of 10 version-bearing stack claims, 7 have solid memlog verification entries and all 7 held up under independent spot-check (Node.js, NestJS, Next.js, PostgreSQL, Prisma, Tiptap, Auth.js-the-version-number). 3 (Tailwind, TanStack Query, Zustand) had no memlog entry; independent checks found no actual staleness in any of them. The one substantive issue is qualitative, not a version number: **Auth.js v5's real-world status (perpetual beta, maintenance-only since the Sept 2025 Better Auth merger, explicit "don't use for new projects" guidance) is more serious than the memlog's "note it and move on" framing suggests**, and deserves a clearer accepted-risk note in the spine given AD-5 commits a brand-new project to it.
