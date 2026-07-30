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
  activity-emerald-soft: "#e9f8f2"
  caution-ochre: "#8a5b00"
  caution-soft: "#fff5d6"
  danger-red: "#b42336"
  focus-violet: "#7957ff"
typography:
  display:
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
  label:
    fontFamily: "Instrument Sans, ui-sans-serif, sans-serif"
    fontSize: "0.72rem"
    fontWeight: 650
    lineHeight: 1.35
    letterSpacing: "normal"
  metric:
    fontFamily: "Instrument Sans, ui-sans-serif, sans-serif"
    fontSize: "1.65rem"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.025em"
rounded:
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
    typography: "{typography.compact-body}"
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
    typography: "{typography.compact-body}"
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
    padding: "0 12px"
    height: "46px"
  filter-chip:
    backgroundColor: "{colors.electric-indigo-soft}"
    textColor: "{colors.electric-indigo-strong}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0 10px"
    height: "30px"
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

BuzzRouter is a calm, information-dense developer workspace for choosing one community with confidence. A cool canvas holds white working planes; compact factual rows remain visible beside a persistent inspector, so browsing and evaluation feel like one continuous task rather than a sequence of promotional pages.

The system is precise without becoming clinical. Graphite type, electric-indigo selection, written emerald activity, and crisp dividers create hierarchy with almost no decorative depth. The binding BuzzRouter logo anchors the masthead and favicon, while the rest of the interface stays light, planar, and factual.

**Key Characteristics:**

- Index and inspector remain visually connected on wide screens.
- Electric indigo identifies the current item, current route, and decisive action.
- Activity appears as plain language with a small emerald dot, never as a decorative chart.
- Compact Instrument Sans typography carries both interface and content.
- White working planes and precise dividers do most of the structural work.
- The BuzzRouter logo appears as a circular brand asset in the masthead and browser identity.

## Colors

The palette is light-first and restrained: cool neutrals and graphite carry the workspace, electric indigo carries interaction, and semantic colors remain narrowly scoped.

### Primary

- **Electric Indigo:** The principal action, selection outline, active-route underline, and directional affordance.
- **Strong Electric Indigo:** Hovered actions and high-contrast interactive text.
- **Indigo Wash:** Tags, secondary hover states, and low-emphasis selected context.
- **Selected Lavender Plane:** The full-width selected community row behind its indigo inset rule.

### Secondary

- **Activity Emerald and Wash:** Current activity and successful or verified states, always paired with written status.
- **Caution Ochre and Wash:** Preview, pending, and incomplete states, always paired with explanatory text.
- **Danger Red:** Error and no-script boundaries.
- **Focus Violet:** The shared high-visibility keyboard focus outline.

### Neutral

- **Cool Canvas:** The application background around working surfaces.
- **Working Surface:** The masthead, command strip, index, inspector, dialogs, and content containers.
- **Muted Surface:** Column headers, evidence sections, supporting bands, and disabled surfaces.
- **Graphite:** Headings, primary copy, controls, and high-confidence values.
- **Reading Graphite:** Long-form inspector and content-page copy.
- **Soft Ink:** Metadata, helper text, inactive navigation, timestamps, and secondary labels.
- **Divider and Strong Divider:** Structural rules and editable-control boundaries.

### Named Rules

**The One Interaction Color Rule.** Electric indigo carries selection, navigation, links, and action; semantic colors do not become general accents.

**The Written Status Rule.** Emerald, ochre, and red supplement explicit status language; color never carries meaning alone.

## Typography

**Display Font:** Instrument Sans (locally served, with ui-sans-serif and sans-serif fallbacks)

**Body Font:** Instrument Sans (locally served, with ui-sans-serif and sans-serif fallbacks)

**Character:** One crisp grotesk voice keeps dense rows, controls, evidence, and longer explanations coherent. Hierarchy comes from compact size steps, firm weight, tabular numerals, and restrained negative tracking rather than a contrasting display face.

### Hierarchy

- **Display** (700, fluid 2–3.4rem, 1.02 line height): Secondary content-page titles only; the discovery workspace does not introduce a visible hero.
- **Headline** (700, fluid 1.35–1.6rem, 1.1 line height): The selected community and dialog headings.
- **Title** (700, about 1.08rem, compact line height): Section headings and strong content labels.
- **Body** (400, 1rem, 1.5 line height): General reading, fields, and content-page explanations.
- **Compact Body** (400–700, roughly 0.78–0.93rem): Index rows, inspector copy, navigation, and buttons.
- **Label** (600–700, roughly 0.68–0.79rem): Column headings, filter prefixes, timestamps, facts, and helper text.
- **Metric** (700, 1.65rem, 1.1 line height): Inspector rating and activity values, with tabular numerals.

### Named Rules

**The One Grotesk Rule.** Use Instrument Sans for brand wordmark text, interface, labels, metrics, and reading copy; vary scale and weight instead of introducing a second typeface.

**The Compact Hierarchy Rule.** Keep the workspace hierarchy shallow; large display type belongs to secondary content pages, not above the index.

## Layout

The discovery surface is a workspace, not a card grid. A sticky masthead is 62px tall on wide screens and contains the brand, short navigation, command search, and preview status. The workspace sits in a nearly full-width shell capped at 1512px, with a 58px command strip and an optional 30px filter-chip strip above the primary split.

At full width, the primary region uses an approximately 64/36 split: a minimum 680px community index and a minimum 390px inspector. Rows align Community, Focus, Activity, Freshness, and Rating in a compact factual grid; the selected inspector remains sticky below the masthead and scrolls independently when needed.

The 4, 8, 12, 16, 24, 32, and 48px spacing rhythm supports both dense controls and readable inspector sections. Most row and toolbar padding uses 10–20px, while long-form cards use 18–30px.

At 1180px, Freshness and one filter fall away while index and inspector remain side by side. At 920px, the workspace becomes one column: the index remains first and the selected inspector follows immediately, with filters moving to the existing dialog. At 680px, the masthead wraps into brand/status, navigation, and search rows; the index reduces to identity, activity, and direction. At 380px, insignias tighten but controls retain useful targets.

### Named Rules

**The Context Stays Put Rule.** Preserve the index while inspecting a community; wide layouts use a persistent side inspector, and narrow layouts place the inspector directly after the selectable list.

**The Facts Before Ornament Rule.** Use aligned columns, consistent row geometry, and dividers to make comparison effortless; do not replace factual density with cards or decoration.

## Elevation & Depth

The workspace is flat by default. Surface changes, divider strength, sticky positioning, and a 1px inset selection rule create nearly all depth. A tiny keycap shadow is acceptable as input affordance; cast shadows are otherwise limited to temporary viewport layers.

### Shadow Vocabulary

- **Selected Row:** A 1px inset electric-indigo rule identifies the active community without lifting it.
- **Keycap:** A 1px low-opacity graphite shadow gives keyboard hints a physical edge.
- **Comparison Tray:** A soft upward shadow separates the fixed shortlist from page content.
- **Modal Overlay:** A broad shadow and dark translucent backdrop identify a blocking dialog.

### Named Rules

**The Flat Working Plane Rule.** Index rows, inspectors, command bars, fields, and content cards stay shadowless at rest; only overlays and small physical key hints cast shadows.

## Shapes

Corners are gently rounded but never pillowy. Controls, buttons, insignias, and compact containers use 7px corners; workspace bands and content sections use 10px; dialogs use 14px. Pills are reserved for active-filter summaries. Circular geometry belongs to the cropped brand logo and small status dots.

Borders are structural. A single cool divider separates rows and inspector sections; stronger lines define editable controls. Selection uses an inset indigo rule over a lavender plane, not a thick tab or floating card.

### Named Rules

**The Precise Divider Rule.** Let 1px rules describe adjacency and reading order; rounded containers must not dissolve the index-and-inspector structure.

## Components

### Brand

The BuzzRouter logo is a binding identity asset, not a generic icon treatment.

- **Masthead:** Use `/assets/brand/buzzrouter-logo.png` at 34px beside the BuzzRouter wordmark on wide screens and 30px on small screens.
- **Shape:** Preserve the complete circular asset and its 1:1 aspect ratio; use a circular crop only as a safeguard.
- **Semantics:** The linked brand carries the accessible name, so the adjacent logo image is decorative with an empty alternative.
- **Browser identity:** Use the same asset as the favicon.

### Buttons

Buttons are compact, direct, and procedural.

- **Shape:** Gently rounded 7px corners with a 44px minimum height and 15px horizontal padding.
- **Primary:** Electric-indigo fill with white text; hover deepens to strong indigo and rises by 1px.
- **Secondary:** White fill, strong divider border, and graphite text; hover shifts to an indigo wash and indigo text.
- **Quiet:** Transparent with strong-indigo text for clearing or reversible actions.
- **Focus / Disabled:** All variants retain the 3px violet focus outline. Disabled buttons use muted surface, divider, soft ink, and no transform.

### Chips

- **Active Filter:** A 30px indigo-wash pill with strong-indigo text.
- **Focus Tag:** A 28px low-radius indigo-wash label inside the inspector.
- **Status Label:** A low-radius semantic wash with explicit status text; a small dot may precede activity language.

### Cards / Containers

- **Corner Style:** The main workspace reads as one divided plane; standalone content cards use 7–10px corners.
- **Background:** White for working content and muted surface for headers, evidence bands, and supporting zones.
- **Shadow Strategy:** Flat at rest.
- **Border:** One continuous divider boundary with aligned internal rules.
- **Internal Padding:** 10–20px in the workspace and 18–30px on secondary content pages.

### Inputs / Fields

- **Search:** A 46px white field with a leading outline search icon, trailing keyboard hint, strong divider, and 7px corners.
- **Command Filters:** A 46px bordered group with a quiet label prefix and bold current selection.
- **Focus:** The shared 3px focus-violet outline sits 2px outside the control.
- **Help / Error:** Help uses soft ink; errors use danger red plus a written message.

### Navigation

The masthead exposes three 44px routes. Default links use soft ink; hover and current states use strong indigo, and the current route gains a restrained 2px indigo underline. On small screens the routes move to their own horizontally scrollable row instead of hiding behind a menu.

### Community Index Row

The row is the canonical discovery unit: a community insignia and short identity block align with factual focus, activity, freshness, rating, and a direction arrow. Rows are 88px on wide screens, separated by dividers, and never become detached cards. Hover uses the muted surface; selection uses the lavender plane, a 1px indigo inset, and `aria-pressed`.

### Persistent Inspector

The inspector keeps community identity and the Join action visible together, then presents activity, rating, focus, current work, evidence, recommendation rationale, and facts in ruled reading order. The selected community remains in context; content is factual, written, and explicit about illustrative data.

## Do's and Don'ts

### Do:

- **Do** use the BuzzRouter logo in the masthead and favicon at its shipped circular proportions.
- **Do** keep the selected community and Join action visible in the first workspace view.
- **Do** preserve compact factual rows and the adjacent or immediately following inspector.
- **Do** pair activity color and dots with plain-language status and freshness.
- **Do** retain 44px interactive targets, visible focus, reduced-motion behavior, and non-color status cues.
- **Do** use indigo sparingly for current route, selection, links, tags, and decisive action.

### Don't:

- **Don't** generalize the logo’s dark dimensional material into UI panels, buttons, or container shadows.
- **Don't** turn the directory into promotional cards, a chart dashboard, or a social feed.
- **Don't** add waveforms, sparklines, decorative squiggles, or other invented activity graphics.
- **Don't** introduce dark-neon, glass, gradient, terminal, civic-ledger, or Craigslist-derived styling.
- **Don't** hide the inspector behind a route change when the index and selection can remain in context.
- **Don't** use semantic emerald, ochre, or red as general-purpose emphasis.
