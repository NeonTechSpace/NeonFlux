import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';

import { loadConvexConfig } from '../packages/config/src/env.js';
import { createConvexPrivateKeyEnvValue } from './generate-convex-private-key.js';
import { createConvexAuthJwksDataUriFromEnv, type ConvexAuthProviderKind } from './convex-jwks.js';
import { createTokenEncryptionKey } from './token-encryption-key.js';

const providerKinds = ['bot', 'web', 'user'] as const satisfies readonly ConvexAuthProviderKind[];
const generatedSecretNames = ['FLUXER_TOKEN_ENCRYPTION_KEY', 'SESSION_SECRET'] as const;
const externalValueNames = ['FLUXER_APP_ID', 'FLUXER_CLIENT_SECRET', 'FLUXER_BOT_TOKEN'] as const;

type SetupMode = 'dry-run' | 'write';

export type DevEnvSetupPlan = {
    changedNames: string[];
    content: string;
    missingExternalNames: string[];
};

type DevEnvSetupGenerators = {
    privateKey: () => string;
    sessionSecret: () => string;
    tokenEncryptionKey: () => string;
};

const defaultGenerators: DevEnvSetupGenerators = {
    privateKey: createConvexPrivateKeyEnvValue,
    sessionSecret: () => randomBytes(32).toString('base64url'),
    tokenEncryptionKey: createTokenEncryptionKey,
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        main();
    } catch (error: unknown) {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    }
}

export function buildDevEnvSetupPlan(
    source: string,
    generators: DevEnvSetupGenerators = defaultGenerators
): DevEnvSetupPlan {
    const env = parseEnv(source);
    const updates = new Map<string, string>();

    for (const kind of providerKinds) {
        const upperKind = kind.toUpperCase();
        const prefix = `NEONFLUX_${upperKind}_AUTH_JWT`;
        const issuerName = `${prefix}_ISSUER`;
        const audienceName = `${prefix}_AUDIENCE`;
        const privateKeyName = `${prefix}_PRIVATE_KEY`;
        const jwksName = `${prefix}_JWKS`;

        setWhenBlank(env, updates, issuerName, `http://localhost:3000/auth/${kind}`);
        setWhenBlank(env, updates, audienceName, `neonflux-convex-${kind}`);

        const privateKey = readPreparedValue(env, updates, privateKeyName);
        const jwks = readPreparedValue(env, updates, jwksName);

        if (!privateKey && jwks) {
            throw new Error(
                `${privateKeyName} is blank while ${jwksName} is populated; refusing to create a mismatched key pair`
            );
        }

        if (!privateKey) {
            updates.set(privateKeyName, generators.privateKey());
        }

        if (!jwks) {
            const preparedEnv = { ...env, ...Object.fromEntries(updates) };
            updates.set(jwksName, createConvexAuthJwksDataUriFromEnv(preparedEnv, kind));
        }
    }

    setWhenBlank(env, updates, generatedSecretNames[0], generators.tokenEncryptionKey());
    setWhenBlank(env, updates, generatedSecretNames[1], generators.sessionSecret());

    const content = applyEnvUpdates(source, updates);
    const preparedEnv = parseEnv(content);
    loadConvexConfig(preparedEnv);

    return {
        changedNames: [...updates.keys()].sort(),
        content,
        missingExternalNames: externalValueNames.filter((name) => !preparedEnv[name]?.trim()),
    };
}

function main(): void {
    const mode = parseMode(process.argv.slice(2));
    const root = resolve(process.cwd());
    const envPath = resolve(root, '.env');
    const templatePath = resolve(root, '.env.example');

    if (!existsSync(templatePath)) {
        throw new Error(`Missing environment template: ${templatePath}`);
    }

    const source = existsSync(envPath) ? readFileSync(envPath, 'utf8') : readFileSync(templatePath, 'utf8');
    const plan = buildDevEnvSetupPlan(source);

    process.stdout.write(
        `${mode === 'write' ? 'Writing' : 'Would write'} ${String(plan.changedNames.length)} local configuration value(s): ${plan.changedNames.join(', ') || 'none'}\n`
    );

    if (plan.missingExternalNames.length > 0) {
        process.stdout.write(`Still requires external values: ${plan.missingExternalNames.join(', ')}\n`);
    }

    if (mode === 'dry-run') {
        process.stdout.write('Dry run only. Re-run with --write to update projects/.env.\n');
        return;
    }

    writeFileSync(envPath, plan.content, { encoding: 'utf8', mode: 0o600 });

    try {
        chmodSync(envPath, 0o600);
    } catch {
        // Windows does not implement POSIX file modes. The ignored file still remains local to the workspace.
    }

    process.stdout.write('Local environment updated without printing generated secrets.\n');
}

function parseMode(args: readonly string[]): SetupMode {
    const normalized = args.filter((arg) => arg !== '--');
    if (normalized.length === 0 || (normalized.length === 1 && normalized[0] === '--dry-run')) return 'dry-run';
    if (normalized.length === 1 && normalized[0] === '--write') return 'write';
    throw new Error('Usage: pnpm setup:dev [--dry-run | --write]');
}

function setWhenBlank(env: NodeJS.ProcessEnv, updates: Map<string, string>, name: string, value: string): void {
    if (!env[name]?.trim()) updates.set(name, value);
}

function readPreparedValue(env: NodeJS.ProcessEnv, updates: ReadonlyMap<string, string>, name: string): string {
    const updatedValue = updates.get(name)?.trim();
    if (updatedValue) return updatedValue;
    return env[name]?.trim() ?? '';
}

function applyEnvUpdates(source: string, updates: ReadonlyMap<string, string>): string {
    const newline = source.includes('\r\n') ? '\r\n' : '\n';
    let content = source;

    for (const [name, value] of updates) {
        const pattern = new RegExp(`^${escapeRegExp(name)}=.*$`, 'gmu');
        const matches = content.match(pattern) ?? [];

        if (matches.length > 1) {
            throw new Error(`Refusing to update duplicate ${name} entries`);
        }

        if (matches.length === 1) {
            content = content.replace(pattern, `${name}=${value}`);
        } else {
            content = `${content.replace(/\s*$/u, '')}${newline}${name}=${value}${newline}`;
        }
    }

    return content.endsWith(newline) ? content : `${content}${newline}`;
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
