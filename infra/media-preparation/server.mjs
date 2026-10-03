import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { mkdtemp, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';

const imageLimit = 5 * 1024 * 1024,
  videoLimit = 100 * 1024 * 1024;
export function mediaKind(bytes, mime) {
  if (
    mime === 'image/jpeg' &&
    bytes[0] === 255 &&
    bytes[1] === 216 &&
    bytes[2] === 255
  )
    return 'image';
  if (
    mime === 'image/png' &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return 'image';
  if (mime === 'video/mp4' && bytes.subarray(4, 8).toString() === 'ftyp')
    return 'video';
  throw new Error('File content does not match JPEG, PNG, or MP4.');
}
async function execute(bin, args, timeout = 90000) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    const chunks = [];
    let size = 0;
    const timer = setTimeout(() => child.kill('SIGKILL'), timeout);
    child.stdout.on('data', (chunk) => {
      size += chunk.length;
      if (size > 256000) child.kill('SIGKILL');
      else chunks.push(chunk);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      code === 0
        ? resolve(Buffer.concat(chunks).toString())
        : reject(new Error('Media validation or conversion failed.'));
    });
  });
}
export async function prepare(bytes, mime, background = '#ffffff') {
  const kind = mediaKind(bytes, mime);
  if (
    bytes.length > (kind === 'image' ? imageLimit : videoLimit) ||
    !/^#[0-9a-fA-F]{6}$/.test(background)
  )
    throw new Error(
      'File exceeds the application limit or has an invalid background.',
    );
  if (kind === 'image') {
    const image = sharp(bytes, {
      limitInputPixels: 16000000,
      failOn: 'warning',
    });
    const meta = await image.metadata();
    if (
      !meta.width ||
      !meta.height ||
      meta.width > 4096 ||
      meta.height > 4096 ||
      (meta.pages ?? 1) > 1
    )
      throw new Error('Use a still image no larger than 4096 × 4096.');
    const { data, info } = await image
      .rotate()
      .flatten({ background })
      .jpeg({ quality: 85 })
      .toBuffer({ resolveWithObject: true });
    if (data.length > imageLimit)
      throw new Error('Prepared image exceeds 5 MB.');
    return {
      data,
      mime: 'image/jpeg',
      kind,
      width: info.width,
      height: info.height,
    };
  }
  const dir = await mkdtemp(join(tmpdir(), 'retarget-media-'));
  try {
    const source = join(dir, 'input.mp4'),
      output = join(dir, 'output.mp4');
    await writeFile(source, bytes);
    const probe = JSON.parse(
      await execute(
        'ffprobe',
        [
          '-v',
          'error',
          '-protocol_whitelist',
          'file,pipe',
          '-show_streams',
          '-show_format',
          '-of',
          'json',
          source,
        ],
        15000,
      ),
    );
    const videos = probe.streams.filter((s) => s.codec_type === 'video'),
      audio = probe.streams.filter((s) => s.codec_type === 'audio');
    const video = videos[0];
    if (
      videos.length !== 1 ||
      audio.length > 1 ||
      !video.width ||
      !video.height ||
      video.width > 4096 ||
      video.height > 4096 ||
      Number(probe.format.duration) <= 0 ||
      Number(probe.format.duration) > 300 ||
      !Number.isFinite(Number(probe.format.duration))
    )
      throw new Error(
        'Use one valid video, at most five minutes and 4096 × 4096.',
      );
    await execute('ffmpeg', [
      '-v',
      'error',
      '-nostdin',
      '-protocol_whitelist',
      'file,pipe',
      '-i',
      source,
      '-map',
      '0:v:0',
      '-map',
      '0:a:0?',
      '-map_metadata',
      '-1',
      '-vf',
      "scale='min(1280,iw)':-2",
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '26',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '96k',
      '-movflags',
      '+faststart',
      '-threads',
      '2',
      '-y',
      output,
    ]);
    if ((await stat(output)).size > videoLimit)
      throw new Error('Prepared video exceeds 100 MB.');
    const final = JSON.parse(
      await execute(
        'ffprobe',
        ['-v', 'error', '-show_streams', '-of', 'json', output],
        15000,
      ),
    );
    const prepared = final.streams.find((s) => s.codec_type === 'video');
    if (
      prepared.codec_name !== 'h264' ||
      prepared.pix_fmt !== 'yuv420p' ||
      final.streams.some(
        (s) => s.codec_type === 'audio' && s.codec_name !== 'aac',
      )
    )
      throw new Error('Video compatibility validation failed.');
    return {
      data: await readFile(output),
      mime: 'video/mp4',
      kind,
      width: prepared.width,
      height: prepared.height,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
export function mediaServer(key) {
  let active = 0;
  return createServer(async (req, res) => {
    const respond = (status, message) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: message }));
    };
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const authorization = req.headers.authorization ?? '';
    const supplied = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (
      !authorization.startsWith('Bearer ') ||
      !key ||
      key.length < 32 ||
      !timingSafeEqual(
        createHash('sha256').update(supplied).digest(),
        createHash('sha256').update(key).digest(),
      )
    )
      return respond(401, 'Unauthorized.');
    if (req.url !== '/prepare' || req.method !== 'POST')
      return respond(404, 'Not found.');
    if (active >= 2)
      return respond(429, 'Media preparation is busy. Retry the upload.');
    active++;
    try {
      const mime = req.headers['content-type']?.split(';')[0],
        limit = mime?.startsWith('image/') ? imageLimit : videoLimit;
      if (!['image/jpeg', 'image/png', 'video/mp4'].includes(mime))
        return respond(415, 'Use JPEG, PNG, or MP4.');
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > limit) {
          respond(413, 'File is too large.');
          req.destroy();
          return;
        }
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks),
        result = await prepare(
          bytes,
          mime,
          req.headers['x-background'] ?? '#ffffff',
        );
      res.writeHead(200, {
        'Content-Type': result.mime,
        'Content-Length': result.data.length,
        'X-Media-Width': result.width,
        'X-Media-Height': result.height,
        'X-Media-Checksum': createHash('sha256')
          .update(result.data)
          .digest('hex'),
        'X-Original-Checksum': createHash('sha256').update(bytes).digest('hex'),
      });
      res.end(result.data);
    } catch {
      respond(
        422,
        'The file could not be prepared. Use a valid still JPEG/PNG image or MP4 video.',
      );
    } finally {
      active--;
    }
  });
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  if (
    !process.env.MEDIA_PREPARATION_KEY ||
    process.env.MEDIA_PREPARATION_KEY.length < 32
  )
    throw new Error('Set MEDIA_PREPARATION_KEY to at least 32 characters.');
  mediaServer(process.env.MEDIA_PREPARATION_KEY).listen(
    Number(process.env.PORT ?? 3001),
    '0.0.0.0',
  );
}
