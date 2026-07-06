import { createPrivateKey } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createConvexPrivateKeyEnvValue, createConvexPrivateKeyPem } from './generate-convex-private-key.js';

describe('createConvexPrivateKeyPem', () => {
    it('generates an RSA PKCS8 private key', () => {
        const privateKeyPem = createConvexPrivateKeyPem();
        const key = createPrivateKey(privateKeyPem);

        expect(privateKeyPem).toMatch(/^-----BEGIN PRIVATE KEY-----\n/u);
        expect(privateKeyPem).toContain('\n-----END PRIVATE KEY-----\n');
        expect(key.asymmetricKeyType).toBe('rsa');
        expect(key.asymmetricKeyDetails?.modulusLength).toBe(2048);
    });

    it('formats the key as a single-line env value', () => {
        const envValue = createConvexPrivateKeyEnvValue();
        const key = createPrivateKey(envValue.replaceAll('\\n', '\n'));

        expect(envValue).toMatch(/^-----BEGIN PRIVATE KEY-----\\n/u);
        expect(envValue).toMatch(/\\n-----END PRIVATE KEY-----$/u);
        expect(envValue).not.toContain('\n');
        expect(key.asymmetricKeyType).toBe('rsa');
    });
});
