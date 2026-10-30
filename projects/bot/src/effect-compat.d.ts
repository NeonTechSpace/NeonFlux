import type { JsonWebKey as NodeJsonWebKey, webcrypto } from "node:crypto"

// Effect 4.1's declarations reference these DOM types even in Node-only applications. Each is taken from Node's own
// declaration of the same thing. Remove JsonWebKey when a release includes Effect-TS/effect#10116, and CryptoKey when one
// fixes Effect-TS/effect#10196
declare global {
    // Node declares CryptoKey only as a value, so the interface adds the type under the same name
    interface CryptoKey extends webcrypto.CryptoKey {}
    interface JsonWebKey extends NodeJsonWebKey {}
}
