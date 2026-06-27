import { and, eq, inArray, isNull } from 'drizzle-orm';
import { err, ok, type Result } from 'neverthrow';

import {
    normalizeRequiredText,
    type GuildFeatureRepositoryDatabase,
    type GuildFeatureRepositoryError,
} from './feature-repository-types.js';
import { giveawayEntries, giveaways } from './schema.js';

export type GiveawayReconciliationRepositoryError = GuildFeatureRepositoryError;

export async function reconcileGiveawayEntries(
    db: GuildFeatureRepositoryDatabase,
    input: { giveawayId: string; userIds: readonly string[]; reconciledAt?: Date }
): Promise<Result<{ added: number; removed: number; kept: number }, GiveawayReconciliationRepositoryError>> {
    const giveawayId = normalizeRequiredText(input.giveawayId, 'giveawayId');

    if (giveawayId.isErr()) return err(giveawayId.error);

    const userIds = [...new Set(input.userIds.map((userId) => userId.trim()).filter(Boolean))];
    const now = input.reconciledAt ?? new Date();

    try {
        const result = await db.transaction(async (tx) => {
            const giveaway = (await tx.select().from(giveaways).where(eq(giveaways.id, giveawayId.value)).limit(1))[0];

            if (!giveaway) return undefined;

            const activeEntries = await tx
                .select()
                .from(giveawayEntries)
                .where(and(eq(giveawayEntries.giveawayId, giveawayId.value), isNull(giveawayEntries.removedAt)));
            const activeUserIds = new Set(activeEntries.map((entry) => entry.userId));
            const targetUserIds = new Set(userIds);
            const userIdsToAdd = userIds.filter((userId) => !activeUserIds.has(userId));
            const userIdsToRemove = activeEntries
                .map((entry) => entry.userId)
                .filter((userId) => !targetUserIds.has(userId));

            if (userIdsToAdd.length > 0) {
                await tx
                    .insert(giveawayEntries)
                    .values(
                        userIdsToAdd.map((userId) => ({
                            giveawayId: giveawayId.value,
                            userId,
                            enteredAt: now,
                            removedAt: null,
                        }))
                    )
                    .onConflictDoUpdate({
                        target: [giveawayEntries.giveawayId, giveawayEntries.userId],
                        set: {
                            removedAt: null,
                        },
                    });
            }

            if (userIdsToRemove.length > 0) {
                await tx
                    .update(giveawayEntries)
                    .set({ removedAt: now })
                    .where(
                        and(
                            eq(giveawayEntries.giveawayId, giveawayId.value),
                            inArray(giveawayEntries.userId, userIdsToRemove),
                            isNull(giveawayEntries.removedAt)
                        )
                    );
            }

            await tx
                .update(giveaways)
                .set({
                    config: {
                        ...giveaway.config,
                        reactionReconciledAt: now.toISOString(),
                    },
                    updatedAt: now,
                })
                .where(eq(giveaways.id, giveawayId.value));

            return {
                added: userIdsToAdd.length,
                removed: userIdsToRemove.length,
                kept: userIds.length - userIdsToAdd.length,
            };
        });

        return result ? ok(result) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}
