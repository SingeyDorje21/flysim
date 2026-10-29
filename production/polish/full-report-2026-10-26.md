## Performance Profile: Full
Generated: 2026-10-26 (perf-profile methodology, applied by hand: the skill's `hooks/yaml-helper.sh` is not installed)

Budget enforcement: no `project.yaml` exists, so `performance.enforce` resolves to the default `warn` and no budgets are committed.

### Performance Budgets
| Metric | Budget | Measured | Status |
|--------|--------|----------|--------|
| Frame time | none set | Simulation ~0.01 ms/frame (Node micro-benchmark); wall-clock frame time not measurable (browser pane was hidden and throttled) | NOT ASSESSED — no budget, no unthrottled data |
| Memory | none set | ~55 MB JS heap in flight (Chromium, medium quality) | NOT ASSESSED — no budget |
| Load time | none set | Initial JS 1,413 kB (405 kB gz) before → 338 kB (106 kB gz) after | NOT ASSESSED — no budget (improved, see below) |
| Draw calls | none set | ~51 main-pass + ~20 shadow-pass draws, ~67k triangles per frame on the runway at medium | NOT ASSESSED — no budget |

### Measurements (CPU, Node / vitest)
| Path | Cost |
|------|------|
| `FlightSession.frame(1/60)` trainer / F-22 / A350 | 0.010 / 0.012 / 0.007 ms |
| `terrain.heightAt` | 0.002 ms |
| `buildChunk` L0 / L2 / L4 (in Web Workers) | 0.29 / 0.33 / 0.94 ms |
| `placeTreeTile` | 0.04 ms (time-budgeted per frame) |

### Hotspots Identified
| # | Location | Issue | Estimated Impact | Fix Effort |
|---|----------|-------|------------------|------------|
| 1 | `src/App.tsx` | three.js, R3F and the whole world were in the startup bundle | ~1.07 MB less JS before the menu is interactive | Done |
| 2 | `src/session/FlightCanvas.tsx` (`logarithmicDepthBuffer: true`) | Log depth writes `gl_FragDepth`, which disables early-Z for every fragment | Unknown, GPU-bound devices only | Needs investigation |
| 3 | `src/world/terrain/terrainStreamer.ts` `dispatch()` | Sorts the whole job queue every frame even when workers are saturated | Microseconds | Not worth it |

### Optimization Recommendations (Priority Order)
1. **Lazy-load the flight scene** — done. `FlightCanvas` is a dynamic import behind `Suspense`, prefetched 1.5 s after the menu loads.
2. **Reverse-Z instead of logarithmic depth** — three 0.186 supports `reverseDepthBuffer` where `EXT_clip_control` exists; keep log depth as the fallback. Risk: Med (z-fighting between runways and terrain if wrong). Verify on a visible, unthrottled browser first.

### Quick Wins
- None outstanding; CPU-side costs are far below anything a player could notice.

### Requires Investigation
- Real GPU frame time at high quality on a mid-range laptop (shadows 4096, dpr 2, 32 km terrain). Needs an unthrottled browser and a committed `performance.target_framerate`.
- The `THREE.Clock` deprecation warning comes from @react-three/fiber internals, not FlySim code.
