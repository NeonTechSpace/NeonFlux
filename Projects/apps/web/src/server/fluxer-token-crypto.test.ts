import { Buffer } from 'node:buffer';

import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { decryptFluxerToken, encryptFluxerToken } from './fluxer-token-crypto.js';
import type { EncryptedFluxerToken } from './fluxer-token-crypto.js';

const encryptionKey = Buffer.alloc(32, 1).toString('base64url');
const otherEncryptionKey = Buffer.alloc(32, 2).toString('base64url');
const token = 'fluxer-token:secret/value';

describe('encryptFluxerToken', () => {
    it('encrypts and decrypts a Fluxer token', () => {
        const encryptedToken = unwrap(encryptFluxerToken({ token, encryptionKey }));

        const decryptedToken = decryptFluxerToken({
            encryptedToken,
            encryptionKey,
        });

        expect(decryptedToken.isOk()).toBe(true);
        expect(decryptedToken._unsafeUnwrap()).toBe(token);
    });

    it('encrypts the same token with different ciphertext because the IV is random', () => {
        const firstToken = unwrap(encryptFluxerToken({ token, encryptionKey }));
        const secondToken = unwrap(encryptFluxerToken({ token, encryptionKey }));

        expect(firstToken.iv).not.toBe(secondToken.iv);
        expect(firstToken.ciphertext).not.toBe(secondToken.ciphertext);
    });

    it('does not expose the token value in the encrypted payload JSON', () => {
        const encryptedToken = unwrap(encryptFluxerToken({ token, encryptionKey }));

        expect(JSON.stringify(encryptedToken)).not.toContain(token);
    });

    it('returns missing-key when the encryption key is missing', () => {
        const result = encryptFluxerToken({ token, encryptionKey: undefined });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('missing-key');
    });

    it('returns invalid-key when the encryption key is malformed', () => {
        const result = encryptFluxerToken({ token, encryptionKey: 'not-a-32-byte-key' });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('invalid-key');
    });
});

describe('decryptFluxerToken', () => {
    it('returns invalid-payload when the payload version is unsupported', () => {
        const encryptedToken = unwrap(encryptFluxerToken({ token, encryptionKey }));

        const result = decryptFluxerToken({
            encryptedToken: {
                ...encryptedToken,
                version: 'v2',
            } as unknown as EncryptedFluxerToken,
            encryptionKey,
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('invalid-payload');
    });

    it('returns invalid-payload when the IV is malformed', () => {
        const encryptedToken = unwrap(encryptFluxerToken({ token, encryptionKey }));

        const result = decryptFluxerToken({
            encryptedToken: {
                ...encryptedToken,
                iv: 'not valid base64url!',
            },
            encryptionKey,
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('invalid-payload');
    });

    it('returns invalid-payload when the auth tag is malformed', () => {
        const encryptedToken = unwrap(encryptFluxerToken({ token, encryptionKey }));

        const result = decryptFluxerToken({
            encryptedToken: {
                ...encryptedToken,
                authTag: Buffer.alloc(8, 1).toString('base64url'),
            },
            encryptionKey,
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('invalid-payload');
    });

    it('returns decrypt-failed when the ciphertext is tampered with', () => {
        const encryptedToken = unwrap(encryptFluxerToken({ token, encryptionKey }));

        const result = decryptFluxerToken({
            encryptedToken: {
                ...encryptedToken,
                ciphertext: tamperBase64UrlBytes(encryptedToken.ciphertext),
            },
            encryptionKey,
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('decrypt-failed');
    });

    it('returns decrypt-failed when the auth tag is tampered with', () => {
        const encryptedToken = unwrap(encryptFluxerToken({ token, encryptionKey }));

        const result = decryptFluxerToken({
            encryptedToken: {
                ...encryptedToken,
                authTag: tamperBase64UrlBytes(encryptedToken.authTag),
            },
            encryptionKey,
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('decrypt-failed');
    });

    it('returns decrypt-failed when a different valid key is used', () => {
        const encryptedToken = unwrap(encryptFluxerToken({ token, encryptionKey }));

        const result = decryptFluxerToken({
            encryptedToken,
            encryptionKey: otherEncryptionKey,
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('decrypt-failed');
    });
});

function unwrap<TValue, TError>(result: Result<TValue, TError>): TValue {
    expect(result.isOk()).toBe(true);

    return result._unsafeUnwrap();
}

function tamperBase64UrlBytes(value: string): string {
    const decodedValue = Buffer.from(value, 'base64url');
    decodedValue[0] ^= 1;

    return decodedValue.toString('base64url');
}
