import { describe, expect, it } from 'vitest';

import {
    structureImportTerminalNotification,
    type StructureImportTerminalStatus,
} from './structure_import_terminal.js';

describe('structure import terminal notification', () => {
    it.each([
        ['succeeded', 'audit'],
        ['partially_applied', 'audit'],
        ['failed_before_mutation', 'structure'],
        ['needs_reconciliation', 'audit'],
        ['outcome_unknown', 'audit'],
        ['cancelled', 'audit'],
    ] satisfies Array<[StructureImportTerminalStatus, 'audit' | 'structure']>)(
        'routes %s through exactly one canonical destination',
        (status, canonicalDestination) => {
            const notification = structureImportTerminalNotification(status);
            expect(notification.canonicalDestination).toBe(canonicalDestination);
            expect('auditAction' in notification).toBe(canonicalDestination === 'audit');
        }
    );

    it('keeps audited terminal action names stable', () => {
        expect(structureImportTerminalNotification('needs_reconciliation')).toStrictEqual({
            auditAction: 'structure.import_execution_needs_reconciliation',
            canonicalDestination: 'audit',
        });
    });
});
