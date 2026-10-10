type Named = readonly { id: string, name: string }[]
/** Lists that name channels and roles, such as the server's catalog */
export interface MentionNames { channels?: Named | undefined, roles?: Named | undefined }

/** Text from the bot or backend with its channel, role and member mentions shown as names, the way chat shows them. Channels and
 *  roles take their names from lists the dashboard already loaded, and a member, whose name the dashboard does not load, shows its ID */
export function mentionText(text: string, names: MentionNames = {}) {
  return text.replace(/<(#|@&|@!?)(\d{1,20})>/g,(_,kind: string,id: string) => kind === '#' ? `#${names.channels?.find(channel => channel.id === id)?.name ?? 'unknown-channel'}`
    : kind === '@&' ? `@${names.roles?.find(role => role.id === id)?.name.replace(/^@/,'') ?? 'unknown-role'}` : `@${id}`)
}
