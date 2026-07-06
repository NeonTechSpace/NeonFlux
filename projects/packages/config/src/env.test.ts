import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadBotConfig, loadConvexConfig, loadRuntimeConfig, loadWebConfig, requireConvexConfig } from './env.js';

const originalCwd = process.cwd();
const originalFluxerBotInviteUrl = process.env.FLUXER_BOT_INVITE_URL;
const originalFluxerAppId = process.env.FLUXER_APP_ID;
const tempEnvDirs: string[] = [];

afterEach(() => {
    process.chdir(originalCwd);
    restoreProcessEnvValue('FLUXER_BOT_INVITE_URL', originalFluxerBotInviteUrl);
    restoreProcessEnvValue('FLUXER_APP_ID', originalFluxerAppId);

    for (const dir of tempEnvDirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

describe('loadBotConfig', () => {
    it('fails when single mode does not include SINGLE_GUILD_ID', () => {
        expect(() => loadBotConfig({ INSTANCE_MODE: 'single' })).toThrow('SINGLE_GUILD_ID is required');
    });

    it('loads single mode with SINGLE_GUILD_ID', () => {
        const config = loadBotConfig({
            INSTANCE_MODE: 'single',
            SINGLE_GUILD_ID: '123',
        });

        expect(config).toMatchObject({
            instanceMode: 'single',
            singleGuildId: '123',
        });
    });

    it('loads multi mode without SINGLE_GUILD_ID', () => {
        const config = loadBotConfig({
            INSTANCE_MODE: 'multi',
        });

        expect(config).toMatchObject({
            instanceMode: 'multi',
        });
        expect('singleGuildId' in config).toBe(false);
    });

    it('loads and normalizes the optional public web origin', () => {
        const config = loadBotConfig({
            PUBLIC_WEB_URL: ' https://neonflux.example/ ',
        });

        expect(config.publicWebUrl).toBe('https://neonflux.example');
    });

    it('omits a blank public web origin', () => {
        const config = loadBotConfig({
            PUBLIC_WEB_URL: '   ',
        });

        expect(config.publicWebUrl).toBeUndefined();
    });

    it('loads optional bot custom status text', () => {
        const config = loadBotConfig({
            FLUXER_BOT_CUSTOM_STATUS: '  Testing NeonFlux  ',
        });

        expect(config.fluxerBotCustomStatusText).toBe('Testing NeonFlux');
    });

    it('omits a blank bot custom status text', () => {
        const config = loadBotConfig({
            FLUXER_BOT_CUSTOM_STATUS: '   ',
        });

        expect(config.fluxerBotCustomStatusText).toBeUndefined();
    });

    it('rejects public web URLs with a path, query, hash, or credentials', () => {
        expect(() => loadBotConfig({ PUBLIC_WEB_URL: 'https://neonflux.example/docs' })).toThrow(
            'PUBLIC_WEB_URL must be an origin without path, query, hash, or credentials'
        );
        expect(() => loadBotConfig({ PUBLIC_WEB_URL: 'https://neonflux.example?x=1' })).toThrow(
            'PUBLIC_WEB_URL must be an origin without path, query, hash, or credentials'
        );
        expect(() => loadBotConfig({ PUBLIC_WEB_URL: 'https://neonflux.example#docs' })).toThrow(
            'PUBLIC_WEB_URL must be an origin without path, query, hash, or credentials'
        );
        expect(() => loadBotConfig({ PUBLIC_WEB_URL: 'https://user:pass@neonflux.example' })).toThrow(
            'PUBLIC_WEB_URL must be an origin without path, query, hash, or credentials'
        );
    });

    it('rejects non-http public web URLs', () => {
        expect(() => loadBotConfig({ PUBLIC_WEB_URL: 'ftp://neonflux.example' })).toThrow(
            'PUBLIC_WEB_URL must be a valid HTTP or HTTPS origin'
        );
    });

    it('rejects malformed public web URLs', () => {
        expect(() => loadBotConfig({ PUBLIC_WEB_URL: 'neonflux.example' })).toThrow(
            'PUBLIC_WEB_URL must be a valid HTTP or HTTPS origin'
        );
    });
});

describe('loadWebConfig', () => {
    it('loads web-only OAuth and session secrets', () => {
        const config = loadWebConfig({
            FLUXER_APP_ID: ' app-id ',
            FLUXER_BOT_INVITE_URL:
                ' https://web.fluxer.app/oauth2/authorize?client_id=1517169145576165376&scope=bot&permissions=8 ',
            FLUXER_BOT_TOKEN: ' bot-token ',
            FLUXER_CLIENT_SECRET: ' client-secret ',
            FLUXER_OAUTH_REDIRECT_URL: ' redirect-url ',
            FLUXER_TOKEN_ENCRYPTION_KEY: ' encryption-key ',
            SESSION_SECRET: ' session-secret ',
        });

        expect(config).toMatchObject({
            fluxerAppId: 'app-id',
            fluxerBotInviteUrl:
                'https://web.fluxer.app/oauth2/authorize?client_id=1517169145576165376&scope=bot&permissions=8',
            fluxerBotToken: 'bot-token',
            fluxerClientSecret: 'client-secret',
            fluxerOauthRedirectUrl: 'redirect-url',
            fluxerTokenEncryptionKey: 'encryption-key',
            sessionSecret: 'session-secret',
        });
        expect('instanceMode' in config).toBe(false);
        expect('singleGuildId' in config).toBe(false);
        expect('ownerIds' in config).toBe(false);
        expect('publicWebUrl' in config).toBe(false);
    });

    it('omits a blank bot invite URL', () => {
        expect(loadWebConfig({ FLUXER_BOT_INVITE_URL: '   ' }).fluxerBotInviteUrl).toBeUndefined();
    });

    it('rejects non-http bot invite URLs', () => {
        expect(() => loadWebConfig({ FLUXER_BOT_INVITE_URL: 'fluxer://oauth2/authorize' })).toThrow(
            'FLUXER_BOT_INVITE_URL must be a valid HTTP or HTTPS URL'
        );
    });

    it('rejects malformed bot invite URLs', () => {
        expect(() => loadWebConfig({ FLUXER_BOT_INVITE_URL: 'web.fluxer.app/oauth2/authorize' })).toThrow(
            'FLUXER_BOT_INVITE_URL must be a valid HTTP or HTTPS URL'
        );
    });

    it('loads local .env values only into missing process env keys', async () => {
        const tempDir = mkdtempSync(join(tmpdir(), 'neonflux-env-'));
        tempEnvDirs.push(tempDir);
        writeFileSync(
            join(tempDir, '.env'),
            [
                'FLUXER_APP_ID=file-app',
                'FLUXER_BOT_INVITE_URL=https://web.fluxer.app/oauth2/authorize?client_id=1517169145576165376&scope=bot&permissions=8',
            ].join('\n')
        );
        process.chdir(tempDir);
        process.env.FLUXER_APP_ID = 'runtime-app';
        process.env.FLUXER_BOT_INVITE_URL = '   ';
        vi.resetModules();

        const { loadLocalEnv: loadLocalEnvFromTempDir, loadWebConfig: loadWebConfigFromLocalEnv } =
            await import('./env.js');
        loadLocalEnvFromTempDir();
        const config = loadWebConfigFromLocalEnv();

        expect(config.fluxerAppId).toBe('runtime-app');
        expect(config.fluxerBotInviteUrl).toBeUndefined();
    });
});

describe('loadConvexConfig', () => {
    it('omits missing or blank Convex values', () => {
        const config = loadConvexConfig({
            CONVEX_DEPLOYMENT: '   ',
            CONVEX_DEPLOY_KEY: '',
            CONVEX_URL: '   ',
            NEONFLUX_AUTH_JWT_AUDIENCE: '',
            NEONFLUX_AUTH_JWT_ISSUER: '   ',
            NEONFLUX_AUTH_JWT_JWKS: '   ',
            NEONFLUX_AUTH_JWT_PRIVATE_KEY: '',
            VITE_CONVEX_URL: '   ',
        });

        expect(config).toEqual({});
    });

    it('loads and normalizes Convex deployment and auth values', () => {
        const jwks = publicJwksDataUri();
        const config = loadConvexConfig({
            CONVEX_DEPLOYMENT: ' team:neonflux-prod ',
            CONVEX_DEPLOY_KEY: ' deploy-key ',
            CONVEX_URL: ' https://neonflux.convex.cloud ',
            NEONFLUX_AUTH_JWT_AUDIENCE: ' neonflux-convex ',
            NEONFLUX_AUTH_JWT_ISSUER: ' https://neonflux.example/auth ',
            NEONFLUX_AUTH_JWT_JWKS: ` ${jwks} `,
            NEONFLUX_AUTH_JWT_PRIVATE_KEY: ' -----BEGIN PRIVATE KEY-----\\nkey\\n-----END PRIVATE KEY----- ',
            VITE_CONVEX_URL: ' https://neonflux.convex.cloud ',
        });

        expect(config).toEqual({
            authJwtAudience: 'neonflux-convex',
            authJwtIssuer: 'https://neonflux.example/auth',
            authJwtJwks: jwks,
            authJwtPrivateKey: '-----BEGIN PRIVATE KEY-----\\nkey\\n-----END PRIVATE KEY-----',
            deployKey: 'deploy-key',
            deployment: 'team:neonflux-prod',
            publicUrl: 'https://neonflux.convex.cloud/',
            url: 'https://neonflux.convex.cloud/',
        });
    });

    it('rejects invalid Convex URLs', () => {
        expect(() => loadConvexConfig({ CONVEX_URL: 'convex.example' })).toThrow(
            'CONVEX_URL must be a valid HTTP or HTTPS URL'
        );
        expect(() => loadConvexConfig({ VITE_CONVEX_URL: 'ssh://convex.example' })).toThrow(
            'VITE_CONVEX_URL must be a valid HTTP or HTTPS URL'
        );
        expect(() => loadConvexConfig({ NEONFLUX_AUTH_JWT_ISSUER: 'auth.example' })).toThrow(
            'NEONFLUX_AUTH_JWT_ISSUER must be a valid HTTP or HTTPS URL'
        );
        expect(() => loadConvexConfig({ NEONFLUX_AUTH_JWT_ISSUER: 'https://web.fluxer.app' })).toThrow(
            'NEONFLUX_AUTH_JWT_ISSUER must be a NeonFlux issuer, not a Fluxer OAuth host'
        );
        expect(() => loadConvexConfig({ NEONFLUX_AUTH_JWT_JWKS: 'not-a-url' })).toThrow(
            'NEONFLUX_AUTH_JWT_JWKS must be a valid HTTP(S) URL or JWKS data URI'
        );
        expect(() => loadConvexConfig({ NEONFLUX_AUTH_JWT_JWKS: 'file:///tmp/jwks.json' })).toThrow(
            'NEONFLUX_AUTH_JWT_JWKS must be a valid HTTP(S) URL or JWKS data URI'
        );
        expect(() =>
            loadConvexConfig({
                NEONFLUX_AUTH_JWT_JWKS: `data:application/json,${encodeURIComponent(
                    JSON.stringify({ keys: [{ d: 'private', kid: 'test' }] })
                )}`,
            })
        ).toThrow('NEONFLUX_AUTH_JWT_JWKS exposes private JWK parameter "d"');
        expect(() =>
            loadConvexConfig({
                NEONFLUX_AUTH_JWT_JWKS: `data:application/json,${encodeURIComponent(
                    JSON.stringify({ keys: [{ alg: 'RS256', e: 'AQAB', kid: 'test', kty: 'RSA', use: 'sig' }] })
                )}`,
            })
        ).toThrow('NEONFLUX_AUTH_JWT_JWKS key at index 0 must include public RSA parameter "n"');
    });
});

describe('requireConvexConfig', () => {
    it('requires every Convex cutover value', () => {
        expect(() => requireConvexConfig({})).toThrow('NEONFLUX_AUTH_JWT_AUDIENCE is required');
        expect(() =>
            requireConvexConfig({
                NEONFLUX_AUTH_JWT_AUDIENCE: 'neonflux-convex',
            })
        ).toThrow('NEONFLUX_AUTH_JWT_ISSUER is required');
        expect(() =>
            requireConvexConfig({
                NEONFLUX_AUTH_JWT_AUDIENCE: 'neonflux-convex',
                NEONFLUX_AUTH_JWT_ISSUER: 'https://neonflux.example/auth',
            })
        ).toThrow('NEONFLUX_AUTH_JWT_JWKS is required');
        expect(() =>
            requireConvexConfig({
                NEONFLUX_AUTH_JWT_AUDIENCE: 'neonflux-convex',
                NEONFLUX_AUTH_JWT_ISSUER: 'https://neonflux.example/auth',
                NEONFLUX_AUTH_JWT_JWKS: publicJwksDataUri(),
            })
        ).toThrow('NEONFLUX_AUTH_JWT_PRIVATE_KEY is required');
    });

    it('returns strict Convex config when all cutover values are present', () => {
        const jwks = publicJwksDataUri();
        const config = requireConvexConfig({
            CONVEX_DEPLOYMENT: 'team:neonflux-prod',
            CONVEX_URL: 'https://neonflux.convex.cloud',
            NEONFLUX_AUTH_JWT_AUDIENCE: 'neonflux-convex',
            NEONFLUX_AUTH_JWT_ISSUER: 'https://neonflux.example/auth',
            NEONFLUX_AUTH_JWT_JWKS: jwks,
            NEONFLUX_AUTH_JWT_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nkey\\n-----END PRIVATE KEY-----',
            VITE_CONVEX_URL: 'https://neonflux.convex.cloud',
        });

        expect(config).toEqual({
            authJwtAudience: 'neonflux-convex',
            authJwtIssuer: 'https://neonflux.example/auth',
            authJwtJwks: jwks,
            authJwtPrivateKey: '-----BEGIN PRIVATE KEY-----\\nkey\\n-----END PRIVATE KEY-----',
            deployment: 'team:neonflux-prod',
            publicUrl: 'https://neonflux.convex.cloud/',
            url: 'https://neonflux.convex.cloud/',
        });
    });
});

describe('loadRuntimeConfig', () => {
    it('rejects staging because the project only has dev and prod bots', () => {
        expect(() => loadRuntimeConfig({ APP_ENV: 'staging' })).toThrow('Invalid environment');
    });

    it('does not require app Postgres config for production runtime loading', () => {
        expect(() =>
            loadRuntimeConfig({
                APP_ENV: 'production',
            })
        ).not.toThrow();
    });

    it('allows production runtime without DATABASE_URL when Convex config is complete', () => {
        const config = loadRuntimeConfig({
            ...createCompleteConvexEnv(),
            APP_ENV: 'production',
        });

        expect(config.convex).toMatchObject({
            authJwtAudience: 'neonflux-convex',
            authJwtIssuer: 'https://neonflux.example/auth',
            deployment: 'team:neonflux-prod',
            publicUrl: 'https://neonflux.convex.cloud/',
            url: 'https://neonflux.convex.cloud/',
        });
    });

    it('loads optional Convex config through runtime config without requiring cutover values', () => {
        const config = loadRuntimeConfig({
            CONVEX_URL: 'https://neonflux.convex.cloud',
            VITE_CONVEX_URL: 'https://neonflux.convex.cloud',
        });

        expect(config.convex).toEqual({
            publicUrl: 'https://neonflux.convex.cloud/',
            url: 'https://neonflux.convex.cloud/',
        });
    });

    it('defaults guild DEFCON override to auto', () => {
        expect(loadRuntimeConfig({}).guildDefconOverride).toBe('auto');
    });

    it('loads numeric guild DEFCON overrides', () => {
        expect(loadRuntimeConfig({ GUILD_DEFCON_OVERRIDE: '1' }).guildDefconOverride).toBe(1);
        expect(loadRuntimeConfig({ GUILD_DEFCON_OVERRIDE: '2' }).guildDefconOverride).toBe(2);
        expect(loadRuntimeConfig({ GUILD_DEFCON_OVERRIDE: '3' }).guildDefconOverride).toBe(3);
    });

    it('loads explicit auto guild DEFCON override', () => {
        expect(loadRuntimeConfig({ GUILD_DEFCON_OVERRIDE: 'auto' }).guildDefconOverride).toBe('auto');
    });

    it('rejects invalid guild DEFCON overrides', () => {
        expect(() => loadRuntimeConfig({ GUILD_DEFCON_OVERRIDE: '4' })).toThrow('Invalid environment');
        expect(() => loadRuntimeConfig({ GUILD_DEFCON_OVERRIDE: 'locked' })).toThrow('Invalid environment');
    });
});

function restoreProcessEnvValue(name: string, value: string | undefined): void {
    if (value === undefined) {
        Reflect.deleteProperty(process.env, name);
        return;
    }

    process.env[name] = value;
}

function createCompleteConvexEnv(): NodeJS.ProcessEnv {
    return {
        CONVEX_DEPLOYMENT: 'team:neonflux-prod',
        CONVEX_DEPLOY_KEY: 'deploy-key',
        CONVEX_URL: 'https://neonflux.convex.cloud',
        NEONFLUX_AUTH_JWT_AUDIENCE: 'neonflux-convex',
        NEONFLUX_AUTH_JWT_ISSUER: 'https://neonflux.example/auth',
        NEONFLUX_AUTH_JWT_JWKS: publicJwksDataUri(),
        NEONFLUX_AUTH_JWT_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nkey\\n-----END PRIVATE KEY-----',
        VITE_CONVEX_URL: 'https://neonflux.convex.cloud',
    };
}

function publicJwksDataUri(): string {
    return `data:application/json,${encodeURIComponent(
        JSON.stringify({
            keys: [
                {
                    alg: 'RS256',
                    e: 'AQAB',
                    kid: 'test-key',
                    kty: 'RSA',
                    n: 'test-modulus',
                    use: 'sig',
                },
            ],
        })
    )}`;
}
