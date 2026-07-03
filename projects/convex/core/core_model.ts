export const deploymentConfigId = 'default';

export type DeploymentConfigInput = {
    instanceMode: string | null | undefined;
    ownerIds?: readonly string[];
    publicWebUrl?: string | null;
    singleGuildId?: string | null;
};

export type DeploymentConfigDocument =
    | {
          createdAt: string;
          id: string;
          instanceMode: 'single';
          ownerIds: string[];
          publicWebUrl?: string;
          singleGuildId: string;
          updatedAt: string;
      }
    | {
          createdAt: string;
          id: string;
          instanceMode: 'multi';
          ownerIds: string[];
          publicWebUrl?: string;
          updatedAt: string;
      };

export type DeploymentConfigRecord =
    | {
          instanceMode: 'single';
          ownerIds: string[];
          publicWebUrl: string | null;
          singleGuildId: string;
      }
    | {
          instanceMode: 'multi';
          ownerIds: string[];
          publicWebUrl: string | null;
      };

type NormalizedDeploymentConfig =
    | {
          instanceMode: 'single';
          ownerIds: string[];
          publicWebUrl?: string;
          singleGuildId: string;
      }
    | {
          instanceMode: 'multi';
          ownerIds: string[];
          publicWebUrl?: string;
      };

export type DeploymentConfigInputError = 'invalid-instance-mode' | 'missing-instance-mode' | 'missing-single-guild-id';

export type CoreInputResult<Value, ErrorValue extends string> =
    | { ok: true; value: Value }
    | { error: ErrorValue; ok: false };

export function normalizeDeploymentConfigInput(
    input: DeploymentConfigInput
): CoreInputResult<NormalizedDeploymentConfig, DeploymentConfigInputError> {
    const instanceMode = input.instanceMode?.trim();

    if (!instanceMode) {
        return { error: 'missing-instance-mode', ok: false };
    }

    const publicWebUrl = normalizeOptionalString(input.publicWebUrl);
    const ownerIds = normalizeStringList(input.ownerIds);

    switch (instanceMode) {
        case 'single': {
            const singleGuildId = normalizeOptionalString(input.singleGuildId);

            if (!singleGuildId) {
                return { error: 'missing-single-guild-id', ok: false };
            }

            return {
                ok: true,
                value: {
                    ...(publicWebUrl ? { publicWebUrl } : {}),
                    instanceMode,
                    ownerIds,
                    singleGuildId,
                },
            };
        }

        case 'multi':
            return {
                ok: true,
                value: {
                    ...(publicWebUrl ? { publicWebUrl } : {}),
                    instanceMode,
                    ownerIds,
                },
            };

        default:
            return { error: 'invalid-instance-mode', ok: false };
    }
}

export function buildDeploymentConfigDocument(
    input: DeploymentConfigInput,
    now: string,
    existingCreatedAt?: string
): CoreInputResult<DeploymentConfigDocument, DeploymentConfigInputError> {
    const normalized = normalizeDeploymentConfigInput(input);

    if (!normalized.ok) {
        return normalized;
    }

    if (normalized.value.instanceMode === 'single') {
        return {
            ok: true,
            value: {
                ...(normalized.value.publicWebUrl ? { publicWebUrl: normalized.value.publicWebUrl } : {}),
                createdAt: existingCreatedAt ?? now,
                id: deploymentConfigId,
                instanceMode: normalized.value.instanceMode,
                ownerIds: normalized.value.ownerIds,
                singleGuildId: normalized.value.singleGuildId,
                updatedAt: now,
            },
        };
    }

    return {
        ok: true,
        value: {
            ...(normalized.value.publicWebUrl ? { publicWebUrl: normalized.value.publicWebUrl } : {}),
            createdAt: existingCreatedAt ?? now,
            id: deploymentConfigId,
            instanceMode: normalized.value.instanceMode,
            ownerIds: normalized.value.ownerIds,
            updatedAt: now,
        },
    };
}

export function normalizeRequiredId(
    value: string,
    missingError: 'missing-guild-id'
): CoreInputResult<string, 'missing-guild-id'> {
    const normalizedValue = value.trim();

    return normalizedValue ? { ok: true, value: normalizedValue } : { error: missingError, ok: false };
}

export function normalizeListLimit(value: number | undefined, defaultLimit = 1000, maxLimit = 5000): number {
    if (!Number.isFinite(value ?? defaultLimit)) {
        return defaultLimit;
    }

    const normalizedValue = Math.trunc(value ?? defaultLimit);

    if (normalizedValue < 1) {
        return 1;
    }

    return Math.min(normalizedValue, maxLimit);
}

function normalizeOptionalString(value: string | null | undefined): string | undefined {
    const normalizedValue = value?.trim();

    return normalizedValue && normalizedValue.length > 0 ? normalizedValue : undefined;
}

function normalizeStringList(values: readonly string[] | undefined): string[] {
    return values?.map((value) => value.trim()).filter((value) => value.length > 0) ?? [];
}
