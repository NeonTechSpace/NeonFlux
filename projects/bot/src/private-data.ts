import type { PrivateAccessAnswer } from "@neonflux/backend/contracts"
import type { Client } from "@neontechspace/fluxerly/effect"
import { Cause, Effect, Schema } from "effect"
import { createBackendRequest } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"
import { readNativeMember } from "./member-evidence.ts"

const id = Schema.String.check(Schema.makeFilter(value => /^[1-9]\d{0,18}$/.test(value)))
const readySchema = Schema.Struct({ checks: Schema.Array(Schema.Struct({ userId: id })).check(Schema.isMaxLength(10)) })
export function createPrivateDataStore(backend: BackendConfig) {
    const request = createBackendRequest(backend)
    return {
        ready: (serverId: string) => request("/private-data/ready", { serverId }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(readySchema))),
        record: (serverId: string, userId: string, answer: PrivateAccessAnswer) => request("/private-data/record", { serverId, userId, ...answer })
            .pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.Struct({ recorded: Schema.Boolean })))),
    }
}
export type PrivateDataStore = ReturnType<typeof createPrivateDataStore>

/** One website viewer read fresh from Fluxer with the bot's own token: whether they own the server and which roles they hold.
 *  Permissions are not read, because only the owner and the private data role grant access */
export function readPrivateAccess(client: Client, serverId: string, userId: string) {
    return Effect.gen(function* () {
        const guild = yield* client.guilds.fetch(serverId).pipe(Effect.timeout("5 seconds"))
        const { member } = yield* readNativeMember(client, serverId, userId, { allowAbsent: true })
        return { originServerId: guild.id, isOwner: guild.ownerId === userId, present: member !== undefined, roleIds: [...member?.roleIds ?? []] }
    })
}

/** The website's access checks for private cases. Each waiting viewer is answered with the bot's own reads, never the viewer's sign-in */
export function processPrivateAccessPass(store: PrivateDataStore, serverId: string, client: Client) {
    return Effect.gen(function* () {
        for (const { userId } of (yield* store.ready(serverId)).checks) {
            const answer: PrivateAccessAnswer = yield* readPrivateAccess(client, serverId, userId).pipe(
                Effect.catchCause(cause => Cause.hasInterrupts(cause) ? Effect.failCause(cause) : Effect.succeed({ failed: true as const })))
            yield* store.record(serverId, userId, answer)
        }
    })
}
