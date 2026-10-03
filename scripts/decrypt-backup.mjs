import { constants, createDecipheriv, privateDecrypt } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export function decryptBackup(envelope, privateKey) {
  if (envelope.version !== 1 || envelope.algorithm !== 'RSA-OAEP-SHA256+AES-256-GCM' ||
      !['key', 'iv', 'tag', 'data'].every(name => typeof envelope[name] === 'string') ||
      Buffer.from(envelope.iv, 'base64').length !== 12 || Buffer.from(envelope.tag, 'base64').length !== 16) {
    throw new Error('Invalid backup envelope.');
  }
  const key = privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, Buffer.from(envelope.key, 'base64'));
  const cipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
  cipher.setAAD(Buffer.from('retarget-backup-v1'));
  cipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  return Buffer.concat([cipher.update(Buffer.from(envelope.data, 'base64')), cipher.final()]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.umask(0o077);
  try {
    const [input, keyPath, output, extra] = process.argv.slice(2);
    if (!input || !keyPath || !output || extra) throw new Error('Usage: node scripts/decrypt-backup.mjs <encrypted.json> <private-key.pem> <output.sql>');
    const bytes = decryptBackup(JSON.parse(await readFile(input, 'utf8')), await readFile(keyPath, 'utf8'));
    await writeFile(output, bytes, { mode: 0o600, flag: 'wx' });
    console.log('Backup decrypted into a new owner-only file.');
  } catch {
    console.error('Backup decryption failed. Check the arguments, private key, envelope integrity, and that the output does not already exist.');
    process.exitCode = 1;
  }
}
