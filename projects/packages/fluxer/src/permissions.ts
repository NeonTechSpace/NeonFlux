import type { DashboardGuild } from '@neonflux/core';

export const MANAGE_SERVER_PERMISSION_BIT = 0x20n;

export type FluxerGuildPermissions = string | number | bigint | readonly string[];

export type FluxerOAuthGuild = {
    id: string;
    name?: string;
    permissions: FluxerGuildPermissions;
    botInstalled?: boolean;
};

export function hasManageServerPermission(permissions: FluxerGuildPermissions): boolean {
    switch (typeof permissions) {
        case 'bigint':
            return hasPermissionBit(permissions);

        case 'number':
            return hasPermissionBit(BigInt(permissions));

        case 'string':
            return isManageServerPermissionName(permissions) || parsePermissionNumber(permissions);

        case 'object': {
            const permissionNames = permissions;
            return permissionNames.some((permission) => isManageServerPermissionName(permission));
        }

        case 'boolean':
        case 'function':
        case 'symbol':
        case 'undefined':
            return false;
    }
}

export function toDashboardGuild(guild: FluxerOAuthGuild): DashboardGuild {
    return {
        id: guild.id,
        ...(guild.name ? { name: guild.name } : {}),
        canManage: hasManageServerPermission(guild.permissions),
        botInstalled: guild.botInstalled === true,
    };
}

function hasPermissionBit(permissions: bigint): boolean {
    return (permissions & MANAGE_SERVER_PERMISSION_BIT) === MANAGE_SERVER_PERMISSION_BIT;
}

function parsePermissionNumber(permissions: string): boolean {
    if (!/^\d+$/.test(permissions)) {
        return false;
    }

    return hasPermissionBit(BigInt(permissions));
}

function isManageServerPermissionName(permission: string): boolean {
    const normalized = permission.trim().toUpperCase().replaceAll(' ', '_');
    return normalized === 'MANAGE_SERVER' || normalized === 'MANAGE_GUILD';
}
