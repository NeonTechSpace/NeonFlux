import { describe, expect, it } from 'vitest';

import { orderDashboardStructureImportActions } from './dashboard-structure-action-order.js';

describe.each(['merge', 'synchronize', 'rebuild'] as const)('%s Server Blueprint action order', (policy) => {
    it('keeps channel and role ordering after every normal mutation, including later deletes', () => {
        const actions = [
            { id: 'channel-order', actionType: 'update', targetType: 'channel-order', sequence: 2 },
            { id: 'create', actionType: 'create', targetType: 'channel', sequence: 0 },
            { id: 'role-order', actionType: 'update', targetType: 'role-order', sequence: 3 },
            { id: 'delete', actionType: 'delete', targetType: 'role', sequence: 4 },
            { id: 'update', actionType: 'update', targetType: 'channel', sequence: 1 },
        ];

        const ordered = orderDashboardStructureImportActions(actions, policy).map(({ id }) => id);
        expect(ordered.slice(-2)).toEqual(['channel-order', 'role-order']);
        expect(ordered.indexOf('delete')).toBeLessThan(ordered.indexOf('channel-order'));
    });
});

describe('rebuild action order', () => {
    it('deletes eligible objects before normal creates while keeping synthetic ordering last', () => {
        const ordered = orderDashboardStructureImportActions(
            [
                { id: 'create', actionType: 'create', targetType: 'role' },
                { id: 'role-order', actionType: 'update', targetType: 'role-order' },
                { id: 'delete', actionType: 'delete', targetType: 'channel' },
            ],
            'rebuild'
        ).map(({ id }) => id);

        expect(ordered).toEqual(['delete', 'create', 'role-order']);
    });
});
