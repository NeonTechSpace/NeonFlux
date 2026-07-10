export function publicAuthEnv(): NodeJS.ProcessEnv {
    const jwks = `data:application/json,${encodeURIComponent(
        JSON.stringify({
            keys: [{ alg: 'RS256', e: 'AQAB', kid: 'test-key', kty: 'RSA', n: 'abc123', use: 'sig' }],
        })
    )}`;
    const env: NodeJS.ProcessEnv = {};
    for (const kind of ['BOT', 'WEB', 'USER']) {
        env[`NEONFLUX_${kind}_AUTH_JWT_AUDIENCE`] = `neonflux-convex-${kind.toLowerCase()}`;
        env[`NEONFLUX_${kind}_AUTH_JWT_ISSUER`] = `https://neonflux.example/${kind.toLowerCase()}`;
        env[`NEONFLUX_${kind}_AUTH_JWT_JWKS`] = jwks;
    }
    return env;
}
