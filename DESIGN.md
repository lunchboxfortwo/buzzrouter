---
name: BuzzRouter
description: A focused developer workspace for finding one active, credible Buzz community.
colors:
  cool-canvas: "#f4f5f7"
  working-surface: "#ffffff"
  muted-surface: "#f8f9fb"
  selected-surface: "#f1f1ff"
  graphite: "#111318"
  reading-graphite: "#414958"
  soft-ink: "#667085"
  divider: "#dfe2e8"
  divider-strong: "#c9ced8"
  electric-indigo: "#5657f2"
  electric-indigo-strong: "#4445d8"
  electric-indigo-soft: "#ececff"
  activity-emerald: "#087c5b"
  activity-emerald-muted: "#316d61"
  activity-emerald-soft: "#e9f8f2"
  caution-ochre: "#8a5b00"
  caution-soft: "#fff5d6"
  danger-red: "#b42336"
  focus-violet: "#7957ff"
typography:
  display:
    fontFamily: "Instrument Sans, ui-sans-serif, sans-serif"
    fontSize: "clamp(2.3rem, 4.2vw, 3.4rem)"
    fontWeight: 700
    lineHeight: 1.04
    letterSpacing: "-0.04em"
  display-content:
    fontFamily: "Instrument Sans, ui-sans-serif, sans-serif"
    fontSize: "clamp(2rem, 4vw, 3.4rem)"
    fontWeight: 700
    lineHeight: 1.02
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "Instrument Sans, ui-sans-serif, sans-serif"
    fontSize: "clamp(1.35rem, 1.55vw, 1.6rem)"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.03em"
  title:
    fontFamily: "Instrument Sans, ui-sans-serif, sans-serif"
    fontSize: "1.08rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.015em"
  body:
    fontFamily: "Instrument Sans, ui-sans-serif, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  compact-body:
    fontFamily: "Instrument Sans, ui-sans-serif, sans-serif"
    fontSize: "0.84rem"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "normal"
  metric:
    fontFamily: "Instrument Sans, ui-sans-serif, sans-serif"
    fontSize: "1.65rem"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.025em"
  label:
    fontFamily: "Instrument Sans, ui-sans-serif, sans-serif"
    fontSize: "0.72rem"
    fontWeight: 620
    lineHeight: 1.35
    letterSpacing: "normal"
  micro:
    fontFamily: "Instrument Sans, ui-sans-serif, sans-serif"
    fontSize: "0.68rem"
    fontWeight: 550
    lineHeight: 1.25
    letterSpacing: "normal"
  svg-label:
    fontFamily: "Instrument Sans, ui-sans-serif, sans-serif"
    fontSize: "11px"
    fontWeight: 620
    lineHeight: 1
    letterSpacing: "normal"
  scale:
    "step-660": "0.66rem"
    "step-680": "0.68rem"
    "step-720": "0.72rem"
    "step-730": "0.73rem"
    "step-740": "0.74rem"
    "step-760": "0.76rem"
    "step-770": "0.77rem"
    "step-780": "0.78rem"
    "step-790": "0.79rem"
    "step-800": "0.8rem"
    "step-820": "0.82rem"
    "step-840": "0.84rem"
    "step-850": "0.85rem"
    "step-860": "0.86rem"
    "step-870": "0.87rem"
    "step-880": "0.88rem"
    "step-900": "0.9rem"
    "step-910": "0.91rem"
    "step-920": "0.92rem"
    "step-930": "0.93rem"
    "step-980": "0.98rem"
    "step-100": "1rem"
    "step-105": "1.05rem"
    "step-108": "1.08rem"
    "step-115": "1.15rem"
    "step-120": "1.2rem"
    "step-125": "1.25rem"
    "step-145": "1.45rem"
    "step-165": "1.65rem"
    "step-215": "2.15rem"
    "svg-11": "11px"
rounded:
  hairline: "2px"
  micro: "4px"
  chip: "5px"
  tag: "6px"
  sm: "7px"
  md: "10px"
  lg: "14px"
  pill: "999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "24px"
  "6": "32px"
  "7": "48px"
components:
  button-primary:
    backgroundColor: "{colors.electric-indigo}"
    textColor: "{colors.working-surface}"
    rounded: "{rounded.sm}"
    padding: "0 15px"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.electric-indigo-strong}"
    textColor: "{colors.working-surface}"
    rounded: "{rounded.sm}"
  button-secondary:
    backgroundColor: "{colors.working-surface}"
    textColor: "{colors.graphite}"
    rounded: "{rounded.sm}"
    padding: "0 15px"
    height: "44px"
  button-secondary-hover:
    backgroundColor: "{colors.electric-indigo-soft}"
    textColor: "{colors.electric-indigo-strong}"
    rounded: "{rounded.sm}"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.electric-indigo-strong}"
    rounded: "{rounded.sm}"
    padding: "0 15px"
    height: "44px"
  search-field:
    backgroundColor: "{colors.working-surface}"
    textColor: "{colors.graphite}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "0 54px 0 42px"
    height: "46px"
  command-filter:
    backgroundColor: "{colors.working-surface}"
    textColor: "{colors.graphite}"
    rounded: "{rounded.sm}"
    padding: "0 0 0 12px"
    height: "46px"
  access-chip:
    backgroundColor: "{colors.working-surface}"
    textColor: "{colors.soft-ink}"
    rounded: "{rounded.pill}"
    padding: "0 14px"
    height: "40px"
  access-chip-selected:
    backgroundColor: "{colors.electric-indigo-soft}"
    textColor: "{colors.electric-indigo-strong}"
    rounded: "{rounded.pill}"
    padding: "0 14px"
    height: "40px"
  filter-chip:
    backgroundColor: "{colors.electric-indigo-soft}"
    textColor: "{colors.electric-indigo-strong}"
    rounded: "{rounded.pill}"
    padding: "0 10px"
    height: "30px"
  access-flag:
    backgroundColor: "{colors.muted-surface}"
    textColor: "{colors.soft-ink}"
    rounded: "{rounded.chip}"
    padding: "2px 7px"
  status-label:
    backgroundColor: "{colors.activity-emerald-soft}"
    textColor: "{colors.activity-emerald}"
    rounded: "{rounded.tag}"
    padding: "0 9px"
    height: "28px"
  tag:
    backgroundColor: "{colors.electric-indigo-soft}"
    textColor: "{colors.electric-indigo-strong}"
    rounded: "{rounded.tag}"
    padding: "0 9px"
    height: "28px"
  community-row:
    backgroundColor: "{colors.working-surface}"
    textColor: "{colors.graphite}"
    rounded: "0"
    padding: "10px 15px"
    height: "88px"
  community-row-selected:
    backgroundColor: "{colors.selected-surface}"
    textColor: "{colors.graphite}"
    rounded: "0"
    padding: "10px 15px"
    height: "88px"
---

# Design System: BuzzRouter

## Overview

**Creative North Star: "The Focused Community Workspace"**

BuzzRouter is a calm, information-dense developer workspace for choosing one community with confidence. A cool, subtly grained canvas holds flat white working planes; compact factual rows remain visible beside a persistent inspector, so browsing and evaluation feel like one continuous task rather than a sequence of promotional pages. The directory now opens with a premise band — a display-scale headline whose last words carry electric indigo, a hand-drawn marker underline that draws in on entry, and an animated "checked directly" probe diagram — before dropping immediately into the factual index.

The system is precise without becoming clinical. Graphite type, electric-indigo selection, written emerald activity, and crisp dividers create hierarchy; atmosphere lives entirely on the canvas layer (fractal-noise grain, faint dot grids, masked indigo and emerald glows behind the hero) and never inside working planes. Motion is a single quiet vocabulary — short rise-in entrances, staggered rows, fade-scale dialogs — fully gated by reduced-motion preferences. The binding BuzzRouter logo anchors the masthead and favicon.

**Key Characteristics:**

- Index and inspector remain visually connected on wide screens.
- Electric indigo identifies the current item, current route, the decisive action, and the hero's marked words.
- Activity and freshness are the metrics; there are no ratings, scores-as-stars, or charts anywhere.
- Texture (grain, dot grids, glows) belongs to the canvas and hero zone; working planes stay flat white.
- Compact Instrument Sans typography carries interface, content, and even SVG diagram labels.
- Verification and probe evidence appear only on the full profile and method pages, never on discovery rows.

## Colors

The palette is light-first and restrained: cool neutrals and graphite carry the workspace, electric indigo carries interaction and the hero's marked words, and semantic colors remain narrowly scoped.

### Primary

- **Electric Indigo:** The principal action, selection inset, active-route underline, marker underline, traveling route pulse, and directional affordance.
- **Strong Electric Indigo:** Hovered actions, links, high-contrast interactive text, and the hero's marked words.
- **Indigo Wash:** Tags, filter pills, selected access chips, and secondary hover states.
- **Selected Lavender Plane:** The full-width selected community row behind its 1px indigo inset rule.

### Secondary

- **Activity Emerald and Wash:** "Very active" status, verified receipts, and success language; the muted emerald variant carries plain "Active" status. Always paired with written status.
- **Caution Ochre and Wash:** Preview stamps, pending states, and Private access flags, always paired with explanatory text.
- **Danger Red:** The no-script boundary and error states.
- **Focus Violet:** The shared 3px keyboard focus outline.

### Neutral

- **Cool Canvas:** The grained application background around working surfaces.
- **Working Surface:** The masthead, command bar, index, inspector, dialogs, and content containers.
- **Muted Surface:** Column headers, evidence sections, access flags, index footer, and disabled surfaces.
- **Graphite:** Headings, primary copy, controls, and high-confidence values.
- **Reading Graphite:** Long-form inspector, dialog, and content-page prose (`#414958`).
- **Soft Ink:** Metadata, helper text, inactive navigation, timestamps, SVG diagram labels, and secondary labels.
- **Divider and Strong Divider:** Structural rules and editable-control boundaries.

### Named Rules

**The One Interaction Color Rule.** Electric indigo carries selection, navigation, links, action, and the hero's emphasis; semantic colors do not become general accents.

**The Written Status Rule.** Emerald, ochre, and red supplement explicit status language; color never carries meaning alone.

## Typography

**Display Font:** Instrument Sans (locally served variable 400–700, with ui-sans-serif fallbacks)

**Body Font:** Instrument Sans (same file; one face for everything)

**Character:** One crisp grotesk voice carries the display-scale premise headline, dense rows, controls, evidence, SVG diagram labels, and long explanations. Hierarchy comes from a wide size range (0.66rem utility text up to a 3.4rem display), firm weight, tabular numerals, and tightening negative tracking as size grows.

### Hierarchy

- **Display** (700, clamp 2.3–3.4rem, 1.04 line height, −0.04em): The directory premise headline; drops to 2.15rem at ≤680px. Carries the indigo offset text-shadow and marker-underlined final words.
- **Display Content** (700, clamp 2–3.4rem, 1.02, −0.035em): Profile, method, and submit page titles; also 2.15rem at ≤680px.
- **Headline** (700, fluid 1.35–1.6rem, 1.1): The inspected community's name; dialog headings sit just below at 1.25rem.
- **Title** (700, 1.08rem): Section-card headings and strong content labels.
- **Body** (400, 1rem, 1.5): General reading, fields, and content-page explanations.
- **Compact Body** (400–700, 0.73–0.98rem): Rows, inspector prose (0.84rem/1.55), navigation (0.91rem), buttons (0.87rem), and the hero standfirst (0.98rem). Reading prose is capped near 70–75ch.
- **Metric** (700, 1.65rem, tabular numerals): Inspector activity and freshness values.
- **Label** (600–660, 0.72–0.79rem): Column headings, filter prefixes, timestamps, and helper text.
- **Micro** (500–660, 0.66–0.68rem): Access flags (0.66rem), keyboard hints, and metric footnotes (0.68rem).
- **SVG Label** (620, 11px): Diagram captions inside the premise-band probe illustration.

The full enumerated interface ramp — every shipped step from 0.66rem to 2.15rem plus the 11px SVG label — is recorded as `typography.scale` in the frontmatter. The in-between steps (.76–.93rem interface band, 1.15–1.45rem headings, 2.15rem mobile display) are the compact band and mobile display steps of the shipped build, not drift.

### Named Rules

**The One Grotesk Rule.** Use Instrument Sans for the wordmark, interface, labels, metrics, diagram text, and reading copy; vary scale and weight instead of introducing a second typeface.

**The Clamped Weight Rule.** The stylesheet authors fine-grained weights (550, 620, 660, 690, 740, 760…), but the variable font spans 400–700 and `font-synthesis: none` is set, so 700 is the effective ceiling. Treat authored weights above 700 as 700; never enable synthetic bolding.

## Layout

The directory is a workspace beneath a premise. A sticky 62px masthead (translucent white at 86% with a 10px backdrop blur) holds the circular brand, a two-route nav (Discover, List a community), the command search, and the Preview stamp. Header, footer, and content shells cap at 1440px; the workspace shell runs nearly full width at 1512px; content pages cap at 1160px.

The premise band spans the workspace top: headline copy (max 17ch) beside a 330px animated probe SVG, over a masked glow-and-dot zone that bleeds past the band's edges. Below it, a 58px command bar (search-adjacent filters plus result count), then an access-chip rail (All / Public / Private, 40px pill chips), an active-filter strip when filters apply, and the primary split: an approximately 64/36 grid (minimum 680px index, minimum 390px inspector) inside one bordered white plane. Rows align Community, Focus, Activity, and Freshness with a trailing arrow; the inspector sticks below the masthead and scrolls independently. A three-column footer (brand, "How ranking works" summary with method link, Directory nav) closes every view over a faint dot grid.

The 4, 8, 12, 16, 24, 32, 48px spacing rhythm supports dense controls and readable sections; row and toolbar padding runs 10–20px, long-form cards 18–30px.

At 1180px the Freshness column and activity filter fall away while the split holds. At 920px the workspace becomes one column (index first, inspector immediately after), the probe SVG is dropped, and filters move to the dialog. At 680px the masthead wraps into brand/status, nav, and search rows; rows reduce to identity plus activity; the headline fixes at 2.15rem. At 380px insignias tighten to 44px and controls retain useful targets.

### Named Rules

**The Context Stays Put Rule.** Preserve the index while inspecting a community; wide layouts use a persistent side inspector, and narrow layouts place the inspector directly after the selectable list.

**The Evidence Lives Deep Rule.** Discovery surfaces (rows, inspector) show only access, activity, freshness, and focus; probe receipts, verification detail, and method mechanics appear only on the full profile and method pages.

## Elevation & Depth

Working planes are flat; the canvas is atmospheric. The body carries an SVG fractal-noise grain (opacity .05, 160px tile) over a 22px dot grid (graphite at 6.5%); the footer and empty/placeholder planes carry fainter 18px dot grids (3.5–4%); the premise zone layers soft indigo (15%) and emerald (9%) radial glows with a 17px indigo dot field, all masked to fade radially (the mask's `#000` stop is an alpha stop, not a rendered color). Index rows, the inspector, command bars, fields, and cards remain shadowless white; depth comes from dividers, surface shifts, sticky positioning, and the 1px inset selection rule. The masthead and dialog backdrop use blur, and dialogs alone cast a true shadow.

### Shadow Vocabulary

- **Headline Register** (`text-shadow: 5px 5px 0 rgb(86 87 242 / 13%)`): A crisp indigo offset behind the display headline only — a print-registration accent, never applied to boxes, cards, or buttons.
- **Selected Row** (`inset 0 0 0 1px var(--accent)`): Identifies the active community without lifting it.
- **Keycap** (`0 1px 1px rgb(17 19 24 / 7%)`): Gives keyboard hints a small physical edge.
- **Modal Overlay** (`0 24px 70px rgb(17 19 24 / 24%)`): Identifies a blocking dialog above its dark (48% graphite) backdrop.

### Named Rules

**The Flat Working Plane Rule.** Rows, inspectors, command bars, fields, and content cards stay shadowless at rest; only dialogs cast a box shadow, and the indigo offset exists solely as the display headline's text-shadow.

**The Textured Canvas Rule.** Grain, dot grids, and glows live on the canvas, hero zone, footer, and empty states; working planes stay flat white so facts stay legible.

## Shapes

Corners are gently rounded but never pillowy, on a two-band scale. The micro band handles inline details: 2px nav underlines, 4px keyboard hints, 5px access flags and search kbd, 6px tags and status labels. The structural band handles planes: 7px controls, buttons, and insignias; 10px workspace bands and content sections; 14px dialogs. Pills (999px) are reserved for access chips and active-filter summaries. Circular geometry belongs to the cropped brand logo, status dots, and the probe diagram's nodes and pulse rings.

Borders are structural: 1px cool dividers separate rows and sections; stronger lines define editable controls. The single illustrative stroke vocabulary — the hand-drawn marker underline and the dashed probe route — is round-capped SVG path work in indigo, never a border style.

### Named Rules

**The Precise Divider Rule.** Let 1px rules describe adjacency and reading order; rounded containers must not dissolve the index-and-inspector structure.

## Components

### Brand

The BuzzRouter logo is a binding identity asset, not a generic icon treatment.

- **Masthead:** `/assets/brand/buzzrouter-logo.png` at 34px beside the wordmark (30px at ≤680px); the footer brand repeats it at 28px.
- **Shape:** Preserve the circular 1:1 crop (`border-radius: 50%; object-fit: cover`).
- **Semantics:** The linked brand carries the accessible name; the logo image is decorative with empty alt.
- **Browser identity:** The same asset is the favicon.

### Premise Band (signature)

The directory's opening statement and the system's one illustrative moment.

- **Headline:** Display type with the final words in strong indigo inside an `em.premise-mark`, underlined by a 3.5px round-capped SVG marker stroke (85% opacity) that draws in over 700ms (300ms delay) on entry.
- **Diagram:** A 330px SVG — indigo BuzzRouter node with two staggered 2.8s pulse rings, a dashed route (strong-divider, 2 7 dashes) carrying a traveling indigo pulse (2.8s linear loop), and a white relay node with an emerald check. Labels are 11px Instrument Sans; the route caption uses strong indigo.
- **Entrance:** Copy rises in at 360ms, the diagram at 420ms with a 120ms delay; the zone glow sits behind at z-index −1 and never intercepts pointer events.
- **Responsive:** The diagram is dropped at ≤920px; the band keeps only copy.

### Buttons

Compact, direct, and procedural.

- **Shape:** 7px corners, 44px minimum height, 15px horizontal padding (12px at ≤380px).
- **Primary:** Indigo fill, white text; hover deepens to strong indigo, rises 1px, and nudges the trailing arrow icon 3px right.
- **Secondary:** White fill, strong-divider border, graphite text; hover shifts to indigo wash with indigo text.
- **Quiet:** Transparent with strong-indigo text for clearing and reversible actions.
- **Focus / Disabled:** All variants use the shared 3px violet outline offset 2px. Disabled buttons use muted surface, divider, soft ink, and no transform.

### Chips

- **Access Chip:** A 40px bordered white pill (All / Public / Private) in the rail under the command bar; hover borders indigo, `aria-pressed` fills with indigo wash and strong-indigo text.
- **Active Filter:** A 30px indigo-wash pill summarizing an applied query.
- **Access Flag:** A 0.66rem, 5px-radius muted flag ("Public") on rows, inspector, and profile; the Private variant uses the caution wash. Hidden on rows at ≤680px.
- **Status Label:** A 28px, 6px-radius semantic wash with explicit text — emerald for verified receipts, caution for pending/unclaimed, bordered neutral for factual notes; used only on profile and method surfaces.
- **Tag / Illustrative Label:** 6px-radius indigo-wash focus tags; the bordered muted "Illustrative data" label appears wherever example numbers do.

### Cards / Containers

- **Corner Style:** The workspace reads as one divided plane (10px outer radius at top and bottom bands); standalone section cards use 10px, evidence/method items 7px.
- **Background:** White for working content; muted surface for headers, evidence bands, and content-page bodies.
- **Shadow Strategy:** Flat at rest (see Elevation).
- **Border:** One continuous divider boundary with aligned internal rules.
- **Internal Padding:** 10–20px in the workspace; 18–30px on content pages.

### Inputs / Fields

- **Search:** A 46px white field with leading outline search icon, trailing ⌘K keycap, strong-divider border, 7px corners.
- **Command Filters:** 46px bordered label-plus-select groups with a quiet 0.79rem prefix and 600-weight value.
- **Form Fields:** 46px minimum (130px textareas), strong-divider borders, 7px corners, 0.77rem soft-ink labels, 0.73rem help text.
- **Focus:** The shared 3px focus-violet outline sits 2px outside every control.
- **Error:** Danger red plus a written message; the no-script banner is a danger fill.

### Navigation

The masthead exposes exactly two 44px routes: Discover and List a community. Default links are soft ink at 0.91rem; hover and current states use strong indigo, and the current route's 2px indigo underline fades and scales in (180ms). Ranking-method access lives in the footer's middle column as a one-line summary plus "Read the ranking method" link. At ≤680px the routes form their own horizontally scrollable row rather than hiding behind a menu.

### Community Index Row

The canonical discovery unit: insignia (48px, 7px radius), name with access flag, two-line description, then Focus, written Activity, Freshness, and a chevron. Rows are ≥88px, divider-separated, never detached cards, and never show ratings or probe detail. Hover uses muted surface and slides the chevron 2px; selection uses the lavender plane, 1px indigo inset, indigo chevron, and `aria-pressed`. On directory entry, rows rise in staggered 26ms apart (320ms each).

### Persistent Inspector

Sticky below the masthead, arriving with a 240ms rise on selection change. It keeps identity, access flag, and the Join action visible, then activity/freshness metrics (1.65rem tabular numerals with illustrative footnotes), focus tags, current work, evidence-and-limitations on a muted band, and a footer linking the full profile. Empty and placeholder states sit on faint dot grids.

### Dialogs

Native `<dialog>` elements: 14px radius, divider border, modal shadow, 48% graphite backdrop. Open animates a 220ms fade-scale (from 98%) with a matching backdrop fade. Filter, preview-explanation, and join-explanation dialogs share the pattern; headings pair a 1.25rem title with a 42px quiet icon-button close.

### Motion Vocabulary

One entrance grammar: `rise-in` (8–10px lift, 240–420ms, `cubic-bezier(.16, 1, .3, 1)`) for rows, inspector arrival, premise copy, and content pages; 26ms row stagger; 220ms dialog fade-scale; 180ms `cubic-bezier(.2, .8, .2, 1)` for all state transitions; slow 2.8s ambient loops confined to the probe diagram. `prefers-reduced-motion` collapses every duration to 0.01ms and zeroes animation delays.

## Do's and Don'ts

### Do:

- **Do** use the BuzzRouter logo in the masthead, footer, and favicon at its shipped circular proportions.
- **Do** open the directory with the premise band — indigo-marked final words, drawing marker underline, offset headline shadow, animated probe diagram — then drop straight into the factual index.
- **Do** keep texture on the canvas, hero zone, footer, and empty states, and keep index, inspector, dialogs, and cards flat white.
- **Do** keep the selected community and Join action visible while browsing; wide layouts pair index and inspector, narrow layouts stack them.
- **Do** pair every semantic color with plain-language status, keep activity and freshness as the only discovery metrics, and label illustrative data explicitly.
- **Do** gate every entrance, loop, and transition behind `prefers-reduced-motion`, including animation delays.
- **Do** retain 44px interactive targets and the shared 3px focus-violet outline on all controls.

### Don't:

- **Don't** show ratings, stars, or review counts anywhere; the shipped surfaces rank by activity and freshness only.
- **Don't** reintroduce a compare feature or a third masthead route; method access belongs to the footer.
- **Don't** surface probe receipts or verification mechanics on discovery rows or the inspector; they belong to the profile and method pages.
- **Don't** apply the indigo offset shadow to boxes, cards, or buttons; it exists only as the display headline's text-shadow.
- **Don't** add waveforms, sparklines, charts, or invented activity graphics; the probe diagram is the one sanctioned illustration.
- **Don't** generalize the logo's dark dimensional material into UI panels, or introduce dark-neon, glass, terminal, or Craigslist-derived styling.
- **Don't** use semantic emerald, ochre, or red as general-purpose emphasis.
