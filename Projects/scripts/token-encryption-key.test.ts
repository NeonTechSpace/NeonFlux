import { Buffer } from 'node:buffer';

import { describe, expect, it } from 'vitest';

import { createTokenEncryptionKey } from './token-encryption-key.js';

describe('createTokenEncryptionKey', () => {
    it('generates nonempty 32-byte base64url keys', () => {
        const key = createTokenEncryptionKey();
        const decodedKey = Buffer.from(key, 'base64url');

        expect(key).toHaveLength(43);
        expect(key).toMatch(/^[A-Za-z0-9_-]+$/);
        expect(decodedKey).toHaveLength(32);
    });
});
