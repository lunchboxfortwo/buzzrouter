---
name: BuzzRouter
description: A restrained, evidence-backed directory for finding Buzz communities.
colors:
  canvas: "#f5f6f8"
  surface: "#ffffff"
  surface-muted: "#fafbfc"
  surface-selected: "#efefff"
  ink: "#111318"
  reading-ink: "#414958"
  ink-soft: "#667085"
  ink-faint: "#667085"
  line: "#dfe2e8"
  line-strong: "#c9ced8"
  accent: "#5657f2"
  accent-strong: "#4445d8"
  accent-soft: "#efefff"
  positive: "#087c5b"
  positive-soft: "#e8f7f1"
  verified-border: "#b6dfcf"
  caution: "#8a5b00"
  caution-soft: "#fff5d6"
  caution-border: "#ead59f"
  focus: "#7957ff"
  error: "#9d2b22"
  error-soft: "#fff3f2"
  error-border: "#f0c9c4"
typography:
  display:
    fontFamily: "Instrument Sans, ui-sans-serif, sans-serif"
    fontSize: "34px"
    fontWeight: 680
    lineHeight: 1.12
    letterSpacing: "0"
  headline:
    fontFamily: "Instrument Sans, ui-sans-serif, sans-serif"
    fontSize: "22px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0"
  title:
    fontFamily: "Instrument Sans, ui-sans-serif, sans-serif"
    fontSize: "18px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0"
  body:
    fontFamily: "Instrument Sans, ui-sans-serif, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "0"
  control:
    fontFamily: "Instrument Sans, ui-sans-serif, sans-serif"
    fontSize: "13px"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "0"
  label:
    fontFamily: "Instrument Sans, ui-sans-serif, sans-serif"
    fontSize: "11px"
    fontWeight: 650
    lineHeight: 1.35
    letterSpacing: "0"
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: "0"
  scale:
    "0-66": "0.66rem"
    "0-68": "0.68rem"
    "0-72": "0.72rem"
    "0-73": "0.73rem"
    "0-74": "0.74rem"
    "0-76": "0.76rem"
    "0-77": "0.77rem"
    "0-78": "0.78rem"
    "0-79": "0.79rem"
    "0-8": "0.8rem"
    "0-82": "0.82rem"
    "0-84": "0.84rem"
    "0-85": "0.85rem"
    "0-86": "0.86rem"
    "0-87": "0.87rem"
    "0-88": "0.88rem"
    "0-9": "0.9rem"
    "0-91": "0.91rem"
    "0-92": "0.92rem"
    "0-93": "0.93rem"
    "0-98": "0.98rem"
    "1": "1rem"
    "1-05": "1.05rem"
    "1-08": "1.08rem"
    "1-15": "1.15rem"
    "1-2": "1.2rem"
    "1-25": "1.25rem"
    "1-35": "1.35rem"
    "1-45": "1.45rem"
    "1-6": "1.6rem"
    "1-65": "1.65rem"
    "2-15": "2.15rem"
    "2-3": "2.3rem"
    "3-4": "3.4rem"
    "11px": "11px"
    "16px": "16px"
    "28px": "28px"
rounded:
  hairline: "2px"
  tag: "4px"
  chip: "5px"
  control: "6px"
  circle: "50%"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  2xl: "32px"
  3xl: "48px"
  4xl: "56px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.surface}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "9px 14px"
  button-procedural:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.surface}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "38px"
  control-field:
    backgroundColor: "{colors.surface-muted}"
    textColor: "{colors.ink}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "0 11px"
    height: "38px"
  category-tag:
    backgroundColor: "{colors.surface-muted}"
    textColor: "{colors.ink-soft}"
    typography: "{typography.label}"
    rounded: "{rounded.tag}"
    padding: "0 5px"
    height: "18px"
  community-row:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "0"
    padding: "11px 13px"
    height: "76px"
  community-row-selected:
    backgroundColor: "{colors.surface-selected}"
    textColor: "{colors.ink}"
    rounded: "0"
    padding: "11px 13px"
    height: "76px"
  community-logo:
    backgroundColor: "{colors.surface-muted}"
    textColor: "{colors.reading-ink}"
    rounded: "{rounded.control}"
    width: "40px"
    height: "40px"
---

# Design System: BuzzRouter

## Overview

**Creative North Star: "The Precise Community Index"**

BuzzRouter is a quiet, information-dense discovery tool. It should feel closer to
Linear or GitHub than to a marketing site: flat working surfaces, compact controls,
clear selection, and factual copy. The first viewport is the real directory, not a
hero or feature explanation.

The public directory in `app/page.tsx` and `app/directory.module.css` is the
canonical visual source. The Submit and Connect routes follow the same masthead,
palette, type, control, and panel language. Internal-review routes currently use
older GitHub-neutral variants; new public work should converge toward the
canonical directory system rather than extend those variants.

**Key Characteristics:**

- A restrained cool-gray canvas around flat white working planes.
- One compact Instrument Sans voice across headings, controls, rows, and metadata.
- Indigo reserved for selection, navigation state, links, and primary actions.
- Emerald reserved for explicit verified or success states.
- One-line community purpose and category visible directly in every useful row.
- Logos are treated as data, not decoration; monograms remain valid fallbacks.
- Verification detail stays in the selected inspector instead of becoming a
  standalone promotional section.

## Colors

The palette is light-first and neutral. Most of the interface is white, cool gray,
graphite, and dividers; indigo and emerald appear only where they communicate state
or action.

### Primary

- **Action Indigo** (`#5657f2`): Active-route underline, selected-row inset, links,
  and the primary join action.
- **Strong Indigo** (`#4445d8`): High-contrast indigo text and the selected
  inspector monogram.
- **Selected Wash** (`#efefff`): Current community row and selected identity
  surfaces.

### Secondary

- **Verified Emerald** (`#087c5b`): Live-index, verified, admitted, and success
  language. Always pair it with written text.
- **Verified Wash** (`#e8f7f1`): Success and verified-status backgrounds.
- **Error Red** (`#9d2b22`): Submission failures and validation errors, paired
  with `#fff3f2` and an explicit message.
- **Caution Amber** (`#8a5b00`): Pending and attention states, paired with
  `#fff5d6` and explicit next-step copy.

### Neutral

- **Canvas** (`#f5f6f8`): Page background around working surfaces.
- **Surface** (`#ffffff`): Masthead, controls, result list, inspector, and form
  panels.
- **Surface Muted** (`#fafbfc`): Inputs, selects, low-emphasis hover states,
  monograms, and category/evidence tags.
- **Surface Selected** (`#efefff`): The current community row and selected
  identity surfaces.
- **Ink** (`#111318`): Headings, names, controls, and strong values.
- **Reading Ink** (`#414958`): Descriptions and longer factual copy.
- **Ink Soft** (`#667085`): Metadata, labels, timestamps, and helper copy.
- **Line** (`#dfe2e8`) / **Line Strong** (`#c9ced8`): Structural boundaries; the
  strong step for emphasized dividers.

### Named Rules

**The Sparse Accent Rule.** Indigo identifies interaction and selection. Do not use
it as general decoration or tint entire page sections.

**The Written Status Rule.** Semantic color supplements plain-language status;
color never carries verification, success, or error meaning alone.

## Typography

**Display Font:** Instrument Sans, with system sans-serif fallbacks.

**Body Font:** Instrument Sans, with system sans-serif fallbacks.

**Label/Mono Font:** The platform monospace stack, reserved for relay URLs and
technical identifiers.

**Character:** A single crisp grotesk supports both dense operational UI and short
reading copy. Hierarchy comes from size and weight, never condensed styles,
negative letter spacing, or decorative font changes.

### Hierarchy

- **Display** (680, 34px, 1.12): Public directory and submission page titles.
- **Headline** (700, 22px, 1.2): Selected community and compact page headings.
- **Title** (700, 18-20px, 1.2): Brand wordmark, empty states, and section titles.
- **Body** (400, 14-15px, 1.5-1.6): Descriptions, helper text, and short
  explanatory copy.
- **Control** (600-650, 13-14px): Buttons, select values, row names, and
  navigation.
- **Label** (600-700, 11-12px, 1.35): Field prefixes, metrics, tags, timestamps,
  and evidence metadata.
- **Mono** (600, 12px, 1.5): Technical identifiers only.

### Named Rules

**The One Grotesk Rule.** Use Instrument Sans for canonical public surfaces and
system sans-serif only as fallback. Do not add a display face.

**The Zero Tracking Rule.** Letter spacing is `0` across the system. Do not tighten
large headings or widen uppercase labels.

## Layout

The sticky masthead is 60px high on wide screens and contains the circular logo,
wordmark, three single-word routes (`Discover`, `Connect`, `List`), and an optional
live-index status. Search appears only on Discover. Its inner shell is capped at
1320px.

The directory intro shares the 1320px shell. It pairs a compact title and
standfirst with two factual totals. The control bar and workspace cap at 1272px.
Search, sort, category, Apply, and result count remain in one bordered row when
space allows.

The primary workspace is a two-column grid with an 18px gap:

- Result list: minimum 420px, compact 76px rows.
- Detail inspector: minimum 460px, sticky 78px below the viewport top.

At 920px the workspace becomes one column and the inspector follows the list. At
680px the masthead wraps into a brand/status row plus one-line navigation;
controls stack vertically; result evidence metadata hides; and fact cells become
a single column. Mobile layouts keep 16px page margins and never introduce
horizontal scrolling.

Use the 4, 8, 12, 16, 24, 32, 48, and 56px rhythm. Tight row internals may use
6-14px values when needed for alignment, but page-level spacing should remain on
the primary rhythm.

### Named Rules

**The Context Stays Visible Rule.** Preserve the result list while inspecting a
community. Wide screens use a sticky side inspector; narrow screens place it
directly after the results.

**The Real Product First Rule.** The directory, controls, and current data occupy
the first screen. Do not prepend a marketing hero, feature cards, or a verification
explainer.

## Elevation & Depth

BuzzRouter is flat by default. Working surfaces use white fills and 1px dividers
instead of ambient shadows. The selected result is identified by a pale indigo
surface and a 2px inset rule. Sticky positioning creates functional depth without
visual lift.

### Named Rules

**The Flat Working Plane Rule.** Result lists, inspectors, command bars, fields,
and form panels stay shadowless.

## Shapes

Structural sections are rectangular and defined by borders. Controls, logos, tags,
and actions use a tight two-step radius:

- 4px for category, evidence, and status tags.
- 6px for fields, buttons, monograms, and community logos.
- 50% only for the BuzzRouter brand mark and semantic status dots.
- 999px only for established status or category pills on auxiliary profile routes.

Cards do not float, nest, or use large soft corners. A result list is one continuous
plane with divider-separated rows.

## Components

### Branded Masthead

- 60px high on wide screens, white at 96% opacity, with a 1px bottom divider.
- BuzzRouter logo at 32px with its original circular crop.
- Wordmark at 18px and 700 weight.
- Navigation at 14px and 600 weight; current route gets a 2px indigo underline.
- Exactly three public routes: `Discover`, `Connect`, and `List`.

### Buttons

- **Primary join action:** Indigo fill, white text, 6px radius, compact
  `9px 14px` padding.
- **Procedural action:** Graphite fill, white text, 6px radius, 38-42px height.
  Use for Apply, Queue verification, and other direct form commands.
- **Secondary action:** Text link in indigo with no enclosing decorative pill.
- **Focus:** Preserve a clearly visible browser or explicit focus outline.

### Inputs and Selects

- Field surface `#fafbfc`, 1px divider border, 6px radius.
- Directory controls are 38px high; submission fields are 42px high.
- Labels are 11-12px, muted, and uppercase only where the current command bar
  requires compact prefixes.
- Search copy describes discoverable attributes: name, description, or category.
  Relay-host search is not part of the public discovery model.

### Category and Evidence Tags

- Muted surface, divider border, muted text, and 4px radius.
- Category tags are factual labels, not promotional badges.
- Use the primary category in a result row and the complete bounded set in the
  inspector.

### Community Result Row

- 76px minimum height, 40px logo or monogram, one-line name, optional primary
  category, and one-line purpose.
- Verification and evidence count align on the trailing edge at wide widths.
- Hover uses the field surface.
- Selection uses the indigo wash and a 2px inset rule.
- The row never shows the raw relay host as its secondary discovery label.
- At mobile widths, hide trailing evidence metadata before truncating the purpose.

### Community Logo

- 40px in rows and 54px in the inspector, 6px radius, `object-fit: cover`.
- Display first-party cached raster bytes only.
- Use the uppercased first character as the deterministic fallback.
- Do not hotlink remote icons or render relay-provided SVG.

### Persistent Detail Inspector

- Flat white surface with a 1px divider border and 24px padding.
- Identity, canonical relay URL, description, categories, and join action appear
  first.
- A 2x2 fact grid exposes last verification, handshake, evidence count, and access.
- Discovery evidence and protocol profile follow as compact factual sections.
- The inspector exposes technical verification, not ownership or listing-edit
  controls.

### Submission Panel

- Maximum 920px page shell and 650px introduction width.
- One flat bordered form panel with 28px desktop padding and 16px mobile padding.
- Status messages appear above the form and always include explicit success or
  error copy.
- The three intake facts form columns on wide screens and stacked divider rows on
  mobile.

## Do's and Don'ts

### Do:

- **Do** show a one-line purpose and useful category directly in result rows.
- **Do** keep search focused on names, descriptions, and category tags.
- **Do** use first-party cached relay logos with monogram fallbacks.
- **Do** keep trust evidence factual and separate from future popularity signals.
- **Do** preserve flat planes, tight radii, crisp dividers, and compact controls.
- **Do** keep all text within stable responsive grids at desktop and mobile widths.
- **Do** pair semantic colors with explicit written status.

### Don't:

- **Don't** add ratings, stars, popularity labels, or activity claims before the
  required telemetry exists.
- **Don't** add a Verification route or promotional verification section.
- **Don't** use relay hosts as the primary public search model or row description.
- **Don't** reintroduce the old animated premise, probe illustration, textured
  canvas, dot grids, glow fields, or decorative motion.
- **Don't** turn sections into floating rounded cards or nest cards inside cards.
- **Don't** add gradients, dark-neon crypto styling, glass surfaces, token
  dashboards, or generic marketing heroes.
- **Don't** apply large type, shadows, or accent color to compact operational
  surfaces.
