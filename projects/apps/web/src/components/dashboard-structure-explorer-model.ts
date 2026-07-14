import { prepareFileTreeInput } from '@pierre/trees';
import type { FileTreePreparedInput } from '@pierre/trees';
import type { FluxerGuildChannel, FluxerGuildRole } from '@neonflux/fluxer';

import type { DashboardStructurePreflightReport } from '../server/dashboard-structure-preflight.js';
import type {
    DashboardStructureDriftPreviewAction,
    DashboardStructureImportAction,
} from '../server/dashboard-structure-model.js';
import { readDashboardStructureExplorerEntityKey } from './dashboard-structure-explorer-snapshot.js';
import type {
    DashboardStructureExplorerEntityKey,
    DashboardStructureExplorerSection,
    DashboardStructureExplorerSnapshot,
} from './dashboard-structure-explorer-snapshot.js';

export { parseDashboardStructureExplorerSnapshot } from './dashboard-structure-explorer-snapshot.js';
export type {
    DashboardStructureExplorerEntityKey,
    DashboardStructureExplorerSection,
    DashboardStructureExplorerSnapshot,
} from './dashboard-structure-explorer-snapshot.js';

type DashboardStructureExplorerBadge =
    | 'blocked'
    | 'create'
    | 'delete'
    | 'destructive'
    | 'failed'
    | 'invalid'
    | 'mapping-required'
    | 'move'
    | 'permissions'
    | 'retry'
    | 'stale'
    | 'unsupported'
    | 'update';

export type DashboardStructureExplorerAction = {
    actionType: string;
    details: Record<string, unknown>;
    fields?: string[];
    id: string;
    label?: string;
    preflightMessage?: string;
    preflightStatus?: string;
    sequence?: number;
    status?: string;
    targetId?: string;
    targetType: string;
};

export type DashboardStructureExplorerPathMetadata = {
    actions: DashboardStructureExplorerAction[];
    badges: DashboardStructureExplorerBadge[];
    entityKey?: DashboardStructureExplorerEntityKey;
    id?: string;
    item?: FluxerGuildRole | FluxerGuildChannel;
    kind: 'action' | 'category' | 'channel' | 'role' | 'root';
    label: string;
    parentId?: string | null;
    path: string;
    position?: number | null;
    risks: string[];
};

export type DashboardStructureExplorerModel = {
    counts: {
        categories: number;
        channels: number;
        roles: number;
    };
    defaultSelectedPath?: string;
    entityPathByKey: Map<DashboardStructureExplorerEntityKey, string>;
    pathMetadata: Map<string, DashboardStructureExplorerPathMetadata>;
    paths: string[];
    preparedInput: FileTreePreparedInput;
    warnings: string[];
};

export type BuildDashboardStructureExplorerModelInput = {
    actions?: DashboardStructureExplorerAction[];
    driftPreviewCapped?: boolean;
    preflightReport?: DashboardStructurePreflightReport;
    section: DashboardStructureExplorerSection;
    snapshot?: DashboardStructureExplorerSnapshot;
};

const roots = {
    blocked: 'Blocked / Unsupported',
    roles: 'Roles',
    uncategorized: 'Uncategorized',
} as const;

const channelTopLevelScope = 'channel-top-level';

export function toDashboardStructureExplorerActions(
    actions: Array<DashboardStructureDriftPreviewAction | DashboardStructureImportAction>,
    preflightReport?: DashboardStructurePreflightReport
): DashboardStructureExplorerAction[] {
    const preflightByActionId = new Map(preflightReport?.actions.map((action) => [action.actionId, action]) ?? []);

    return actions.map((action) => {
        const preflight = preflightByActionId.get(action.id);

        return {
            actionType: action.actionType,
            details: action.details,
            fields: 'fields' in action ? action.fields : readChangedFields(action.details),
            id: action.id,
            ...(action.label ? { label: action.label } : {}),
            ...(preflight ? { preflightMessage: preflight.message, preflightStatus: preflight.status } : {}),
            ...('sequence' in action ? { sequence: action.sequence } : {}),
            ...(action.targetId ? { targetId: action.targetId } : {}),
            targetType: action.targetType,
        };
    });
}

export function buildDashboardStructureExplorerModel({
    actions = [],
    driftPreviewCapped = false,
    preflightReport,
    section,
    snapshot,
}: BuildDashboardStructureExplorerModelInput): DashboardStructureExplorerModel {
    const visibleActions = actions.filter((action) => sectionForTargetType(action.targetType) === section);
    const paths: string[] = section === 'roles' ? [`${roots.roles}/`] : [`${roots.uncategorized}/`];
    const pathMetadata = new Map<string, DashboardStructureExplorerPathMetadata>();
    const entityPathByKey = new Map<DashboardStructureExplorerEntityKey, string>();
    const actionsByKey = groupActionsByEntityKey(visibleActions);
    const segments = createPathSegmentAllocator();
    const warnings = driftPreviewCapped ? ['Drift preview is capped. Create a dry-run to inspect every action.'] : [];

    if (section === 'roles') {
        addRootMetadata(pathMetadata, roots.roles);
    } else {
        segments.allocate(channelTopLevelScope, roots.uncategorized);
        segments.allocate(channelTopLevelScope, roots.blocked);
        addRootMetadata(pathMetadata, roots.uncategorized);
    }

    const categoryPathById = new Map<string, string>();

    if (section === 'roles') {
        for (const role of sortRoles(snapshot?.roles ?? [])) {
            const key = entityKey('role', role.id);
            const label = toDisplayLabel(role.name);
            const path = `${roots.roles}/${segments.allocate(roots.roles, label)}`;
            addEntityPath({
                actionsByKey,
                entityPathByKey,
                item: role,
                key,
                kind: 'role',
                label,
                path,
                pathMetadata,
                paths,
            });
        }
    }

    if (section === 'channels') {
        for (const category of sortChannels(snapshot?.categories ?? [])) {
            const key = entityKey('category', category.id);
            const label = toDisplayLabel(category.name ?? category.id);
            const path = `${segments.allocate(channelTopLevelScope, label)}/`;
            categoryPathById.set(category.id, path.slice(0, -1));
            addEntityPath({
                actionsByKey,
                entityPathByKey,
                item: category,
                key,
                kind: 'category',
                label,
                path,
                pathMetadata,
                paths,
            });
        }

        for (const channel of sortChannels(snapshot?.channels ?? [])) {
            const key = entityKey('channel', channel.id);
            const rootPath = channel.parentId
                ? (categoryPathById.get(channel.parentId) ?? roots.uncategorized)
                : roots.uncategorized;
            const label = toDisplayLabel(channel.name ?? channel.id);
            const path = `${rootPath}/${segments.allocate(rootPath, label)}`;
            addEntityPath({
                actionsByKey,
                entityPathByKey,
                item: channel,
                key,
                kind: 'channel',
                label,
                parentId: channel.parentId,
                path,
                pathMetadata,
                paths,
            });
        }
    }

    addMissingActionTargets({
        actionsByKey,
        categoryPathById,
        entityPathByKey,
        pathMetadata,
        paths,
        segments,
    });
    addBlockedShortcuts({ actions: visibleActions, pathMetadata, paths, segments });
    addUnmatchedPreflightWarnings(preflightReport, warnings);

    const uniquePaths = [...new Set(paths)];
    const treePaths = uniquePaths.filter((path) => pathMetadata.get(path)?.kind !== 'root');
    const pathOrder = new Map(uniquePaths.map((path, index) => [path, index]));

    return {
        counts: {
            categories: snapshot?.categories.length ?? 0,
            channels: snapshot?.channels.length ?? 0,
            roles: snapshot?.roles.length ?? 0,
        },
        defaultSelectedPath: uniquePaths.find((path) => pathMetadata.get(path)?.kind !== 'root'),
        entityPathByKey,
        pathMetadata,
        paths: uniquePaths,
        preparedInput: prepareFileTreeInput(treePaths, { sort: createTreePathComparator(pathOrder) }),
        warnings,
    };
}

function sectionForTargetType(targetType: string): DashboardStructureExplorerSection {
    return targetType === 'role' ? 'roles' : 'channels';
}

function addEntityPath(input: {
    actionsByKey: Map<DashboardStructureExplorerEntityKey, DashboardStructureExplorerAction[]>;
    entityPathByKey: Map<DashboardStructureExplorerEntityKey, string>;
    item: FluxerGuildRole | FluxerGuildChannel;
    key: DashboardStructureExplorerEntityKey;
    kind: 'category' | 'channel' | 'role';
    label: string;
    parentId?: string | null;
    path: string;
    pathMetadata: Map<string, DashboardStructureExplorerPathMetadata>;
    paths: string[];
}): void {
    const actions = input.actionsByKey.get(input.key) ?? [];
    input.paths.push(input.path);
    input.entityPathByKey.set(input.key, input.path);
    setPathMetadata(input.pathMetadata, input.path, {
        actions,
        badges: badgesForActions(actions),
        entityKey: input.key,
        id: input.item.id,
        item: input.item,
        kind: input.kind,
        label: input.label,
        parentId: input.parentId,
        path: input.path,
        position: 'position' in input.item ? input.item.position : undefined,
        risks: risksForActions(actions),
    });
}

function addMissingActionTargets(input: {
    actionsByKey: Map<DashboardStructureExplorerEntityKey, DashboardStructureExplorerAction[]>;
    categoryPathById: Map<string, string>;
    entityPathByKey: Map<DashboardStructureExplorerEntityKey, string>;
    pathMetadata: Map<string, DashboardStructureExplorerPathMetadata>;
    paths: string[];
    segments: PathSegmentAllocator;
}): void {
    const missingTargets = [...input.actionsByKey].filter(([key]) => !input.entityPathByKey.has(key));

    for (const [key, actions] of missingTargets) {
        if (!key.startsWith('category:')) continue;

        const [, id] = key.split(':') as ['category', string];
        const representative = actions[0];
        const item = readActionItem(representative);
        const explorerItem = isChannel(item) ? item : undefined;
        const label = toDisplayLabel(readActionLabel(representative, item, id));
        const path = `${input.segments.allocate(channelTopLevelScope, label)}/`;

        input.categoryPathById.set(id, path.slice(0, -1));
        input.paths.push(path);
        input.entityPathByKey.set(key, path);
        setPathMetadata(input.pathMetadata, path, {
            actions,
            badges: badgesForActions(actions),
            entityKey: key,
            id,
            ...(explorerItem ? { item: explorerItem } : {}),
            kind: 'category',
            label,
            path,
            position: typeof item?.position === 'number' ? item.position : undefined,
            risks: risksForActions(actions),
        });
    }

    for (const [key, actions] of missingTargets) {
        if (input.entityPathByKey.has(key)) continue;

        const [kind, id] = key.split(':') as ['category' | 'channel' | 'role', string];
        const representative = actions[0];
        const item = readActionItem(representative);
        const explorerItem = isRole(item) || isChannel(item) ? item : undefined;
        const label = toDisplayLabel(readActionLabel(representative, item, id));
        const parentId =
            kind === 'channel' && (typeof item?.parentId === 'string' || item?.parentId === null)
                ? item.parentId
                : undefined;
        const rootPath =
            kind === 'role'
                ? roots.roles
                : parentId
                  ? (input.categoryPathById.get(parentId) ?? roots.uncategorized)
                  : roots.uncategorized;
        const path = `${rootPath}/${input.segments.allocate(rootPath, label)}`;

        input.paths.push(path);
        input.entityPathByKey.set(key, path);
        setPathMetadata(input.pathMetadata, path, {
            actions,
            badges: badgesForActions(actions),
            entityKey: key,
            id,
            ...(explorerItem ? { item: explorerItem } : {}),
            kind,
            label,
            ...(kind === 'channel' ? { parentId } : {}),
            path,
            position: typeof item?.position === 'number' ? item.position : undefined,
            risks: risksForActions(actions),
        });
    }
}

function addBlockedShortcuts(input: {
    actions: DashboardStructureExplorerAction[];
    pathMetadata: Map<string, DashboardStructureExplorerPathMetadata>;
    paths: string[];
    segments: PathSegmentAllocator;
}): void {
    const blockedActions = input.actions.filter((action) => badgesForAction(action).includes('blocked'));
    if (blockedActions.length === 0) return;

    input.paths.push(`${roots.blocked}/`);
    addRootMetadata(input.pathMetadata, roots.blocked);

    for (const action of blockedActions) {
        const label = toDisplayLabel(action.label ?? action.targetId ?? action.id);
        const path = `${roots.blocked}/${input.segments.allocate(roots.blocked, label)}`;
        input.paths.push(path);
        setPathMetadata(input.pathMetadata, path, {
            actions: [action],
            badges: badgesForAction(action),
            kind: 'action',
            label,
            path,
            risks: risksForActions([action]),
        });
    }
}

function addRootMetadata(pathMetadata: Map<string, DashboardStructureExplorerPathMetadata>, root: string): void {
    const path = `${root}/`;
    setPathMetadata(pathMetadata, path, {
        actions: [],
        badges: [],
        kind: 'root',
        label: root,
        path,
        risks: [],
    });
}

function setPathMetadata(
    pathMetadata: Map<string, DashboardStructureExplorerPathMetadata>,
    path: string,
    metadata: DashboardStructureExplorerPathMetadata
): void {
    pathMetadata.set(path, metadata);

    if (!path.endsWith('/')) return;

    const canonicalPath = path.slice(0, -1);
    pathMetadata.set(canonicalPath, { ...metadata, path: canonicalPath });
}

function addUnmatchedPreflightWarnings(
    preflightReport: DashboardStructurePreflightReport | undefined,
    warnings: string[]
): void {
    if (!preflightReport) return;
    if (preflightReport.actions.length > 0) return;
    if (preflightReport.summary.total === 0) return;

    warnings.push('Preflight summary is available, but action details are not loaded.');
}

function groupActionsByEntityKey(
    actions: DashboardStructureExplorerAction[]
): Map<DashboardStructureExplorerEntityKey, DashboardStructureExplorerAction[]> {
    const actionsByKey = new Map<DashboardStructureExplorerEntityKey, DashboardStructureExplorerAction[]>();

    for (const action of actions) {
        const key = readDashboardStructureExplorerEntityKey(action);
        if (!key) continue;

        actionsByKey.set(key, [...(actionsByKey.get(key) ?? []), action]);
    }

    return actionsByKey;
}

function badgesForActions(actions: DashboardStructureExplorerAction[]): DashboardStructureExplorerBadge[] {
    return [...new Set(actions.flatMap(badgesForAction))];
}

function badgesForAction(action: DashboardStructureExplorerAction): DashboardStructureExplorerBadge[] {
    const badges = new Set<DashboardStructureExplorerBadge>();
    const fields = action.fields ?? readChangedFields(action.details);

    if (action.actionType === 'create') badges.add('create');
    if (action.actionType === 'update') badges.add('update');
    if (action.actionType === 'delete') {
        badges.add('delete');
        badges.add('destructive');
    }
    if (fields.includes('parentId') || fields.includes('position')) badges.add('move');
    if (fields.includes('permissions') || fields.includes('permissionOverwrites')) badges.add('permissions');
    if (action.status === 'failed') badges.add('failed');
    if (typeof action.details.createdId === 'string') badges.add('retry');
    if (fields.includes('type') || isEveryonePositionAction(action)) {
        badges.add('blocked');
        badges.add('unsupported');
    }

    if (action.preflightStatus === 'stale') badges.add('stale');
    if (action.preflightStatus === 'mapping-required') badges.add('mapping-required');
    if (action.preflightStatus === 'destructive-approval-required') badges.add('destructive');
    if (action.preflightStatus === 'unsupported') {
        badges.add('blocked');
        badges.add('unsupported');
    }
    if (action.preflightStatus === 'invalid-plan') {
        badges.add('blocked');
        badges.add('invalid');
    }

    return [...badges];
}

function risksForActions(actions: DashboardStructureExplorerAction[]): string[] {
    const risks = new Set<string>();

    for (const action of actions) {
        const fields = action.fields ?? readChangedFields(action.details);
        if (action.actionType === 'delete') risks.add('Deletes this item during apply.');
        if (fields.includes('permissions') || fields.includes('permissionOverwrites')) {
            risks.add('Changes permissions.');
        }
        if (fields.includes('type')) risks.add('Channel type changes are blocked.');
        if (isEveryonePositionAction(action)) risks.add('@everyone cannot be moved.');
        if (action.status === 'failed') risks.add('Last apply attempt failed for this action.');
        if (action.preflightMessage) risks.add(action.preflightMessage);
    }

    return [...risks];
}

function isEveryonePositionAction(action: DashboardStructureExplorerAction): boolean {
    const fields = action.fields ?? readChangedFields(action.details);
    const item = readActionItem(action);

    return (
        action.targetType === 'role' &&
        fields.includes('position') &&
        (item?.name === '@everyone' || positionChangeTouchesEveryone(action.details))
    );
}

function positionChangeTouchesEveryone(details: Record<string, unknown>): boolean {
    if (!Array.isArray(details.changes)) return false;

    return details.changes.some(
        (change) => isObject(change) && change.field === 'position' && (change.before === 0 || change.after === 0)
    );
}

function readActionItem(action: DashboardStructureExplorerAction): Record<string, unknown> | undefined {
    const after = action.details.after;
    const before = action.details.before;

    if (isObject(after)) return after;
    if (isObject(before)) return before;

    return undefined;
}

function readActionLabel(
    action: DashboardStructureExplorerAction | undefined,
    item: Record<string, unknown> | undefined,
    fallback: string
): string {
    if (action?.label) return action.label;
    if (typeof item?.name === 'string' && item.name.trim()) return item.name;
    if (typeof action?.details.label === 'string' && action.details.label.trim()) return action.details.label;

    return fallback;
}

function readChangedFields(details: Record<string, unknown>): string[] {
    return Array.isArray(details.changes)
        ? details.changes.flatMap((change) =>
              isObject(change) && typeof change.field === 'string' ? [change.field] : []
          )
        : [];
}

function sortRoles(roles: FluxerGuildRole[]): FluxerGuildRole[] {
    return [...roles].sort((left, right) => {
        if (left.position === 0) return 1;
        if (right.position === 0) return -1;
        return right.position - left.position || left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
    });
}

function sortChannels(channels: FluxerGuildChannel[]): FluxerGuildChannel[] {
    return [...channels].sort(
        (left, right) =>
            (left.position ?? Number.MAX_SAFE_INTEGER) - (right.position ?? Number.MAX_SAFE_INTEGER) ||
            (left.name ?? '').localeCompare(right.name ?? '') ||
            left.id.localeCompare(right.id)
    );
}

function entityKey(type: 'category' | 'channel' | 'role', id: string): DashboardStructureExplorerEntityKey {
    return `${type}:${id}`;
}

function createTreePathComparator(pathOrder: Map<string, number>) {
    return (left: { path: string }, right: { path: string }): number => {
        const leftTopLevelOrder = pathOrder.get(readTopLevelDirectoryPath(left.path));
        const rightTopLevelOrder = pathOrder.get(readTopLevelDirectoryPath(right.path));

        if (leftTopLevelOrder !== undefined && rightTopLevelOrder !== undefined) {
            if (leftTopLevelOrder !== rightTopLevelOrder) return leftTopLevelOrder - rightTopLevelOrder;
        } else if (leftTopLevelOrder !== undefined) {
            return -1;
        } else if (rightTopLevelOrder !== undefined) {
            return 1;
        }

        const leftOrder = pathOrder.get(left.path);
        const rightOrder = pathOrder.get(right.path);

        if (leftOrder !== undefined && rightOrder !== undefined) return leftOrder - rightOrder;
        if (leftOrder !== undefined) return -1;
        if (rightOrder !== undefined) return 1;

        return left.path.localeCompare(right.path);
    };
}

function readTopLevelDirectoryPath(path: string): string {
    const separatorIndex = path.indexOf('/');

    return `${separatorIndex === -1 ? path : path.slice(0, separatorIndex)}/`;
}

type PathSegmentAllocator = ReturnType<typeof createPathSegmentAllocator>;

function createPathSegmentAllocator() {
    const usedByScope = new Map<string, Map<string, number>>();

    return {
        allocate(scope: string, label: string): string {
            const base = sanitizePathSegment(label) || 'Unnamed';
            const used = usedByScope.get(scope) ?? new Map<string, number>();
            usedByScope.set(scope, used);

            const nextCount = (used.get(base) ?? 0) + 1;
            used.set(base, nextCount);

            return nextCount === 1 ? base : `${base} (${nextCount})`;
        },
    };
}

function toDisplayLabel(value: string): string {
    return sanitizePathSegment(value) || 'Unnamed';
}

function sanitizePathSegment(value: string): string {
    return Array.from(value, sanitizePathSegmentChar).join('').replace(/\s+/g, ' ').trim();
}

function sanitizePathSegmentChar(value: string): string {
    const code = value.charCodeAt(0);

    return value === '/' || value === '\\' || code <= 31 || code === 127 ? ' ' : value;
}

function isRole(value: unknown): value is FluxerGuildRole {
    return (
        isObject(value) &&
        typeof value.id === 'string' &&
        typeof value.name === 'string' &&
        typeof value.position === 'number' &&
        typeof value.color === 'number' &&
        typeof value.permissions === 'string' &&
        typeof value.hoist === 'boolean' &&
        typeof value.mentionable === 'boolean'
    );
}

function isChannel(value: unknown): value is FluxerGuildChannel {
    return (
        isObject(value) &&
        typeof value.id === 'string' &&
        (typeof value.name === 'string' || value.name === null) &&
        typeof value.type === 'number' &&
        (typeof value.parentId === 'string' || value.parentId === null || value.parentId === undefined) &&
        (typeof value.position === 'number' || value.position === null || value.position === undefined) &&
        Array.isArray(value.permissionOverwrites)
    );
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
