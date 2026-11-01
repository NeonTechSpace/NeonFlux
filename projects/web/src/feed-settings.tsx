import type { DashboardCatalog } from "@neonflux/backend/dashboard-contracts"
import {
    FEED_ACCOUNT_HINTS,
    FEED_LIMIT,
    feedAccountKey,
    feedPendingHandle,
    feedProviderNames,
    type FeedProvider,
    type FeedSubscription,
} from "@neonflux/contracts/feeds"
import { ConfigForm, rowCard, savedRows } from "./configuration-form"
import type { ConfigSectionProps } from "./configuration-form"
import { FormInputError } from "./settings-form"
import type { FormValues } from "./settings-form"
import { SearchPicker } from "./search-picker"
import { localTime } from "./time"

// Text, announcement and forum channels. In a forum each post becomes its own forum post
const postChannels = (catalog?: DashboardCatalog) =>
    catalog?.channels.filter((channel) => [0, 5, 15].includes(channel.type)) ?? []
function accountValue(provider: FeedProvider, value: string | boolean | undefined) {
    const key = feedAccountKey(provider, typeof value === "string" ? value : "")
    if (!key) throw new FormInputError(FEED_ACCOUNT_HINTS[provider])
    return key
}
function channelValue(values: FormValues) {
    if (typeof values.channelId !== "string" || !values.channelId)
        throw new FormInputError("Choose a channel for the posts")
    return values.channelId
}
const handleOf = (row: FeedSubscription) => row.status.handle ?? feedPendingHandle(row.accountId) ?? row.accountId
const name = (row: FeedSubscription) => {
    const service = feedProviderNames[row.provider],
        handle = handleOf(row)
    return row.status.name ? `${service}: ${row.status.name} (${handle})` : `${service}: ${handle}`
}
const draftKey = (row: FeedSubscription) => `feed:${row.provider}:${row.accountId}`
const problems = {
    channel:
        "Off: Its channel is gone or cannot hold posts. Choose a text, announcement or forum channel below to turn the posts back on",
    permission:
        "Off: NeonFlux cannot post in its channel. Give NeonFlux View channel, Send messages and Embed links there, then save the channel below to turn the posts back on",
}

export function FeedSettings(props: ConfigSectionProps<"feeds">) {
    const { data, configRevision: revision, jobs } = props.remote,
        common = { queue: props.queue, connected: props.connected, jobs }
    const nameOf = (id: string) => props.catalog?.channels.find((channel) => channel.id === id)?.name ?? `Channel ${id}`
    const picker = (values: FormValues, edit: (key: string, value: string | boolean) => void, disabled: boolean) => (
        <SearchPicker
            catalog
            label="Post channel"
            options={postChannels(props.catalog)}
            loading={props.catalogLoading}
            allowManual={props.catalogError}
            value={values.channelId ? [String(values.channelId)] : []}
            disabled={disabled}
            onChange={(ids) => edit("channelId", ids[0] ?? "")}
        />
    )
    const help = (
        <p className="field-help">
            NeonFlux needs View channel, Send messages and Embed links in the post channel. If they go missing, or the
            channel is removed, NeonFlux turns that account's posts off and says so in the server's system channel and
            the recovery inbox
        </p>
    )
    const saved = savedRows(data.subscriptions, props.removedDefinitions, draftKey),
        used = new Set(
            saved.flatMap((row) => [
                `${row.provider}:${row.accountId}`,
                ...(row.status.handle ? [`${row.provider}:pending:${row.status.handle}`] : []),
            ]),
        )
    return (
        <div className="role-section">
            <section className="panel">
                <h2>Bluesky and X feeds</h2>
                <p>
                    Follow up to ten accounts. Their own posts and quote posts go out as they appear, checked every few
                    minutes on Bluesky and less often on X. Reposts, replies and sensitive posts do not, and nothing
                    published before the follow is posted
                </p>
                {!data.xConfigured && (
                    <p className="muted">The bot operator has not set up an X key, so only Bluesky works</p>
                )}
                {data.xPaused && (
                    <p className="muted">
                        This NeonFlux used its X reads for this month, so X accounts wait for the next month
                    </p>
                )}
            </section>
            {data.subscriptions.map((row) => {
                const key = draftKey(row),
                    { card } = rowCard(common, props.removedDefinitions, key)
                return (
                    <details key={key}>
                        <summary>
                            {name(row)} in {nameOf(row.channelId)}:{" "}
                            {row.enabled && (row.provider !== "x" || data.xConfigured) ? "On" : "Off"}
                        </summary>
                        <div className="role-section">
                            <section className="panel" aria-label={`Status of ${name(row)}`}>
                                <ul>
                                    {row.problem && <li>{problems[row.problem]}</li>}
                                    {row.status.error && (
                                        <li>
                                            Problem: {row.status.error}
                                            {row.status.stopped ? "" : ". NeonFlux tries again on its own"}
                                        </li>
                                    )}
                                    <li>
                                        Last check:{" "}
                                        {row.status.lastReadAt !== undefined
                                            ? localTime(row.status.lastReadAt)
                                            : "None yet"}
                                    </li>
                                    <li>
                                        Latest post:{" "}
                                        {row.status.lastItemAt !== undefined
                                            ? localTime(row.status.lastItemAt)
                                            : "None yet"}
                                    </li>
                                    <li>
                                        Last sent here:{" "}
                                        {row.status.lastPostAt !== undefined
                                            ? localTime(row.status.lastPostAt)
                                            : "None yet"}
                                    </li>
                                </ul>
                            </section>
                            <ConfigForm<"feeds">
                                {...card}
                                draftKey={key}
                                title={`Post channel for ${name(row)}`}
                                description="Saving moves the posts and turns them back on if NeonFlux turned them off"
                                submitLabel="Save channel"
                                submitUnchanged={!row.enabled}
                                snapshot={{ revision, values: { channelId: row.channelId } }}
                                operation={(values) => ({
                                    type: "add",
                                    provider: row.provider,
                                    accountId: row.accountId,
                                    channelId: channelValue(values),
                                })}
                                fields={(values, edit, disabled) => (
                                    <>
                                        {picker(values, edit, disabled)}
                                        {help}
                                    </>
                                )}
                            />
                            <ConfigForm<"feeds">
                                {...card}
                                draftKey={`feed-remove:${row.provider}:${row.accountId}`}
                                title={`Stop posts of ${name(row)}`}
                                description="NeonFlux stops posting this account's posts"
                                submitLabel="Remove account"
                                submitUnchanged
                                snapshot={{
                                    revision,
                                    values: {},
                                    context: { channelId: row.channelId, enabled: row.enabled },
                                }}
                                operation={() => ({
                                    type: "remove",
                                    provider: row.provider,
                                    accountId: row.accountId,
                                })}
                                fields={() => null}
                            />
                        </div>
                    </details>
                )
            })}
            {saved.length < FEED_LIMIT ? (
                <ConfigForm<"feeds">
                    {...common}
                    title="Follow an account"
                    description="Enter a handle or a link to the account's profile"
                    submitLabel="Follow account"
                    snapshot={{ revision, values: { provider: "bluesky", account: "", channelId: "" } }}
                    operation={(values) => {
                        const provider: FeedProvider = values.provider === "x" ? "x" : "bluesky"
                        if (provider === "x" && !data.xConfigured)
                            throw new FormInputError("The bot operator has not set up an X key")
                        const accountId = accountValue(provider, values.account)
                        if (used.has(`${provider}:${accountId}`))
                            throw new FormInputError(
                                "This server already follows that account. Change its post channel above",
                            )
                        return { type: "add", provider, accountId, channelId: channelValue(values) }
                    }}
                    fields={(values, edit, disabled) => (
                        <>
                            <label>
                                Service
                                <select
                                    value={String(values.provider)}
                                    disabled={disabled}
                                    onChange={(event) => edit("provider", event.target.value)}
                                >
                                    <option value="bluesky">Bluesky</option>
                                    <option value="x" disabled={!data.xConfigured}>
                                        X
                                    </option>
                                </select>
                            </label>
                            <label>
                                Handle or link
                                <input
                                    value={String(values.account)}
                                    maxLength={200}
                                    disabled={disabled}
                                    onChange={(event) => edit("account", event.target.value)}
                                />
                            </label>
                            {picker(values, edit, disabled)}
                            {help}
                        </>
                    )}
                />
            ) : (
                <section className="panel">
                    <h2>Follow an account</h2>
                    <p className="muted">
                        This server follows the maximum of {FEED_LIMIT} accounts. Remove one to follow another
                    </p>
                </section>
            )}
        </div>
    )
}
