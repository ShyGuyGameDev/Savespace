# Design research: Waypoint UI/UX

Research date: 2026-11-10. Sources are linked inline. Where a source is a third-party write-up rather than the vendor's own docs, that is noted, and those claims are treated as a reasonable guide rather than gospel.

## 1. What I studied and what I took from each

### Raycast (palette)

- Raycast's stated principles are **fast, simple, delightful** ([Raycast blog: A fresh look and feel](https://raycast.com/blog/a-fresh-look-and-feel)).
- Every view shares the same layout: search field on top, a list of uniform rows, an action bar/footer showing the primary action and its shortcut ([rmoff: A love letter to Raycast](https://rmoff.net/2025/12/18/a-love-letter-to-raycast/)).
- Raycast's team built custom UI because AppKit defaults aren't keyboard-first ([console.dev Q&A](https://console.dev/qa/raycast-petr-nikolaev/)).
- Recurring visual traits (third-party analyses, [blakecrosley.com/guides/design/raycast](https://blakecrosley.com/guides/design/raycast)): compact uniform rows, a high-contrast selected row, hierarchy that favours recognition.

**Applied:** The Waypoint palette is a frameless floating window: one search field, a uniform row list, and a footer with `↵ Resume`, `⌘↵ Preview`, `⌘K Checkpoint now`, `esc`. The first row is pre-selected and arrow keys move the selection. It opens on a global hotkey, filters synchronously in memory (Fuse.js) so no network or DB round-trip happens on keystroke, and hides on blur.

### Linear (dashboard)

- Every action is reachable through a button, a shortcut, a context menu, or ⌘K search ([Linear docs: conceptual model](https://linear.app/docs/conceptual-model)).
- Shortcut hints appear inside menus and tooltips so people learn shortcuts while using the mouse ([Linear: invisible details / contextual menus](https://www.plushcap.com/content/linear/blog/linear-invisible-details-building-contextual-menus)).
- A three-column layout: collapsible sidebar, main list, detail pane ([925studios breakdown](https://www.925studios.co/blog/linear-design-breakdown-saas-ui-2026), third-party).
- Updates feel instant because they're optimistic and local-first ([dev.to: why Linear feels fast](https://dev.to/0xgosu/why-linear-feels-fast-local-data-small-updates-and-product-discipline-1m53)).

**Applied:** The dashboard is a three-column layout (projects sidebar → checkpoint timeline → checkpoint detail). Each control shows its shortcut in a tooltip (`<Kbd>`). `j`/`k` move through the timeline, `r` previews a restore, `⌘K` opens the palette, and `g s` jumps to Suggestions. Data is local SQLite, so TanStack Query reads are effectively instant. Optimistic updates are used for rename/confirm in Suggestions.

### Arc

- Arc's sidebar is the main navigation model: spaces and pinned items are kept separate from the transient ones. Its AppleScript API exposes windows, tabs, and spaces ([Arc AppleScript API](https://browserinc.notion.site/Arc-AppleScript-API-897272210c784627ba3925a7610b02b6)).

**Applied:** The sidebar has pinned ("confirmed") projects on top and the transient Suggestions inbox below with a count badge. Each project gets a soft colour accent, like an Arc space.

### Things 3

- Things' simplicity comes from constraints and restraint, with global Quick Entry (Ctrl+Space) as the always-available capture point ([blakecrosley: Things design study](https://blakecrosley.com/blog/design-study-things), third-party).

**Applied:** The global "Checkpoint now" hotkey works from anywhere, with no form: it captures immediately and shows a quiet toast you can click to reassign the project. Restraint is applied throughout: one accent colour, generous whitespace in detail views, and no decorative chrome.

### Superhuman

- Superhuman's UX drives toward a clear "done" state, keyboard-first ([consumerstartups: Superhuman of X](https://consumerstartups.substack.com/p/superhuman-of-x)).

**Applied:** The Suggestions inbox drives toward "Inbox zero": each suggestion has `c` confirm, `e` rename, `m` merge, `s` split, and `x` dismiss. When it's empty, it shows a calm "All caught up" state.

### Notion Calendar (ex-Cron)

- An obsessive focus on speed and shortcuts: `t` today, `/` command palette. The UI is minimal without feeling empty ([blakecrosley: Notion Calendar](https://blakecrosley.com/guides/design/notion-calendar), third-party).

**Applied:** The timeline groups checkpoints by Today / Yesterday / This week / Earlier, with `t` jumping to the newest.

### Apple HIG: menu bar extras, popovers, sidebars, vibrancy

- Popovers: keep them small, only big enough for their contents, and pointing at their origin. Let one click close one popover and open another. Consider letting people detach a popover into a window ([HIG: Popovers](https://developer.apple.com/design/human-interface-guidelines/popovers)).
- Menu bar extras are user-chosen and live in a 22pt-tall area. The icon should be a template image that works in light and dark menu bars ([HIG: The menu bar](https://developer.apple.com/design/human-interface-guidelines/the-menu-bar), [Bjango: Designing menu bar extras](https://bjango.com/articles/designingmenubarextras/)).
- Electron supports `vibrancy: 'popover' | 'sidebar' | 'menu' | 'under-window' ...` on macOS. On macOS a window's y can't sit above the menu bar, so position below the tray icon ([Electron BaseWindow options](https://www.electronjs.org/docs/latest/api/structures/base-window-options)). There's one vibrancy material per window, so the dashboard sidebar uses a CSS translucent layer over `under-window` vibrancy ([translucent sidebars in Electron](https://engineered.at/articles/translucent-sidebars-in-electron-apps)).

**Applied:**

- Tray: a monochrome template PNG (`trayTemplate.png` / `@2x`), so macOS tints it.
- Tray popover: 360×480 frameless `BrowserWindow`, `vibrancy: 'popover'`, `transparent`, positioned centred under the tray icon (clamped to the display's work area), and hidden on blur. It shows the current suggested project, a "Checkpoint now" button, the last three projects with Resume, and an "Open dashboard" link (the "detach" affordance).
- Dashboard: `titleBarStyle: 'hiddenInset'`, `vibrancy: 'sidebar'`, and the sidebar is transparent so the native material shows through. The content pane is opaque `bg-background`.
- Palette: frameless, `vibrancy: 'popover'`, rounded 12px, centred on the active display at about 1/3 height.

### Onboarding and permission flows (well-regarded macOS utilities)

- Show your own explainer _before_ the system prompt, at first launch or just before the first feature that needs it. Deep-link to the exact System Settings pane with `x-apple.systempreferences:`. Re-poll status after the user returns, because TCC caches unpredictably. Grants are tied to the code signature, so ad-hoc/unsigned builds may lose grants between rebuilds ([OpenClaw mac permissions doc](https://cdn.jsdelivr.net/npm/openclaw@2026.6.9/docs/platforms/mac/permissions.md), [PermissionPilot](https://swiftpackageregistry.com/arpitagarwal1301/PermissionPilot); community practice, not Apple guidance).

**Applied:** Onboarding is a five-step stepper:

1. Welcome: what Waypoint does, and the open-only promise in one sentence.
2. Privacy: what's captured (metadata) vs. never captured (contents, screenshots, keystrokes).
3. Accessibility: why ("to read window titles and, only if you turn it on, arrange windows"), what works without it, then the button "Open System Settings". Status is polled every 1.5s while the window is focused.
4. Automation: why ("to ask Chrome/Safari/Mail which tabs/drafts are open, read-only"). This is requested per app lazily the first time an adapter needs it, with an "Ask now for apps I use" button that triggers a harmless read-only probe for each installed scriptable app.
5. Local AI (built in): the RAM-appropriate model starts downloading automatically with a progress bar; the user can continue while it finishes.

Every step has "Skip for now", and the Privacy center later shows each permission's state with a "Fix" button.

## 2. Cross-cutting decisions

| Concern            | Decision                                                                                                                                                                                                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Keyboard-first     | Every action has a shortcut. `?` opens a shortcut sheet. Focus is always visible (`focus-visible:ring-2 ring-ring`). Palette and inbox are fully operable with the keyboard alone.                                                                                                         |
| Instant palette    | Data is preloaded in the renderer. Fuse.js fuzzy search runs over project names, aliases, and recent resource titles with threshold 0.35. No async work per keystroke. The window is pre-created hidden so showing it takes about 16ms.                                                    |
| Light/dark         | Tailwind v4 CSS variables with shadcn tokens. `prefers-color-scheme` drives `.dark`, and `nativeTheme.themeSource = 'system'`.                                                                                                                                                             |
| Reduced motion     | Framer Motion `MotionConfig reducedMotion="user"`, plus CSS `@media (prefers-reduced-motion)` disables transitions.                                                                                                                                                                        |
| Accessibility      | Radix primitives (via shadcn) give ARIA roles. The palette uses the `combobox`/`listbox` pattern with `aria-activedescendant`. Live region announcements for restore progress. All icons have `aria-label` or are `aria-hidden`. Contrast targets WCAG AA.                                 |
| Empty states       | Each list has a purposeful empty state with one action: "No projects yet — Waypoint is watching for patterns. Check Suggestions in a few minutes." / "No checkpoints — press ⌥⌘S to save one now."                                                                                         |
| Restore UX         | **Preview restore** lists every item grouped by app with its intended action (open / focus existing / skip because excluded). On confirm, a live per-item result list shows ✓ Opened, ↺ Already open, – Skipped, ✕ Failed, each with a reason. A Cancel button stops before the next item. |
| Typography/density | System font stack (`-apple-system, BlinkMacSystemFont`), 13px base in dense lists (macOS-native density) and 14px in detail.                                                                                                                                                               |
| Motion             | 120–180ms ease-out for the popover/palette fade+scale (0.98→1). There are no bouncy springs on data.                                                                                                                                                                                       |
