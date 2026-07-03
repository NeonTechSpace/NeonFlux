import { v } from 'convex/values';

export const jsonValue = v.any();
export const timestamp = v.string();
export const optionalTimestamp = v.optional(v.string());
export const optionalString = v.optional(v.string());
export const optionalNumber = v.optional(v.number());

export const encryptedOAuthTokenPayload = v.object({
    authTag: v.string(),
    ciphertext: v.string(),
    iv: v.string(),
    version: v.string(),
});
