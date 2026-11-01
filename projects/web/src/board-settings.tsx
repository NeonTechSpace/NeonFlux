import type { DashboardCatalog } from "@neonflux/backend/dashboard-contracts"
import {
    BOARD_IGNORE_LIMIT,
    BOARD_LIMIT,
    BOARD_THRESHOLD_DEFAULT,
    BOARD_THRESHOLD_MAX,
    isBoardEmoji,
    type Board,
} from "@neonflux/contracts/boards"
import { isName } from "@neonflux/contracts/common"
import { ConfigForm, rowCard, savedRows } from "./configuration-form"
import type { ConfigSectionProps } from "./configuration-form"
import { SearchPicker } from "./search-picker"
import { FormInputError } from "./settings-form"
import type { FormValues } from "./settings-form"

// Text and announcement channels hold a board's posts
const boardChannels = (catalog?: DashboardCatalog) =>
    catalog?.channels.filter((channel) => channel.type === 0 || channel.type === 5) ?? []
function emojiValue(values: FormValues) {
    const value = String(values.emoji ?? "").trim()
    if (!isBoardEmoji(value))
        throw new FormInputError("Enter one emoji, such as ⭐, or a custom emoji's markup, such as <:party:123>")
    return value
}
function thresholdValue(values: FormValues) {
    const value = Number(values.threshold)
    if (!Number.isInteger(value) || value < 1 || value > BOARD_THRESHOLD_MAX)
        throw new FormInputError(`Enter a threshold from 1 to ${BOARD_THRESHOLD_MAX}`)
    return value
}
const problems = {
    channel: "Stopped: Its channel is gone or is not a text or announcement channel. Choose another channel and save",
    permission:
        "Stopped: NeonFlux cannot post in its channel. Give NeonFlux View channel, Send messages and Embed links there, then save to turn it back on",
}

export function BoardSettings(props: ConfigSectionProps<"boards">) {
    const { data, configRevision: revision, jobs } = props.remote,
        common = { queue: props.queue, connected: props.connected, jobs }
    const channelName = (id: string) =>
        props.catalog?.channels.find((channel) => channel.id === id)?.name ?? `Channel ${id}`
    const saved = savedRows(data.boards, props.removedDefinitions, (row: Board) => `board:${row.name}`)
    const channelPicker = (
        label: string,
        value: string | boolean | undefined,
        disabled: boolean,
        onChange: (id: string) => void,
        all = false,
    ) => (
        <SearchPicker
            catalog
            label={label}
            options={
                all
                    ? (props.catalog?.channels.filter((channel) => channel.type !== 4) ?? [])
                    : boardChannels(props.catalog)
            }
            loading={props.catalogLoading}
            allowManual={props.catalogError}
            value={value ? [String(value)] : []}
            disabled={disabled}
            onChange={(ids) => onChange(ids[0] ?? "")}
        />
    )
    const emojiField = (values: FormValues, edit: (key: string, value: string) => void, disabled: boolean) => (
        <>
            <label>
                Emoji
                <input
                    value={String(values.emoji)}
                    maxLength={64}
                    disabled={disabled}
                    onChange={(event) => edit("emoji", event.target.value)}
                />
            </label>
            <label>
                Reactions needed
                <input
                    type="number"
                    min={1}
                    max={BOARD_THRESHOLD_MAX}
                    value={String(values.threshold)}
                    disabled={disabled}
                    onChange={(event) => edit("threshold", event.target.value)}
                />
            </label>
        </>
    )
    return (
        <div className="role-section">
            <ConfigForm<"boards">
                {...common}
                title="Boards"
                description={`Repost messages that collect enough of an emoji, on up to ${BOARD_LIMIT} boards, such as a starboard and a clownboard`}
                snapshot={{ revision, values: { enabled: data.enabled } }}
                submitLabel="Save boards"
                operation={(values) => ({ type: "module", enabled: Boolean(values.enabled) })}
                fields={(values, edit, disabled) => (
                    <label>
                        <input
                            type="checkbox"
                            checked={Boolean(values.enabled)}
                            disabled={disabled}
                            onChange={(event) => edit("enabled", event.target.checked)}
                        />
                        Boards on
                    </label>
                )}
            />
            {data.boards.map((row) => {
                const { card } = rowCard(common, props.removedDefinitions, `board:${row.name}`)
                return (
                    <details key={row.name}>
                        <summary>
                            {row.name}: {row.emoji} at {row.threshold} in {channelName(row.channelId)},{" "}
                            {row.problem ? "Stopped" : "On"}
                        </summary>
                        <div className="role-section">
                            {row.problem && (
                                <section className="panel" aria-label={`Status of ${row.name}`}>
                                    <p>{problems[row.problem]}</p>
                                </section>
                            )}
                            <ConfigForm<"boards">
                                {...card}
                                draftKey={`board:${row.name}`}
                                title={`Settings of ${row.name}`}
                                description="Saving turns the board back on if NeonFlux stopped it. Posts it already made stay where they are"
                                submitLabel="Save board"
                                submitUnchanged={!!row.problem}
                                snapshot={{
                                    revision,
                                    values: {
                                        emoji: row.emoji,
                                        threshold: String(row.threshold),
                                        channelId: row.channelId,
                                        selfReactions: row.selfReactions,
                                        bots: row.bots,
                                    },
                                }}
                                operation={(values) => {
                                    if (typeof values.channelId !== "string" || !values.channelId)
                                        throw new FormInputError("Choose a channel for the posts")
                                    return {
                                        type: "set",
                                        name: row.name,
                                        emoji: emojiValue(values),
                                        threshold: thresholdValue(values),
                                        channelId: values.channelId,
                                        selfReactions: Boolean(values.selfReactions),
                                        bots: Boolean(values.bots),
                                    }
                                }}
                                fields={(values, edit, disabled) => (
                                    <>
                                        {emojiField(values, edit, disabled)}
                                        {channelPicker("Channel for the posts", values.channelId, disabled, (id) =>
                                            edit("channelId", id),
                                        )}
                                        <label>
                                            <input
                                                type="checkbox"
                                                checked={Boolean(values.selfReactions)}
                                                disabled={disabled}
                                                onChange={(event) => edit("selfReactions", event.target.checked)}
                                            />
                                            An author's own reaction counts
                                        </label>
                                        <label>
                                            <input
                                                type="checkbox"
                                                checked={Boolean(values.bots)}
                                                disabled={disabled}
                                                onChange={(event) => edit("bots", event.target.checked)}
                                            />
                                            Messages of bots and webhooks can be reposted
                                        </label>
                                    </>
                                )}
                            />
                            {row.ignoredChannelIds.map((channelId) => (
                                <ConfigForm<"boards">
                                    {...card}
                                    key={channelId}
                                    draftKey={`board-ignore:${row.name}:${channelId}`}
                                    title={`Ignored: ${channelName(channelId)}`}
                                    description="Messages in this channel stay off the board"
                                    submitLabel="Take back in"
                                    submitUnchanged
                                    snapshot={{ revision, values: {} }}
                                    operation={() => ({ type: "ignore", name: row.name, channelId, ignored: false })}
                                    fields={() => null}
                                />
                            ))}
                            {row.ignoredChannelIds.length < BOARD_IGNORE_LIMIT && (
                                <ConfigForm<"boards">
                                    {...card}
                                    draftKey={`board-ignore-add:${row.name}`}
                                    title={`Leave a channel out of ${row.name}`}
                                    description={`Up to ${BOARD_IGNORE_LIMIT} channels. A thread follows its channel`}
                                    submitLabel="Ignore channel"
                                    snapshot={{ revision, values: { channelId: "" } }}
                                    operation={(values) => {
                                        if (typeof values.channelId !== "string" || !values.channelId)
                                            throw new FormInputError("Choose a channel to leave out")
                                        return {
                                            type: "ignore",
                                            name: row.name,
                                            channelId: values.channelId,
                                            ignored: true,
                                        }
                                    }}
                                    fields={(values, edit, disabled) =>
                                        channelPicker(
                                            "Channel to leave out",
                                            values.channelId,
                                            disabled,
                                            (id) => edit("channelId", id),
                                            true,
                                        )
                                    }
                                />
                            )}
                            <ConfigForm<"boards">
                                {...card}
                                draftKey={`board-remove:${row.name}`}
                                title={`Remove ${row.name}`}
                                description="Its posts stay in their channel"
                                submitLabel="Remove board"
                                submitUnchanged
                                snapshot={{ revision, values: {}, context: { emoji: row.emoji } }}
                                operation={() => ({ type: "remove", name: row.name })}
                                fields={() => null}
                            />
                        </div>
                    </details>
                )
            })}
            {saved.length < BOARD_LIMIT ? (
                <ConfigForm<"boards">
                    {...common}
                    title="Add a board"
                    description="Choose its name, emoji, channel and how many reactions a message needs. A member's own reaction and messages of bots do not count until changed"
                    submitLabel="Add board"
                    snapshot={{
                        revision,
                        values: { name: "", emoji: "", threshold: String(BOARD_THRESHOLD_DEFAULT), channelId: "" },
                    }}
                    operation={(values) => {
                        const name = String(values.name ?? "")
                            .trim()
                            .toLowerCase()
                        if (!isName(name))
                            throw new FormInputError(
                                "Name the board with up to 32 letters, digits, _ or -, such as stars",
                            )
                        if (typeof values.channelId !== "string" || !values.channelId)
                            throw new FormInputError("Choose a channel for the posts")
                        return {
                            type: "add",
                            name,
                            emoji: emojiValue(values),
                            channelId: values.channelId,
                            threshold: thresholdValue(values),
                        }
                    }}
                    fields={(values, edit, disabled) => (
                        <>
                            <label>
                                Name
                                <input
                                    value={String(values.name)}
                                    maxLength={32}
                                    disabled={disabled}
                                    onChange={(event) => edit("name", event.target.value)}
                                />
                            </label>
                            {emojiField(values, edit, disabled)}
                            {channelPicker("Channel for the posts", values.channelId, disabled, (id) =>
                                edit("channelId", id),
                            )}
                        </>
                    )}
                />
            ) : (
                <section className="panel">
                    <h2>Add a board</h2>
                    <p className="muted">
                        This server has the maximum of {BOARD_LIMIT} boards. Remove one to add another
                    </p>
                </section>
            )}
        </div>
    )
}
