# Versioning & SemVer Policy

`mcp-context-optimizer` follows [Semantic Versioning](https://semver.org/)
(SemVer) for its public API and output formats.

## Version components

| Segment | Meaning |
| --- | --- |
| **Major** (`X`.0.0) | Breaking changes to public API, rendered text format, or report JSON shape |
| **Minor** (0.`Y`.0) | New features, new pipeline stages, new scoring signals, new options — backward compatible |
| **Patch** (0.0.`Z`) | Bug fixes, internal refactors, documentation changes — no API or output changes |

## Stability matrix

| Component | Stability | Change triggers |
| --- | --- | --- |
| Public TypeScript API (`src/index.ts`) | Stable | Minor |
| `ContextOptimizer` constructor options | Stable | Minor |
| `OptimizedContext` / `OptimizationReport` shape | Stable | Minor |
| Rendered context text format | Stable | Minor |
| MCP tool names & arguments | Stable | Minor |
| `PIPELINE_VERSION` constant | Internal | Patch (may change if pipeline output changes) |
| Scoring weight defaults | Internal | Patch (may change between releases) |
| `TokenEstimator` interface | Stable | Minor |
| CLI flags / exit codes | Stable | Minor |

## `PIPELINE_VERSION`

`PIPELINE_VERSION` is baked into the config hash so that cached results are
automatically invalidated when the pipeline changes. It is incremented whenever
a pipeline stage is added, removed, or modified in a way that affects output.

- Current: `1.1` (added Stage 3b text compaction)
- Format: `major.minor` string, independent of npm package version

## Pre-1.0 policy

We are currently in `0.1.x`. Until `1.0.0`:

- Breaking changes may ship in **minor** releases (e.g. `0.1.5` → `0.2.0`).
- Patch releases (`0.1.5` → `0.1.6`) are guaranteed to be backward compatible.
- Changelog entries will flag any breaking change explicitly.

After `1.0.0`:

- Breaking changes require a **major** version bump.
- Minor releases add features without breaking changes.
- Patch releases fix bugs only.

## Deprecation

Deprecated APIs are marked with JSDoc `@deprecated` and remain functional for
at least one minor release cycle before removal.

## Reporting version issues

If an upgrade produces different output for identical inputs, check:

1. `PIPELINE_VERSION` in the report's `configHash` — if it changed, the pipeline
   was modified and output differences are expected.
2. Release notes for the new version — look for "Breaking change" flags.
3. Your `TokenEstimator` — a different estimator changes token counts and can
   alter selection even with identical pipeline behavior.
