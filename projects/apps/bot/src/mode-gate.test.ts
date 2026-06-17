import { describe, expect, it } from 'vitest';

import { shouldProcessBotGuildEvent } from './mode-gate.js';

describe('shouldProcessBotGuildEvent', () => {
    it('ignores non-target guild events in single mode', () => {
        expect(
            shouldProcessBotGuildEvent(
                {
                    instanceMode: 'single',
                    singleGuildId: 'target',
                },
                {
                    guildId: 'other',
                }
            )
        ).toBe(false);
    });

    it('accepts target guild events in single mode', () => {
        expect(
            shouldProcessBotGuildEvent(
                {
                    instanceMode: 'single',
                    singleGuildId: 'target',
                },
                {
                    guildId: 'target',
                }
            )
        ).toBe(true);
    });

    it('accepts installed guild events in multi mode', () => {
        expect(
            shouldProcessBotGuildEvent(
                {
                    instanceMode: 'multi',
                },
                {
                    guildId: 'guild-1',
                    installedGuildIds: ['guild-1'],
                }
            )
        ).toBe(true);
    });
});
