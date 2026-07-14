import type { GuildMemberFlowEventDocument } from './growth_overview_model.js';

export type MessageActivityReceipt = {
    activityDate: string;
    guildId: string;
    messageId: string;
    occurredAt: string;
    shard: number;
};

export async function recordMessageActivityOnce(input: {
    findReceipt: () => Promise<MessageActivityReceipt | null>;
    incrementAggregate: () => Promise<void>;
    insertReceipt: (receipt: MessageActivityReceipt) => Promise<void>;
    receipt: MessageActivityReceipt;
}): Promise<Pick<MessageActivityReceipt, 'activityDate' | 'guildId' | 'shard'> & { status: 'duplicate' | 'recorded' }> {
    const existing = await input.findReceipt();
    if (existing) return toMessageActivityResult(existing, 'duplicate');

    await input.insertReceipt(input.receipt);
    await input.incrementAggregate();
    return toMessageActivityResult(input.receipt, 'recorded');
}

function toMessageActivityResult(receipt: MessageActivityReceipt, status: 'duplicate' | 'recorded') {
    return {
        activityDate: receipt.activityDate,
        guildId: receipt.guildId,
        shard: receipt.shard,
        status,
    };
}

export async function recordMemberFlowEventOnce<Record>(input: {
    event: GuildMemberFlowEventDocument;
    findExistingJoin: () => Promise<Record | null>;
    insertEvent: () => Promise<Record>;
    prepareJoin?: () => Promise<void>;
}): Promise<Record> {
    if (input.event.eventType === 'join') {
        const existing = await input.findExistingJoin();
        if (existing) return existing;
        await input.prepareJoin?.();
    }

    return await input.insertEvent();
}
