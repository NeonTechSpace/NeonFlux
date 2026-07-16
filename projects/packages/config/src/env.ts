import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { type } from 'arktype';
import { parse as parseDotEnv } from 'dotenv';

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
    'NEONFLUX_BOT_AUTH_JWT_AUDIENCE?': 'string',
    'NEONFLUX_BOT_AUTH_JWT_ISSUER?': 'string',
    'NEONFLUX_BOT_AUTH_JWT_JWKS?': 'string',
    'NEONFLUX_BOT_AUTH_JWT_PRIVATE_KEY?': 'string',
    'NEONFLUX_BOT_INTERNAL_API_HOST?': 'string',
    'NEONFLUX_BOT_INTERNAL_API_PORT?': 'string',
    'NEONFLUX_BOT_INTERNAL_API_URL?': 'string',
    'NEONFLUX_USER_AUTH_JWT_AUDIENCE?': 'string',
    'NEONFLUX_USER_AUTH_JWT_ISSUER?': 'string',
    'NEONFLUX_USER_AUTH_JWT_JWKS?': 'string',
    'NEONFLUX_USER_AUTH_JWT_PRIVATE_KEY?': 'string',
    'NEONFLUX_WEB_AUTH_JWT_AUDIENCE?': 'string',
    'NEONFLUX_WEB_AUTH_JWT_ISSUER?': 'string',
    'NEONFLUX_WEB_AUTH_JWT_JWKS?': 'string',
    'NEONFLUX_WEB_AUTH_JWT_PRIVATE_KEY?': 'string',
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
    botAuthJwtAudience?: string;
    botAuthJwtIssuer?: string;
    botAuthJwtJwks?: string;
    botAuthJwtPrivateKey?: string;
    deployKey?: string;
    deployment?: string;
    publicUrl?: string;
    userAuthJwtAudience?: string;
    userAuthJwtIssuer?: string;
    userAuthJwtJwks?: string;
    userAuthJwtPrivateKey?: string;
    url?: string;
    webAuthJwtAudience?: string;
    webAuthJwtIssuer?: string;
    webAuthJwtJwks?: string;
    webAuthJwtPrivateKey?: string;
};

export type RequiredConvexConfig = {
    botAuthJwtAudience: string;
    botAuthJwtIssuer: string;
    botAuthJwtJwks: string;
    botAuthJwtPrivateKey: string;
    deployment: string;
    publicUrl: string;
    userAuthJwtAudience: string;
    userAuthJwtIssuer: string;
    userAuthJwtJwks: string;
    userAuthJwtPrivateKey: string;
    url: string;
    webAuthJwtAudience: string;
    webAuthJwtIssuer: string;
    webAuthJwtJwks: string;
    webAuthJwtPrivateKey: string;
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
        botInternalApiHost: string;
        botInternalApiPort: number;
        fluxerBotCustomStatusText?: string;
        fluxerBotToken?: string;
        publicWebUrl?: string;
        ownerIds: string[];
    };

export type WebConfig = RuntimeConfig & {
    botInternalApiUrl?: string;
    fluxerAppId?: string;
    fluxerBotInviteUrl?: string;
    fluxerClientSecret?: string;
    fluxerOauthRedirectUrl?: string;
    fluxerTokenEncryptionKey?: string;
    sessionSecret?: string;
};

export type AppConfig = BotConfig;

type ParsedEnv = typeof rawEnv.infer;

let loadedDotEnvPath: string | undefined;

export function loadLocalEnv(startDir = process.cwd()): string | undefined {
    return loadLocalEnvWithExclusions(startDir, new Set());
}

function loadLocalEnvWithExclusions(startDir: string, excludedKeys: ReadonlySet<string>): string | undefined {
    if (loadedDotEnvPath) {
        loadLocalDotEnvFile(loadedDotEnvPath, excludedKeys);
        return loadedDotEnvPath;
    }

    let currentDir = resolve(startDir);
    let previousDir: string | undefined;

    while (currentDir !== previousDir) {
        const candidate = join(currentDir, '.env');

        if (existsSync(candidate)) {
            loadLocalDotEnvFile(candidate, excludedKeys);
            loadedDotEnvPath = candidate;
            return candidate;
        }

        previousDir = currentDir;
        currentDir = dirname(currentDir);
    }

    return undefined;
}

function loadLocalDotEnvFile(path: string, excludedKeys: ReadonlySet<string>): void {
    const parsed = parseDotEnv(readFileSync(path));

    for (const [key, value] of Object.entries(parsed)) {
        if (excludedKeys.has(key)) continue;
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
        botAuthJwtAudience: requireConfigValue(config.botAuthJwtAudience, 'NEONFLUX_BOT_AUTH_JWT_AUDIENCE'),
        botAuthJwtIssuer: requireConfigValue(config.botAuthJwtIssuer, 'NEONFLUX_BOT_AUTH_JWT_ISSUER'),
        botAuthJwtJwks: requireConfigValue(config.botAuthJwtJwks, 'NEONFLUX_BOT_AUTH_JWT_JWKS'),
        botAuthJwtPrivateKey: requireConfigValue(config.botAuthJwtPrivateKey, 'NEONFLUX_BOT_AUTH_JWT_PRIVATE_KEY'),
        deployment: requireConfigValue(config.deployment, 'CONVEX_DEPLOYMENT'),
        publicUrl: requireConfigValue(config.publicUrl, 'VITE_CONVEX_URL'),
        userAuthJwtAudience: requireConfigValue(config.userAuthJwtAudience, 'NEONFLUX_USER_AUTH_JWT_AUDIENCE'),
        userAuthJwtIssuer: requireConfigValue(config.userAuthJwtIssuer, 'NEONFLUX_USER_AUTH_JWT_ISSUER'),
        userAuthJwtJwks: requireConfigValue(config.userAuthJwtJwks, 'NEONFLUX_USER_AUTH_JWT_JWKS'),
        userAuthJwtPrivateKey: requireConfigValue(config.userAuthJwtPrivateKey, 'NEONFLUX_USER_AUTH_JWT_PRIVATE_KEY'),
        url: requireConfigValue(config.url, 'CONVEX_URL'),
        webAuthJwtAudience: requireConfigValue(config.webAuthJwtAudience, 'NEONFLUX_WEB_AUTH_JWT_AUDIENCE'),
        webAuthJwtIssuer: requireConfigValue(config.webAuthJwtIssuer, 'NEONFLUX_WEB_AUTH_JWT_ISSUER'),
        webAuthJwtJwks: requireConfigValue(config.webAuthJwtJwks, 'NEONFLUX_WEB_AUTH_JWT_JWKS'),
        webAuthJwtPrivateKey: requireConfigValue(config.webAuthJwtPrivateKey, 'NEONFLUX_WEB_AUTH_JWT_PRIVATE_KEY'),
    };
}

export function loadBotConfig(env: NodeJS.ProcessEnv = process.env): BotConfig {
    const parsed = parseEnv(env);
    const runtimeConfig = createRuntimeConfig(parsed);
    const instanceModeValue = parsed.INSTANCE_MODE ?? 'multi';
    const fluxerBotCustomStatusText = optionalValue(parsed.FLUXER_BOT_CUSTOM_STATUS);
    const fluxerBotToken = optionalValue(parsed.FLUXER_BOT_TOKEN);
    const publicWebUrl = optionalPublicWebUrl(parsed.PUBLIC_WEB_URL);
    const botInternalApiHost =
        optionalValue(parsed.NEONFLUX_BOT_INTERNAL_API_HOST) ??
        (runtimeConfig.appEnv === 'production' ? '0.0.0.0' : '127.0.0.1');
    const botInternalApiPort = parsePort(parsed.NEONFLUX_BOT_INTERNAL_API_PORT, 'NEONFLUX_BOT_INTERNAL_API_PORT', 3001);

    const botBaseConfig = {
        ...runtimeConfig,
        botInternalApiHost,
        botInternalApiPort,
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
    const parsed = parseWebEnv(env);
    const runtimeConfig = createRuntimeConfig(parsed);
    const configuredBotInternalApiUrl = optionalHttpOrigin(
        parsed.NEONFLUX_BOT_INTERNAL_API_URL,
        'NEONFLUX_BOT_INTERNAL_API_URL'
    );
    const botInternalApiUrl =
        configuredBotInternalApiUrl ?? (runtimeConfig.appEnv === 'development' ? 'http://127.0.0.1:3001' : undefined);
    const fluxerAppId = optionalValue(parsed.FLUXER_APP_ID);
    const fluxerBotInviteUrl = optionalHttpUrl(parsed.FLUXER_BOT_INVITE_URL, 'FLUXER_BOT_INVITE_URL');
    const fluxerClientSecret = optionalValue(parsed.FLUXER_CLIENT_SECRET);
    const fluxerOauthRedirectUrl = optionalValue(parsed.FLUXER_OAUTH_REDIRECT_URL);
    const fluxerTokenEncryptionKey = optionalValue(parsed.FLUXER_TOKEN_ENCRYPTION_KEY);
    const sessionSecret = optionalValue(parsed.SESSION_SECRET);

    return {
        ...runtimeConfig,
        ...(botInternalApiUrl ? { botInternalApiUrl } : {}),
        ...(fluxerAppId ? { fluxerAppId } : {}),
        ...(fluxerBotInviteUrl ? { fluxerBotInviteUrl } : {}),
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

    return parseRawEnv(env);
}

function parseWebEnv(env: NodeJS.ProcessEnv): ParsedEnv {
    const webEnv = env === process.env ? process.env : { ...env };
    Reflect.deleteProperty(webEnv, 'FLUXER_BOT_TOKEN');

    if (env === process.env && shouldAutoLoadLocalEnv(env)) {
        loadLocalEnvWithExclusions(process.cwd(), new Set(['FLUXER_BOT_TOKEN']));
    }

    return parseRawEnv(webEnv);
}

function parseRawEnv(env: NodeJS.ProcessEnv): ParsedEnv {
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
    const botAuthJwtAudience = optionalValue(parsed.NEONFLUX_BOT_AUTH_JWT_AUDIENCE);
    const botAuthJwtIssuer = optionalNeonFluxJwtIssuer(
        parsed.NEONFLUX_BOT_AUTH_JWT_ISSUER,
        'NEONFLUX_BOT_AUTH_JWT_ISSUER'
    );
    const botAuthJwtJwks = optionalJwksConfig(parsed.NEONFLUX_BOT_AUTH_JWT_JWKS, 'NEONFLUX_BOT_AUTH_JWT_JWKS');
    const botAuthJwtPrivateKey = optionalValue(parsed.NEONFLUX_BOT_AUTH_JWT_PRIVATE_KEY);
    const userAuthJwtAudience = optionalValue(parsed.NEONFLUX_USER_AUTH_JWT_AUDIENCE);
    const userAuthJwtIssuer = optionalNeonFluxJwtIssuer(
        parsed.NEONFLUX_USER_AUTH_JWT_ISSUER,
        'NEONFLUX_USER_AUTH_JWT_ISSUER'
    );
    const userAuthJwtJwks = optionalJwksConfig(parsed.NEONFLUX_USER_AUTH_JWT_JWKS, 'NEONFLUX_USER_AUTH_JWT_JWKS');
    const userAuthJwtPrivateKey = optionalValue(parsed.NEONFLUX_USER_AUTH_JWT_PRIVATE_KEY);
    const webAuthJwtAudience = optionalValue(parsed.NEONFLUX_WEB_AUTH_JWT_AUDIENCE);
    const webAuthJwtIssuer = optionalNeonFluxJwtIssuer(
        parsed.NEONFLUX_WEB_AUTH_JWT_ISSUER,
        'NEONFLUX_WEB_AUTH_JWT_ISSUER'
    );
    const webAuthJwtJwks = optionalJwksConfig(parsed.NEONFLUX_WEB_AUTH_JWT_JWKS, 'NEONFLUX_WEB_AUTH_JWT_JWKS');
    const webAuthJwtPrivateKey = optionalValue(parsed.NEONFLUX_WEB_AUTH_JWT_PRIVATE_KEY);
    const deployKey = optionalValue(parsed.CONVEX_DEPLOY_KEY);
    const deployment = optionalValue(parsed.CONVEX_DEPLOYMENT);
    const publicUrl = optionalHttpUrl(parsed.VITE_CONVEX_URL, 'VITE_CONVEX_URL');
    const url = optionalHttpUrl(parsed.CONVEX_URL, 'CONVEX_URL');

    return {
        ...(botAuthJwtAudience ? { botAuthJwtAudience } : {}),
        ...(botAuthJwtIssuer ? { botAuthJwtIssuer } : {}),
        ...(botAuthJwtJwks ? { botAuthJwtJwks } : {}),
        ...(botAuthJwtPrivateKey ? { botAuthJwtPrivateKey } : {}),
        ...(deployKey ? { deployKey } : {}),
        ...(deployment ? { deployment } : {}),
        ...(publicUrl ? { publicUrl } : {}),
        ...(userAuthJwtAudience ? { userAuthJwtAudience } : {}),
        ...(userAuthJwtIssuer ? { userAuthJwtIssuer } : {}),
        ...(userAuthJwtJwks ? { userAuthJwtJwks } : {}),
        ...(userAuthJwtPrivateKey ? { userAuthJwtPrivateKey } : {}),
        ...(url ? { url } : {}),
        ...(webAuthJwtAudience ? { webAuthJwtAudience } : {}),
        ...(webAuthJwtIssuer ? { webAuthJwtIssuer } : {}),
        ...(webAuthJwtJwks ? { webAuthJwtJwks } : {}),
        ...(webAuthJwtPrivateKey ? { webAuthJwtPrivateKey } : {}),
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

function optionalNeonFluxJwtIssuer(value: string | undefined, name: string): string | undefined {
    const normalizedValue = optionalValue(value);

    if (!normalizedValue) {
        return undefined;
    }

    const url = parseHttpUrl(normalizedValue, name);

    if (url.hostname.toLowerCase().endsWith('fluxer.app')) {
        throw new Error(`${name} must be a NeonFlux issuer, not a Fluxer OAuth host`);
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
    return optionalHttpOrigin(value, 'PUBLIC_WEB_URL');
}

function optionalHttpOrigin(value: string | undefined, name: string): string | undefined {
    const normalizedValue = optionalValue(value);

    if (!normalizedValue) {
        return undefined;
    }

    let url: URL;

    try {
        url = new URL(normalizedValue);
    } catch {
        throw new Error(`${name} must be a valid HTTP or HTTPS origin`);
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error(`${name} must be a valid HTTP or HTTPS origin`);
    }

    if (
        url.pathname !== '/' ||
        url.search.length > 0 ||
        url.hash.length > 0 ||
        url.username.length > 0 ||
        url.password.length > 0
    ) {
        throw new Error(`${name} must be an origin without path, query, hash, or credentials`);
    }

    return url.origin;
}

function parsePort(value: string | undefined, name: string, defaultValue: number): number {
    const normalizedValue = optionalValue(value);

    if (!normalizedValue) return defaultValue;

    const port = Number(normalizedValue);

    if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
        throw new Error(`${name} must be an integer between 1 and 65535`);
    }

    return port;
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
