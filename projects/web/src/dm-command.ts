/** A DM command as the owner types it. When the bot serves several servers, a DM command names its server right after the
 *  command name. The DM prefix is always `!` */
export function dmCommand(command: string, serverId: string, multi: boolean) {
    if (!multi) return command
    const [name, ...rest] = command.split(" ")
    return [name, "--server", serverId, ...rest].join(" ")
}
