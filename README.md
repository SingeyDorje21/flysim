<div align="center">

# ✈️ FlySim

**An open-source island flight simulator that runs in your browser.**

Take off, fly a circuit and grease the landing, from a light trainer to an A350.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![React 19](https://img.shields.io/badge/React-19-61dafb?logo=react&logoColor=white)](https://react.dev)
[![Three.js](https://img.shields.io/badge/Three.js-r186-black?logo=three.js)](https://threejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)

<img src="docs/main-menu.jpg" alt="FlySim main menu: aircraft picker, time of day and pilot log over an island backdrop" width="720">

</div>

## Features

- **Flight physics:** lift, drag, thrust and ground handling for each aircraft, including landing on open ground
- **Five aircraft:** FS-1 Trainer, Airbus A220, Airbus A350, Bombardier Global 8000 and F-22, each tuned against published figures
- **Airports and maps:** airports with more than one runway, a minimap and a full world map
- **Autopilot:** speed, heading, altitude and vertical-speed holds
- **Landing assist** (press `0` near a runway): flies the approach and the 3° glide path down to 100 ft, then hands over for the flare, and goes around if the approach is unstable
- **Landing coach:** tips during the approach, and every touchdown is graded
- **Flight School:** guided take-off, landing and full-circuit lessons
- **Challenges:** take-off, landing and ring courses, with best scores kept in your pilot log
- **Time of day:** morning, noon or evening light
- **Multiplayer:** share a room code and fly the island together, with mid-air collisions and an airborne-time leaderboard

## Quick start

You need [Node.js](https://nodejs.org) 22 or newer.

```bash
git clone https://github.com/SingeyDorje21/flysim.git
cd flysim
npm install
npm run dev
```

Then open the local URL Vite prints (usually http://localhost:5173).

## Controls

| Action                         | Keys                                     |
| ------------------------------ | ---------------------------------------- |
| Pitch down / up                | `W` / `S` or `↑` / `↓`                   |
| Roll left / right              | `A` / `D` or `←` / `→`                   |
| Yaw (rudder)                   | `Q` / `E`                                |
| Throttle up / down             | `R` / `F`, `+` / `-`, or `PgUp` / `PgDn` |
| Flaps down / up                | `X` / `Z` or `]` / `[`                   |
| Trim up / down                 | `.` / `,`                                |
| Brakes                         | `B` or `Space`                           |
| Landing gear                   | `G`                                      |
| Speed brake                    | `V`                                      |
| Reverse thrust                 | `Y`                                      |
| Landing assist                 | `0`                                      |
| Camera: chase / cockpit / free | `1` / `2` / `3` (`C` cycles)             |
| Toggle HUD / instruments       | `H` / `I`                                |
| World map                      | `M`                                      |
| Multiplayer leaderboard        | `L` (in a room)                          |
| Pause                          | `Esc` or `P`                             |

The full list is also on the **Controls** screen in the game.

## Multiplayer

Single player is unchanged and needs no server. Multiplayer adds a small room server ([server/](server/)) that the browser connects to over WebSockets.

**How it plays**

- **Rooms and codes:** choose **Multiplayer** on the main menu, enter a pilot name and pick an aircraft.
  - **Create room** gives you a 6-character code (like `ABC234`) to share, then **Take off**.
  - Others enter the code and **Join**, which puts them straight onto the runway.
  - A room holds up to 8 pilots. Everyone starts on the home runway, each in their own slot.
- **Collisions:** if two aircraft touch, both crash. The server decides, using a sphere around each aircraft scaled to its size. You get 3 seconds of immunity after joining or respawning, and two aircraft that are both on the ground never collide. After a crash, **Respawn** puts you back in your slot.
- **Leaderboard:** ranks pilots by time spent in the air. It only counts while you're airborne, not crashed, and not paused. A mid-air collision resets **both** pilots to 0:00. Hitting the terrain only pauses your clock until you respawn. Press `L` to hide or show it.

**Run it locally**

Start the room server in one terminal and the game in another:

```bash
npm run server
```

```bash
npm run dev
```

On `localhost` the game finds the server at `ws://localhost:8787` by itself. To try two pilots, open the game in two browser windows: create a room in one and join it from the other.

**Deploy**

The site stays a static build on Vercel. Vercel can't host the always-on WebSocket room server, so that runs on [Render](https://render.com), whose free plan works without a card. [`render.yaml`](render.yaml) sets it all up.

1. In Render: **New → Blueprint**, then pick this repository and branch. Render creates the `flysim-rooms` service and runs `npm run server`. Health checks hit `/healthz`.
2. That's it. The game connects to `wss://flysim-rooms.onrender.com` by default. If Render gives the service a different URL, set `VITE_MP_SERVER_URL` to it in Vercel and redeploy.

On the free plan the server sleeps after about 15 minutes idle. The first room after that takes up to a minute to connect, and the lobby says so while it waits.

| Setting                    | Where       | Meaning                                                                        |
| -------------------------- | ----------- | ------------------------------------------------------------------------------ |
| `VITE_MP_SERVER_URL`       | site build  | Room server URL. Default: `wss://flysim-rooms.onrender.com`, or `ws://localhost:8787` when the game runs on localhost |
| `PORT`                     | server      | Listen port (default `8787`)                                                   |
| `ALLOWED_ORIGINS`          | server      | Comma-separated site origins allowed to connect. `*` matches part of a host name, e.g. `https://flysim-*-singeys-projects.vercel.app` for every preview |
| `TRUST_PROXY`              | server      | `1` behind a proxy, so per-IP rate limits use `X-Forwarded-For`               |

**Decisions you might revisit:** these are in [docs/plan/multiplayer.md](docs/plan/multiplayer.md) and [docs/adr/0001-multiplayer-room-server.md](docs/adr/0001-multiplayer-room-server.md).
- Only mid-air collisions reset a score (D2).
- Leaderboards last as long as the room and aren't saved anywhere (D3).
- Rooms are capped at 8 pilots (D4).

## Scripts

| Command             | What it does                        |
| ------------------- | ----------------------------------- |
| `npm run dev`       | Start the dev server                |
| `npm run server`    | Start the multiplayer room server   |
| `npm run build`     | Type-check and build for production |
| `npm run preview`   | Serve the production build          |
| `npm test`          | Run the tests (Vitest)              |
| `npm run typecheck` | Type-check without building         |
| `npm run lint`      | Lint with ESLint                    |

## Project layout

```
src/
├── simulation/   Flight physics (forces, engines, ground contact)
├── config/       Aircraft, airports and world settings
├── autopilot/    Autopilot holds and the landing assist
├── game/         Modes, lessons, challenges, scoring and the landing coach
├── world/        Three.js scene: terrain, airports, aircraft, camera
├── components/   React UI: menus, HUD, instruments, maps
├── input/        Keyboard controls and hotkeys
├── audio/        Engine sound and callouts
├── session/      Flight session lifecycle
├── net/          Multiplayer protocol, client and remote-pose smoothing
└── state/        Zustand stores
server/           Multiplayer room server (Node + ws)
```

## Contributing

Contributions are welcome: new aircraft, airports, lessons, bug fixes or better physics.

1. Fork the repo and create a branch: `git checkout -b feature/my-idea`
2. Make your change and add tests where it makes sense
3. Run the checks: `npm run typecheck`, `npm run lint` and `npm test`
4. Open a pull request describing what you changed and why

See [CONTRIBUTING.md](CONTRIBUTING.md) for more detail. Found a bug or have an idea? [Open an issue](https://github.com/SingeyDorje21/flysim/issues).

## Tech stack

[React 19](https://react.dev) · [Three.js](https://threejs.org) · [@react-three/fiber](https://r3f.docs.pmnd.rs) · [Zustand](https://zustand.docs.pmnd.rs) · [Vite](https://vite.dev) · [Vitest](https://vitest.dev) · TypeScript

## License

[MIT](LICENSE) © Singey Dorje
