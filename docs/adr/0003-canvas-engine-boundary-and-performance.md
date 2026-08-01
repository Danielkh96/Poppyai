# ADR-0003: React Flow behind a project-owned canvas boundary

- Status: Accepted for M0 implementation
- Date: 2026-08-01

## Context

Phase 1 is a structured node/edge workspace, not a freehand whiteboard. It needs custom
source/chat cards, explicit context edges, selection, drag, pan, zoom, grouping, resize,
keyboard paths, and a fixed performance workload. Spreading a third-party canvas model
through persistence and domain code would make replacement, serialization, testing, and
security review costly.

## Decision

Use `@xyflow/react` v12 for the interaction engine. Only `packages/ui` may import React
Flow. Public project contracts use `CanvasNode`, `CanvasEdge`, `WorldPoint`, size,
viewport, and versioned operation types from `@siftloom/shared`; adapters map at the UI
boundary.

Keep geometry/selection, content, ingestion progress, and chat streaming in separate
normalized state. Define custom node/edge types outside render functions, memoize node
cards, use targeted selectors, and enable visible-element rendering. The semantic board
outline is a first-class non-spatial path, not a canvas-derived afterthought.

The M0 reference fixture is deterministic: 200 mixed nodes, 300 edges, one progress
state, one streaming state, 1440×900 viewport. Hardware-sensitive thresholds are
calibrated and documented rather than guessed in CI.

## Consequences

- React Flow types cannot enter API schemas, database JSON, or worker/provider packages.
- Library upgrades are localized but the adapter itself becomes critical code.
- React Flow's large-graph performance is not assumed; M2 repeats the baseline with real
  updates, drag, autosave, and a 15-minute soak.
- Full editor SSR is avoided; the interactive canvas is a client component.

## Alternatives rejected

- tldraw: strong freehand/full-whiteboard product, but broader editor model and commercial
  SDK licensing/version policy do not fit this structured Phase 1 default.
- A custom canvas engine: excessive accessibility, interaction, geometry, and browser
  risk for the MVP.

## Sources

- [React Flow documentation](https://reactflow.dev/learn)
- [React Flow common errors and performance guidance](https://reactflow.dev/learn/troubleshooting/common-errors)
