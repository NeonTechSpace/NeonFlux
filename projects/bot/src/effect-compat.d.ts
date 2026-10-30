import type { JsonWebKey as NodeJsonWebKey, webcrypto } from "node:crypto"

// Effect 4.1's declarations reference these DOM types even in Node-only applications. Each is taken from Node's own
// declaration of the same thing. Remove an entry when Effect no longer requires the missing global type
declare global {
    // Node declares CryptoKey only as a value, so the interface adds the type under the same name
    interface CryptoKey extends webcrypto.CryptoKey {}
    interface JsonWebKey extends NodeJsonWebKey {}
}
