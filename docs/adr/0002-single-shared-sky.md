# ADR 0002 — One shared sky, chosen airports and a graded score

- **Status:** Accepted, 2026-10-31. Supersedes the room and leaderboard parts of [ADR 0001](0001-multiplayer-room-server.md); its host, authority, collision and anti-griefing decisions still stand.
- **Plan:** [docs/plan/universal-sky.md](../plan/universal-sky.md)
- **Protocol:** [src/net/protocol.ts](../../src/net/protocol.ts) (version 2)

## Context

Multiplayer launched with private rooms joined by a 6-character code, everyone spawning in slots on the home runway, and a leaderboard of plain airborne time.
That changed in four ways:
- Players should all fly together, with no rooms or codes.
- Each player chooses their airport before spawning.
- Spawns are always in the middle of the runway.
- The score should reward flying well, not just staying airborne.

## Decision

1. **One world per server process.** The client sends `hello {v, name, aircraftId}` and is in. There are no codes or rooms. The cap is `MAX_PLAYERS` = 24 (`SERVER_FULL` beyond it). Server→client frames have their own 64 KB limit, because a full sky's snapshot is bigger than the 4 KB client limit. The Render service, its URL and `render.yaml` are unchanged.
2. **Airport choice is client-side.** The lobby embeds the same airport picker as single player. The server never needs to know the airport: positions are world coordinates.
3. **Mid-runway spawn, multiplayer only.** `atMultiplayerStart()` puts the aircraft on the centreline facing the chosen end, with `multiplayerRunwayAhead()` metres ahead. That is half the runway, or the aircraft's `minRunway` when it needs more, but never further back than the normal line-up 60 m past the threshold. So the trainer always starts at the midpoint, and the airliners start further back: an A350 at Harbor has 2,600 m ahead. Pilots in the same aircraft at the same airport share the spot. That is safe because two aircraft on the ground never collide, and there are 3 s of spawn grace. Single-player modes keep the threshold line-up, because lessons and short-runway jets need the full length.
4. **Score = airborne seconds × multiplier, graded by the server** ([server/scoring.ts](../../server/scoring.ts)) from the poses it already receives. Clients never report grades.
   - **Take-off:** credited when a leg that began on the ground has stayed airborne for 10 s, so a bounce doesn't count. Graded from the lift-off attitude: wings level and pitch ≤ 15° earns +0.25, then +0.15, then +0.1.
   - **Landing:** credited at touchdown after a leg of at least 30 s, so hops don't count. Graded from the last airborne pose's sink rate: under 1 m/s with wings level earns +0.5, under 2 m/s earns +0.3, under 3 m/s earns +0.1, and harder costs 0.25.
   - **Bounds:** the multiplier starts at 1 and stays within [0.5, 5].
   - **Never graded:** poses during a teleport penalty, or a touchdown that crashes.
   - **Resets:** any crash resets seconds and multiplier, as does a mid-air collision. This replaces ADR 0001's D2, under which only collisions reset. Each crash resets once; the next reset needs a respawn.
5. **Scoreboard on Tab.** The in-flight board is no longer always shown. Holding Tab shows everyone online. A small chip keeps your own score, multiplier and latest grade visible.

## Consequences

- Protocol 1 and 2 are incompatible. The site and the server must be deployed together, and an old tab gets `VERSION_MISMATCH` ("Reload the page").
- The leaderboard lives as long as the server process: a Render free-tier sleep or redeploy clears it.
- A strict midpoint would leave at most 1,700 m (Harbor International), and the A350 needs 2,120 m just to lift off at game weight (trainer 325 m, F-22 386 m, Global 8000 739 m, A220 1,163 m). So "always in the middle" gives way for aircraft that need more: they start back from the middle with their `minRunway` ahead. Every aircraft can therefore take off online wherever it can offline, and the lobby's short-runway warnings are the single-player ones. The lobby names the spawn: "middle of runway 09R", or the distance from the end when it is further back.
- There is no matchmaking or sharding. Past 24 pilots, a second process (and URL) would be needed.
