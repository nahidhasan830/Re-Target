# Encrypted deployment backup recovery

CI saves the D1 export in a versioned JSON envelope encrypted with AES-256-GCM. Its random data key is encrypted with the configured RSA public key using OAEP with SHA-256. The seven-day GitHub artifact contains only encrypted data; the private key is never required by CI.

Download the encrypted artifact to a trusted machine and use the corresponding private key:

```sh
node scripts/decrypt-backup.mjs backups/before-deploy.sql.encrypted.json .deploy/backup-private.pem backups/recovered.sql
```

Replace the example filename with the downloaded artifact's filename. The script authenticates the encrypted content before writing plaintext, creates an owner-only file, and refuses to overwrite an existing output. Wrong keys and modified envelopes fail decryption.

Inspect and retain the recovered export privately. It includes customer data, password/session verifiers, and encrypted courier credentials. Database restoration is a separate operational action: stop writers and queued work, preserve the current database, and review the restore procedure before applying SQL to the live D1 database. Do not use the application development server or automated tests to restore or seed data.

Back up the courier encryption key separately and retain the private key corresponding to every retained backup public key. Rotating a backup key does not re-encrypt older artifacts. Without the original private key, encrypted artifacts are unrecoverable. Keep verified backups outside GitHub if seven days is insufficient.

Local deployments continue to keep ignored, owner-only SQL exports under `backups/`; encrypt them before transferring them to another system.
