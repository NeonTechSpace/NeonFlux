import type { DashboardCatalog } from "@neonflux/backend/dashboard-contracts"
import {
    TWITCH_LIMIT,
    twitchLoginKey,
    isTwitchChannelId,
    twitchLink,
    type TwitchSubscription,
    TWITCH_CHANNEL_ID_HINT,
} from "@neonflux/contracts/twitch"
import { ConfigForm, rowCard, savedRows } from "./configuration-form"
import type { ConfigSectionProps } from "./configuration-form"
import { FormInputError } from "./settings-form"
import type { FormValues } from "./settings-form"
import { SearchPicker } from "./search-picker"
import { localTime } from "./time"

// Text, announcement and forum channels. In a forum each alert becomes its own post
const alertChannels = (catalog?: DashboardCatalog) =>
    catalog?.channels.filter((channel) => [0, 5, 15].includes(channel.type)) ?? []
/** Parse the login, with the same numeric-login distinction as chat */
function twitchChannelValue(value: string | boolean | undefined) {
    const text = typeof value === "string" ? value.trim() : ""
    const id = isTwitchChannelId(text.toLowerCase()) ? text.toLowerCase() : twitchLink(text)?.twitchChannelId
    if (!id) throw new FormInputError(TWITCH_CHANNEL_ID_HINT)
    return twitchLoginKey(id)
}
function channelValue(values: FormValues) {
    if (typeof values.channelId !== "string" || !values.channelId)
        throw new FormInputError("Choose a channel for the alerts")
    return values.channelId
}
const name = (row: TwitchSubscription) =>
    row.status.title
        ? `${row.status.title} (${row.status.login ?? row.twitchChannelId})`
        : (row.status.login ?? row.twitchChannelId)
const problems = {
    channel:
        "Off: Its alert channel is gone or cannot hold alerts. Choose a text, announcement or forum channel below to turn the alerts back on",
    permission:
        "Off: NeonFlux cannot post in its alert channel. Give NeonFlux View channel, Send messages and Embed links there, then save the channel below to turn the alerts back on",
}

export function TwitchSettings(props: ConfigSectionProps<"twitch">) {
    const { data, configRevision: revision, jobs } = props.remote,
        common = { queue: props.queue, connected: props.connected, jobs }
    const nameOf = (id: string) => props.catalog?.channels.find((channel) => channel.id === id)?.name ?? `Channel ${id}`
    const picker = (values: FormValues, edit: (key: string, value: string | boolean) => void, disabled: boolean) => (
        <SearchPicker
            catalog
            label="Alert channel"
            options={alertChannels(props.catalog)}
            loading={props.catalogLoading}
            allowManual={props.catalogError}
            value={values.channelId ? [String(values.channelId)] : []}
            disabled={disabled}
            onChange={(ids) => edit("channelId", ids[0] ?? "")}
        />
    )
    const help = (
        <p className="field-help">
            NeonFlux needs View channel, Send messages and Embed links in the alert channel. If they go missing, or the
            channel is removed, NeonFlux turns that channel's alerts off and says so in the server's system channel and
            the recovery inbox
        </p>
    )
    const saved = savedRows(data.subscriptions, props.removedDefinitions, (row) => `twitch:${row.twitchChannelId}`),
        used = new Set(
            saved.flatMap((row) => [
                row.twitchChannelId,
                ...(row.status.login ? [twitchLoginKey(row.status.login)] : []),
            ]),
        )
    return (
        <div className="role-section">
            <section className="panel">
                <h2>Twitch alerts</h2>
                <p>
                    Follow up to ten Twitch streamers by login or twitch.tv link. Only new live streams are announced,
                    through Twitch's push notifications
                </p>
                {!data.configured && <p className="muted">The bot operator has not set up Twitch alerts yet</p>}
                <p className="field-help">
                    <a
                        href="https://www.twitch.tv/p/en/legal/terms-of-service/"
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        Twitch's Terms of Service
                    </a>{" "}
                    and{" "}
                    <a
                        href="https://www.twitch.tv/p/en/legal/privacy-notice/"
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        Twitch's Privacy Notice
                    </a>
                </p>
            </section>
            {data.subscriptions.map((row) => {
                const { card } = rowCard(common, props.removedDefinitions, `twitch:${row.twitchChannelId}`)
                return (
                    <details key={row.twitchChannelId}>
                        <summary>
                            {name(row)} in {nameOf(row.channelId)}: {row.enabled ? "On" : "Off"}
                        </summary>
                        <div className="role-section">
                            <section className="panel" aria-label={`Status of ${name(row)}`}>
                                <ul>
                                    {row.problem && <li>{problems[row.problem]}</li>}
                                    <li>
                                        Twitch subscription:{" "}
                                        {row.status.hubError
                                            ? `${row.status.hubError}${row.status.retrying ? ". NeonFlux tries again on its own" : ""}`
                                            : row.status.connected
                                              ? "Confirmed"
                                              : "Waiting for Twitch to confirm"}
                                    </li>
                                    <li>
                                        Last notification:{" "}
                                        {row.status.lastNotificationAt !== undefined
                                            ? localTime(row.status.lastNotificationAt)
                                            : "None yet"}
                                    </li>
                                    <li>
                                        Last post:{" "}
                                        {row.status.lastPostAt !== undefined
                                            ? localTime(row.status.lastPostAt)
                                            : "None yet"}
                                    </li>
                                    {row.status.latestStream && (
                                        <li>
                                            Latest stream:{" "}
                                            <a
                                                href={`https://www.twitch.tv/${row.status.login ?? row.twitchChannelId}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                            >
                                                {row.status.latestStream.title}
                                            </a>
                                            , started {localTime(row.status.latestStream.publishedAt)}
                                        </li>
                                    )}
                                </ul>
                            </section>
                            <ConfigForm<"twitch">
                                {...card}
                                draftKey={`twitch:${row.twitchChannelId}`}
                                title={`Alert channel for ${name(row)}`}
                                description="Saving moves the alerts and turns them back on if NeonFlux turned them off"
                                submitLabel="Save channel"
                                submitUnchanged={!row.enabled}
                                snapshot={{ revision, values: { channelId: row.channelId } }}
                                operation={(values) => ({
                                    type: "add",
                                    twitchChannelId: row.twitchChannelId,
                                    channelId: channelValue(values),
                                })}
                                fields={(values, edit, disabled) => (
                                    <>
                                        {picker(values, edit, disabled)}
                                        {help}
                                    </>
                                )}
                            />
                            <ConfigForm<"twitch">
                                {...card}
                                draftKey={`twitch-remove:${row.twitchChannelId}`}
                                title={`Stop alerts for ${name(row)}`}
                                description="NeonFlux stops posting this streamer's live alerts"
                                submitLabel="Remove channel"
                                submitUnchanged
                                snapshot={{
                                    revision,
                                    values: {},
                                    context: { channelId: row.channelId, enabled: row.enabled },
                                }}
                                operation={() => ({ type: "remove", twitchChannelId: row.twitchChannelId })}
                                fields={() => null}
                            />
                        </div>
                    </details>
                )
            })}
            {!data.configured ? null : saved.length < TWITCH_LIMIT ? (
                <ConfigForm<"twitch">
                    {...common}
                    title="Follow a Twitch channel"
                    description={TWITCH_CHANNEL_ID_HINT}
                    submitLabel="Follow channel"
                    snapshot={{ revision, values: { twitchChannelId: "", channelId: "" } }}
                    operation={(values) => {
                        const twitchChannelId = twitchChannelValue(values.twitchChannelId)
                        if (used.has(twitchChannelId))
                            throw new FormInputError(
                                "This server already follows that Twitch channel. Change its alert channel above",
                            )
                        return { type: "add", twitchChannelId, channelId: channelValue(values) }
                    }}
                    fields={(values, edit, disabled) => (
                        <>
                            <label>
                                Twitch login or link
                                <input
                                    value={String(values.twitchChannelId)}
                                    maxLength={200}
                                    disabled={disabled}
                                    onChange={(event) => edit("twitchChannelId", event.target.value)}
                                />
                            </label>
                            {picker(values, edit, disabled)}
                            {help}
                        </>
                    )}
                />
            ) : (
                <section className="panel">
                    <h2>Follow a Twitch channel</h2>
                    <p className="muted">
                        This server follows the maximum of {TWITCH_LIMIT} Twitch channels. Remove one to follow another
                    </p>
                </section>
            )}
        </div>
    )
}
