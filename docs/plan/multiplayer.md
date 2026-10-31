# Multiplayer plan

> **Superseded in part (2026-10-31):** rooms and codes are gone. Everyone now flies in one shared sky, chooses an airport and spawns mid-runway, and scores flying time x a take-off/landing multiplier. See [universal-sky.md](universal-sky.md) and [ADR 0002](../adr/0002-single-shared-sky.md).

FlySim keeps its single-player game exactly as it is and adds a **Multiplayer** mode.
A player creates a room and gets a short code to share, and others join with that code.
Everyone flies the same island at the same time. If two aircraft touch, both crash.
A live leaderboard ranks players by time spent flying, and a collision resets both players' scores to zero.

## Ground rules

- **Single player is the default and doesn't change.** Multiplayer is an overlay on Free Flight: a network session plus a store slice. It is **not** a new member of the `GameMode` union. `GAME_MODES`, `spawnFor`, `createChallenge`, `LESSON_MODES` and `configContracts.test.ts` stay untouched, and every existing test passes unchanged.
- **The server is authoritative** over room membership, plane-to-plane collisions and leaderboard time. Clients report their own pose and render everyone else.
- **"Time flying"** means airborne time: not `onGround` and not `crashed`. The server accumulates it per player per room.
- **The site stays static on Vercel.** Vercel functions can't hold WebSockets, so the room server is a separate deployable in `server/`.

## Decisions

Defaults confirmed by the project owner on 2026-10-30.

| # | Question | Decision | Alternatives |
|---|---|---|---|
| D1 | Room server host | Small Node `ws` server in `server/` (Fly.io / Render / Railway) | PartyKit, Cloudflare Durable Objects |
| D2 | Does a terrain crash also reset the score? | **No.** Only a player-to-player collision resets it. A terrain crash stops the clock until respawn. | Reset on any crash |
| D3 | Leaderboard lifetime | Per room, in memory, gone when the room empties | Persisted all-time board (needs a DB) |
| D4 | Max players per room | 8 | Configurable |

---

## Step 1 — Design the multiplayer architecture and protocol

Choose the room-server stack (D1) and write an ADR. Define the wire protocol as shared TypeScript types in `src/net/protocol.ts`: `create`, `join`, `pose` (position, quaternion, velocity, onGround, crashed, aircraftId at ~15 Hz), `roster`, `collision`, `leaderboard`, `error`. Define the code format: 6 characters from an unambiguous alphabet, cryptographically random. Set the collision radius per aircraft from `aircraftCatalog.ts` and spawn slot offsets.

Acceptance:
- ADR committed under `docs/adr/` with the chosen host and the authority model
- `src/net/protocol.ts` compiles, and each message has a runtime validator

Out of scope: writing the server or client implementation.

## Step 2 — Implement the room server (create/join, relay, collisions, leaderboard)

Build a Node + `ws` server in `server/`. Create a room and return its code, join by code (cap D4), relay `pose` to the other players in the room, and drop dead sockets. Every server tick: sphere–sphere collision between airborne players, with a 3 s grace period after spawn or respawn. On a hit, broadcast `collision` to both players and zero both scores. Accumulate airborne seconds and broadcast `leaderboard` once per second. Validate every inbound payload, rate-limit create/join per IP, and reject oversized messages.

Acceptance:
- Unit tests cover create/join, a wrong code, a full room, collision → both scores 0, and grace-period immunity
- Malformed or oversized messages are dropped without crashing the server

Out of scope: persistence (D3), accounts and authentication.

## Step 3 — Implement the client network layer and multiplayer store

Add `src/net/client.ts`, a WebSocket client with reconnect and backoff, and `src/state/multiplayerStore.ts` (zustand) holding the room code, my id, the roster, remote poses and the leaderboard. Send the local pose from `SimulationDriver` at ~15 Hz only while in a room. Buffer remote poses and interpolate them about 100 ms behind.

Acceptance:
- The store and interpolation are unit-tested with a fake socket
- With no room joined, no socket is opened and single-player behaviour is unchanged

Out of scope: UI and rendering.

## Step 4 — Build the Multiplayer menu (create room / join by code)

Add a Multiplayer entry to `MainMenu.tsx` next to the single-player flow. **Create** shows the code with a copy button. **Join** takes a code input that validates format before connecting. The player picks an aircraft, then enters the shared Free Flight world at their spawn slot. Show clear errors for a bad code, a full room or a server that can't be reached.

Acceptance:
- Component tests cover create, join, an invalid code and a full room
- The single-player menu path and its tests are unchanged

## Step 5 — Implement remote aircraft rendering

Render one aircraft model per remote player in `FlightWorld` from interpolated poses, with a name label. A crashed remote player shows the existing crash state. Add the remote players to the minimap.

Acceptance:
- Remote planes render at interpolated poses with no per-frame allocations in the render loop
- Single-player scenes mount no remote-aircraft components

## Step 6 — Implement the collision crash and score reset on the client

When the server sends `collision`, crash the local aircraft through the existing `AircraftPhysics.crash()` path with a new crash reason, "Mid-air collision with <name>". Show the crash overlay, then let the player respawn at their slot. The respawn starts the server-side grace period.

Acceptance:
- A collision event sets `crashed` with the mid-air reason, and the respawn resets the pose to the slot spawn
- The leaderboard shows the player's score at 0 after a collision

## Step 7 — Build the leaderboard HUD

Add a compact HUD panel, shown only in a room, ranking players by airborne time (mm:ss). The local player is highlighted. A reset entry flashes briefly after a collision. Hide it with a hotkey.

Acceptance:
- The panel sorts by time and highlights the local player, and component tests cover the reset flash
- Nothing renders in single player

## Step 8 — Test the two-client integration end to end

Run the server, then open two browser contexts. One creates a room and the other joins with the code. Both see each other. Fly them into each other and check that both crash and both scores reset. Check that the airborne timer counts only while flying.

Acceptance:
- An e2e test with two contexts passes locally against a real server
- The test asserts that a collision crashes both planes and zeroes both scores

## Step 9 — Update docs (README and server run guide)

Document how to run the server locally (`server/` scripts plus the `VITE_MP_SERVER_URL` env var) and how to deploy it. Explain how multiplayer, room codes, collisions and the leaderboard work. Note decisions D2–D4.

Acceptance:
- The README has a Multiplayer section, and a fresh clone can run two local clients against a local server by following it
