import { describe, expect, it } from 'vitest';

import { convexMigrationTables } from '../migration-tables.js';
import { createTransformedManifest } from './manifest.js';
import { stableJson } from './stable-json.js';
import type { MigrationDocument, TransformedMigrationBundle, TransformedMigrationTable } from './types.js';
import { validateNoSecretMaterial, validateTransformedMigrationBundle } from './validate.js';

describe('migration validation', () => {
    it('passes an empty inventory-complete bundle', () => {
        const report = validateTransformedMigrationBundle(createBundle({}));

        expect(report.ok).toBe(true);
        expect(report.issueCount).toBe(0);
    });

    it('fails on manifest count mismatch', () => {
        const bundle = createBundle({
            guilds: [{ guildId: 'guild-1' }],
        });
        bundle.manifest.tableCounts.guilds = 2;

        const report = validateTransformedMigrationBundle(bundle);

        expect(report.issues).toContainEqual(expect.objectContaining({ code: 'count-mismatch', table: 'guilds' }));
    });

    it('fails on duplicate legacy IDs', () => {
        const report = validateTransformedMigrationBundle(
            createBundle({
                moderationCases: [
                    { caseNumber: 1, guildId: 'guild-1', legacyId: 'case-1' },
                    { caseNumber: 2, guildId: 'guild-1', legacyId: 'case-1' },
                ],
            })
        );

        expect(report.issues).toContainEqual(
            expect.objectContaining({ code: 'duplicate-legacy-id', table: 'moderationCases' })
        );
    });

    it('fails on missing UUID legacy references', () => {
        const report = validateTransformedMigrationBundle(
            createBundle({
                ticketEvents: [{ eventType: 'opened', legacyId: 'event-1', ticketLegacyId: 'missing-ticket' }],
            })
        );

        expect(report.issues).toContainEqual(
            expect.objectContaining({ code: 'missing-reference', table: 'ticketEvents' })
        );
    });

    it('fails on stale imported counters', () => {
        const report = validateTransformedMigrationBundle(
            createBundle({
                moderationCaseCounters: [{ guildId: 'guild-1', nextCaseNumber: 3 }],
                moderationCases: [{ caseNumber: 3, guildId: 'guild-1', legacyId: 'case-1' }],
            })
        );

        expect(report.issues).toContainEqual(
            expect.objectContaining({ code: 'stale-counter', table: 'moderationCaseCounters' })
        );
    });

    it('fails on former unique key violations', () => {
        const report = validateTransformedMigrationBundle(
            createBundle({
                autoroleRules: [
                    { guildId: 'guild-1', legacyId: 'rule-1', roleId: 'role-1' },
                    { guildId: 'guild-1', legacyId: 'rule-2', roleId: 'role-1' },
                ],
            })
        );

        expect(report.issues).toContainEqual(
            expect.objectContaining({ code: 'unique-key-violation', table: 'autoroleRules' })
        );
    });

    it('fails when event ordering moves backwards', () => {
        const report = validateTransformedMigrationBundle(
            createBundle({
                xpGrants: [
                    {
                        grantedAt: '2026-07-03T10:00:00.000Z',
                        guildId: 'guild-1',
                        legacyId: 'grant-1',
                    },
                    {
                        grantedAt: '2026-07-03T09:00:00.000Z',
                        guildId: 'guild-1',
                        legacyId: 'grant-2',
                    },
                ],
            })
        );

        expect(report.issues).toContainEqual(expect.objectContaining({ code: 'event-ordering', table: 'xpGrants' }));
    });

    it('does not leak token material into validation reports', () => {
        const secret = 'super-secret-token-material';
        const bundle = createBundle({
            fluxerOauthTokens: [
                {
                    accessToken: { ciphertext: secret },
                    fluxerUserId: 'user-1',
                    scopes: ['identify'],
                    tokenType: 'Bearer',
                },
            ],
        });
        const report = validateTransformedMigrationBundle(bundle, { forbiddenSamples: [secret] });

        expect(report.ok).toBe(true);
        expect(stableJson(report)).not.toContain(secret);
    });

    it('detects forbidden material when a report contains it', () => {
        expect(
            validateNoSecretMaterial({ detail: 'super-secret-token-material' }, ['super-secret-token-material'])
        ).toEqual([expect.objectContaining({ code: 'secret-leak' })]);
    });
});

function createBundle(overrides: Record<string, MigrationDocument[]>): TransformedMigrationBundle {
    const tables: TransformedMigrationTable[] = convexMigrationTables.map((table) => ({
        convexTable: table.convexTable,
        docs: overrides[table.convexTable] ?? [],
        postgresTable: table.postgresTable,
    }));

    return {
        manifest: createTransformedManifest({
            createdAt: new Date('2026-07-03T00:00:00.000Z'),
            migrationHead: '0028_reaction_role_builder_modes',
            revision: 'test-revision',
            sourceDatabaseId: 'test-db',
            tables,
        }),
        tables,
    };
}
