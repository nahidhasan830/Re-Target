import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const path = createRequire(import.meta.url).resolve('http-cache-semantics');
const originalDigest = '01b7d66c854b2fe53ac05c98feb6e0d64722ab8898a778e2d2426a8b468d178f';
const before = '        this._assertRequestHasHeaders(req);\n\n        // In all circumstances';
const after = '        this._assertRequestHasHeaders(req);\n\n        // Re-Target: never reuse security-zeroed entries (GHSA-ch52-4w7c-c8xp).\n        if (!this.storable() || this.maxAge() <= 0) {\n            return this._evaluateRequestMissResult(req);\n        }\n\n        // In all circumstances';
const source = await readFile(path, 'utf8');
const normalized = source.replace(after, before);
if (createHash('sha256').update(normalized).digest('hex') !== originalDigest || !normalized.includes(before)) {
  throw new Error('Cache-policy dependency changed. Review the security mitigation before installing or building.');
}
if (source === normalized) await writeFile(path, source.replace(before, after));
