import type { ConvexReactClient } from "convex/react"
import { useEffect, useRef, useState } from "react"
import { isVoiceChannelName, isVoiceRegion, type VoiceMemberOperation, type VoiceRoom } from "@neonflux/contracts/voice"
import { dashboardApi } from "./dashboard-api"
import { useLiveQuery } from "./live-query"
import { requestError } from "./request-error"
import { MemberRequests } from "./member-requests"
import { localTime } from "./time"

/** A room's state is read again when the page opens after this long */
const STALE_MS = 600000
const memberId = (value: string) => /^<@!?(\d{15,20})>$/.exec(value.trim())?.[1] ?? value.trim()
const validMember = (value: string) => /^\d{15,20}$/.test(memberId(value))

const label = (operation: VoiceMemberOperation) => {
    switch (operation.type) {
        case "lookup":
            return "Check my room"
        case "rename":
            return `Rename to ${operation.name}`
        case "limit":
            return operation.limit ? `Limit to ${operation.limit} members` : "Remove the member limit"
        case "region":
            return operation.region ? `Use region ${operation.region}` : "Use the automatic region"
        case "lock":
            return "Lock"
        case "unlock":
            return "Unlock"
        case "hide":
            return "Hide"
        case "show":
            return "Show"
        case "allow":
            return `Allow member ${operation.userId}`
        case "block":
            return `Block member ${operation.userId}`
        case "transfer":
            return `Give to member ${operation.userId}`
    }
}

function RoomControls({
    room,
    disabled,
    send,
}: {
    room: VoiceRoom
    disabled: boolean
    send: (operation: VoiceMemberOperation) => void
}) {
    const view = room.view,
        roomId = room.channelId
    const [name, setName] = useState(view?.name ?? ""),
        [limit, setLimit] = useState(String(view?.userLimit ?? 0)),
        [region, setRegion] = useState(view?.region ?? ""),
        [member, setMember] = useState("")
    const limitNumber = Number(limit),
        nameValid = isVoiceChannelName(name),
        limitValid = /^\d{1,2}$/.test(limit.trim()),
        regionValid = !region.trim() || isVoiceRegion(region.trim()),
        memberValid = validMember(member)
    return (
        <fieldset className="mapping-row">
            <legend>{view?.name ?? `Room ${roomId}`}</legend>
            {view ? (
                <p className="field-help">
                    {view.locked ? "Locked" : "Open to join"}, {view.hidden ? "hidden" : "visible"},{" "}
                    {view.userLimit ? `up to ${view.userLimit} members` : "no member limit"},{" "}
                    {view.region ? `region ${view.region}` : "automatic region"}. Checked {localTime(view.observedAt)}
                </p>
            ) : (
                <p role="status" className="notice">
                    The bot has not read this room yet
                </p>
            )}
            <div className="actions">
                <button
                    type="button"
                    disabled={disabled || !view}
                    onClick={() => send({ type: view?.locked ? "unlock" : "lock", roomId })}
                >
                    {view?.locked ? "Unlock" : "Lock"}
                </button>
                <button
                    type="button"
                    disabled={disabled || !view}
                    onClick={() => send({ type: view?.hidden ? "show" : "hide", roomId })}
                >
                    {view?.hidden ? "Show" : "Hide"}
                </button>
            </div>
            <label>
                Room name
                <input
                    maxLength={100}
                    value={name}
                    disabled={disabled}
                    onChange={(event) => setName(event.target.value)}
                />
            </label>
            <div className="actions">
                <button
                    type="button"
                    disabled={disabled || !nameValid}
                    onClick={() => send({ type: "rename", roomId, name: name.trim() })}
                >
                    Rename
                </button>
            </div>
            <label>
                Member limit, 0 for none
                <input
                    inputMode="numeric"
                    maxLength={2}
                    value={limit}
                    disabled={disabled}
                    onChange={(event) => setLimit(event.target.value)}
                />
            </label>
            <div className="actions">
                <button
                    type="button"
                    disabled={disabled || !limitValid}
                    onClick={() => send({ type: "limit", roomId, limit: limitNumber })}
                >
                    Set limit
                </button>
            </div>
            <label>
                Voice region, empty for automatic
                <input
                    maxLength={64}
                    value={region}
                    disabled={disabled}
                    onChange={(event) => setRegion(event.target.value)}
                />
            </label>
            <div className="actions">
                <button
                    type="button"
                    disabled={disabled || !regionValid}
                    onClick={() => send({ type: "region", roomId, region: region.trim() || null })}
                >
                    Set region
                </button>
            </div>
            <label>
                Member ID
                <input value={member} disabled={disabled} onChange={(event) => setMember(event.target.value)} />
            </label>
            <p className="field-help">
                Allowing lets a member see and join your room. Blocking stops them, and does not disconnect a member
                already inside. You can give your room only to a member who is in it
            </p>
            <div className="actions">
                {(["allow", "block", "transfer"] as const).map((type) => (
                    <button
                        key={type}
                        type="button"
                        className="secondary"
                        disabled={disabled || !memberValid}
                        onClick={() => send({ type, roomId, userId: memberId(member) })}
                    >
                        {type === "allow" ? "Allow" : type === "block" ? "Block" : "Give room"}
                    </button>
                ))}
            </div>
        </fieldset>
    )
}

// The member view. The bot reads the member and the room fresh and applies the chat commands' rule to each request, so the website decides nothing
export function VoiceRoomMember({
    client,
    sessionToken,
    serverId,
    connected,
}: {
    client: ConvexReactClient
    sessionToken: string
    serverId: string
    connected: boolean
}) {
    const { data: remote, error } = useLiveQuery(client, dashboardApi.voiceMember, { sessionToken, serverId })
    const [sending, setSending] = useState(false),
        [notice, setNotice] = useState("")
    const looked = useRef<string | undefined>(undefined)
    async function send(operation: VoiceMemberOperation) {
        setSending(true)
        setNotice("")
        try {
            await client.mutation(dashboardApi.voiceRequest, {
                sessionToken,
                serverId,
                requestId: crypto.randomUUID(),
                operation,
            })
        } catch (cause) {
            setNotice(requestError(cause))
        } finally {
            setSending(false)
        }
    }
    const room = remote?.rooms[0],
        pending = remote?.requests.some((row) => row.state === "queued") ?? false
    // One read of the room when the page opens without a recent one
    useEffect(() => {
        if (!room || !connected || looked.current === room.channelId || pending) return
        looked.current = room.channelId
        if (!room.view || Date.now() - room.view.observedAt > STALE_MS) void send({ type: "lookup" })
    }, [room, connected, pending])
    if (error)
        return (
            <section className="panel">
                <p role="alert" className="notice error">
                    Temporary voice rooms are not available in this server right now, or your sign-in needs a refresh
                </p>
            </section>
        )
    if (!remote)
        return (
            <section className="panel">
                <p role="status">Loading your voice room…</p>
            </section>
        )
    const disabled = !connected || sending || pending
    return (
        <>
            <section className="panel" aria-label="Your voice room">
                <h2>Your voice room</h2>
                <p className="muted">
                    The bot checks that the room is yours before each change, so a change shows as pending until it is
                    applied. The chat commands under !voice do the same
                </p>
                {!remote.rooms.length && (
                    <p className="muted">You own no temporary voice room. Join a generator channel to create one</p>
                )}
                {remote.rooms.map((row) => (
                    <RoomControls
                        key={`${row.channelId}:${row.view?.observedAt ?? 0}`}
                        room={row}
                        disabled={disabled}
                        send={(operation) => void send(operation)}
                    />
                ))}
                {room && (
                    <div className="actions">
                        <button
                            type="button"
                            className="secondary"
                            disabled={disabled}
                            onClick={() => void send({ type: "lookup" })}
                        >
                            Check my room again
                        </button>
                    </div>
                )}
                {notice && (
                    <p role="alert" className="notice error">
                        {notice}
                    </p>
                )}
            </section>
            <MemberRequests requests={remote.requests} label={label} />
        </>
    )
}
