---
version: 1
slug: "public-prototype-html"
primary_target: "public/prototype.html"
related_targets: []
---

# BuzzRouter public directory

- Target: `public/prototype.html` (rendered views live in `public/prototype.js`; styles in `public/prototype.css`)
- Mode: Operate
- Status: implemented; codified 2026-07-30 after the find/join + list simplification pass
- Concept seed: `9fa1a3c8`
- Approved comp: `.impeccable/mocks/workspace-index-inspector.png`, extended 2026-07-30 by the user-directed hero/texture direction now recorded in DESIGN.md
- Chosen direction: Index + Inspector workspace on a textured canvas, opened by a display-scale premise band.
- User stories (everything user-facing must serve one of these):
  1. **Find & join** — a visitor scans the index, inspects a community without losing context, and joins through the community's native Buzz space.
  2. **List** — a community operator lists their community via the "List a community" page.
- First viewport: premise band (headline with indigo-marked phrase, drawn underline, animated probe diagram), command bar (Focus / Activity / Sort), access chip rail (All / Public / Private), community index (Community, Focus, Activity, Freshness), persistent inspector with the Join action.
- Metrics rule: activity and freshness only. No ratings anywhere. No compare feature — the persistent inspector is the comparison tool.
- Evidence Lives Deep: verification and probe detail (relay checks, probe receipts, listing basis) appear only on the full profile page and the ranking-method page, never on discovery surfaces. The hero carries the one-line trust claim.
- Navigation: Discover and "List a community" in the masthead; ranking method reachable from the three-column footer and in-page links.
- Access model: every listing shows a Public or Private flag; the chip rail filters on it (`?access=`).
- Truth constraints: all names, scores, activity, freshness, and probe times are illustrative and labeled as such ("Illustrative", "example", "Example rank"). No fixture links to a fake relay. Preview and join dialogs state what is and is not real.
- Interaction contract: every visible control works; state serializes to the URL (`view, id, q, access, focus, activity, sort, status`); browser history supported; meaningful view changes move focus; keyboard row navigation (arrows + Enter) and ⌘K search.
- Accessibility bar: WCAG 2.2 AA target, semantic landmarks and headings, visible focus, non-color status, reduced-motion behavior for all animation (including stagger delays), usable at 320px and high zoom.
- Anti-goals: no civic register, card mosaic, chart dashboard, decorative squiggles, terminal cosplay, neon/glass AI styling, fake live presence, or inert controls. Ratings and comparison must not return without an explicit product decision and real data to back them.
