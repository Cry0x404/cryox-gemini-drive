---
name: Cryox Drive
description: A dense local encrypted vault interface with a dark operational rail and quiet mineral workspace.
colors:
  rail: "#171b1a"
  rail-elevated: "#202624"
  canvas: "#f2f3f0"
  surface: "#ffffff"
  ink: "#18201d"
  muted: "#56615c"
  line: "#d4d9d2"
  oxide: "#dd5c36"
  success: "#2f7d5a"
typography:
  title:
    fontFamily: "Aptos, Segoe UI Variable, Segoe UI, sans-serif"
    fontSize: "36px"
    fontWeight: 720
    lineHeight: 1.08
    letterSpacing: "-0.03em"
  body:
    fontFamily: "Aptos, Segoe UI Variable, Segoe UI, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "Aptos, Segoe UI Variable, Segoe UI, sans-serif"
    fontSize: "12px"
    fontWeight: 700
rounded:
  xs: "5px"
  sm: "7px"
  md: "10px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "18px"
  lg: "28px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.surface}"
    rounded: "{rounded.sm}"
    height: "44px"
  sidebar-upload:
    backgroundColor: "{colors.oxide}"
    textColor: "{colors.surface}"
    rounded: "{rounded.sm}"
    height: "42px"
---

# Design System: Cryox Drive

## Overview

**Creative North Star: "Encrypted Workbench"**

Cryox Drive should feel like a serious local utility: dark operational chrome around a light, readable work surface. Gemini remains infrastructure rather than the visual subject. Information density is moderate, controls are familiar, and permanent surfaces remain flat.

The interface earns visual character from contrast between the dark rail, mineral neutral workspace, restrained oxide accent, and precise file-table structure. Decoration is rejected unless it communicates state, action, or storage behavior.

**Key Characteristics:**
- Dark operational sidebar with a quiet light workspace.
- Conventional file-manager interaction patterns.
- Oxide accent reserved for upload and small brand signals.
- Decoration is limited to elements that communicate state or action.
- Dense metadata and explicit status over empty ornament.

## Colors

The palette is mineral and slightly warm rather than pure black, white, or neutral gray.

### Primary
- **Oxide:** Used for the high-intent upload action and the wordmark separator.

### Neutral
- **Rail:** Persistent navigation and connection chrome.
- **Canvas:** Main application ground.
- **Surface:** File browser, dialogs, and controls.
- **Ink:** Primary text and dominant actions.
- **Muted:** Supporting metadata and descriptions.
- **Line:** Structural borders and separators.

**The Rare Accent Rule.** Oxide marks actions or brand identity; it is not a decorative page color.

## Typography

**Body Font:** Aptos with Segoe UI Variable and Segoe UI fallbacks.
**Label/Mono Font:** Cascadia Code with platform monospace fallbacks for commands and compact technical metadata.

**Character:** Neutral, compact, and operational. Typography should disappear into file-management tasks rather than perform as display branding.

### Hierarchy
- **Page title:** 36px, 720 weight, compact negative tracking.
- **Section title:** 15px, 720 weight.
- **Body:** 14–15px.
- **Metadata:** 12–13px with strong contrast against its surface.

**The Product-Type Rule.** Fixed sizes only. No fluid display typography inside the application shell.

## Layout

Desktop uses a fixed dark rail and a flexible workspace capped at 1500px. Navigation, connection state, and upload initiation stay in the rail. Search, sync, and page-level commands stay in the sticky command bar. File content occupies a single primary browser surface.

At medium widths the rail collapses to icons. At narrow widths it becomes a compact top bar, metadata columns collapse, and actions retain touch-sized targets.

**The One Primary Surface Rule.** The file browser is the dominant content surface. Supporting information appears as strips, separators, or utility regions rather than nested cards.

## Elevation & Depth

Permanent surfaces use borders and tonal separation, not shadows. Shadows are reserved for overlays that physically leave the document flow: context menus, dialogs, and upload progress.

**The Flat-By-Default Rule.** If an element does not float, it does not receive a shadow.

## Shapes

Controls use compact 5–10px radii. Pills are limited to small counters. File icons remain unboxed. Large rounded marketing shapes are not part of the application language.

## Components

- **Sidebar navigation:** stable, left-aligned, stateful, and compact.
- **Search:** visible keyboard shortcut, familiar input behavior, no decorative icon container.
- **File browser:** conventional table semantics with row hover, keyboard download, context actions, and responsive column collapse.
- **Empty state:** teaches encryption, recovery, and local boundaries while keeping upload or session setup as the clear next action.
- **Session setup:** native dialog with explicit credential handling guidance and a copyable local command.
- **Upload progress:** floating operational panel with state-driven progress only.

## Do's and Don'ts

- Do make connection state obvious without dominating the page.
- Do use familiar file-manager affordances.
- Do keep all product copy in English.
- Do reserve the accent for high-intent actions and small identity marks.
- Do show useful security and availability metadata.
- Do not use decorative effects that compete with file-management tasks.
- Do not add fake storage quotas, fake activity, or navigation that has no behavior.
- Do not use oversized icon tiles, giant empty cards, or ornamental hero metrics.
- Do not hide session-cookie risk behind vague wording.
