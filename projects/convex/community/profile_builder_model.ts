export type ProfileFormInput = {
    approvalRequired?: boolean | null;
    config?: Record<string, unknown> | null;
    createdAt?: string | null;
    enabled?: boolean | null;
    guildId?: string | null;
    legacyId?: string | null;
    name?: string | null;
    outputChannelId?: string | null;
    updatedAt?: string | null;
};

export type ProfileFormDocument = {
    approvalRequired: boolean;
    config: Record<string, unknown>;
    createdAt: string;
    enabled: boolean;
    guildId: string;
    legacyId: string;
    name: string;
    outputChannelId?: string;
    updatedAt: string;
};

export type ProfileFieldInput = {
    createdAt?: string | null;
    fieldKey?: string | null;
    fieldType?: string | null;
    formId?: string | null;
    label?: string | null;
    legacyId?: string | null;
    maxLength?: number | null;
    position?: number | null;
    required?: boolean | null;
    updatedAt?: string | null;
};

export type ProfileFieldDocument = {
    createdAt: string;
    fieldKey: string;
    fieldType: string;
    formLegacyId: string;
    label: string;
    legacyId: string;
    maxLength?: number;
    position: number;
    required: boolean;
    updatedAt: string;
};

export type ProfileSubmissionInput = {
    formId?: string | null;
    guildId?: string | null;
    legacyId?: string | null;
    reviewedAt?: string | null;
    status?: string | null;
    submittedAt?: string | null;
    updatedAt?: string | null;
    userId?: string | null;
    values?: Record<string, unknown> | null;
};

export type ProfileSubmissionStatus = 'approved' | 'pending' | 'rejected';

export type ProfileSubmissionDocument = {
    formLegacyId: string;
    guildId: string;
    legacyId: string;
    reviewedAt?: string;
    status: ProfileSubmissionStatus;
    submittedAt: string;
    updatedAt: string;
    userId: string;
    values: Record<string, unknown>;
};

export type ProfileSubmissionReviewInput = {
    createdAt?: string | null;
    decision?: string | null;
    legacyId?: string | null;
    reason?: string | null;
    reviewerUserId?: string | null;
    submissionId?: string | null;
};

export type ProfileSubmissionReviewDocument = {
    createdAt: string;
    decision: 'approved' | 'rejected';
    legacyId: string;
    reason?: string;
    reviewerUserId: string;
    submissionLegacyId: string;
};

export type ProfileBuilderInputError =
    | { field: string; type: 'invalid-value' | 'missing-input' }
    | { from: string; to: string; type: 'invalid-status-transition' };
export type ProfileBuilderInputResult<Value> =
    | { ok: true; value: Value }
    | { error: ProfileBuilderInputError; ok: false };

const submissionStatusTransitions = new Map<ProfileSubmissionStatus, readonly ProfileSubmissionStatus[]>([
    ['pending', ['approved', 'rejected']],
    ['approved', []],
    ['rejected', []],
]);

export function buildProfileFormDocument(
    input: ProfileFormInput,
    now: string,
    existing?: Pick<ProfileFormDocument, 'createdAt' | 'legacyId'>,
    createLegacyId: () => string = () => crypto.randomUUID()
): ProfileBuilderInputResult<ProfileFormDocument> {
    const guildId = normalizeRequiredString(input.guildId, 'guildId');
    const name = normalizeRequiredString(input.name, 'name');
    const config = normalizeRecord(input.config ?? {});
    const createdAt =
        input.createdAt === undefined ? (existing?.createdAt ?? now) : normalizeTimestamp(input.createdAt);
    const updatedAt = input.updatedAt === undefined ? now : normalizeTimestamp(input.updatedAt);

    if (!guildId.ok) return guildId;
    if (!name.ok) return name;
    if (!config) return { error: { field: 'config', type: 'invalid-value' }, ok: false };
    if (!createdAt) return { error: { field: 'createdAt', type: 'invalid-value' }, ok: false };
    if (!updatedAt) return { error: { field: 'updatedAt', type: 'invalid-value' }, ok: false };

    const outputChannelId = normalizeOptionalString(input.outputChannelId);

    return {
        ok: true,
        value: {
            approvalRequired: input.approvalRequired ?? true,
            config,
            createdAt,
            enabled: input.enabled ?? true,
            guildId: guildId.value,
            legacyId: normalizeOptionalString(input.legacyId) ?? existing?.legacyId ?? createLegacyId(),
            name: name.value,
            ...(outputChannelId ? { outputChannelId } : {}),
            updatedAt,
        },
    };
}

export function buildProfileFieldDocument(
    input: ProfileFieldInput,
    now: string,
    existing?: Pick<ProfileFieldDocument, 'createdAt' | 'legacyId'>,
    createLegacyId: () => string = () => crypto.randomUUID()
): ProfileBuilderInputResult<ProfileFieldDocument> {
    const formId = normalizeRequiredString(input.formId, 'formId');
    const fieldKey = normalizeRequiredString(input.fieldKey, 'fieldKey');
    const label = normalizeRequiredString(input.label, 'label');
    const fieldType = normalizeRequiredString(input.fieldType, 'fieldType');
    const position = normalizeNonNegativeInteger(input.position ?? 0, 'position');
    const maxLength = input.maxLength === null || input.maxLength === undefined ? undefined : input.maxLength;
    const createdAt =
        input.createdAt === undefined ? (existing?.createdAt ?? now) : normalizeTimestamp(input.createdAt);
    const updatedAt = input.updatedAt === undefined ? now : normalizeTimestamp(input.updatedAt);

    if (!formId.ok) return formId;
    if (!fieldKey.ok) return fieldKey;
    if (!label.ok) return label;
    if (!fieldType.ok) return fieldType;
    if (!position.ok) return position;
    if (maxLength !== undefined && !Number.isInteger(maxLength)) {
        return { error: { field: 'maxLength', type: 'invalid-value' }, ok: false };
    }
    if (!createdAt) return { error: { field: 'createdAt', type: 'invalid-value' }, ok: false };
    if (!updatedAt) return { error: { field: 'updatedAt', type: 'invalid-value' }, ok: false };

    return {
        ok: true,
        value: {
            createdAt,
            fieldKey: fieldKey.value,
            fieldType: fieldType.value,
            formLegacyId: formId.value,
            label: label.value,
            legacyId: normalizeOptionalString(input.legacyId) ?? existing?.legacyId ?? createLegacyId(),
            ...(maxLength === undefined ? {} : { maxLength }),
            position: position.value,
            required: input.required ?? false,
            updatedAt,
        },
    };
}

export function buildProfileSubmissionDocument(
    input: ProfileSubmissionInput,
    now: string,
    createLegacyId: () => string = () => crypto.randomUUID()
): ProfileBuilderInputResult<ProfileSubmissionDocument> {
    const guildId = normalizeRequiredString(input.guildId, 'guildId');
    const formId = normalizeRequiredString(input.formId, 'formId');
    const userId = normalizeRequiredString(input.userId, 'userId');
    const status = normalizeSubmissionStatus(input.status ?? 'pending', true);
    const values = normalizeRecord(input.values ?? {});
    const submittedAt = input.submittedAt === undefined ? now : normalizeTimestamp(input.submittedAt);
    const updatedAt = input.updatedAt === undefined ? now : normalizeTimestamp(input.updatedAt);
    const reviewedAt =
        input.reviewedAt === undefined || input.reviewedAt === null
            ? status.ok && status.value === 'approved'
                ? now
                : undefined
            : normalizeTimestamp(input.reviewedAt);

    if (!guildId.ok) return guildId;
    if (!formId.ok) return formId;
    if (!userId.ok) return userId;
    if (!status.ok) return status;
    if (!values) return { error: { field: 'values', type: 'invalid-value' }, ok: false };
    if (!submittedAt) return { error: { field: 'submittedAt', type: 'invalid-value' }, ok: false };
    if (!updatedAt) return { error: { field: 'updatedAt', type: 'invalid-value' }, ok: false };
    if (input.reviewedAt !== undefined && input.reviewedAt !== null && !reviewedAt) {
        return { error: { field: 'reviewedAt', type: 'invalid-value' }, ok: false };
    }

    return {
        ok: true,
        value: {
            formLegacyId: formId.value,
            guildId: guildId.value,
            legacyId: normalizeOptionalString(input.legacyId) ?? createLegacyId(),
            ...(reviewedAt ? { reviewedAt } : {}),
            status: status.value,
            submittedAt,
            updatedAt,
            userId: userId.value,
            values,
        },
    };
}

export function buildProfileSubmissionReviewDocument(
    input: ProfileSubmissionReviewInput,
    now: string,
    createLegacyId: () => string = () => crypto.randomUUID()
): ProfileBuilderInputResult<ProfileSubmissionReviewDocument> {
    const submissionId = normalizeRequiredString(input.submissionId, 'submissionId');
    const reviewerUserId = normalizeRequiredString(input.reviewerUserId, 'reviewerUserId');
    const decision = normalizeSubmissionStatus(input.decision, false);
    const createdAt = input.createdAt === undefined ? now : normalizeTimestamp(input.createdAt);

    if (!submissionId.ok) return submissionId;
    if (!reviewerUserId.ok) return reviewerUserId;
    if (!decision.ok) return decision;
    if (!createdAt) return { error: { field: 'createdAt', type: 'invalid-value' }, ok: false };

    const reason = normalizeOptionalString(input.reason);

    return {
        ok: true,
        value: {
            createdAt,
            decision: decision.value,
            legacyId: normalizeOptionalString(input.legacyId) ?? createLegacyId(),
            ...(reason ? { reason } : {}),
            reviewerUserId: reviewerUserId.value,
            submissionLegacyId: submissionId.value,
        },
    };
}

export function buildSubmissionReviewPatch(
    currentStatus: ProfileSubmissionStatus,
    decision: 'approved' | 'rejected',
    now: string
): ProfileBuilderInputResult<{ reviewedAt: string; status: 'approved' | 'rejected'; updatedAt: string }> {
    if (currentStatus === decision || submissionStatusTransitions.get(currentStatus)?.includes(decision)) {
        return { ok: true, value: { reviewedAt: now, status: decision, updatedAt: now } };
    }

    return { error: { from: currentStatus, to: decision, type: 'invalid-status-transition' }, ok: false };
}

export const normalizeRequiredGuildId = (value: string) => normalizeRequiredString(value, 'guildId');
export const normalizeRequiredFormId = (value: string) => normalizeRequiredString(value, 'formId');
export const normalizeRequiredFormName = (value: string) => normalizeRequiredString(value, 'name');
export const normalizeRequiredFieldKey = (value: string) => normalizeRequiredString(value, 'fieldKey');
export const normalizeRequiredSubmissionId = (value: string) => normalizeRequiredString(value, 'submissionId');

export function normalizeProfileBuilderLimit(limit: number | undefined, fallback = 25): number {
    if (limit === undefined || !Number.isFinite(limit)) return fallback;

    return Math.min(Math.max(Math.trunc(limit), 1), 100);
}

export function toProfileFormRecord(document: ProfileFormDocument) {
    return {
        approvalRequired: document.approvalRequired,
        config: document.config,
        createdAt: document.createdAt,
        enabled: document.enabled,
        guildId: document.guildId,
        id: document.legacyId,
        name: document.name,
        outputChannelId: document.outputChannelId ?? null,
        updatedAt: document.updatedAt,
    };
}

export function toProfileFieldRecord(document: ProfileFieldDocument) {
    return {
        createdAt: document.createdAt,
        fieldKey: document.fieldKey,
        fieldType: document.fieldType,
        formId: document.formLegacyId,
        id: document.legacyId,
        label: document.label,
        maxLength: document.maxLength ?? null,
        position: document.position,
        required: document.required,
        updatedAt: document.updatedAt,
    };
}

export function toProfileSubmissionRecord(document: ProfileSubmissionDocument) {
    return {
        formId: document.formLegacyId,
        guildId: document.guildId,
        id: document.legacyId,
        reviewedAt: document.reviewedAt ?? null,
        status: document.status,
        submittedAt: document.submittedAt,
        updatedAt: document.updatedAt,
        userId: document.userId,
        values: document.values,
    };
}

export function toProfileSubmissionReviewRecord(document: ProfileSubmissionReviewDocument) {
    return {
        createdAt: document.createdAt,
        decision: document.decision,
        id: document.legacyId,
        reason: document.reason ?? null,
        reviewerUserId: document.reviewerUserId,
        submissionId: document.submissionLegacyId,
    };
}

function normalizeRequiredString(value: string | null | undefined, field: string): ProfileBuilderInputResult<string> {
    const normalizedValue = normalizeOptionalString(value);

    return normalizedValue
        ? { ok: true, value: normalizedValue }
        : { error: { field, type: 'missing-input' }, ok: false };
}

function normalizeOptionalString(value: string | null | undefined): string | undefined {
    const normalizedValue = value?.trim();

    return normalizedValue && normalizedValue.length > 0 ? normalizedValue : undefined;
}

function normalizeRecord(value: Record<string, unknown> | null | undefined): Record<string, unknown> | undefined {
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : undefined;
}

function normalizeTimestamp(value: string | null | undefined): string | undefined {
    const parsed = Date.parse(value ?? '');

    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

function normalizeNonNegativeInteger(
    value: number | null | undefined,
    field: string
): ProfileBuilderInputResult<number> {
    return Number.isInteger(value) && Number(value) >= 0
        ? { ok: true, value: Number(value) }
        : { error: { field, type: 'invalid-value' }, ok: false };
}

function normalizeSubmissionStatus<AllowPending extends boolean>(
    value: string | null | undefined,
    allowPending: AllowPending
): ProfileBuilderInputResult<
    AllowPending extends true ? ProfileSubmissionStatus : Exclude<ProfileSubmissionStatus, 'pending'>
> {
    const normalizedValue = normalizeOptionalString(value);
    const accepted = allowPending
        ? normalizedValue === 'approved' || normalizedValue === 'pending'
        : normalizedValue === 'approved' || normalizedValue === 'rejected';

    return accepted
        ? {
              ok: true,
              value: normalizedValue as AllowPending extends true
                  ? ProfileSubmissionStatus
                  : Exclude<ProfileSubmissionStatus, 'pending'>,
          }
        : { error: { field: 'status', type: normalizedValue ? 'invalid-value' : 'missing-input' }, ok: false };
}
