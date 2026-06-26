import { and, eq } from 'drizzle-orm';
import { err, ok, type Result } from 'neverthrow';

import {
    normalizeOptionalText,
    normalizeRequiredText,
    type GuildFeatureRepositoryDatabase,
    type GuildFeatureRepositoryError,
} from './feature-repository-types.js';
import { messageTemplates, postedMessages } from './schema.js';

export type MessageTemplateRecord = typeof messageTemplates.$inferSelect;
export type PostedMessageRecord = typeof postedMessages.$inferSelect;
export type PostingRepositoryError = GuildFeatureRepositoryError;

export async function upsertMessageTemplate(
    db: GuildFeatureRepositoryDatabase,
    input: {
        guildId: string;
        name: string;
        content?: string;
        embeds?: unknown[];
        createdByUserId?: string;
    }
): Promise<Result<MessageTemplateRecord, PostingRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const name = normalizeRequiredText(input.name, 'name');
    const content = normalizeOptionalText(input.content);
    const embeds = input.embeds ?? [];
    const updatedAt = new Date();

    if (guildId.isErr()) return err(guildId.error);
    if (name.isErr()) return err(name.error);

    if (!content && embeds.length === 0) {
        return err({ type: 'missing-input', field: 'message' });
    }

    try {
        const rows = await db
            .insert(messageTemplates)
            .values({
                guildId: guildId.value,
                name: name.value,
                content: content ?? null,
                embeds,
                createdByUserId: normalizeOptionalText(input.createdByUserId),
                updatedAt,
            })
            .onConflictDoUpdate({
                target: [messageTemplates.guildId, messageTemplates.name],
                set: {
                    content: content ?? null,
                    embeds,
                    updatedAt,
                },
            })
            .returning();
        const row = rows[0];

        return row ? ok(row) : err({ type: 'database-error' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function recordPostedMessage(
    db: GuildFeatureRepositoryDatabase,
    input: {
        guildId: string;
        channelId: string;
        messageId: string;
        templateId?: string;
        createdByUserId?: string;
        purpose?: string;
    }
): Promise<Result<PostedMessageRecord, PostingRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const channelId = normalizeRequiredText(input.channelId, 'channelId');
    const messageId = normalizeRequiredText(input.messageId, 'messageId');

    if (guildId.isErr()) return err(guildId.error);
    if (channelId.isErr()) return err(channelId.error);
    if (messageId.isErr()) return err(messageId.error);

    try {
        const rows = await db
            .insert(postedMessages)
            .values({
                guildId: guildId.value,
                channelId: channelId.value,
                messageId: messageId.value,
                templateId: normalizeOptionalText(input.templateId),
                createdByUserId: normalizeOptionalText(input.createdByUserId),
                purpose: normalizeOptionalText(input.purpose) ?? 'manual',
                updatedAt: new Date(),
            })
            .onConflictDoUpdate({
                target: [postedMessages.guildId, postedMessages.channelId, postedMessages.messageId],
                set: {
                    templateId: normalizeOptionalText(input.templateId),
                    purpose: normalizeOptionalText(input.purpose) ?? 'manual',
                    updatedAt: new Date(),
                },
            })
            .returning();
        const row = rows[0];

        return row ? ok(row) : err({ type: 'database-error' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function findMessageTemplateByName(
    db: GuildFeatureRepositoryDatabase,
    input: { guildId: string; name: string }
): Promise<Result<MessageTemplateRecord, PostingRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const name = normalizeRequiredText(input.name, 'name');

    if (guildId.isErr()) return err(guildId.error);
    if (name.isErr()) return err(name.error);

    try {
        const rows = await db
            .select()
            .from(messageTemplates)
            .where(and(eq(messageTemplates.guildId, guildId.value), eq(messageTemplates.name, name.value)))
            .limit(1);
        const row = rows[0];

        return row ? ok(row) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}
