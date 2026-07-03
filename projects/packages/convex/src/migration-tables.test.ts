import { describe, expect, it } from 'vitest';

import { convexMigrationTableCount, convexMigrationTables } from './migration-tables.js';

describe('convexMigrationTables', () => {
    it('covers every current Postgres table exactly once', () => {
        expect(convexMigrationTableCount).toBe(59);
        expect(new Set(convexMigrationTables.map((table) => table.postgresTable)).size).toBe(convexMigrationTableCount);
        expect(new Set(convexMigrationTables.map((table) => table.convexTable)).size).toBe(convexMigrationTableCount);
    });

    it('marks sensitive and workflow-heavy tables as high risk', () => {
        expect(
            convexMigrationTables.filter((table) =>
                ['deployment_config', 'fluxer_oauth_tokens', 'web_sessions', 'moderation_cases'].includes(
                    table.postgresTable
                )
            )
        ).toEqual([
            expect.objectContaining({ postgresTable: 'deployment_config', risk: 'high' }),
            expect.objectContaining({ postgresTable: 'web_sessions', risk: 'high' }),
            expect.objectContaining({ postgresTable: 'fluxer_oauth_tokens', risk: 'high' }),
            expect.objectContaining({ postgresTable: 'moderation_cases', risk: 'high' }),
        ]);
    });
});
