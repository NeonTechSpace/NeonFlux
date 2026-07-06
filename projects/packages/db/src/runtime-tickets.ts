import { api } from '@neonflux/convex-api';
import type {
    TicketEventRecord,
    TicketMemberRecord,
    TicketRecord,
    TicketsRepositoryError,
} from './contracts-tickets.js';
import { err, ok, type Result } from 'neverthrow';

import type { ConvexDatabase } from './convex.js';
import {
    normalizeOptionalText,
    normalizePositiveInteger,
    normalizePositiveLimit,
    normalizeRequiredText,
    toTicketEventRecord,
    toTicketMemberRecord,
    toTicketRecord,
} from './runtime-tickets-records.js';

type TicketsDb = ConvexDatabase;

export async function createTicket(
    db: TicketsDb,
    input: {
        channelId?: string;
        guildId: string;
        openerUserId: string;
        panelId?: string;
        ticketNumber: number;
    }
): Promise<Result<TicketRecord, TicketsRepositoryError>> {
    const normalizedInput = normalizeCreateTicketInput(input);
    if (normalizedInput.isErr()) return err(normalizedInput.error);

    try {
        const ticket = await db.client.mutation(api.tickets.createTicket, normalizedInput.value);

        return ok(toTicketRecord(ticket));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function findOpenTicketByPanelAndOpener(
    db: TicketsDb,
    input: { openerUserId: string; panelId: string }
): Promise<Result<TicketRecord, TicketsRepositoryError>> {
    const normalizedInput = normalizePanelOpenerInput(input);
    if (normalizedInput.isErr()) return err(normalizedInput.error);

    try {
        const ticket = await db.client.query(
            api.tickets.findOpenTicketByPanelAndOpener,
            normalizedInput.value
        );

        return ticket ? ok(toTicketRecord(ticket)) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function listOpenTicketsByPanelAndOpener(
    db: TicketsDb,
    input: { limit?: number; openerUserId: string; panelId: string }
): Promise<Result<TicketRecord[], TicketsRepositoryError>> {
    const normalizedInput = normalizePanelOpenerInput(input);
    const limit = normalizePositiveLimit(input.limit, 10);

    if (normalizedInput.isErr()) return err(normalizedInput.error);
    if (limit.isErr()) return err(limit.error);

    try {
        const tickets = await db.client.query(api.tickets.listOpenTicketsByPanelAndOpener, {
            ...normalizedInput.value,
            limit: limit.value,
        });

        return ok(tickets.map(toTicketRecord));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function findTicketByChannelId(
    db: TicketsDb,
    input: { channelId: string; guildId: string }
): Promise<Result<TicketRecord, TicketsRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const channelId = normalizeRequiredText(input.channelId, 'channelId');

    if (guildId.isErr()) return err(guildId.error);
    if (channelId.isErr()) return err(channelId.error);

    try {
        const ticket = await db.client.query(api.tickets.findTicketByChannelId, {
            channelId: channelId.value,
            guildId: guildId.value,
        });

        return ticket ? ok(toTicketRecord(ticket)) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function updateTicketChannelId(
    db: TicketsDb,
    input: { channelId: string; ticketId: string }
): Promise<Result<TicketRecord, TicketsRepositoryError>> {
    const ticketId = normalizeRequiredText(input.ticketId, 'ticketId');
    const channelId = normalizeRequiredText(input.channelId, 'channelId');

    if (ticketId.isErr()) return err(ticketId.error);
    if (channelId.isErr()) return err(channelId.error);

    try {
        const ticket = await db.client.mutation(api.tickets.updateTicketChannelId, {
            channelId: channelId.value,
            ticketId: ticketId.value,
        });

        return ticket ? ok(toTicketRecord(ticket)) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function updateTicketStatus(
    db: TicketsDb,
    input: { actorUserId?: string; status: string; ticketId: string }
): Promise<Result<TicketRecord, TicketsRepositoryError>> {
    const ticketId = normalizeRequiredText(input.ticketId, 'ticketId');
    const status = normalizeRequiredText(input.status, 'status');

    if (ticketId.isErr()) return err(ticketId.error);
    if (status.isErr()) return err(status.error);

    try {
        const ticket = await db.client.mutation(api.tickets.updateTicketStatus, {
            status: status.value,
            ticketId: ticketId.value,
        });

        return ticket ? ok(toTicketRecord(ticket)) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function addTicketMember(
    db: TicketsDb,
    input: { role?: string; ticketId: string; userId: string }
): Promise<Result<TicketMemberRecord, TicketsRepositoryError>> {
    const ticketId = normalizeRequiredText(input.ticketId, 'ticketId');
    const userId = normalizeRequiredText(input.userId, 'userId');
    const role = normalizeOptionalText(input.role);

    if (ticketId.isErr()) return err(ticketId.error);
    if (userId.isErr()) return err(userId.error);

    try {
        const member = await db.client.mutation(api.tickets.addTicketMember, {
            ...(role ? { role } : {}),
            ticketId: ticketId.value,
            userId: userId.value,
        });

        return ok(toTicketMemberRecord(member));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function recordTicketEvent(
    db: TicketsDb,
    input: { actorUserId?: string; details?: Record<string, unknown>; eventType: string; ticketId: string }
): Promise<Result<TicketEventRecord, TicketsRepositoryError>> {
    const ticketId = normalizeRequiredText(input.ticketId, 'ticketId');
    const eventType = normalizeRequiredText(input.eventType, 'eventType');
    const actorUserId = normalizeOptionalText(input.actorUserId);

    if (ticketId.isErr()) return err(ticketId.error);
    if (eventType.isErr()) return err(eventType.error);

    try {
        const event = await db.client.mutation(api.tickets.recordTicketEvent, {
            ...(actorUserId ? { actorUserId } : {}),
            details: input.details ?? {},
            eventType: eventType.value,
            ticketId: ticketId.value,
        });

        return ok(toTicketEventRecord(event));
    } catch {
        return err({ type: 'database-error' });
    }
}

function normalizeCreateTicketInput(input: {
    channelId?: string;
    guildId: string;
    openerUserId: string;
    panelId?: string;
    ticketNumber: number;
}) {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const ticketNumber = normalizePositiveInteger(input.ticketNumber, 'ticketNumber');
    const openerUserId = normalizeRequiredText(input.openerUserId, 'openerUserId');
    const panelId = normalizeOptionalText(input.panelId);
    const channelId = normalizeOptionalText(input.channelId);

    if (guildId.isErr()) return err(guildId.error);
    if (ticketNumber.isErr()) return err(ticketNumber.error);
    if (openerUserId.isErr()) return err(openerUserId.error);

    return ok({
        ...(channelId ? { channelId } : {}),
        guildId: guildId.value,
        openerUserId: openerUserId.value,
        ...(panelId ? { panelId } : {}),
        ticketNumber: ticketNumber.value,
    });
}

function normalizePanelOpenerInput(input: {
    openerUserId: string;
    panelId: string;
}): Result<{ openerUserId: string; panelId: string }, TicketsRepositoryError> {
    const panelId = normalizeRequiredText(input.panelId, 'panelId');
    const openerUserId = normalizeRequiredText(input.openerUserId, 'openerUserId');

    if (panelId.isErr()) return err(panelId.error);
    if (openerUserId.isErr()) return err(openerUserId.error);

    return ok({ openerUserId: openerUserId.value, panelId: panelId.value });
}
