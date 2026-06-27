import type { ProfileFieldRecord } from '@neonflux/db';

export type DashboardProfileFieldType = 'text' | 'textarea' | 'url';

export type DashboardProfileField = {
    id?: string;
    fieldKey: string;
    label: string;
    fieldType: DashboardProfileFieldType;
    required: boolean;
    maxLength?: number;
    position: number;
};

export type ProfileBuilderValueValidationResult =
    | {
          type: 'valid';
          values: Record<string, string>;
      }
    | {
          type: 'invalid-input';
          field: string;
      };

const allowedFieldTypes = new Set<DashboardProfileFieldType>(['text', 'textarea', 'url']);

export function toDashboardProfileField(record: ProfileFieldRecord): DashboardProfileField {
    return {
        id: record.id,
        fieldKey: record.fieldKey,
        label: record.label,
        fieldType: isDashboardProfileFieldType(record.fieldType) ? record.fieldType : 'text',
        required: record.required,
        ...(record.maxLength ? { maxLength: record.maxLength } : {}),
        position: record.position,
    };
}

export function normalizeProfileBuilderValues(
    fields: readonly DashboardProfileField[],
    rawValues: Record<string, unknown>
): ProfileBuilderValueValidationResult {
    const values: Record<string, string> = {};

    for (const field of fields) {
        const value = normalizeProfileValue(rawValues[field.fieldKey]);
        const maxLength = field.maxLength ?? defaultMaxLengthForField(field.fieldType);

        if (field.required && !value) {
            return { type: 'invalid-input', field: field.fieldKey };
        }

        if (!value) {
            continue;
        }

        if (value.length > maxLength) {
            return { type: 'invalid-input', field: field.fieldKey };
        }

        if (field.fieldType === 'url' && !isHttpUrl(value)) {
            return { type: 'invalid-input', field: field.fieldKey };
        }

        values[field.fieldKey] = value;
    }

    return {
        type: 'valid',
        values,
    };
}

export function isDashboardProfileFieldType(value: string): value is DashboardProfileFieldType {
    return allowedFieldTypes.has(value as DashboardProfileFieldType);
}

function normalizeProfileValue(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function defaultMaxLengthForField(fieldType: DashboardProfileFieldType): number {
    return fieldType === 'textarea' ? 1000 : 200;
}

function isHttpUrl(value: string): boolean {
    try {
        const url = new URL(value);

        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
        return false;
    }
}
