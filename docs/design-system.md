# Interface system

The normative interface specification is maintained in the repository root as `DESIGN.md`. Product truth and non-visual constraints are maintained separately in `PRODUCT.md`.

Cryox Drive uses an "Encrypted Workbench" direction: a dark operational rail, a quiet mineral workspace, one primary file-browser surface, restrained oxide action color, and conventional file-manager behavior.

The interface keeps permanent surfaces flat and reserves stronger visual treatment for state, focus, and transient overlays.

## Interaction rules

- Upload, search, synchronization, file filtering, sorting, download, and local removal remain directly accessible.
- Keyboard focus is visible on every interactive control.
- File rows support Enter to download.
- `Ctrl+K` focuses vault search and `Ctrl+U` opens upload when a valid session is available.
- Context menus are attached to the viewport rather than clipped inside the file surface.
- Loading uses skeleton rows to avoid presenting an incorrect empty state while data is still being read.
- Session setup uses a native dialog because credential setup is a focused workflow with explicit security guidance.

## Responsive rules

The full navigation rail is retained while there is enough horizontal space for labels. It collapses to an icon rail at medium widths and becomes a top bar on narrow screens. File metadata columns are removed progressively instead of converting each row into an unrelated card design.
