// Bundles the multiplayer server (server/index.ts + everything it imports
// from src/) into a single self-contained CommonJS file the Electron main
// process can require() directly, with no runtime node_modules dependency.
import { build } from 'esbuild';

await build({
  entryPoints: ['server/index.ts'],
  outfile: 'dist-electron/server.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  // ws's optional native accelerators aren't installed; let it fall back to
  // its pure-JS path at runtime instead of erroring out at bundle time.
  external: ['bufferutil', 'utf-8-validate'],
  logLevel: 'info',
});
