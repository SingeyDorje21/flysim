# ADR 0001 — Multiplayer room server and authority model

- **Status:** Accepted, 2026-10-30. Rooms, room codes, spawn slots and the time-only leaderboard are superseded by [ADR 0002](0002-single-shared-sky.md) (one shared sky).
- **Plan:** [docs/plan/multiplayer.md](../plan/multiplayer.md), step 1
- **Protocol:** [src/net/protocol.ts](../../src/net/protocol.ts)

## Context

FlySim is a static Vite + React + three.js site deployed on Vercel, with no backend.
Multiplayer has four requirements:
- Rooms that players join with a shareable code.
- A shared world where two aircraft touching crash each other.
- A leaderboard of time spent flying.
- A collision resets both players' scores.

Single player must stay the default and work exactly as it does today.

Vercel serverless functions can't hold long-lived WebSocket connections, so the live part needs its own process.

## Decision

### 1. Host: a small Node + `ws` server in `server/`, deployed separately

- One Node process (Node ≥ 20, `ws` package), with in-memory rooms and no database.
- It runs on any always-on container host: Fly.io, Render or Railway. The client finds it through `VITE_MP_SERVER_URL`. When that variable is unset, the client falls back to `ws://<page host>:8787` on localhost only. Otherwise Multiplayer reports that the server is unreachable, and single player is unaffected.
- The static site stays on Vercel, unchanged.
- Server and client share `src/net/protocol.ts`. The server imports it directly (run with `tsx`), so the wire contract has exactly one definition.

Alternatives considered:

| Option | Why not (for now) |
|---|---|
| PartyKit / Cloudflare Durable Objects | A good fit (one room per object) but adds a vendor account and its own runtime. The protocol is transport-agnostic, so a later move stays cheap. |
| Peer-to-peer WebRTC | No neutral party to decide collisions or keep score, so a cheating or lagging peer could avoid resets. Also needs NAT traversal/TURN. |
| Supabase / Firebase realtime | Pub/sub with no server tick. Collision and timer logic would be back on clients, untrusted. |

### 2. Authority: the server owns membership, collisions and score

- **Clients own their own physics.** Each client simulates its own aircraft and sends a `pose` about 15 Hz (`POSE_SEND_HZ`). The server doesn't simulate flight.
- **The server decides plane-to-plane collisions.** Every tick (`SERVER_TICK_HZ` = 20) it tests each pair of players with spheres around the centre of gravity, radius from `collisionRadius()`: 0.4 × the larger of length and wingspan. A pair is tested only when:
  - both players are not crashed,
  - neither is inside the spawn grace window (`SPAWN_GRACE_S` = 3 s after joining or `respawn`),
  - and **at least one is airborne**.

  **Swept test:** each pose is extrapolated along its velocity to the tick time, at most 200 ms ahead. The test then uses the closest approach of the two straight paths since the previous tick, not just the end points. Jets close tens of metres per tick, more than their combined radius, so they would otherwise pass straight through each other.

  Two aircraft taxiing on the ground never collide, which keeps shared runway spawns safe. A plane landing into one on the runway still counts. This refines the plan's "between airborne players".
- **On a hit**, the server marks both crashed, zeroes both scores, adds 1 to each one's `resets`, and broadcasts `collision`. Each client crashes its own aircraft through the existing `AircraftPhysics.crash()` path.
- **Score** is airborne seconds: the server adds tick time while the player's latest pose has `onGround = false` and `crashed = false`. A terrain crash (reported by the client as `crashed`) stops the clock but doesn't reset the score (plan decision D2). The score is per room, in memory, and gone when the room empties (D3).
- Because clients report their own pose, a modified client could lie about its position. That's acceptable for a casual game with no accounts. The server limits the damage:
  - It rejects poses that are non-finite or out of bounds.
  - **Teleports:** a pose that moved faster than 800 m/s since the last one makes that player un-collidable and earn no time for 1.5 s. Jumping onto the leader therefore does nothing.
  - **Respawns:** a `respawn` that doesn't follow a crash renews the spawn grace at most every 15 s, so it can't be spammed for permanent immunity.
  - It never trusts a client's claim about *another* player.
- **Pausing:** a paused client stops sending poses. After 1.5 s the server treats it as stale: no airborne time, and it can't collide. Other pilots see the plane hanging in place and can fly through it. Accepted, because a paused player shouldn't be crashable while away from the keys.

### 3. Room codes

- 6 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`. That's 31 symbols with no 0/O, 1/I/L look-alikes, giving 31⁶ ≈ 8.9 × 10⁸ codes.
- Codes come from `crypto.getRandomValues` with rejection sampling, so every symbol is equally likely. Never `Math.random`.
- Input is normalized: upper-cased, with spaces and dashes removed. A code is a capability, not a secret.
- **Join rate limits:** the server limits create and join per client key: 20 a minute, IPv6 grouped by /64. It also caps wrong-code joins across the whole server at 300 a minute, so guessing from many addresses stays slow.
- **Proxies:** behind a proxy (`TRUST_PROXY=1`) the key is the rightmost `X-Forwarded-For` entry, the one the proxy appended. Entries to its left are client-supplied and ignored.
- **Resource caps:**
  - 2,000 connections in total, and 16 per client key.
  - 200 rooms.
  - A client that falls more than 256 KiB behind reading its snapshots is disconnected.

### 4. Spawning

- Each player gets a slot (0–7, `MAX_PLAYERS` = 8) and spawns lined up on the Free Flight runway, offset by `spawnSlotOffset(slot)`. Slots come in pairs: ±12 m either side of the centreline, then 80 m further down the runway per pair. Ground contacts never count as collisions, and the grace window covers the start of the take-off roll.
- A respawn after a crash returns the player to their slot and sends `respawn`, which restarts the grace window on the server.

### 5. Wire format

- JSON text frames, one message per frame, at most `MAX_MESSAGE_BYTES` (4 KiB). Each message has a `t` discriminator.
- `create` and `join` carry `PROTOCOL_VERSION`. A mismatch gets the `VERSION_MISMATCH` error.
- Every inbound frame on both sides goes through `parseClientMessage` / `parseServerMessage`. These return `null` for anything malformed, oversized, non-finite or out of bounds. Callers drop `null` and never throw.
- `aircraftId` travels in the roster, not in each `pose`. It can't change mid-room, so resending it at 15 Hz would only waste bandwidth. This refines the plan's step 1 text.
- The server sends remote poses as one `snapshot` per tick instead of relaying each `pose` frame. That gives one frame per tick per client, and every client sees the same state the collision test used.

## Consequences

- One extra deployable to run and pay for. The free tiers of the listed hosts are enough for small rooms.
- Single-player code paths don't change: no new `GameMode`, and no socket is opened unless the player picks Multiplayer.
- Server-side collisions add about one round-trip of latency before a crash appears. The server's `collision` message is final.
- Moving to PartyKit or Durable Objects later means re-hosting the room logic. The protocol and client don't change.
