# M0 experience direction and wireframes

## Direction: Editorial Research Field

Siftloom should feel like a calm research desk, not a generic admin dashboard and not a
copy of Poppy AI. The canvas is warm paper; typography is deep ink; cobalt denotes the
primary action and selected context; coral is reserved for warnings and citation focus.
Cards carry a narrow source-type rail, readable status text, and provenance metadata.
Status is never communicated by color alone.

Design rules:

- The board occupies the primary viewport. Chat remains a wide `Synthesis` node on the
  board rather than taking over the application.
- Every AI answer exposes source chips and reference handles. “Source changed” is a
  visible state, not silently updated context.
- One dominant action per surface. Avoid glassmorphism, decorative gradients, floating
  widgets, and unrelated KPI cards.
- Use open-source/system sans for UI, a restrained editorial serif for major headings,
  and mono only for revisions/status metadata.
- Reduced motion disables non-essential animation. Keyboard users have a semantic board
  outline rather than being forced through spatial coordinates.

## 1. Sign in

```text
┌──────────────────────────────────────────────────────────────────────┐
│ Siftloom                                               Privacy · Help│
│                                                                      │
│  Arrange evidence.                 ┌───────────────────────────────┐ │
│  Keep the answer traceable.        │ Sign in to your workspace     │ │
│                                    │                               │ │
│  [source card] ───▶ [synthesis]    │ [ Continue with Google     ]  │ │
│                                    │ ─────────── or ─────────────  │ │
│  Private sources stay within       │ Email                         │ │
│  the workspace you authorize.      │ [_________________________]   │ │
│                                    │ [ Send secure sign-in link ]  │ │
│                                    └───────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

Errors name the recoverable next action without revealing whether another account owns
an email or resource. Password fields are not present in the private-alpha default.

## 2. Board index

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ Siftloom / Daniel's workspace        Search              [+ New board]   │
├───────────────┬──────────────────────────────────────────────────────────┤
│ ● Active  4   │ Boards                                                   │
│   Archived 2  │ ┌─────────────────┐ ┌─────────────────┐ ┌──────────────┐│
│               │ │ Launch research │ │ Creator themes  │ │ Untitled     ││
│ Recently      │ │ 23 nodes · saved│ │ 11 nodes · saved│ │ Empty        ││
│ opened        │ │ updated 12 min  │ │ updated Tue     │ │ just now     ││
│ ...           │ └─────────────────┘ └─────────────────┘ └──────────────┘│
└───────────────┴──────────────────────────────────────────────────────────┘
```

Empty, initial loading, retryable error, active, and archived states are separate real
paths. Archive/restore actions are idempotent and accessible from keyboard menus.

## 3. Empty board onboarding

```text
┌ Top bar: ← Boards | Untitled board | Saved | Undo | Zoom | Outline ┐
├───────┬─────────────────────────────────────────────────────────────┤
│ + Add │                                                             │
│ Note  │           Start with evidence                               │
│ File  │   [ Upload PDF/TXT ] [ Add webpage ] [ Write a note ]       │
│ URL   │                                                             │
│ Chat  │   Connect sources into a Synthesis node when ready.         │
│       │   Keyboard: press A to open Add. Outline: press O.           │
└───────┴─────────────────────────────────────────────────────────────┘
```

The first action is importing or writing a source—not opening a detached chatbot.

## 4. Desktop board

```text
┌ ← Boards │ Board name │ ● Saved │ ↶ ↷ │ 75% │ Fit │ Outline │ ⋯ ┐
├──────┬───────────────────────────────────────────────┬────────────┤
│ Add  │                                               │ Inspector  │
│ note │ [PDF]──────────────┐                          │            │
│ file │                    ├──▶ [Synthesis / Chat]    │ Title      │
│ web  │ [Web]──────────────┘                          │ Status     │
│ video│                                               │ Source     │
│ chat │       [Group: Audience evidence]              │ Revision   │
│      │                                               │ Actions    │
├──────┴───────────────────────────────────────────────┴────────────┤
│ Saving failed — edits are safe on this device. [Retry] [Details] │
└───────────────────────────────────────────────────────────────────┘
```

The right panel toggles between inspector and semantic outline. It never hides save
failure/conflict. Multi-select and drag are desktop conveniences; the outline supplies a
complete non-spatial selection path.

## 5. Import sheet and ingestion states

```text
┌ Add a source ──────────────────────────────────────────────────────┐
│ [File] [Webpage] [Public video] [Text]                              │
│                                                                    │
│ URL [https://____________________________________________] [Check] │
│                                                                    │
│ What happens: validate → fetch safely → extract → index → ready    │
│ Imported content is treated as untrusted data.                     │
│                                                   [Cancel] [Add]    │
└────────────────────────────────────────────────────────────────────┘

Node state: Validating → Queued → Processing 64% → Ready
                                  ↘ Ready with warning
                                  ↘ Failed: reason + Retry
```

An unsupported public transcript becomes an explicit `Transcript unavailable` state
with an upload-transcript/audio fallback; it is not represented as a generic failure.

## 6. Synthesis node

```text
┌ SYNTHESIS · connected context ─────────────────────────────────────┐
│ [S1 Research.pdf ×] [S2 Pricing page ×]  + choose once             │
├────────────────────────────────────────────────────────────────────┤
│ You: What should we validate first?                                │
│                                                                    │
│ AI: The strongest shared signal is measurable time saved... [S1]  │
│     Price sensitivity rises when migration is unclear... [S2]     │
│                                                                    │
│ Generating…  [Cancel]                                              │
├────────────────────────────────────────────────────────────────────┤
│ Ask only from connected sources…                         [Send ↑]  │
└────────────────────────────────────────────────────────────────────┘
```

Streaming deltas are visually temporary. On completion the client refetches the
canonical message and validated source handles.

## 7. Citation focus and changed source

```text
┌ Answer ───────────────────────┬ Source snapshot S1 ────────────────┐
│ ... measurable time [S1]      │ Research.pdf · page 14             │
│                               │ Exact text used on 2026-08-01      │
│                               │                                    │
│                               │ Source has changed since this run. │
│                               │ [View current] [Keep snapshot]      │
└───────────────────────────────┴────────────────────────────────────┘
```

A historic answer always points to its immutable generation snapshot. “View current” is
navigation, not retroactive replacement.

## 8. Save conflict and reapply

```text
┌ Conflict detected ─────────────────────────────────────────────────┐
│ This card changed in another tab after your last saved revision.   │
│                                                                    │
│ Canonical                          Your retained edit               │
│ “Enterprise teams...”             “Small research teams...”       │
│                                                                    │
│ [Reload canonical] [Copy my text] [Reapply my edit to latest]      │
└────────────────────────────────────────────────────────────────────┘
```

There is no silent merge and no last-write-wins. Unrelated node revisions do not create
a conflict.

## 9. Recently deleted

```text
┌ Recently deleted · retained 30 days ───────────────────────────────┐
│ Research.pdf       deleted 2 hours ago        [Preview] [Restore]  │
│ Pricing evidence   deleted 3 days ago         [Preview] [Restore]  │
└────────────────────────────────────────────────────────────────────┘
```

Restore revalidates all relationships. Incident edges return only when both endpoints
remain valid in the same authorized board.

## 10. Narrow mobile

```text
┌ Siftloom / Launch research ┐
│ Desktop is required to edit│
├────────────────────────────┤
│ Outline                    │
│ ▾ Audience evidence        │
│   PDF · Ready              │
│   Web · Processing 64%     │
│ ▾ Synthesis                │
│   [Open chat]              │
├────────────────────────────┤
│ Chat / sources / citations │
│ [Cancel] [Copy] [Retry]    │
└────────────────────────────┘
```

Narrow screens do not expose misleading partial drag/resize/connection controls.
