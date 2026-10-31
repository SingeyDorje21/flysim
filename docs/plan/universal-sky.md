# Plan: one shared sky, airport choice, mid-runway spawns, scored flying

Status: implemented (2026-10-31), see [ADR 0002](../adr/0002-single-shared-sky.md). Supersedes the room-code part of `multiplayer.md`
and ADR 0001's room model.

## 1. One universal server (no rooms, no codes)

The Render service (`wss://flysim-rooms.onrender.com`, `render.yaml`) keeps
running; it just hosts one shared world instead of many rooms.

- **Protocol** (`src/net/protocol.ts`, `PROTOCOL_VERSION` 1 -> 2)
  - Client `create` / `join {code}` are replaced by one `hello {v, name, aircraftId}`.
  - Remove room codes: `ROOM_CODE_*`, `generateRoomCode`, `normalizeRoomCode`,
    `isValidRoomCode`, error codes `BAD_CODE`, `ROOM_FULL`, `NOT_IN_ROOM`
    (`SERVER_FULL` stays, for when the sky is full).
  - `welcome {id}` (no code, no slot). Remove `spawnSlotOffset` and `RosterEntry.slot`.
  - `MAX_PLAYERS` 8 -> 24. Server->client frames get their own, larger size
    limit (a 24-pilot snapshot does not fit the 4 KB client limit).
- **Server** (`server/RoomServer.ts` -> `server/SkyServer.ts`)
  - One player list instead of `Map<code, Room>`; `hello` adds you (or
    `SERVER_FULL`). Drop `maxRooms`, global wrong-code limit, `uniqueCode`.
  - Keep: per-IP join rate limit, message rate limit, bad-message kick,
    teleport penalty, spawn grace, swept collisions, snapshots, heartbeat,
    origin check, `/healthz`. `server/index.ts` only renames the import.
- **Client** (`src/net/client.ts`): reconnect just resends `hello`.
- **Store** (`src/state/multiplayerStore.ts`): `createRoom`/`joinRoom`/`leaveRoom`
  -> `joinSky(aircraftId)` / `leaveSky()`; drop `code`, `slot`, `helloKind`.
  Status `inRoom` -> `inSky`. Error texts updated.
- **Lobby** (`MultiplayerLobby.tsx`): pilot name, aircraft, **airport picker**,
  one "Join the sky" button. No room code UI, no `CopyCode`.
- **HUD** (`MultiplayerHud.tsx`): no room code anywhere. "Leave room" -> "Leave".
  The scoreboard is no longer always on screen: see section 5.

## 2. Choose the airport before spawning

- The lobby embeds the existing `AirportPicker` (map + list + runway end),
  sharing the game store's `airportId` / `runwayEnd` like single player.
- `enterMultiplayerFlight()` stops forcing `HOME_PLACE`; it flies Free Flight
  from whatever the player picked. `savedPlace` restore logic goes away
  (nothing is overwritten any more).
- Respawn after a crash returns to the same chosen airport/runway.

## 3. Spawn in the middle of the runway

- New `runwayMidpoint(end)` in `src/game/airportGeometry.ts`: the runway
  centre on its centreline, facing the chosen runway end's heading.
- In multiplayer the session spawns there (replaces the slot offsets in
  `FlightSession.spawnAt` / `setSpawnSlot`, which become `setMidRunwaySpawn(bool)`).
- Aircraft whose `minRunway` is more than half the runway start further back,
  with `minRunway` ahead (at most back to the normal line-up), so the A350
  and other heavies can still take off (`multiplayerRunwayAhead` in `spawns.ts`).
- Several pilots at one airport share that spot: ground-to-ground contact
  already never collides, and spawn grace covers the first 3 s airborne.
- Single-player modes (Free Flight, lessons, take-off challenge) keep their
  current threshold line-up, since lessons and short-runway jets need the
  full length. (Easy to switch Free Flight too if wanted.)

## 4. Score = flying time x quality multiplier

Computed by the server from the poses it already gets (no client-reported
grades to cheat with). Per pilot:

- `seconds`: airborne time since last reset (as now).
- `multiplier` X, starts at 1.0, clamped to [0.5, 5.0].
- **Take-off**: credited once a flight leg has been airborne 10 s (so bounces
  don't count). Grade from the lift-off pose: wings level (bank < 10 deg)
  and pitch not excessive -> X += 0.1 to 0.25.
- **Landing**: touchdown after a leg of at least 30 s airborne. Grade by the
  sink rate of the last airborne pose (and bank):
  - < 1 m/s and wings level: excellent, X += 0.5
  - < 2 m/s: good, X += 0.3
  - < 3 m/s: firm, X += 0.1
  - harder but not crashed: X -= 0.25
- `score = seconds x X`; the leaderboard sorts by score.
- **Reset to zero** (seconds, X, score): any crash (pose reports `crashed`,
  e.g. hitting the ground) **and** mid-air collisions. Today only collisions
  reset; a plain crash will now reset too.
- `LeaderboardEntry` becomes `{id, score, seconds, multiplier, resets}`, plus a
  new server message `grade {kind: 'takeoff'|'landing', label, delta}` to the
  pilot so the HUD can flash "Good landing x1.6 (+0.3)".
- Leaderboard rows show score, with `x1.6` and the time underneath. Crash
  panel text: "Your score was reset."

## 5. Tab shows the scoreboard and who is online

- The leaderboard leaves the HUD's right column. In multiplayer, **holding Tab**
  shows a centred scoreboard over the flight; releasing it hides it again.
- It lists every pilot online ("Online - N pilots"): name, aircraft, score,
  multiplier X and flying time, sorted by score, your own row highlighted, and
  rows that were just reset flash as now.
- `hotkeys.ts`: `KeyL` toggle is removed; Tab keydown/keyup sets
  `boardVisible` (store `toggleBoard` -> `setBoardVisible(bool)`), with
  `preventDefault` so Tab doesn't move focus. Window blur hides it, so it
  can't get stuck open. Only active while in the sky; Tab does nothing in
  single player.
- A small always-visible chip stays in the HUD corner: "Score 412 x1.6 · Tab:
  scoreboard", so your own score is still visible while flying.
- Controls list (`controlsData.ts` / How it works) shows "Tab (hold) -
  scoreboard" instead of L.

## 6. Tests and docs

- Rewrite the room tests for the single sky: `RoomServer.test.ts`
  (-> `SkyServer.test.ts`), `twoClients.e2e.test.ts`, `protocol.test.ts`,
  `client.test.ts`, `multiplayerStore.test.ts`, `multiplayerLobby.test.tsx`,
  `multiplayerHud.test.tsx`, `minimapPilots.test.tsx`.
- New tests: scoring (take-off/landing grades, multiplier clamp, reset on
  crash and on collision), mid-runway spawn position, airport choice reaching
  `startFlight`, Tab hold shows / release hides the scoreboard.
- Update ADR 0001 (new ADR 0002 "single shared sky"), `multiplayer.md`, README.
- Verify: `npm test`, typecheck, two browser tabs against a local server.

## Deploy note

Protocol v2 is not compatible with the running v1 server: the Vercel site and
the Render service must be deployed together (old tabs get "Reload the page").
`render.yaml` and the service URL stay the same.
