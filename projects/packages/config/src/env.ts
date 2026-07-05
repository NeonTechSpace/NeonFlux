import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { type } from 'arktype';
import { config as loadDotEnv, parse as parseDotEnv } from 'dotenv';

const appEnv = type("'development' | 'production'");
const instanceMode = type("'single' | 'multi'");
const guildDefconOverride = type("'auto' | '1' | '2' | '3'");
const logLevel = type("'debug' | 'info' | 'warn' | 'error'");
const nodeEnv = type("'development' | 'test' | 'production'");
const privateJwkParameters = ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth'] as const;
const base64UrlPattern = /^[A-Za-z0-9_-]+$/u;

const rawEnv = type({
    'APP_ENV?': appEnv,
    'INSTANCE_MODE?': instanceMode,
    'SINGLE_GUILD_ID?': 'string',
    'CONVEX_DEPLOYMENT?': 'string',
    'CONVEX_DEPLOY_KEY?': 'string',
    'CONVEX_URL?': 'string',
    'FLUXER_APP_ID?': 'string',
    'FLUXER_CLIENT_SECRET?': 'string',
    'FLUXER_BOT_CUSTOM_STATUS?': 'string',
    'FLUXER_BOT_INVITE_URL?': 'string',
    'FLUXER_BOT_TOKEN?': 'string',
    'FLUXER_OAUTH_REDIRECT_URL?': 'string',
    'FLUXER_TOKEN_ENCRYPTION_KEY?': 'string',
    'SESSION_SECRET?': 'string',
    'NEONFLUX_AUTH_JWT_AUDIENCE?': 'string',
    'NEONFLUX_AUTH_JWT_ISSUER?': 'string',
    'NEONFLUX_AUTH_JWT_JWKS?': 'string',
    'NEONFLUX_AUTH_JWT_PRIVATE_KEY?': 'string',
    'PUBLIC_WEB_URL?': 'string',
    'VITE_CONVEX_URL?': 'string',
    'GUILD_DEFCON_OVERRIDE?': guildDefconOverride,
    'LOG_LEVEL?': logLevel,
    'NODE_ENV?': nodeEnv,
    'OWNER_IDS?': 'string',
});

export type AppEnv = 'development' | 'production';
export type InstanceMode = 'single' | 'multi';
export type GuildDefconLevel = 1 | 2 | 3;
export type GuildDefconOverride = 'auto' | GuildDefconLevel;
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type AppMode = { instanceMode: 'single'; singleGuildId: string } | { instanceMode: 'multi' };

export type ConvexConfig = {
    authJwtAudience?: string;
    authJwtIssuer?: string;
    authJwtJwks?: string;
    authJwtPrivateKey?: string;
    deployKey?: string;
    deployment?: string;
    publicUrl?: string;
    url?: string;
};

export type RequiredConvexConfig = {
    authJwtAudience: string;
    authJwtIssuer: string;
    authJwtJwks: string;
    authJwtPrivateKey: string;
    deployment: string;
    publicUrl: string;
    url: string;
};

export type RuntimeConfig = {
    appEnv: AppEnv;
    convex?: ConvexConfig;
    guildDefconOverride: GuildDefconOverride;
    logLevel: LogLevel;
    nodeEnv: 'development' | 'test' | 'production';
};

export type BotConfig = RuntimeConfig &
    AppMode & {
        fluxerBotCustomStatusText?: string;
        fluxerBotToken?: string;
        publicWebUrl?: string;
        ownerIds: string[];
    };

export type WebConfig = RuntimeConfig & {
    fluxerAppId?: string;
    fluxerBotInviteUrl?: string;
    fluxerBotToken?: string;
    fluxerClientSecret?: string;
    fluxerOauthRedirectUrl?: string;
    fluxerTokenEncryptionKey?: string;
    sessionSecret?: string;
};

export type AppConfig = BotConfig;

type ParsedEnv = typeof rawEnv.infer;

let loadedDotEnvPath: string | undefined;

export function loadLocalEnv(startDir = process.cwd()): string | undefined {
    if (loadedDotEnvPath) {
        loadLocalDotEnvFile(loadedDotEnvPath);
        return loadedDotEnvPath;
    }

    let currentDir = resolve(startDir);
    let previousDir: string | undefined;

    while (currentDir !== previousDir) {
        const candidate = join(currentDir, '.env');

        if (existsSync(candidate)) {
            loadLocalDotEnvFile(candidate);
            loadedDotEnvPath = candidate;
            return candidate;
        }

        previousDir = currentDir;
        currentDir = dirname(currentDir);
    }

    return undefined;
}

function loadLocalDotEnvFile(path: string): void {
    const result = loadDotEnv({ path, override: false, quiet: true });
    const parsed = result.parsed ?? parseDotEnv(readFileSync(path));

    for (const [key, value] of Object.entries(parsed)) {
        const currentValue = process.env[key];

        if (currentValue === undefined) {
            process.env[key] = value;
        }
    }
}

export function loadRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
    return createRuntimeConfig(parseEnv(env));
}

export function loadConvexConfig(env: NodeJS.ProcessEnv = process.env): ConvexConfig {
    return createConvexConfig(parseEnv(env));
}

export function requireConvexConfig(env: NodeJS.ProcessEnv = process.env): RequiredConvexConfig {
    const config = loadConvexConfig(env);

    return {
        authJwtAudience: requireConfigValue(config.authJwtAudience, 'NEONFLUX_AUTH_JWT_AUDIENCE'),
        authJwtIssuer: requireConfigValue(config.authJwtIssuer, 'NEONFLUX_AUTH_JWT_ISSUER'),
        authJwtJwks: requireConfigValue(config.authJwtJwks, 'NEONFLUX_AUTH_JWT_JWKS'),
        authJwtPrivateKey: requireConfigValue(config.authJwtPrivateKey, 'NEONFLUX_AUTH_JWT_PRIVATE_KEY'),
        deployment: requireConfigValue(config.deployment, 'CONVEX_DEPLOYMENT'),
        publicUrl: requireConfigValue(config.publicUrl, 'VITE_CONVEX_URL'),
        url: requireConfigValue(config.url, 'CONVEX_URL'),
    };
}

export function loadBotConfig(env: NodeJS.ProcessEnv = process.env): BotConfig {
    const parsed = parseEnv(env);
    const runtimeConfig = createRuntimeConfig(parsed);
    const instanceModeValue = parsed.INSTANCE_MODE ?? 'multi';
    const fluxerBotCustomStatusText = optionalValue(parsed.FLUXER_BOT_CUSTOM_STATUS);
    const fluxerBotToken = optionalValue(parsed.FLUXER_BOT_TOKEN);
    const publicWebUrl = optionalPublicWebUrl(parsed.PUBLIC_WEB_URL);

    const botBaseConfig = {
        ...runtimeConfig,
        ...(fluxerBotCustomStatusText ? { fluxerBotCustomStatusText } : {}),
        ...(fluxerBotToken ? { fluxerBotToken } : {}),
        ...(publicWebUrl ? { publicWebUrl } : {}),
        ownerIds: parseCsvIds(parsed.OWNER_IDS),
    } satisfies Omit<BotConfig, keyof AppMode>;

    switch (instanceModeValue) {
        case 'single': {
            const singleGuildId = optionalValue(parsed.SINGLE_GUILD_ID);
            requireEnvValue(singleGuildId, 'SINGLE_GUILD_ID');

            return {
                ...botBaseConfig,
                instanceMode: 'single',
                singleGuildId,
            };
        }

        case 'multi':
            return {
                ...botBaseConfig,
                instanceMode: 'multi',
            };
    }
}

export function loadWebConfig(env: NodeJS.ProcessEnv = process.env): WebConfig {
    const parsed = parseEnv(env);
    const runtimeConfig = createRuntimeConfig(parsed);
    const fluxerAppId = optionalValue(parsed.FLUXER_APP_ID);
    const fluxerBotInviteUrl = optionalHttpUrl(parsed.FLUXER_BOT_INVITE_URL, 'FLUXER_BOT_INVITE_URL');
    const fluxerBotToken = optionalValue(parsed.FLUXER_BOT_TOKEN);
    const fluxerClientSecret = optionalValue(parsed.FLUXER_CLIENT_SECRET);
    const fluxerOauthRedirectUrl = optionalValue(parsed.FLUXER_OAUTH_REDIRECT_URL);
    const fluxerTokenEncryptionKey = optionalValue(parsed.FLUXER_TOKEN_ENCRYPTION_KEY);
    const sessionSecret = optionalValue(parsed.SESSION_SECRET);

    return {
        ...runtimeConfig,
        ...(fluxerAppId ? { fluxerAppId } : {}),
        ...(fluxerBotInviteUrl ? { fluxerBotInviteUrl } : {}),
        ...(fluxerBotToken ? { fluxerBotToken } : {}),
        ...(fluxerClientSecret ? { fluxerClientSecret } : {}),
        ...(fluxerOauthRedirectUrl ? { fluxerOauthRedirectUrl } : {}),
        ...(fluxerTokenEncryptionKey ? { fluxerTokenEncryptionKey } : {}),
        ...(sessionSecret ? { sessionSecret } : {}),
    };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BotConfig {
    return loadBotConfig(env);
}

function parseEnv(env: NodeJS.ProcessEnv): ParsedEnv {
    if (env === process.env && shouldAutoLoadLocalEnv(env)) {
        loadLocalEnv();
    }

    const parsed = rawEnv(env);

    if (parsed instanceof type.errors) {
        throw new Error(`Invalid environment: ${parsed.summary}`);
    }

    return parsed;
}

function shouldAutoLoadLocalEnv(env: NodeJS.ProcessEnv): boolean {
    return env.NODE_ENV !== 'test' && env.VITEST !== 'true';
}

function createRuntimeConfig(parsed: ParsedEnv): RuntimeConfig {
    const appEnvValue = parsed.APP_ENV ?? 'development';
    const convex = createConvexConfig(parsed);

    return {
        appEnv: appEnvValue,
        convex,
        guildDefconOverride: parseGuildDefconOverride(parsed.GUILD_DEFCON_OVERRIDE),
        logLevel: parsed.LOG_LEVEL ?? 'info',
        nodeEnv: parsed.NODE_ENV ?? 'development',
    };
}

function createConvexConfig(parsed: ParsedEnv): ConvexConfig {
    const authJwtAudience = optionalValue(parsed.NEONFLUX_AUTH_JWT_AUDIENCE);
    const authJwtIssuer = optionalNeonFluxJwtIssuer(parsed.NEONFLUX_AUTH_JWT_ISSUER);
    const authJwtJwks = optionalJwksConfig(parsed.NEONFLUX_AUTH_JWT_JWKS, 'NEONFLUX_AUTH_JWT_JWKS');
    const authJwtPrivateKey = optionalValue(parsed.NEONFLUX_AUTH_JWT_PRIVATE_KEY);
    const deployKey = optionalValue(parsed.CONVEX_DEPLOY_KEY);
    const deployment = optionalValue(parsed.CONVEX_DEPLOYMENT);
    const publicUrl = optionalHttpUrl(parsed.VITE_CONVEX_URL, 'VITE_CONVEX_URL');
    const url = optionalHttpUrl(parsed.CONVEX_URL, 'CONVEX_URL');

    return {
        ...(authJwtAudience ? { authJwtAudience } : {}),
        ...(authJwtIssuer ? { authJwtIssuer } : {}),
        ...(authJwtJwks ? { authJwtJwks } : {}),
        ...(authJwtPrivateKey ? { authJwtPrivateKey } : {}),
        ...(deployKey ? { deployKey } : {}),
        ...(deployment ? { deployment } : {}),
        ...(publicUrl ? { publicUrl } : {}),
        ...(url ? { url } : {}),
    };
}

function optionalValue(value: string | undefined): string | undefined {
    const trimmed = value?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function optionalHttpUrl(value: string | undefined, name: string): string | undefined {
    const normalizedValue = optionalValue(value);

    if (!normalizedValue) {
        return undefined;
    }

    return parseHttpUrl(normalizedValue, name).toString();
}

function optionalNeonFluxJwtIssuer(value: string | undefined): string | undefined {
    const normalizedValue = optionalValue(value);

    if (!normalizedValue) {
        return undefined;
    }

    const url = parseHttpUrl(normalizedValue, 'NEONFLUX_AUTH_JWT_ISSUER');

    if (url.hostname.toLowerCase().endsWith('fluxer.app')) {
        throw new Error('NEONFLUX_AUTH_JWT_ISSUER must be a NeonFlux issuer, not a Fluxer OAuth host');
    }

    return url.toString();
}

function parseHttpUrl(value: string, name: string): URL {
    let url: URL;

    try {
        url = new URL(value);
    } catch {
        throw new Error(`${name} must be a valid HTTP or HTTPS URL`);
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error(`${name} must be a valid HTTP or HTTPS URL`);
    }

    return url;
}

function optionalJwksConfig(value: string | undefined, name: string): string | undefined {
    const normalizedValue = optionalValue(value);

    if (!normalizedValue) {
        return undefined;
    }

    let url: URL;

    try {
        url = new URL(normalizedValue);
    } catch {
        throw new Error(`${name} must be a valid HTTP(S) URL or JWKS data URI`);
    }

    if (url.protocol !== 'data:' && url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error(`${name} must be a valid HTTP(S) URL or JWKS data URI`);
    }

    if (url.protocol === 'data:') {
        assertPublicJwksDataUri(normalizedValue, name);
    }

    return url.protocol === 'data:' ? normalizedValue : url.toString();
}

function assertPublicJwksDataUri(value: string, name: string): void {
    const commaIndex = value.indexOf(',');

    if (commaIndex < 0) {
        throw new Error(`${name} must include a comma-separated data payload`);
    }

    const metadata = value.slice('data:'.length, commaIndex).toLowerCase();
    const encodedPayload = value.slice(commaIndex + 1);
    const isBase64 = metadata.split(';').includes('base64');
    let body: string;

    try {
        body = isBase64 ? Buffer.from(encodedPayload, 'base64').toString('utf8') : decodeURIComponent(encodedPayload);
    } catch {
        throw new Error(`${name} data URI could not be decoded`);
    }

    let jwks: unknown;

    try {
        jwks = JSON.parse(body);
    } catch {
        throw new Error(`${name} data URI must decode to JSON`);
    }

    if (!isObjectRecord(jwks) || !Array.isArray(jwks.keys) || jwks.keys.length === 0) {
        throw new Error(`${name} must contain a non-empty "keys" array`);
    }

    for (const [index, key] of jwks.keys.entries()) {
        if (!isObjectRecord(key)) {
            throw new Error(`${name} has a non-object key at index ${String(index)}`);
        }

        const leakedParameter = privateJwkParameters.find((parameter) => parameter in key);

        if (leakedParameter) {
            throw new Error(`${name} exposes private JWK parameter "${leakedParameter}"`);
        }

        assertPublicRsaSigningJwk(key, index, name);
    }
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertPublicRsaSigningJwk(key: Record<string, unknown>, index: number, name: string): void {
    const keyIndex = String(index);

    if (key.kty !== 'RSA') {
        throw new Error(`${name} key at index ${keyIndex} must be an RSA public JWK`);
    }

    if (!isNonEmptyString(key.kid)) {
        throw new Error(`${name} key at index ${keyIndex} must include a non-empty "kid"`);
    }

    if (key.alg !== 'RS256') {
        throw new Error(`${name} key at index ${keyIndex} must use alg "RS256"`);
    }

    if (key.use !== 'sig') {
        throw new Error(`${name} key at index ${keyIndex} must use "sig"`);
    }

    for (const parameter of ['n', 'e'] as const) {
        if (!isBase64UrlString(key[parameter])) {
            throw new Error(`${name} key at index ${keyIndex} must include public RSA parameter "${parameter}"`);
        }
    }
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

function isBase64UrlString(value: unknown): value is string {
    return isNonEmptyString(value) && base64UrlPattern.test(value);
}

function optionalPublicWebUrl(value: string | undefined): string | undefined {
    const normalizedValue = optionalValue(value);

    if (!normalizedValue) {
        return undefined;
    }

    let url: URL;

    try {
        url = new URL(normalizedValue);
    } catch {
        throw new Error('PUBLIC_WEB_URL must be a valid HTTP or HTTPS origin');
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error('PUBLIC_WEB_URL must be a valid HTTP or HTTPS origin');
    }

    if (
        url.pathname !== '/' ||
        url.search.length > 0 ||
        url.hash.length > 0 ||
        url.username.length > 0 ||
        url.password.length > 0
    ) {
        throw new Error('PUBLIC_WEB_URL must be an origin without path, query, hash, or credentials');
    }

    return url.origin;
}

function requireEnvValue(value: string | undefined, name: string): asserts value is string {
    if (!value) {
        throw new Error(`${name} is required`);
    }
}

function requireConfigValue(value: string | undefined, name: string): string {
    requireEnvValue(value, name);
    return value;
}

function parseGuildDefconOverride(value: 'auto' | '1' | '2' | '3' | undefined): GuildDefconOverride {
    switch (value ?? 'auto') {
        case 'auto':
            return 'auto';
        case '1':
            return 1;
        case '2':
            return 2;
        case '3':
            return 3;
    }
}

function parseCsvIds(value: string | undefined): string[] {
    return (
        value
            ?.split(',')
            .map((id) => id.trim())
            .filter((id) => id.length > 0) ?? []
    );
}
