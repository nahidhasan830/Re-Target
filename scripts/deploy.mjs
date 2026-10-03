import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { npm, root, wrangler } from './commands.mjs';
import { release, waitForLiveSite } from './deployment.mjs';
import { backupPublicKey, encryptBackup } from './encrypt-backup.mjs';

process.chdir(root);
process.umask(0o077);
let locked = false;
let uploadSecretsFile;
let token;
const deploymentId = randomUUID();
try {
  if (process.env.CI) {
    if (!process.env.DATABASE_BACKUP_PUBLIC_KEY) throw new Error('CI deployment requires DATABASE_BACKUP_PUBLIC_KEY to protect database backup artifacts.');
    backupPublicKey(process.env.DATABASE_BACKUP_PUBLIC_KEY);
  }
  if (process.env.CLOUDFLARE_ENV)
    throw new Error(
      'Unset CLOUDFLARE_ENV; this project has one deployment environment.',
    );
  const config = JSON.parse(await readFile('wrangler.jsonc', 'utf8'));
  if (
    process.env.CLOUDFLARE_ACCOUNT_ID &&
    process.env.CLOUDFLARE_ACCOUNT_ID !== config.account_id
  ) {
    throw new Error('CLOUDFLARE_ACCOUNT_ID does not match this project.');
  }
  const domain = config.routes.find((route) => route.custom_domain)?.pattern;
  const bucket = config.r2_buckets.find(
    (binding) => binding.binding === 'MEDIA',
  )?.bucket_name;
  if (!domain || !bucket)
    throw new Error(
      'Configure the custom domain and MEDIA bucket in wrangler.jsonc.',
    );
  const origin = `https://${domain}`;
  await mkdir('.deploy', { recursive: true, mode: 0o700 });
  try {
    await mkdir('.deploy/lock');
    locked = true;
    await writeFile('.deploy/lock/pid', String(process.pid));
  } catch (error) {
    if (error.code === 'EEXIST')
      throw new Error(
        'Another deployment owns .deploy/lock. If it was interrupted, confirm its PID is no longer running before removing that folder.',
      );
    throw error;
  }
  console.log(`Deploying Re-Target to ${origin}`);
  await release({
    async validate() {
      await npm('run', 'deploy:check');
      await npm('run', 'verify');
    },
    async preflight() {
      console.log(
        'Checking Cloudflare access, background queue and media storage...',
      );
      const queues = await wrangler(
        ['queues', 'list', '--config', 'wrangler.jsonc'],
        { capture: true },
      );
      const names = new Set([
        ...(config.queues?.producers ?? []).map((q) => q.queue),
        ...(config.queues?.consumers ?? []).flatMap((q) => [
          q.queue,
          ...(q.dead_letter_queue ? [q.dead_letter_queue] : []),
        ]),
      ]);
      for (const name of names)
        if (!queues.split(/[\s│]+/).includes(name))
          await wrangler([
            'queues',
            'create',
            name,
            '--config',
            'wrangler.jsonc',
          ]);
      await wrangler(['d1', 'info', 'DB', '--config', 'wrangler.jsonc'], {
        capture: true,
      });
      try {
        await wrangler(['r2', 'bucket', 'info', bucket, '--json'], {
          capture: true,
        });
      } catch (error) {
        if (error.message.includes('[code: 10042]')) {
          throw new Error(
            `Enable R2 at https://dash.cloudflare.com/${config.account_id}/r2/overview, then rerun npm run deploy.`,
          );
        }
        if (!error.message.includes('[code: 10006]')) throw error;
        await wrangler([
          'r2',
          'bucket',
          'create',
          bucket,
          '--location',
          'apac',
          '--storage-class',
          'Standard',
          '--update-config=false',
        ]);
      }
      let secrets = [];
      try {
        secrets = JSON.parse(
          await wrangler(
            [
              'secret',
              'list',
              '--config',
              'wrangler.jsonc',
              '--format',
              'json',
            ],
            { capture: true },
          ),
        );
      } catch (error) {
        if (!error.message.includes(`Worker "${config.name}" not found.`))
          throw error;
      }
      const privateFile = '.deploy/production-secrets.json';
      let saved = {};
      try {
        saved = JSON.parse(await readFile(privateFile, 'utf8'));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      const pending = {};
      if (!secrets.some((secret) => secret.name === 'ADMIN_API_TOKEN')) {
        token = saved.ADMIN_API_TOKEN || process.env.ADMIN_API_TOKEN;
        if (!token && process.env.CI)
          throw new Error(
            'First CI deployment requires an ADMIN_API_TOKEN secret of at least 32 characters.',
          );
        token ??= randomBytes(32).toString('hex');
        if (token.length < 32 || token.startsWith('replace-with-'))
          throw new Error(
            'The production admin token must be at least 32 characters.',
          );
        pending.ADMIN_API_TOKEN = token;
      }
      if (!secrets.some((secret) => secret.name === 'ADMIN_PASSWORD_HASH')) {
        const passwordHash =
          saved.ADMIN_PASSWORD_HASH || process.env.ADMIN_PASSWORD_HASH;
        if (
          !/^(?:pbkdf2-sha256:100000|scrypt:16384:8:5):[a-f0-9]{32}:[a-f0-9]{64}$/.test(
            passwordHash ?? '',
          )
        ) {
          throw new Error(
            'Configure ADMIN_PASSWORD_HASH in .deploy/production-secrets.json or the CI secret before deployment.',
          );
        }
        pending.ADMIN_PASSWORD_HASH = passwordHash;
      }
      if (!secrets.some((secret) => secret.name === 'COURIER_ENCRYPTION_KEY')) {
        const key =
          saved.COURIER_ENCRYPTION_KEY ||
          process.env.COURIER_ENCRYPTION_KEY ||
          randomBytes(32).toString('hex');
        if (!/^[a-f0-9]{64}$/.test(key))
          throw new Error(
            'COURIER_ENCRYPTION_KEY must be 64 lowercase hex characters.',
          );
        pending.COURIER_ENCRYPTION_KEY = key;
      }
      for (const name of ['WHATSAPP_WEBHOOK_SECRET', 'MEDIA_PREPARATION_KEY']) {
        if (!secrets.some((secret) => secret.name === name)) {
          const value =
            saved[name] || process.env[name] || randomBytes(32).toString('hex');
          if (value.length < 32)
            throw new Error(`${name} must contain at least 32 characters.`);
          pending[name] = value;
        }
      }
      for (const name of config.secrets.required) {
        if (pending[name] || secrets.some((secret) => secret.name === name)) continue;
        const value = saved[name] || process.env[name];
        if (!value || value.startsWith('replace-with-')) throw new Error(`Configure the missing production secret ${name} before deployment.`);
        if (name === 'ADMIN_PHONE' && !/^01[0-9]{9}$/.test(value)) throw new Error('Configure a valid ADMIN_PHONE.');
        pending[name] = value;
      }
      const transportUrl =
        saved.STEADFAST_TRANSPORT_URL || process.env.STEADFAST_TRANSPORT_URL;
      const transportToken =
        saved.STEADFAST_TRANSPORT_TOKEN ||
        process.env.STEADFAST_TRANSPORT_TOKEN;
      if (transportUrl || transportToken) {
        let url;
        try {
          url = new URL(transportUrl);
        } catch {
          throw new Error('Configure a valid STEADFAST_TRANSPORT_URL.');
        }
        if (
          url.protocol !== 'https:' ||
          url.username ||
          url.password ||
          url.search ||
          url.hash ||
          !transportToken
        ) {
          throw new Error(
            'Configure both STEADFAST_TRANSPORT_URL and STEADFAST_TRANSPORT_TOKEN for the authenticated HTTPS transport.',
          );
        }
        for (const [name, value] of Object.entries({
          STEADFAST_TRANSPORT_URL: transportUrl,
          STEADFAST_TRANSPORT_TOKEN: transportToken,
        })) {
          if (
            process.argv.includes('--refresh-courier-transport') ||
            !secrets.some((secret) => secret.name === name)
          )
            pending[name] = value;
        }
      }
      if (Object.keys(pending).length) {
        await writeFile(privateFile, JSON.stringify({ ...saved, ...pending }), {
          mode: 0o600,
        });
        await chmod(privateFile, 0o600);
        uploadSecretsFile = `.deploy/upload-secrets-${deploymentId}.json`;
        await writeFile(uploadSecretsFile, JSON.stringify(pending), {
          mode: 0o600,
        });
        console.log(
          'Missing production secrets prepared privately for this deployment.',
        );
      } else {
        console.log('Keeping the existing production secrets.');
      }
    },
    async backup() {
      await mkdir('backups', { recursive: true, mode: 0o700 });
      const output = `backups/before-deploy-${deploymentId}.sql`;
      await wrangler(
        [
          'd1',
          'export',
          'DB',
          '--remote',
          '--config',
          'wrangler.jsonc',
          '--output',
          output,
        ],
        { capture: true },
      );
      await chmod(output, 0o600);
      if (process.env.CI) {
        await writeFile(`${output}.encrypted.json`, encryptBackup(await readFile(output), process.env.DATABASE_BACKUP_PUBLIC_KEY), { mode: 0o600 });
        await rm(output);
      }
      console.log(`Database backup saved to ${output}`);
    },
    async migrate() {
      await npm('run', 'db:migrate:production');
    },
    async publish() {
      const args = ['deploy', '--var', `DEPLOYMENT_ID:${deploymentId}`];
      if (uploadSecretsFile) args.push('--secrets-file', uploadSecretsFile);
      await wrangler(args);
    },
    async smoke() {
      await waitForLiveSite(origin, deploymentId, token);
    },
  });
  await writeFile(
    '.deploy/last-success.json',
    JSON.stringify(
      { url: origin, deploymentId, deployedAt: new Date().toISOString() },
      null,
      2,
    ),
  );
  console.log(`\nDeployment verified: ${origin}`);
} catch (error) {
  console.error(`\nDeployment stopped: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (uploadSecretsFile) await rm(uploadSecretsFile, { force: true });
  if (locked) await rm('.deploy/lock', { recursive: true, force: true });
}
