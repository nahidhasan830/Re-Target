import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { mediaKind, prepare, mediaServer } from './server.mjs';
const key = 'synthetic-preparation-key-at-least-32-characters',
  server = mediaServer(key);
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
after(() => new Promise((resolve) => server.close(resolve)));
test('transparent PNG is flattened to a metadata-free JPEG and JPEG remains valid', async () => {
  const png = await sharp({
    create: {
      width: 32,
      height: 24,
      channels: 4,
      background: { r: 255, g: 0, b: 0, alpha: 0 },
    },
  })
    .png()
    .toBuffer();
  const result = await prepare(png, 'image/png', '#ffffff');
  assert.equal(result.mime, 'image/jpeg');
  assert.equal(result.width, 32);
  assert.equal(result.height, 24);
  const metadata = await sharp(result.data).metadata();
  assert.equal(metadata.format, 'jpeg');
  assert.equal(metadata.hasAlpha, false);
  assert.equal(metadata.exif, undefined);
  assert.equal((await prepare(result.data, 'image/jpeg')).mime, 'image/jpeg');
});
test('forged MIME, malformed containers and oversized files are rejected', async () => {
  assert.throws(() => mediaKind(Buffer.from('<svg>unsafe</svg>'), 'image/png'));
  await assert.rejects(
    prepare(Buffer.from([255, 216, 255, 0, 0, 0]), 'image/jpeg'),
  );
  await assert.rejects(
    prepare(
      Buffer.concat([
        Buffer.from([255, 216, 255]),
        Buffer.alloc(5 * 1024 * 1024),
      ]),
      'image/jpeg',
    ),
  );
  await assert.rejects(prepare(Buffer.from('0000ftypmalformed'), 'video/mp4'));
});
test('MP4 is normalized once to H.264, AAC, yuv420p and a playable MP4', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'retarget-video-'));
  try {
    const source = join(dir, 'source.mp4');
    await promisify(execFile)('ffmpeg', [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=c=green:s=64x48:d=1',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=500:duration=1',
      '-c:v',
      'mpeg4',
      '-c:a',
      'aac',
      '-shortest',
      '-y',
      source,
    ]);
    const result = await prepare(await readFile(source), 'video/mp4');
    assert.equal(result.mime, 'video/mp4');
    assert.equal(result.width, 64);
    assert.equal(result.height, 48);
    assert.equal(result.data.subarray(4, 8).toString(), 'ftyp');
    const original = await readFile(source),
      padded = Buffer.alloc(100 * 1024 * 1024);
    original.copy(padded);
    padded.writeUInt32BE(padded.length - original.length, original.length);
    padded.write('free', original.length + 4);
    const response = await fetch(`${base}/prepare`, {
      method: 'POST',
      headers: { 'Content-Type': 'video/mp4', Authorization: `Bearer ${key}` },
      body: padded,
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'video/mp4');
    const normalized = Buffer.from(await response.arrayBuffer());
    assert.equal(normalized.subarray(4, 8).toString(), 'ftyp');
    assert.ok(normalized.length <= padded.length);
    await assert.rejects(
      prepare(Buffer.concat([padded, Buffer.alloc(1)]), 'video/mp4'),
      /exceeds the application limit/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('preparation requires authentication and returns bounded binary output with checksums', async () => {
  const png = await sharp({
    create: { width: 10, height: 10, channels: 3, background: '#17603d' },
  })
    .png()
    .toBuffer();
  assert.equal(
    (
      await fetch(`${base}/prepare`, {
        method: 'POST',
        headers: { 'Content-Type': 'image/png' },
        body: png,
      })
    ).status,
    401,
  );
  for (const authorization of [key, `Basic ${key}`, 'Bearer wrong']) {
    const response = await fetch(`${base}/prepare`, { method: 'POST', headers: { 'Content-Type': 'image/png', Authorization: authorization }, body: png });
    assert.equal(response.status, 401);
  }
  const result = await fetch(`${base}/prepare`, {
    method: 'POST',
    headers: { 'Content-Type': 'image/png', Authorization: `Bearer ${key}` },
    body: png,
  });
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('content-type'), 'image/jpeg');
  assert.match(result.headers.get('x-media-checksum'), /^[a-f0-9]{64}$/);
  assert.ok((await result.arrayBuffer()).byteLength < 5 * 1024 * 1024);
});
