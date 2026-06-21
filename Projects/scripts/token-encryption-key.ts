import { randomBytes } from 'node:crypto';

const tokenEncryptionKeyByteLength = 32;

export function createTokenEncryptionKey(): string {
    return randomBytes(tokenEncryptionKeyByteLength).toString('base64url');
}
