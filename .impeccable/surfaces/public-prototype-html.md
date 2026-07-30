---
version: 1
slug: "public-prototype-html"
primary_target: "public/prototype.html"
related_targets: []
---

# BuzzRouter public directory

- Target: `public/prototype.html`
- Mode: Operate
- Status: implemented; Impeccable finish review disposition `ship`
- Concept seed: `9fa1a3c8`
- Approved comp: `.impeccable/mocks/workspace-index-inspector.png`
- Chosen direction: Index + Inspector — a light-first developer workspace for curated community discovery.
- Audience and job: Individual AI builders and startup teams scan a small curated set, inspect current activity and fit, then confidently join one community.
- Primary task: Search or filter, move through the community index, inspect a selected community without losing context, and use one prominent Join action.
- First viewport: Compact branded masthead with command search, a separate slim filter strip, an efficient community index with factual activity/freshness columns, and a persistent selected-community inspector.
- Visual world: Cool neutral canvas, white working surfaces, graphite type, electric indigo for selection/action, emerald only for written activity status, crisp grotesk type, precise dividers, minimal shadow.
- Activity rule: Activity is compact evidence—status, freshness, current work, and plain-language limitations. No waveform, sparkline, chart, or decorative visualization.
- Responsive behavior: Desktop uses index plus inspector. Narrow layouts turn the index into a selectable list and place the focused inspector immediately after it; filters move to the existing accessible dialog.
- Truth constraints: All fixture names, scores, ratings, activity, and relay-open counts are illustrative. Public listings and rankings are not connected. No fixture links to a fake relay. “Relay verified” describes a technical identity check, not endorsement.
- Interaction contract: Every visible control works. State is serialized in the URL, browser history is supported, meaningful view changes move focus, and comparison still supports exactly two or three selections.
- Accessibility bar: WCAG 2.2 AA target, semantic landmarks and headings, 44px controls, visible focus, non-color status, reduced motion, and usability at 320px and 200–400% zoom.
- Anti-goals: No civic register, Craigslist density, giant hero, card mosaic, chart dashboard, decorative squiggles, terminal cosplay, neon/glass AI styling, fake live presence, or inert controls.

## Approved-comp implementation inventory

| Visible ingredient | Shipped medium | Commitment |
| --- | --- | --- |
| Compact masthead and company mark | Semantic HTML + supplied, optimized raster logo | Keep the user-supplied BuzzRouter badge visible, circular, and paired with the wordmark. |
| Masthead command search and separate filter strip | Native inputs/selects + accessible dialog | Search remains primary; filters never dominate the page. |
| Six-row community index | Semantic list/grid + existing local raster insignias | Align Community, Focus, Activity, Freshness, and Rating without making an old spreadsheet. |
| Selected-row treatment | CSS surface wash + 1px selection rule | Quiet indigo selection; no thick side tab or ambient lift. |
| Persistent community inspector | Semantic article/sections | Join action stays near the selected community heading; evidence follows in reading order. |
| Activity and freshness | Text labels and timestamps | No generated visualization; all example data is explicitly illustrative. |
| Compare selection | Native buttons + URL state + fixed tray | Preserve the existing two-or-three-community comparison workflow. |
| Mobile selection transition | Responsive HTML/CSS + small focus/scroll behavior | Selection moves users directly to the inspector while preserving the list and filters. |
| Empty/loading/error/join-unavailable states | Semantic status regions and dialog | Every state explains what happened and the next action. |
| Method, submit, profile, comparison views | Semantic HTML/CSS in the same system | No secondary route falls back to the discarded civic world. |

- FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md
