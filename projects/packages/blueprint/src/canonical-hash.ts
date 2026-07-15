import { canonicalJsonStringify } from './canonical-json.js';

export async function sha256CanonicalJson(value: unknown): Promise<string> {
    const encoded = new TextEncoder().encode(canonicalJsonStringify(value));
    const digest = await globalThis.crypto.subtle.digest('SHA-256', encoded);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
