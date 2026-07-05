import { api } from '@neonflux/convex/api';
import type { TicketPanelRecord, TicketsRepositoryError } from './contracts-tickets.js';
import { err, ok, type Result } from 'neverthrow';

import type { ConvexDatabase } from './convex.js';
import {
    normalizeOptionalText,
    normalizeRequiredText,
    toTicketPanelRecord,
    type ConvexTicketPanelRecord,
} from './runtime-tickets-records.js';

type ConvexQueryReference = Parameters<ConvexDatabase['client']['query']>[0];
type ConvexMutationReference = Parameters<ConvexDatabase['client']['mutation']>[0];

const convexApi = api as unknown as {
    tickets: {
        createTicketPanel: ConvexMutationReference;
        deleteTicketPanel: ConvexMutationReference;
        findEnabledTicketPanelByMessageId: ConvexQueryReference;
        listTicketPanelsByGuildId: ConvexQueryReference;
        reserveNextTicketNumber: ConvexMutationReference;
        updateTicketPanel: ConvexMutationReference;
        updateTicketPanelEnabled: ConvexMutationReference;
    };
};

type TicketsPanelDb = ConvexDatabase;

export async function createTicketPanel(
    db: TicketsPanelDb,
    input: {
        channelId: string;
        config?: Record<string, unknown>;
        enabled?: boolean;
        guildId: string;
        messageId?: string;
        title: string;
    }
): Promise<Result<TicketPanelRecord, TicketsRepositoryError>> {
    const normalizedInput = normalizePanelInput(input);
    if (normalizedInput.isErr()) return err(normalizedInput.error);

    try {
        const panel = await db.client.mutation<ConvexTicketPanelRecord>(
            convexApi.tickets.createTicketPanel,
            normalizedInput.value
        );

        return ok(toTicketPanelRecord(panel));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function updateTicketPanel(
    db: TicketsPanelDb,
    input: {
        channelId: string;
        config?: Record<string, unknown>;
        enabled?: boolean;
        guildId: string;
        messageId?: string;
        panelId: string;
        title: string;
    }
): Promise<Result<TicketPanelRecord, TicketsRepositoryError>> {
    const normalizedInput = normalizePanelInput(input);
    const panelId = normalizeRequiredText(input.panelId, 'panelId');

    if (normalizedInput.isErr()) return err(normalizedInput.error);
    if (panelId.isErr()) return err(panelId.error);

    try {
        const panel = await db.client.mutation<ConvexTicketPanelRecord | null>(convexApi.tickets.updateTicketPanel, {
            ...normalizedInput.value,
            panelId: panelId.value,
        });

        return panel ? ok(toTicketPanelRecord(panel)) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function listTicketPanelsByGuildId(
    db: TicketsPanelDb,
    input: { enabledOnly?: boolean; guildId: string }
): Promise<Result<TicketPanelRecord[], TicketsRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    if (guildId.isErr()) return err(guildId.error);

    try {
        const panels = await db.client.query<ConvexTicketPanelRecord[]>(convexApi.tickets.listTicketPanelsByGuildId, {
            ...(input.enabledOnly === undefined ? {} : { enabledOnly: input.enabledOnly }),
            guildId: guildId.value,
            limit: 500,
        });

        return ok(panels.map(toTicketPanelRecord));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function findEnabledTicketPanelByMessageId(
    db: TicketsPanelDb,
    input: { guildId: string; messageId: string }
): Promise<Result<TicketPanelRecord, TicketsRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const messageId = normalizeRequiredText(input.messageId, 'messageId');

    if (guildId.isErr()) return err(guildId.error);
    if (messageId.isErr()) return err(messageId.error);

    try {
        const panel = await db.client.query<ConvexTicketPanelRecord | null>(
            convexApi.tickets.findEnabledTicketPanelByMessageId,
            {
                guildId: guildId.value,
                messageId: messageId.value,
            }
        );

        return panel ? ok(toTicketPanelRecord(panel)) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function updateTicketPanelEnabled(
    db: TicketsPanelDb,
    input: { enabled: boolean; guildId: string; panelId: string }
): Promise<Result<TicketPanelRecord, TicketsRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const panelId = normalizeRequiredText(input.panelId, 'panelId');

    if (guildId.isErr()) return err(guildId.error);
    if (panelId.isErr()) return err(panelId.error);

    try {
        const panel = await db.client.mutation<ConvexTicketPanelRecord | null>(
            convexApi.tickets.updateTicketPanelEnabled,
            {
                enabled: input.enabled,
                guildId: guildId.value,
                panelId: panelId.value,
            }
        );

        return panel ? ok(toTicketPanelRecord(panel)) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function deleteTicketPanel(
    db: TicketsPanelDb,
    input: { guildId: string; panelId: string }
): Promise<Result<TicketPanelRecord, TicketsRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const panelId = normalizeRequiredText(input.panelId, 'panelId');

    if (guildId.isErr()) return err(guildId.error);
    if (panelId.isErr()) return err(panelId.error);

    try {
        const panel = await db.client.mutation<ConvexTicketPanelRecord | null>(convexApi.tickets.deleteTicketPanel, {
            guildId: guildId.value,
            panelId: panelId.value,
        });

        return panel ? ok(toTicketPanelRecord(panel)) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function reserveNextTicketNumber(
    db: TicketsPanelDb,
    input: { guildId: string }
): Promise<Result<number, TicketsRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    if (guildId.isErr()) return err(guildId.error);

    try {
        const ticketNumber = await db.client.mutation<number>(convexApi.tickets.reserveNextTicketNumber, {
            guildId: guildId.value,
        });

        return ok(ticketNumber);
    } catch {
        return err({ type: 'database-error' });
    }
}

function normalizePanelInput(input: {
    channelId: string;
    config?: Record<string, unknown>;
    enabled?: boolean;
    guildId: string;
    messageId?: string;
    title: string;
}): Result<Record<string, unknown>, TicketsRepositoryError> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const channelId = normalizeRequiredText(input.channelId, 'channelId');
    const title = normalizeRequiredText(input.title, 'title');
    const messageId = normalizeOptionalText(input.messageId);

    if (guildId.isErr()) return err(guildId.error);
    if (channelId.isErr()) return err(channelId.error);
    if (title.isErr()) return err(title.error);

    return ok({
        channelId: channelId.value,
        config: input.config ?? {},
        ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
        guildId: guildId.value,
        ...(messageId ? { messageId } : {}),
        title: title.value,
    });
}
