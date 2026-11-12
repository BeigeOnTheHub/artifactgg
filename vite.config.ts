import { defineConfig } from 'vite';

/**
 * Sharing is hash-only: links look like /#s=<lz-string>, so the whole strat
 * rides in the URL fragment and the path stays '/'. There are no server-side
 * share routes to special-case anymore. appType: 'spa' is left explicit below
 * (it is the vite default) so any non-asset path still falls back to
 * index.html in `npm run dev`.
 */
export default defineConfig({
  base: '/',
  // appType: 'spa' is the default; setting explicitly to make the SPA-fallback
  // contract self-documenting.
  appType: 'spa',
  server: {
    host: 'localhost',
    port: 5173,
    // fail loudly on a port collision instead of silently bumping to 5174 and
    // leaving the hmr client pointed at the wrong port (that mismatch was the
    // "browser 5174 <-> server 5173" websocket error).
    strictPort: true,
    hmr: { host: 'localhost', protocol: 'ws' },
  },
  build: {
    outDir: 'dist',
    target: 'es2022',
    // Off in production builds so we don't ship the original TS + comments
    // alongside the bundle. Set VITE_SOURCEMAP=1 locally if you want them.
    sourcemap: process.env['VITE_SOURCEMAP'] === '1',
  },
});
