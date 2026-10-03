// @ts-check
import { readFileSync } from 'node:fs';
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

const bindings = JSON.parse(readFileSync(new URL('./wrangler.jsonc', import.meta.url), 'utf8'));
if (bindings.d1_databases?.length !== 1 || bindings.r2_buckets?.length !== 1 ||
    [...bindings.d1_databases, ...bindings.r2_buckets, ...bindings.queues.producers].some((binding) => binding.remote !== true)) {
  throw new Error('Re-Target requires its shared production database, media bucket and queues.');
}
export default defineConfig({
  site: 'https://retarget.nahidlabs.com',
  output: 'server',
  adapter: cloudflare({ imageService: 'compile', remoteBindings: true, persistState: false }),
  security: { checkOrigin: true },
  vite: {
    build: { assetsInlineLimit: 0 },
    environments: {
      client: { optimizeDeps: { include: ['tabulator-tables', 'zod'] } },
      ssr: { optimizeDeps: { include: ['zod', 'drizzle-orm', 'drizzle-orm/d1', 'drizzle-orm/sqlite-core'] } },
    },
  },
});
