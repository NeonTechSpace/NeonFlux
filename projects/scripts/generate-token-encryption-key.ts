import { createTokenEncryptionKey } from './token-encryption-key.js';

process.stdout.write(`${createTokenEncryptionKey()}\n`);
