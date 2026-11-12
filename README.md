# artifactgg.com

A fan-made tactics board for Vail VR. Pick a map, place players, drop vision
cones, sketch routes, step through frames, and share the strat with your team.

Live at <https://artifactgg.com>.

It's a Vite + TypeScript single-page app with no UI framework, just plain DOM
and a small store. There's no backend: sharing packs the whole strat into a
`#s=` link, and saves live in your browser's localStorage.

## Running it

You need Node 20.19+ or 22.12+ (what Vite asks for).

```bash
npm install
npm run dev          # dev server at http://localhost:5173/
npm run build        # type-check and build to dist/
npm run typecheck
npm test             # unit tests (vitest)
npm run test:e2e     # browser tests (playwright, run `npx playwright install` once first)
```

Edit images in `assets/`, not `public/assets/`. `npm run dev` and `npm run
build` copy them across for you.

## Where things are

- `src/main.ts` boots the app and wires everything together.
- `src/app/` has the store, undo/redo (`commands.ts`, `history.ts`), saving
  and share links (`persistence.ts`, `library.ts`) and the viewport.
- `src/render/` has one layer per thing on the map (strokes, shapes, cones,
  players, text, quick-adds).
- `src/tools/` has the tools, one file each.
- `src/ui/` has the sidebar, top bar, frame strip, modals and the mobile layout.

Every module has a `*.test.ts` next to it.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

The code is public domain under CC0 1.0 (see `LICENSE`).

That doesn't cover the art in `assets/`. The map images, utility icons and
scanner sprite are Vail VR artwork and belong to AEXLAB. The bundled libraries and fonts keep their own licences. Details are in
`THIRD-PARTY-NOTICES`.

Not affiliated with AEXLAB or the Vail VR team. If you own something used here
and want it taken down, open an issue and it'll be removed.
