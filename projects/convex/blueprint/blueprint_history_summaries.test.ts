import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const summarySource = readFileSync(fileURLToPath(new URL('./blueprint_history_summaries.ts', import.meta.url)), 'utf8');
const hotRecordsSource = readFileSync(fileURLToPath(new URL('./blueprint_hot_records.ts', import.meta.url)), 'utf8');

describe('Blueprint History summary module boundary', () => {
    it('imports only hot-record and infrastructure modules', () => {
        const imports = importSpecifiers(summarySource);
        expect(imports).toEqual([
            'convex/values',
            '../_generated/server.js',
            '../auth.js',
            './blueprint_hot_records.js',
        ]);
    });

    it('keeps the hot-record helper as a pure serializer boundary', () => {
        const imports = importSpecifiers(hotRecordsSource);
        expect(imports).toEqual(['convex/values', '../_generated/dataModel.js']);
        expect(hotRecordsSource).not.toMatch(/\b(?:ctx|db)\b/u);
        expect(hotRecordsSource).not.toMatch(
            /\b(?:query|internalQuery|mutation|internalMutation|action|internalAction|require)\s*\(/u
        );
    });

    it('cannot reference any cold Blueprint table', () => {
        const coldTables = [
            'blueprintPlanAuthorities',
            'blueprintPlanExecutionAuthorities',
            'blueprintPlanExecutionAuthorityBuckets',
            'blueprintPlanPreflightEvidence',
            'blueprintPlanSteps',
            'blueprintPlanDecisions',
            'blueprintRunCursors',
            'blueprintRunVerificationEvidence',
            'blueprintRunIdMappings',
        ];
        for (const source of [summarySource, hotRecordsSource]) {
            for (const table of coldTables) expect(source).not.toContain(table);
        }
    });
});

function importSpecifiers(source: string): string[] {
    return [
        ...source.matchAll(/from\s+['"]([^'"]+)['"]/gu),
        ...source.matchAll(/\bimport\s+['"]([^'"]+)['"]/gu),
        ...source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]/gu),
    ].flatMap((match) => (typeof match[1] === 'string' ? [match[1]] : []));
}
