# Implementation Status

_Last updated: Phase 2 (parallel implementation)._ Spec: [SPEC.md](SPEC.md) (reconstructed - original not found).

## Stack (pinned)
Vite 8.3.5, React 19.3.1, TypeScript 6.0.3 (TS 7 is incompatible with typescript-eslint 8.72),
three 0.186.1, @react-three/fiber 9.8.2 (no drei), zustand 5.0.15, Vitest 5.0.5, jsdom 30, ESLint 10.

## File ownership
| Area | Owner | Paths |
| --- | --- | --- |
| Shared contracts | Orchestrator | `src/simulation/types.ts`, `src/config/{aircraftGeometry,world,quality}.ts`, `src/world/types.ts`, `src/game/{types,modes,courses}.ts`, `src/state/*` |
| Integration | Orchestrator | `src/App.tsx`, `src/main.tsx`, `src/session/**`, `src/input/**`, `src/game/challenges.ts` |
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
- Persisted settings and scores are validated on load (from Agent D's review).

## Done
- Scaffold, contracts, store, telemetry, game modes/courses, challenges, keyboard input, hotkeys, session, canvas shell.
- UI (Agent C): 30 tests passing. QA contract tests (Agent D): 51 passing. Keyboard and challenge tests: 23 passing.

## In progress
- Agent A physics, Agent B world.

## Next
- Integrate A + B, then typecheck, lint, test and build; run a browser check; run the QA pass.
