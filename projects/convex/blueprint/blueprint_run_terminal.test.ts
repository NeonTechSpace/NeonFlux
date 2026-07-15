import { describe, expect, it } from 'vitest';

import { blueprintRunTerminalNotification, type BlueprintRunTerminalStatus } from './blueprint_run_terminal.js';

describe('Blueprint run terminal notification', () => {
    it.each([
        ['succeeded', 'audit'],
        ['partially_applied', 'audit'],
        ['failed_before_mutation', 'audit'],
        ['needs_reconciliation', 'audit'],
        ['outcome_unknown', 'audit'],
        ['cancelled', 'audit'],
    ] satisfies Array<[BlueprintRunTerminalStatus, 'audit']>)(
        'routes %s through exactly one canonical destination',
        (status, canonicalDestination) => {
            const notification = blueprintRunTerminalNotification(status);
            expect(notification.canonicalDestination).toBe(canonicalDestination);
            expect('auditAction' in notification).toBe(true);
        }
    );

    it('keeps audited terminal action names stable', () => {
        expect(blueprintRunTerminalNotification('needs_reconciliation')).toStrictEqual({
            auditAction: 'blueprint.run_needs_reconciliation',
            canonicalDestination: 'audit',
        });
    });
});
