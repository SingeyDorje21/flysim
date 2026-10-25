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
| Pause                          | `Esc` or `P`                             |

The full list is also on the **Controls** screen in the game.

## Scripts

| Command             | What it does                        |
| ------------------- | ----------------------------------- |
| `npm run dev`       | Start the dev server                |
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
└── state/        Zustand stores
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
