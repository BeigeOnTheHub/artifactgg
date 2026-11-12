# Contributing

Bug reports, ideas and pull requests are all welcome.

Bugs and ideas go in an issue. For a bug, say what you did, what you expected
and what happened, plus your browser and whether it was on a phone.

For anything bigger than a small fix, open an issue before writing code so we
can agree on it before you spend the time.

## Before you open a PR

```bash
npm run typecheck
npm test
npm run test:e2e
```

All three should pass. If you change behaviour, change or add the matching
`*.test.ts` next to the file.

## House style

- British spelling (`colour`, `serialise`). Match what's around you.
- The map coordinate space is fixed at 1920x1080. Tools and layers rely on it.
- Anything a user should be able to undo goes through `history.dispatch` with
  a command in `src/app/commands.ts`. Zoom, pan and tool switches skip history
  on purpose.
- Don't rename the `artifact-gg.*` localStorage keys. People's saved strats
  live under them.
- Comments say why, not what.

By contributing you agree your code is released under AGPL-3.0-or-later,
same as the rest.
