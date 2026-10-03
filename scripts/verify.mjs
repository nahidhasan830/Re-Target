import { readdir } from 'node:fs/promises';
import { npm, root, run } from './commands.mjs';

process.chdir(root);
try {
  await npm('run', 'security:check');
  await npm('run', 'check');
  await npm('run', 'media:install');
  await run(process.execPath, ['scripts/build-steadfast-relay.mjs']);
  const tests = (await readdir('tests'))
    .filter((name) => name.endsWith('.test.mjs'))
    .sort()
    .map((name) => `tests/${name}`);
  await run(process.execPath, [
    '--test',
    ...tests,
    'infra/media-preparation/server.test.mjs',
  ]);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
