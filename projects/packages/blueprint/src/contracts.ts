export type BlueprintRoleProtectionReason = 'everyone' | 'bot' | 'integration' | 'managed';

export type BlueprintRole = {
    id: string;
    name: string;
    position: number;
    hierarchyRank?: number;
    color: number;
    permissions: string;
    hoist: boolean;
    mentionable: boolean;
    protected?: boolean;
    protectionReason?: BlueprintRoleProtectionReason;
};

export type BlueprintPermissionOverwrite = {
    id: string;
    type: number;
    allow: string;
    deny: string;
};

export type BlueprintChannel = {
    id: string;
    name: string | null;
    type: number;
    url?: string | null;
    parentId: string | null;
    position: number | null;
    permissionOverwrites: BlueprintPermissionOverwrite[];
};

export type BlueprintStructure = {
    guildId: string;
    guildName: string;
    botHighestRolePosition?: number;
    botHighestRoleHierarchyRank?: number;
    roles: BlueprintRole[];
    channels: BlueprintChannel[];
    categories: BlueprintChannel[];
};

export function isProtectedBlueprintRole(role: Pick<BlueprintRole, 'id'> & Partial<BlueprintRole>): boolean {
    return role.protected === true || role.protectionReason !== undefined;
}
