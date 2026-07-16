import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const sentinel = 'neonflux-e2e-ephemeral-v1';
const webDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const expectedStatePath = resolve(webDirectory, '.e2e-runtime', 'provider-state.json');
const configuredStatePath = process.env.NEONFLUX_E2E_PROVIDER_STATE_PATH;
const fluxerGuildsUrl = 'https://api.fluxer.app/v1/users/@me/guilds';
const botInternalApiOrigin = 'http://neonflux-e2e-provider.invalid';

if (process.env.NEONFLUX_E2E_AUTHENTICATED !== sentinel || process.env.NEONFLUX_E2E_EPHEMERAL_SENTINEL !== sentinel) {
    throw new Error('Refusing to install the provider fixture outside authenticated ephemeral E2E.');
}
if (!configuredStatePath || resolve(configuredStatePath) !== expectedStatePath) {
    throw new Error('Authenticated provider fixture references an unowned state file.');
}

const networkFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (url.origin + url.pathname === fluxerGuildsUrl) {
        requireBearerAuthorization(input, init, 'Fluxer guild fixture');
        const state = await readState();
        return Response.json([state.guild]);
    }
    if (url.origin === botInternalApiOrigin && /^\/v1\/provider\/guilds\/[^/]+\/structure$/u.test(url.pathname)) {
        requireBearerAuthorization(input, init, 'bot internal API fixture');
        const state = await readState();
        return Response.json({ protocolVersion: 1, type: 'structure', structure: state.structure });
    }
    if (url.origin === botInternalApiOrigin && url.pathname === '/v1/posting/worker/wake') {
        requireBearerAuthorization(input, init, 'bot internal API posting-control fixture');
        if ((init?.method ?? (input instanceof Request ? input.method : 'GET')) !== 'POST' || init?.body) {
            throw new Error('Bot internal API posting-control fixture received an invalid request.');
        }
        return Response.json({ protocolVersion: 1, type: 'accepted' }, { status: 202 });
    }
    return networkFetch(input, init);
};

async function readState() {
    const value = JSON.parse(await readFile(expectedStatePath, 'utf8'));
    if (!value || typeof value !== 'object' || value.sentinel !== sentinel || !value.guild || !value.structure) {
        throw new Error('Authenticated provider fixture state is invalid.');
    }
    return value;
}

function requireBearerAuthorization(input, init, boundary) {
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
    if (!headers.get('authorization')?.startsWith('Bearer ')) {
        throw new Error(`${boundary} received an unauthenticated request.`);
    }
}
