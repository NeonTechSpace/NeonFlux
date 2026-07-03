import { api } from '@neonflux/convex/api';
import {
    deleteVerificationFlow as deleteVerificationFlowPostgres,
    findActiveVerificationRecord as findActiveVerificationRecordPostgres,
    findEnabledVerificationFlowByReaction as findEnabledVerificationFlowByReactionPostgres,
    listVerificationFlowsByGuildId as listVerificationFlowsByGuildIdPostgres,
    revokeVerificationRecord as revokeVerificationRecordPostgres,
    upsertVerificationFlow as upsertVerificationFlowPostgres,
    upsertVerificationRecord as upsertVerificationRecordPostgres,
    type GuildFeatureRepositoryError,
    type VerificationFlowRecord,
    type VerificationRecord,
    type VerificationRepositoryError,
} from '@neonflux/db';
import { err, ok, type Result } from 'neverthrow';

import { isConvexPersistenceDatabase, type ConvexPersistenceDatabase } from './convex.js';

type ConvexQueryReference = Parameters<ConvexPersistenceDatabase['client']['query']>[0];
type ConvexMutationReference = Parameters<ConvexPersistenceDatabase['client']['mutation']>[0];

const convexApi = api as unknown as {
    verification: {
        deleteVerificationFlow: ConvexMutationReference;
        findActiveVerificationRecord: ConvexQueryReference;
        findEnabledVerificationFlowByReaction: ConvexQueryReference;
        listVerificationFlowsByGuildId: ConvexQueryReference;
        revokeVerificationRecord: ConvexMutationReference;
        upsertVerificationFlow: ConvexMutationReference;
        upsertVerificationRecord: ConvexMutationReference;
    };
};

type PostgresVerificationDb = Parameters<typeof upsertVerificationFlowPostgres>[0];
type VerificationDb = ConvexPersistenceDatabase | PostgresVerificationDb;

type ConvexVerificationFlowRecord = {
    channelId: string;
    createdAt: string;
    emojiKey: string;
    enabled: boolean;
    guildId: string;
    id: string;
    messageId: string;
    updatedAt: string;
    verifiedRoleId: string;
};

type ConvexVerificationRecord = {
    guildId: string;
    id: string;
    method: string;
    revokedAt: string | null;
    userId: string;
    verifiedAt: string;
};

export async function upsertVerificationFlow(
    db: VerificationDb,
    input: {
        channelId: string;
        emojiKey: string;
        enabled?: boolean;
        guildId: string;
        messageId: string;
        verifiedRoleId: string;
    }
): Promise<Result<VerificationFlowRecord, VerificationRepositoryError>> {
    if (!isConvexPersistenceDatabase(db)) {
        return upsertVerificationFlowPostgres(db, input);
    }

    const normalizedInput = normalizeVerificationFlowInput(input);

    if (normalizedInput.isErr()) {
        return err(normalizedInput.error);
    }

    try {
        const flow = (await db.client.mutation(
            convexApi.verification.upsertVerificationFlow,
            normalizedInput.value
        )) as ConvexVerificationFlowRecord;

        return ok(toVerificationFlowRecord(flow));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function listVerificationFlowsByGuildId(
    db: VerificationDb,
    input: { enabled?: boolean; guildId: string }
): Promise<Result<VerificationFlowRecord[], VerificationRepositoryError>> {
    if (!isConvexPersistenceDatabase(db)) {
        return listVerificationFlowsByGuildIdPostgres(db, input);
    }

    const guildId = normalizeRequiredText(input.guildId, 'guildId');

    if (guildId.isErr()) {
        return err(guildId.error);
    }

    try {
        const flows = (await db.client.query(convexApi.verification.listVerificationFlowsByGuildId, {
            ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
            guildId: guildId.value,
        })) as ConvexVerificationFlowRecord[];

        return ok(flows.map(toVerificationFlowRecord));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function findEnabledVerificationFlowByReaction(
    db: VerificationDb,
    input: { emojiKey: string; guildId: string; messageId: string }
): Promise<Result<VerificationFlowRecord, VerificationRepositoryError>> {
    if (!isConvexPersistenceDatabase(db)) {
        return findEnabledVerificationFlowByReactionPostgres(db, input);
    }

    const normalizedInput = normalizeVerificationReactionInput(input);

    if (normalizedInput.isErr()) {
        return err(normalizedInput.error);
    }

    try {
        const flow = (await db.client.query(
            convexApi.verification.findEnabledVerificationFlowByReaction,
            normalizedInput.value
        )) as ConvexVerificationFlowRecord | null;

        return flow ? ok(toVerificationFlowRecord(flow)) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function deleteVerificationFlow(
    db: VerificationDb,
    input: { guildId: string; messageId: string }
): Promise<Result<VerificationFlowRecord, VerificationRepositoryError>> {
    if (!isConvexPersistenceDatabase(db)) {
        return deleteVerificationFlowPostgres(db, input);
    }

    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const messageId = normalizeRequiredText(input.messageId, 'messageId');

    if (guildId.isErr()) return err(guildId.error);
    if (messageId.isErr()) return err(messageId.error);

    try {
        const flow = (await db.client.mutation(convexApi.verification.deleteVerificationFlow, {
            guildId: guildId.value,
            messageId: messageId.value,
        })) as ConvexVerificationFlowRecord | null;

        return flow ? ok(toVerificationFlowRecord(flow)) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function upsertVerificationRecord(
    db: VerificationDb,
    input: { guildId: string; method: string; userId: string }
): Promise<Result<VerificationRecord, VerificationRepositoryError>> {
    if (!isConvexPersistenceDatabase(db)) {
        return upsertVerificationRecordPostgres(db, input);
    }

    const normalizedInput = normalizeVerificationRecordInput(input);

    if (normalizedInput.isErr()) {
        return err(normalizedInput.error);
    }

    try {
        const record = (await db.client.mutation(
            convexApi.verification.upsertVerificationRecord,
            normalizedInput.value
        )) as ConvexVerificationRecord;

        return ok(toVerificationRecord(record));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function revokeVerificationRecord(
    db: VerificationDb,
    input: { guildId: string; userId: string }
): Promise<Result<VerificationRecord, VerificationRepositoryError>> {
    if (!isConvexPersistenceDatabase(db)) {
        return revokeVerificationRecordPostgres(db, input);
    }

    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const userId = normalizeRequiredText(input.userId, 'userId');

    if (guildId.isErr()) return err(guildId.error);
    if (userId.isErr()) return err(userId.error);

    try {
        const record = (await db.client.mutation(convexApi.verification.revokeVerificationRecord, {
            guildId: guildId.value,
            userId: userId.value,
        })) as ConvexVerificationRecord | null;

        return record ? ok(toVerificationRecord(record)) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function findActiveVerificationRecord(
    db: VerificationDb,
    input: { guildId: string; userId: string }
): Promise<Result<VerificationRecord, VerificationRepositoryError>> {
    if (!isConvexPersistenceDatabase(db)) {
        return findActiveVerificationRecordPostgres(db, input);
    }

    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const userId = normalizeRequiredText(input.userId, 'userId');

    if (guildId.isErr()) return err(guildId.error);
    if (userId.isErr()) return err(userId.error);

    try {
        const record = (await db.client.query(convexApi.verification.findActiveVerificationRecord, {
            guildId: guildId.value,
            userId: userId.value,
        })) as ConvexVerificationRecord | null;

        return record ? ok(toVerificationRecord(record)) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

function toVerificationFlowRecord(record: ConvexVerificationFlowRecord): VerificationFlowRecord {
    return {
        channelId: record.channelId,
        createdAt: new Date(record.createdAt),
        emojiKey: record.emojiKey,
        enabled: record.enabled,
        guildId: record.guildId,
        id: record.id,
        messageId: record.messageId,
        updatedAt: new Date(record.updatedAt),
        verifiedRoleId: record.verifiedRoleId,
    };
}

function toVerificationRecord(record: ConvexVerificationRecord): VerificationRecord {
    return {
        guildId: record.guildId,
        id: record.id,
        method: record.method,
        revokedAt: record.revokedAt ? new Date(record.revokedAt) : null,
        userId: record.userId,
        verifiedAt: new Date(record.verifiedAt),
    };
}

function normalizeVerificationFlowInput(input: {
    channelId: string;
    emojiKey: string;
    enabled?: boolean;
    guildId: string;
    messageId: string;
    verifiedRoleId: string;
}): Result<
    {
        channelId: string;
        emojiKey: string;
        enabled?: boolean;
        guildId: string;
        messageId: string;
        verifiedRoleId: string;
    },
    VerificationRepositoryError
> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const channelId = normalizeRequiredText(input.channelId, 'channelId');
    const messageId = normalizeRequiredText(input.messageId, 'messageId');
    const emojiKey = normalizeRequiredText(input.emojiKey, 'emojiKey');
    const verifiedRoleId = normalizeRequiredText(input.verifiedRoleId, 'verifiedRoleId');

    if (guildId.isErr()) return err(guildId.error);
    if (channelId.isErr()) return err(channelId.error);
    if (messageId.isErr()) return err(messageId.error);
    if (emojiKey.isErr()) return err(emojiKey.error);
    if (verifiedRoleId.isErr()) return err(verifiedRoleId.error);

    return ok({
        channelId: channelId.value,
        emojiKey: emojiKey.value,
        ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
        guildId: guildId.value,
        messageId: messageId.value,
        verifiedRoleId: verifiedRoleId.value,
    });
}

function normalizeVerificationReactionInput(input: {
    emojiKey: string;
    guildId: string;
    messageId: string;
}): Result<{ emojiKey: string; guildId: string; messageId: string }, VerificationRepositoryError> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const messageId = normalizeRequiredText(input.messageId, 'messageId');
    const emojiKey = normalizeRequiredText(input.emojiKey, 'emojiKey');

    if (guildId.isErr()) return err(guildId.error);
    if (messageId.isErr()) return err(messageId.error);
    if (emojiKey.isErr()) return err(emojiKey.error);

    return ok({
        emojiKey: emojiKey.value,
        guildId: guildId.value,
        messageId: messageId.value,
    });
}

function normalizeVerificationRecordInput(input: {
    guildId: string;
    method: string;
    userId: string;
}): Result<{ guildId: string; method: string; userId: string }, VerificationRepositoryError> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const userId = normalizeRequiredText(input.userId, 'userId');
    const method = normalizeRequiredText(input.method, 'method');

    if (guildId.isErr()) return err(guildId.error);
    if (userId.isErr()) return err(userId.error);
    if (method.isErr()) return err(method.error);

    return ok({
        guildId: guildId.value,
        method: method.value,
        userId: userId.value,
    });
}

function normalizeRequiredText(
    value: string | null | undefined,
    field: string
): Result<string, GuildFeatureRepositoryError> {
    const normalizedValue = value?.trim();

    if (!normalizedValue) {
        return err({ field, type: 'missing-input' });
    }

    return ok(normalizedValue);
}
