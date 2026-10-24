# FlySim

A browser flight simulator built with React, Three.js (react-three-fiber) and TypeScript.

## Features

- Flight physics with take-off, landing, and landing on open ground
- Airports with more than one runway, plus a minimap and world map
- Autopilot with speed, heading, altitude and vertical-speed holds
- Landing assist (press `0` near a runway): flies the approach down to 100 ft, then hands over for the flare; goes around if the approach is unstable
- Flight School lessons, including a full circuit: take off, fly around and land

## Getting started

```bash
npm install
npm run dev
```

Then open the local URL Vite prints (usually http://localhost:5173).

## Scripts

| Command           | What it does                        |
| ----------------- | ----------------------------------- |
| `npm run dev`     | Start the dev server                |
| `npm run build`   | Type-check and build for production |
| `npm run preview` | Serve the production build          |
| `npm test`        | Run the tests (Vitest)              |
| `npm run lint`    | Lint with ESLint                    |

## Tech stack

React 19 · Three.js · @react-three/fiber · Zustand · Vite · Vitest
