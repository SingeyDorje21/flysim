# FlySim runtime QA checklist (Phase 4)

Run `npm run dev`, open the app, keep DevTools Console open (clear it, tick "Preserve log").
Any red error or React warning during a normal flight = fail.

## Boot and menus
- [ ] Main menu renders; Play, Settings and Controls buttons all react. No console errors on load.
- [ ] Mode select lists 4 modes with description, objectives, time limit and best score; Back works.
- [ ] Settings and Controls overlays open and close (button and Esc) from the menu and from pause.

## Flying (Free Flight)
- [ ] Spawn on the runway, nose north, engine idle, aircraft sits on its wheels (not sunk or hovering).
- [ ] Throttle R/F, PgUp/PgDn, =/-: gauge and prop follow. Full power: speed rises, rotate ~55 kt, lift off.
- [ ] W/Up pushes nose down, S/Down pulls up; invert-pitch setting flips it. A/D roll to the matching side; Q/E yaw the matching way.
- [ ] Flaps ] [ X Z step through detents (visible on the wings and on the HUD); trim . , moves the trim readout.
- [ ] Brakes (B/Space, hold) stop the roll; release frees it. Stall: warning first, then the nose drops, no NaN or jitter.
- [ ] Heading shown matches the view: turning right increases heading; east = 090.
- [ ] Hard landing, wingtip/prop strike, terrain or water crash shows a failure result with a reason.

## Pause, restart, quit
- [ ] Esc and P pause: aircraft, clocks, timers and clouds freeze; controls ignored. Esc/P again resumes with no jump.
- [ ] Pause then Settings then close: still paused. Esc while the settings overlay is open does not leave a stuck paused state.
- [ ] Open Settings during an unpaused flight: confirm whether the sim keeps running (should pause).
- [ ] Restart (pause menu and results): aircraft back at spawn, telemetry and challenge reset, timer 0, camera snaps (no swoop), unpaused.
- [ ] Restart 5 times quickly: no doubled speed, no stale crash text, no console errors.
- [ ] Quit to menu, then start another mode: no leftover result, HUD challenge text or ring markers.

## Cameras
- [ ] C cycles chase, cockpit, free; 1/2/3 select directly. Default-camera setting applies at flight start.
- [ ] Free look: mouse orbit follows sensitivity slider; no drift when the mouse is released. Cockpit has no clipped geometry.

## Quality and display
- [ ] Low/Medium/High visibly change terrain detail, clouds, trees, shadows and fog; switching mid-flight does not crash or reset the flight.
- [ ] Resize window and test a phone-width viewport: canvas fills the window, HUD is not clipped.
- [ ] Settings (quality, units, invert, HUD, camera, sensitivity) survive a page reload; clear storage and reload gives defaults.
- [ ] Corrupt localStorage key `flysim-v1` (e.g. quality "ultra") and reload: app must not white-screen.

## Instruments and HUD
- [ ] Airspeed, altitude, vertical speed, heading, attitude, g, RPM, flaps, throttle, trim all move live and match the HUD.
- [ ] Units toggle switches kt/ft/fpm and km/h/m/m/s everywhere. H hides the HUD, I hides instruments, both persist.
- [ ] Gauges look sane on the ground, in a stall and after a crash (no NaN, no "undefined").

## Game modes (each: one success, one failure, then results)
- [ ] Take-off: success by climbing to 150 m AGL within 120 s; failure by leaving the runway, rolling past 30 deg, or timing out.
- [ ] Landing: success by touching down under 3 m/s and stopping on the runway; failure by crash, off-runway stop, or timeout.
- [ ] Rings: fly all 9 rings in order (next ring highlighted, "Ring n of 9" updates); failure by missing the time or crashing.
- [ ] Free Flight: ends only on crash or quit.
- [ ] Results: headline, reason, score, time and stats are correct; Retry, Mode select and Menu all work.
- [ ] Best score appears only after a success, updates only when beaten, and survives reload. A failure never sets a best.

## Final
- [ ] A 10 minute mixed session ends with a clean console and stable frame rate. `npm run build` and `npm test` pass.
