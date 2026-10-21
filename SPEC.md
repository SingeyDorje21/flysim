# FlySim - Reconstructed Specification

> The original flight-simulator specification was not present in the repository or
> any prior session. This document reconstructs it from the orchestration brief
> (model routing / subagent plan) plus sensible defaults. Replace or amend it if
> the original spec turns up.

## Product
A browser flight simulator (Vite + React + TypeScript + three.js via
@react-three/fiber). One light single-engine aircraft, a procedural island with
an airport, several game modes, menus, HUD and cockpit instruments.

## Functional requirements
1. **Flight physics** (pure TS, `src/simulation/AircraftPhysics.ts`, `src/config/aircraft.ts`)
   - Lift, drag, thrust, gravity, side force; pitch/roll/yaw moments with damping.
   - Stall: lift breaks down past the critical AoA, warning before it, reproducible.
   - Control response through rate-limited surfaces, weaker at low dynamic pressure.
   - Engine spool-up lag; propeller rpm.
   - Ground handling: gear contact, rolling friction, brakes, nosewheel steering, rotation.
   - Crash detection (hard landing, wingtip/tail/prop strike, terrain, water).
   - Fixed timestep, frame-rate independent, deterministic, NaN-safe, resettable.
2. **World** (`src/world/**`)
   - Procedural island terrain shared with physics, airport with runway and markings,
     sky, sun, fog, clouds, trees, ocean.
   - Procedural aircraft model with animated elevator, ailerons, rudder, flaps, propeller.
   - Chase, cockpit and free-look (mouse orbit) cameras.
   - Low / medium / high quality presets with measurable differences.
   - Rendering only consumes physics state; no second flight model.
3. **UI and game flow** (`src/components/**`)
   - Main menu, mode select, HUD, cockpit instrument panel, pause menu, settings,
     controls reference, results screen.
   - Every button performs its advertised action; instruments read live simulation data.
4. **Game modes**: Free Flight, Take-off Challenge, Landing Challenge, Ring Course,
   with HUD objective progress and scored results (best scores persisted).
5. **Input**: keyboard flight controls (pitch, roll, rudder, throttle, flaps, brakes,
   trim), camera switching, pause, HUD/instrument toggles; invert-pitch setting.

## Definition of Done
- [ ] `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` all pass.
- [ ] Physics tests: take-off acceleration, stall onset, control response, reset,
      frame-rate independence, numerical safety.
- [ ] Aircraft orientation in the scene matches the simulation; surfaces animate.
- [ ] Camera switching works (chase / cockpit / free).
- [ ] Quality presets change terrain resolution, clouds, trees, shadows, fog, DPR.
- [ ] Every visible button works; instruments show live values.
- [ ] Pause stops simulation updates; restart/reset leaves no stale state.
- [ ] Each game mode can be completed or failed and shows a results screen.
- [ ] No runtime errors in the browser console during a normal flight.

## Controls (default)
| Action | Keys |
| --- | --- |
| Pitch (nose down / up) | W / S or Up / Down (invertible) |
| Roll | A / D or Left / Right |
| Rudder | Q / E |
| Throttle up / down | R / F, PageUp / PageDown, = / - |
| Flaps extend / retract | ] or X / [ or Z |
| Brakes (hold) | B or Space |
| Elevator trim nose up / down | . / , |
| Camera cycle / direct | C / 1, 2, 3 |
| Pause | Esc or P |
| Toggle HUD / instruments | H / I |
