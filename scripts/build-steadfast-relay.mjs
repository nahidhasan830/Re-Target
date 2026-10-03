import { build } from 'esbuild';
await build({ entryPoints: ['src/lib/steadfast-compact.ts'], outfile: 'infra/steadfast-transport/parser.mjs', bundle: true, platform: 'node', format: 'esm', target: 'node24', minify: true });
console.log('Steadfast relay parser built from the shared courier model.');
