import { and, asc, eq, sql } from 'drizzle-orm';
import { err, ok, type Result } from 'neverthrow';

import {
    assertAllowedStatusTransition,
    normalizeOptionalText,
    normalizeRequiredPositiveInteger,
    normalizeRequiredText,
    type GuildFeatureRepositoryDatabase,
    type GuildFeatureRepositoryError,
} from './feature-repository-types.js';
import { ticketCounters, ticketEvents, ticketMembers, ticketPanels, tickets } from './schema.js';

export type TicketPanelRecord = typeof ticketPanels.$inferSelect;
export type TicketRecord = typeof tickets.$inferSelect;
export type TicketMemberRecord = typeof ticketMembers.$inferSelect;
export type TicketEventRecord = typeof ticketEvents.$inferSelect;
export type TicketsRepositoryError = GuildFeatureRepositoryError;

const ticketStatusTransitions = new Map<string, readonly string[]>([
    ['open', ['closed', 'archived']],
    ['closed', ['archived']],
    ['archived', []],
]);

export async function createTicketPanel(
    db: GuildFeatureRepositoryDatabase,
    input: {
        guildId: string;
        channelId: string;
        title: string;
        messageId?: string;
        enabled?: boolean;
        config?: Record<string, unknown>;
    }
): Promise<Result<TicketPanelRecord, TicketsRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const channelId = normalizeRequiredText(input.channelId, 'channelId');
    const title = normalizeRequiredText(input.title, 'title');

    if (guildId.isErr()) return err(guildId.error);
    if (channelId.isErr()) return err(channelId.error);
    if (title.isErr()) return err(title.error);

    try {
        const rows = await db
            .insert(ticketPanels)
            .values({
                guildId: guildId.value,
                channelId: channelId.value,
                title: title.value,
                messageId: normalizeOptionalText(input.messageId),
                enabled: input.enabled ?? true,
                config: input.config ?? {},
                updatedAt: new Date(),
            })
            .returning();
        const row = rows[0];

        return row ? ok(row) : err({ type: 'database-error' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function updateTicketPanel(
    db: GuildFeatureRepositoryDatabase,
    input: {
        guildId: string;
        panelId: string;
        channelId: string;
        title: string;
        messageId?: string;
        enabled?: boolean;
        config?: Record<string, unknown>;
    }
): Promise<Result<TicketPanelRecord, TicketsRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const panelId = normalizeRequiredText(input.panelId, 'panelId');
    const channelId = normalizeRequiredText(input.channelId, 'channelId');
    const title = normalizeRequiredText(input.title, 'title');

    if (guildId.isErr()) return err(guildId.error);
    if (panelId.isErr()) return err(panelId.error);
    if (channelId.isErr()) return err(channelId.error);
    if (title.isErr()) return err(title.error);

    try {
        const rows = await db
            .update(ticketPanels)
            .set({
                channelId: channelId.value,
                title: title.value,
                messageId: normalizeOptionalText(input.messageId),
                enabled: input.enabled ?? true,
                config: input.config ?? {},
                updatedAt: new Date(),
            })
            .where(and(eq(ticketPanels.guildId, guildId.value), eq(ticketPanels.id, panelId.value)))
            .returning();
        const row = rows[0];

        return row ? ok(row) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function listTicketPanelsByGuildId(
    db: GuildFeatureRepositoryDatabase,
    input: { guildId: string; enabledOnly?: boolean }
): Promise<Result<TicketPanelRecord[], TicketsRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');

    if (guildId.isErr()) return err(guildId.error);

    try {
        const rows = await db
            .select()
            .from(ticketPanels)
            .where(
                input.enabledOnly
                    ? and(eq(ticketPanels.guildId, guildId.value), eq(ticketPanels.enabled, true))
                    : eq(ticketPanels.guildId, guildId.value)
            )
            .orderBy(asc(ticketPanels.createdAt));

        return ok(rows);
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function findEnabledTicketPanelByMessageId(
    db: GuildFeatureRepositoryDatabase,
    input: { guildId: string; messageId: string }
): Promise<Result<TicketPanelRecord, TicketsRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const messageId = normalizeRequiredText(input.messageId, 'messageId');

    if (guildId.isErr()) return err(guildId.error);
    if (messageId.isErr()) return err(messageId.error);

    try {
        const rows = await db
            .select()
            .from(ticketPanels)
            .where(
                and(
                    eq(ticketPanels.guildId, guildId.value),
                    eq(ticketPanels.messageId, messageId.value),
                    eq(ticketPanels.enabled, true)
                )
            )
            .orderBy(asc(ticketPanels.createdAt))
            .limit(1);
        const row = rows[0];

        return row ? ok(row) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function updateTicketPanelEnabled(
    db: GuildFeatureRepositoryDatabase,
    input: { guildId: string; panelId: string; enabled: boolean }
): Promise<Result<TicketPanelRecord, TicketsRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const panelId = normalizeRequiredText(input.panelId, 'panelId');

    if (guildId.isErr()) return err(guildId.error);
    if (panelId.isErr()) return err(panelId.error);

    try {
        const rows = await db
            .update(ticketPanels)
            .set({
                enabled: input.enabled,
                updatedAt: new Date(),
            })
            .where(and(eq(ticketPanels.guildId, guildId.value), eq(ticketPanels.id, panelId.value)))
            .returning();
        const row = rows[0];

        return row ? ok(row) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function deleteTicketPanel(
    db: GuildFeatureRepositoryDatabase,
    input: { guildId: string; panelId: string }
): Promise<Result<TicketPanelRecord, TicketsRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const panelId = normalizeRequiredText(input.panelId, 'panelId');

    if (guildId.isErr()) return err(guildId.error);
    if (panelId.isErr()) return err(panelId.error);

    try {
        const rows = await db
            .delete(ticketPanels)
            .where(and(eq(ticketPanels.guildId, guildId.value), eq(ticketPanels.id, panelId.value)))
            .returning();
        const row = rows[0];

        return row ? ok(row) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function reserveNextTicketNumber(
    db: GuildFeatureRepositoryDatabase,
    input: { guildId: string }
): Promise<Result<number, TicketsRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');

    if (guildId.isErr()) return err(guildId.error);

    try {
        const rows = await db
            .insert(ticketCounters)
            .values({
                guildId: guildId.value,
                nextTicketNumber: 2,
                updatedAt: new Date(),
            })
            .onConflictDoUpdate({
                target: ticketCounters.guildId,
                set: {
                    nextTicketNumber: sql`${ticketCounters.nextTicketNumber} + 1`,
                    updatedAt: new Date(),
                },
            })
            .returning({
                nextTicketNumber: ticketCounters.nextTicketNumber,
            });
        const row = rows[0];

        return row ? ok(row.nextTicketNumber - 1) : err({ type: 'database-error' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function createTicket(
    db: GuildFeatureRepositoryDatabase,
    input: {
        guildId: string;
        ticketNumber: number;
        openerUserId: string;
        panelId?: string;
        channelId?: string;
    }
): Promise<Result<TicketRecord, TicketsRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const ticketNumber = normalizeRequiredPositiveInteger(input.ticketNumber, 'ticketNumber');
    const openerUserId = normalizeRequiredText(input.openerUserId, 'openerUserId');

    if (guildId.isErr()) return err(guildId.error);
    if (ticketNumber.isErr()) return err(ticketNumber.error);
    if (openerUserId.isErr()) return err(openerUserId.error);

    try {
        const rows = await db
            .insert(tickets)
            .values({
                guildId: guildId.value,
                ticketNumber: ticketNumber.value,
                openerUserId: openerUserId.value,
                panelId: normalizeOptionalText(input.panelId),
                channelId: normalizeOptionalText(input.channelId),
            })
            .returning();
        const row = rows[0];

        return row ? ok(row) : err({ type: 'database-error' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function findOpenTicketByPanelAndOpener(
    db: GuildFeatureRepositoryDatabase,
    input: { panelId: string; openerUserId: string }
): Promise<Result<TicketRecord, TicketsRepositoryError>> {
    const panelId = normalizeRequiredText(input.panelId, 'panelId');
    const openerUserId = normalizeRequiredText(input.openerUserId, 'openerUserId');

    if (panelId.isErr()) return err(panelId.error);
    if (openerUserId.isErr()) return err(openerUserId.error);

    try {
        const rows = await db
            .select()
            .from(tickets)
            .where(
                and(
                    eq(tickets.panelId, panelId.value),
                    eq(tickets.openerUserId, openerUserId.value),
                    eq(tickets.status, 'open')
                )
            )
            .orderBy(asc(tickets.openedAt))
            .limit(1);
        const row = rows[0];

        return row ? ok(row) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function listOpenTicketsByPanelAndOpener(
    db: GuildFeatureRepositoryDatabase,
    input: { panelId: string; openerUserId: string; limit?: number }
): Promise<Result<TicketRecord[], TicketsRepositoryError>> {
    const panelId = normalizeRequiredText(input.panelId, 'panelId');
    const openerUserId = normalizeRequiredText(input.openerUserId, 'openerUserId');

    if (panelId.isErr()) return err(panelId.error);
    if (openerUserId.isErr()) return err(openerUserId.error);

    try {
        const rows = await db
            .select()
            .from(tickets)
            .where(
                and(
                    eq(tickets.panelId, panelId.value),
                    eq(tickets.openerUserId, openerUserId.value),
                    eq(tickets.status, 'open')
                )
            )
            .orderBy(asc(tickets.openedAt))
            .limit(input.limit ?? 10);

        return ok(rows);
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function findTicketByChannelId(
    db: GuildFeatureRepositoryDatabase,
    input: { guildId: string; channelId: string }
): Promise<Result<TicketRecord, TicketsRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const channelId = normalizeRequiredText(input.channelId, 'channelId');

    if (guildId.isErr()) return err(guildId.error);
    if (channelId.isErr()) return err(channelId.error);

    try {
        const rows = await db
            .select()
            .from(tickets)
            .where(and(eq(tickets.guildId, guildId.value), eq(tickets.channelId, channelId.value)))
            .orderBy(asc(tickets.openedAt))
            .limit(1);
        const row = rows[0];

        return row ? ok(row) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function updateTicketChannelId(
    db: GuildFeatureRepositoryDatabase,
    input: { ticketId: string; channelId: string }
): Promise<Result<TicketRecord, TicketsRepositoryError>> {
    const ticketId = normalizeRequiredText(input.ticketId, 'ticketId');
    const channelId = normalizeRequiredText(input.channelId, 'channelId');

    if (ticketId.isErr()) return err(ticketId.error);
    if (channelId.isErr()) return err(channelId.error);

    try {
        const rows = await db
            .update(tickets)
            .set({
                channelId: channelId.value,
                updatedAt: new Date(),
            })
            .where(eq(tickets.id, ticketId.value))
            .returning();
        const row = rows[0];

        return row ? ok(row) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function updateTicketStatus(
    db: GuildFeatureRepositoryDatabase,
    input: { ticketId: string; status: string; actorUserId?: string }
): Promise<Result<TicketRecord, TicketsRepositoryError>> {
    const ticketId = normalizeRequiredText(input.ticketId, 'ticketId');
    const status = normalizeRequiredText(input.status, 'status');

    if (ticketId.isErr()) return err(ticketId.error);
    if (status.isErr()) return err(status.error);

    try {
        const existingRows = await db.select().from(tickets).where(eq(tickets.id, ticketId.value)).limit(1);
        const existing = existingRows[0];

        if (!existing) {
            return err({ type: 'not-found' });
        }

        const transition = assertAllowedStatusTransition(existing.status, status.value, ticketStatusTransitions);

        if (transition.isErr()) {
            return err(transition.error);
        }

        const rows = await db
            .update(tickets)
            .set({
                status: status.value,
                closedAt:
                    status.value === 'closed' || (status.value === 'archived' && !existing.closedAt)
                        ? new Date()
                        : existing.closedAt,
                updatedAt: new Date(),
            })
            .where(eq(tickets.id, ticketId.value))
            .returning();
        const row = rows[0];

        return row ? ok(row) : err({ type: 'database-error' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function addTicketMember(
    db: GuildFeatureRepositoryDatabase,
    input: { ticketId: string; userId: string; role?: string }
): Promise<Result<TicketMemberRecord, TicketsRepositoryError>> {
    const ticketId = normalizeRequiredText(input.ticketId, 'ticketId');
    const userId = normalizeRequiredText(input.userId, 'userId');

    if (ticketId.isErr()) return err(ticketId.error);
    if (userId.isErr()) return err(userId.error);

    try {
        const rows = await db
            .insert(ticketMembers)
            .values({
                ticketId: ticketId.value,
                userId: userId.value,
                role: normalizeOptionalText(input.role) ?? 'participant',
            })
            .onConflictDoUpdate({
                target: [ticketMembers.ticketId, ticketMembers.userId],
                set: {
                    role: normalizeOptionalText(input.role) ?? 'participant',
                },
            })
            .returning();
        const row = rows[0];

        return row ? ok(row) : err({ type: 'database-error' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function recordTicketEvent(
    db: GuildFeatureRepositoryDatabase,
    input: { ticketId: string; eventType: string; actorUserId?: string; details?: Record<string, unknown> }
): Promise<Result<TicketEventRecord, TicketsRepositoryError>> {
    const ticketId = normalizeRequiredText(input.ticketId, 'ticketId');
    const eventType = normalizeRequiredText(input.eventType, 'eventType');

    if (ticketId.isErr()) return err(ticketId.error);
    if (eventType.isErr()) return err(eventType.error);

    try {
        const rows = await db
            .insert(ticketEvents)
            .values({
                ticketId: ticketId.value,
                eventType: eventType.value,
                actorUserId: normalizeOptionalText(input.actorUserId),
                details: input.details ?? {},
            })
            .returning();
        const row = rows[0];

        return row ? ok(row) : err({ type: 'database-error' });
    } catch {
        return err({ type: 'database-error' });
    }
}
