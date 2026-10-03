import { setTimeout as delay } from 'node:timers/promises';
import { lookup, resolve4 } from 'node:dns';
import { request as httpsRequest } from 'node:https';
import { Readable } from 'node:stream';

function deploymentLookup(hostname, options, callback) {
  lookup(hostname, options, (error, address, family) => {
    if (error?.code !== 'ENOTFOUND') return callback(error, address, family);
    // macOS can retain a negative system lookup after a new domain starts resolving.
    resolve4(hostname, (dnsError, addresses) => {
      if (dnsError) return callback(dnsError);
      if (options.all) callback(null, addresses.map((value) => ({ address: value, family: 4 })));
      else callback(null, addresses[0], 4);
    });
  });
}

function liveRequest(url, options) {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(url, { headers: options.headers, signal: options.signal, lookup: deploymentLookup }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400) {
        res.resume();
        reject(new Error('Unexpected redirect from the deployment domain.'));
        return;
      }
      resolve(new Response(Readable.toWeb(res), { status: res.statusCode, headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

export async function release(steps) {
  await steps.validate();
  await steps.preflight();
  await steps.backup();
  await steps.migrate();
  await steps.publish();
  await steps.smoke();
}

export async function checkLiveSite(origin, deploymentId, token, request = liveRequest) {
  const get = (path, headers = {}) => request(new URL(path, origin), {
    headers, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10000),
  });
  const health = await get('/api/health');
  if (health.status !== 200 || (await health.json()).status !== 'ok') {
    throw new Error('Live database or media storage is not ready.');
  }
  if (health.headers.get('x-deployment-id') !== deploymentId) {
    throw new Error('The domain is not serving this deployment yet.');
  }
  const home = await get('/');
  if (home.status !== 200) throw new Error('The home page is unavailable.');
  await home.body?.cancel();
  const unauthorized = await get('/api/products');
  if (unauthorized.status !== 401) throw new Error('The admin API did not reject an unauthenticated request.');
  await unauthorized.body?.cancel();
  if (token) {
    const authorized = await get('/api/products?limit=1', { Authorization: `Bearer ${token}` });
    if (authorized.status !== 200) throw new Error('The production admin secret was not accepted.');
    await authorized.body?.cancel();
  }
}

export async function waitForLiveSite(origin, deploymentId, token) {
  let lastError;
  for (let attempt = 0; attempt < 18; attempt++) {
    try {
      await checkLiveSite(origin, deploymentId, token);
      return;
    } catch (error) {
      lastError = error;
      console.log(`Waiting for DNS, HTTPS, and the new deployment (${attempt + 1}/18)...`);
      await delay(5000);
    }
  }
  throw new Error(`Deployment was uploaded, but verification failed: ${lastError.message} Check the custom domain and Cloudflare logs; rerun npm run deploy after resolving the issue.`);
}
