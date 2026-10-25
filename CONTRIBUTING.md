# Contributing to FlySim

Thanks for wanting to help! Every contribution, big or small, is welcome.

## Ways to help

- **Report a bug:** [open an issue](https://github.com/SingeyDorje21/flysim/issues) with what you did, what you expected and what happened. Your browser and a screenshot help a lot.
- **Suggest an idea:** new aircraft, airports, lessons or challenges. For a big change, open an issue to talk it through first.
- **Send a pull request:** fixes, features, tests or docs.

## Development setup

You need [Node.js](https://nodejs.org) 22 or newer.

```bash
git clone https://github.com/<your-username>/flysim.git
cd flysim
npm install
npm run dev
```

## Before you open a pull request

Make sure all three checks pass:

```bash
npm run typecheck
npm run lint
npm test
```

Then:

1. Keep the pull request focused on one change.
2. Add or update tests for logic changes (physics, autopilot, scoring, lessons). Tests live in `__tests__` folders next to the code.
3. Match the style of the surrounding code.
4. Describe what you changed and why, and add a screenshot for UI changes.

## Where things live

| Area                         | Folder                 |
| ---------------------------- | ---------------------- |
| Flight physics               | `src/simulation/`      |
| Aircraft definitions         | `src/config/aircraft/` |
| Autopilot and landing assist | `src/autopilot/`       |
| Modes, lessons and scoring   | `src/game/`            |
| 3D world                     | `src/world/`           |
| Menus, HUD and maps          | `src/components/`      |

### Adding an aircraft

Aircraft live in `src/config/aircraft/`. Copy the closest existing one (`trainer.ts` for a light aircraft, `a220.ts` for an airliner), adjust the figures, and note your sources in the comment at the top of the file. Then add it to `src/config/aircraftCatalog.ts`.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
