import { constants, createCipheriv, createPublicKey, publicEncrypt, randomBytes } from 'node:crypto';

export function backupPublicKey(pem) {
  const key = createPublicKey(pem);
  if (key.asymmetricKeyType !== 'rsa' || key.asymmetricKeyDetails.modulusLength < 2048) {
    throw new Error('Use an RSA backup public key of at least 2048 bits.');
  }
  return key;
}

export function encryptBackup(bytes, pem) {
  const key = randomBytes(32), iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from('retarget-backup-v1'));
  const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return JSON.stringify({
    version: 1,
    algorithm: 'RSA-OAEP-SHA256+AES-256-GCM',
    key: publicEncrypt({ key: backupPublicKey(pem), padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, key).toString('base64'),
    iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: encrypted.toString('base64'),
  });
}
