import { eq } from 'drizzle-orm';
import { err, ok, type Result } from 'neverthrow';

import {
    assertAllowedStatusTransition,
    normalizeOptionalText,
    normalizeRequiredPositiveInteger,
    normalizeRequiredText,
    type GuildFeatureRepositoryDatabase,
    type GuildFeatureRepositoryError,
} from './feature-repository-types.js';
import { ticketEvents, ticketMembers, ticketPanels, tickets } from './schema.js';

export type TicketPanelRecord = typeof ticketPanels.$inferSelect;
export type TicketRecord = typeof tickets.$inferSelect;
export type TicketMemberRecord = typeof ticketMembers.$inferSelect;
export type TicketEventRecord = typeof ticketEvents.$inferSelect;
export type TicketsRepositoryError = GuildFeatureRepositoryError;

const ticketStatusTransitions = new Map<string, readonly string[]>([
    ['open', ['closed']],
    ['closed', []],
]);

export async function createTicketPanel(
    db: GuildFeatureRepositoryDatabase,
    input: { guildId: string; channelId: string; title: string; config?: Record<string, unknown> }
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
                config: input.config ?? {},
            })
            .returning();
        const row = rows[0];

        return row ? ok(row) : err({ type: 'database-error' });
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
                closedAt: status.value === 'closed' ? new Date() : existing.closedAt,
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
