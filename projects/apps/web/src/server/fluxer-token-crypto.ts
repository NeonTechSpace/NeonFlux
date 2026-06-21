import '@tanstack/react-start/server-only';

import { Buffer } from 'node:buffer';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

export type EncryptedFluxerToken = {
    version: 'v1';
    iv: string;
    ciphertext: string;
    authTag: string;
};

export type FluxerTokenCryptoError = 'missing-key' | 'invalid-key' | 'invalid-payload' | 'decrypt-failed';

type StoredEncryptedFluxerToken = Omit<EncryptedFluxerToken, 'version'> & {
    version: string;
};

const algorithm = 'aes-256-gcm';
const encryptionKeyByteLength = 32;
const ivByteLength = 12;
const authTagByteLength = 16;
const base64UrlPattern = /^[A-Za-z0-9_-]+$/;

export function encryptFluxerToken(input: {
    token: string;
    encryptionKey: string | undefined;
}): Result<EncryptedFluxerToken, FluxerTokenCryptoError> {
    const keyResult = parseEncryptionKey(input.encryptionKey);

    if (keyResult.isErr()) {
        return err(keyResult.error);
    }

    const iv = randomBytes(ivByteLength);
    const cipher = createCipheriv(algorithm, keyResult.value, iv);
    const ciphertext = Buffer.concat([cipher.update(input.token, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return ok({
        version: 'v1',
        iv: iv.toString('base64url'),
        ciphertext: ciphertext.toString('base64url'),
        authTag: authTag.toString('base64url'),
    });
}

export function decryptFluxerToken(input: {
    encryptedToken: EncryptedFluxerToken;
    encryptionKey: string | undefined;
}): Result<string, FluxerTokenCryptoError> {
    const keyResult = parseEncryptionKey(input.encryptionKey);

    if (keyResult.isErr()) {
        return err(keyResult.error);
    }

    const payloadResult = parseEncryptedToken(input.encryptedToken);

    if (payloadResult.isErr()) {
        return err(payloadResult.error);
    }

    try {
        const decipher = createDecipheriv(algorithm, keyResult.value, payloadResult.value.iv);
        decipher.setAuthTag(payloadResult.value.authTag);

        return ok(Buffer.concat([decipher.update(payloadResult.value.ciphertext), decipher.final()]).toString('utf8'));
    } catch {
        return err('decrypt-failed');
    }
}

function parseEncryptionKey(encryptionKey: string | undefined): Result<Buffer, 'missing-key' | 'invalid-key'> {
    const trimmedKey = encryptionKey?.trim();

    if (!trimmedKey) {
        return err('missing-key');
    }

    const decodedKey = decodeBase64Url(trimmedKey);

    if (!decodedKey || decodedKey.length !== encryptionKeyByteLength) {
        return err('invalid-key');
    }

    return ok(decodedKey);
}

function parseEncryptedToken(encryptedToken: StoredEncryptedFluxerToken): Result<
    {
        iv: Buffer;
        ciphertext: Buffer;
        authTag: Buffer;
    },
    'invalid-payload'
> {
    if (encryptedToken.version !== 'v1') {
        return err('invalid-payload');
    }

    const iv = decodeBase64Url(encryptedToken.iv);
    const ciphertext = decodeBase64Url(encryptedToken.ciphertext);
    const authTag = decodeBase64Url(encryptedToken.authTag);

    if (
        !iv ||
        iv.length !== ivByteLength ||
        !ciphertext ||
        ciphertext.length === 0 ||
        !authTag ||
        authTag.length !== authTagByteLength
    ) {
        return err('invalid-payload');
    }

    return ok({ iv, ciphertext, authTag });
}

function decodeBase64Url(value: string): Buffer | undefined {
    if (!base64UrlPattern.test(value)) {
        return undefined;
    }

    try {
        return Buffer.from(value, 'base64url');
    } catch {
        return undefined;
    }
}
