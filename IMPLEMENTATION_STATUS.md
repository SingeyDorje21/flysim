# Implementation Status

_Last updated: Phase 4 complete (verification + audit fixes)._ Spec: [SPEC.md](SPEC.md) (reconstructed - original not found).

## Stack (pinned)
Vite 8.3.5, React 19.3.1, TypeScript 6.0.3 (TS 7 is incompatible with typescript-eslint 8.72),
three 0.186.1, @react-three/fiber 9.8.2 (no drei), zustand 5.0.15, Vitest 5.0.5, jsdom 30, ESLint 10.

## File ownership
| Area | Owner | Paths |
| --- | --- | --- |
| Shared contracts | Orchestrator | `src/simulation/types.ts`, `src/config/{aircraftGeometry,world,quality}.ts`, `src/world/types.ts`, `src/game/{types,modes,courses}.ts`, `src/state/*` |
| Integration | Orchestrator | `src/App.tsx`, `src/main.tsx`, `src/session/**`, `src/input/**`, `src/game/challenges.ts`, `src/world/terrain/terrainGrid.ts` |
| Physics | Agent A (Opus, high) | `src/simulation/**` (except types.ts), `src/config/aircraft.ts` |
| World | Agent B (Sonnet, medium) | `src/world/**` (except types.ts) |
| UI | Agent C (Sonnet, medium) | `src/components/**` |
| QA | Agent D (Sonnet, medium) | `src/state/__tests__/**`, `src/__tests__/**`, `QA_CHECKLIST.md` |

## Key decisions
- World/body frames follow three.js (Y up, nose = -Z); the renderer copies the pose with no conversion.
- Fixed 1/120 s physics step driven from an R3F `useFrame` at priority -1; render pose is interpolated.
- Telemetry is a separate ~30 Hz external store (`useTelemetry`); zustand holds only low-frequency state.
- The canvas stays mounted between restart and results; restart resets the session in place (`flightId`).
- The simulation is frozen while paused, while an overlay is open, or on the results screen.
- **What you see is what you hit:** physics, trees and cameras sample the same triangulated grid as the
  drawn terrain mesh at the current quality (`terrainGrid.ts`); quality changes swap the physics sampler.
- Persisted settings and scores are validated on load.

## Verification (latest run)
- `npm run typecheck`, `npm run lint`: clean. `npm test`: 14 files, 170 tests passing. `npm run build`: OK (1.23 MB JS, 342 kB gzip).
- Session integration tests fly a scripted take-off, landing and the full ring course (263 s of the
  360 s limit) to challenge success on the real terrain, plus crash reporting, pause freeze and reset.
- Ring radius widened 20 m -> 30 m: with 20 m the scripted pilot missed rings and ran out of time.
- Browser (dev server): menus, mode select, flight, pause, settings/quality switch, controls, results,
  restart and chase/cockpit/free cameras checked. The only console warning is `THREE.Clock` deprecated (inside R3F).

## Audit fixes (Opus cross-system audit)
1. Tail-strike point moved to the drawn tail (it struck ~0.4 m below the visible tail).
2. Terrain away from the airport differed by up to 33 m between physics and mesh; now identical (test < 1 mm).
3. A crashed engine kept 2700 rpm; it now stops. The propeller holds still while paused.
4. A held Space (brakes) could auto-repeat into the focused Retry button; now suppressed.
5. Objective text aligned with scoring (bank/sink limits are score bonuses, not failures).

## Phase 1: world and terrain (branch `feature/phase1-world`)
- 100 km world: a 38 km main island with islets, lakes and rivers, and peaks to ~1,800 m. The airport, corridors and ring course are kept.
- Streaming quadtree terrain: levels 0-7, 32x32-cell chunks, built in Web Workers. Level 0 is the 30 m physics grid
  and always covers at least 1.5 km around the camera, so the ground near the aircraft is exactly the ground physics hits.
- Height/slope terrain material, three tree types streamed by chunk, time-of-day sky/lighting/fog (morning, noon, evening),
  animated water shader, clouds over the whole world.
- Quality now sets view distance, LOD bias, tree density, cloud count, shadows and fog; it never changes physics.
- Gate: 205 tests passing; build bundles the terrain worker.

## Phase 2: multiple airports (same branch)
- 10 airports: Central Field, Harbor and North Bay Internationals, Ridgeback Air Base, Westport, Southgate,
  Eastshore, Pine Ridge, Gull Island and Cedar Valley. The data lives in `src/config/airports.ts` and the
  geometry in `src/game/airportGeometry.ts`.
- Terrain flattens every airport exactly and keeps a sloped clear surface 10 km out from both runway ends.
  Sites were moved up to 2.5 km onto suitable ground.
- Every airport is drawn: markings, runway numbers, edge, threshold and taxi lights, PAPI, buildings by class.
- Airport and runway picker for Free Flight, Take-off and Landing; world map (M); HUD minimap,
  nearest-airport readout and ILS-style approach guidance.
- Gate: 292 tests passing.

## Phase 3: selectable aircraft (same branch)
- Five aircraft: FS-1 Trainer, F-22 Raptor, A220-300, A350-900, Global 8000. The catalog is
  `src/config/aircraftCatalog.ts` (published specs and sources); physics configs are in `src/config/aircraft/`.
- One physics model with:
  - piston, turbofan and afterburning engines; ISA atmosphere to 20 km; Mach drag rise;
  - retractable gear (refused on the ground), speed brakes, auto ground spoilers, reverse thrust;
  - fly-by-wire (airliners: bank and AoA protection; F-22: 9 g limit, thrust vectoring).
- Calibrated against published data. Every target is met except one: the A350 lifts off in ~1,500 m at its 80%-MTOW
  game weight (it matches the published 2,600 m at MTOW).
- Procedural models for all four jets with gear, surface, nozzle and afterburner animation; per-aircraft cameras.
- Hangar picker, inline map preview with runway-length warnings, HUD gear/N1/Mach/AB/SPD BRK/REV, per-aircraft
  instrument scales, jet engine sounds. Keys: G gear, V speed brake, Y reverse.
- Gate: 476 tests passing.

## Known limitations
- No wind, prop torque/P-factor or asymmetric stall wing-drop; gear force is vertical.
- No audio, gamepad or touch controls; keyboard + mouse (free-look) only.
- No 3D cockpit panel (cockpit view uses the 2D instrument overlay).
- Real-time FPS could not be measured: the in-app browser pane was backgrounded (rAF throttled to ~1 Hz).
- The bundle is a single 1.2 MB chunk (three.js); the warning limit is raised in vite.config.ts.

## Next
- Optional: audio (engine, stall horn), gamepad support, code-splitting three.js, wind.
