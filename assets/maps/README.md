# Maps

One folder per map, named by its id in `src/types/maps.ts`:

```text
maps/<id>/
  thumbnail.png       sidebar picker image
  map.png             the map itself, 1920x1080
  map-callouts.png    optional callout overlay, same size, transparent background
```

To add a map, drop its folder in here and add an entry to `src/types/maps.ts`.
`npm run dev` copies the folder into `public/assets/` for you.

The map artwork belongs to AEXLAB (see `THIRD-PARTY-NOTICES`).
