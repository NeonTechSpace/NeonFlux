import {
    GIVEAWAY_ENTRANTS_TEXT,
    GIVEAWAY_LENGTH_SECONDS,
    GIVEAWAY_PRIZE_LENGTH,
    GIVEAWAY_RUNNING,
    GIVEAWAY_WINNERS,
    isGiveawayPrize,
    noWinnersText,
    type Giveaway,
    type GiveawayProblem,
} from "@neonflux/contracts/giveaways"
import { publicationChannels, selectableRoles } from "./catalog-options"
import { ConfigForm, rowCard } from "./configuration-form"
import type { ConfigSectionProps } from "./configuration-form"
import { NumberField } from "./configuration-fields"
import { numberValue } from "./configuration-values"
import { SearchPicker } from "./search-picker"
import { FormInputError } from "./settings-form"

const LENGTH_MINUTES = [GIVEAWAY_LENGTH_SECONDS[0] / 60, GIVEAWAY_LENGTH_SECONDS[1] / 60] as const
const problems: Record<GiveawayProblem, string> = {
    channel: "Its channel is gone or cannot hold it, so it ended",
    card: "Its card was deleted, so it ended",
    permission: "NeonFlux needs View channel, Add reactions and Read message history there. It tries again on its own",
    "post-failed": "Fluxer refused its card, so it never started",
    "post-late": "Its end passed before its card could go out, so it ended with no entries. Start it again",
    "post-uncertain":
        "NeonFlux does not know whether its card was posted. Check it under Recovery, and it is never posted twice",
    "result-failed": "Fluxer refused the update of its card, so the card does not show this",
    "result-uncertain":
        "NeonFlux does not know whether its card was updated, and never updates it twice. !giveaway show reads the card",
    reaction: "NeonFlux could not add the entry emoji. Members can add it themselves, or give NeonFlux Add reactions",
}
const when = (ms: number) => new Date(ms).toLocaleString()
const stateText = (row: Giveaway) =>
    row.state === "cancelled"
        ? "Cancelled"
        : row.state === "ended"
          ? row.phase === "done"
              ? "Ended"
              : "Drawing"
          : row.phase === "post" || row.phase === "sending"
            ? "Being posted"
            : row.phase === "blocked"
              ? "Waiting for its card to be confirmed"
              : `Ends ${when(row.endsAt)}`

export function GiveawaySettingsSection(props: ConfigSectionProps<"giveaways">) {
    const { data, configRevision: revision, jobs } = props.remote,
        common = { queue: props.queue, connected: props.connected, jobs }
    const picks = { catalog: true, loading: props.catalogLoading, allowManual: props.catalogError }
    const channelName = (id: string) =>
        props.catalog?.channels.find((channel) => channel.id === id)?.name ?? `Channel ${id}`
    const userName = (id: string) => `Member ${id}`
    const running = data.giveaways.filter((row) => row.state === "running").length
    return (
        <div className="role-section">
            <ConfigForm<"giveaways">
                {...common}
                title="Giveaways"
                description="The chat commands !giveaway module and !giveaway role change the same settings"
                submitLabel="Save giveaways"
                snapshot={{
                    revision,
                    values: { enabled: data.settings.enabled, requiredRoleId: data.settings.requiredRoleId ?? "" },
                }}
                operation={(values) => ({
                    type: "settings",
                    patch: {
                        enabled: Boolean(values.enabled),
                        requiredRoleId: values.requiredRoleId ? String(values.requiredRoleId) : null,
                    },
                })}
                fields={(values, edit, disabled) => (
                    <>
                        <label>
                            <input
                                type="checkbox"
                                checked={Boolean(values.enabled)}
                                disabled={disabled}
                                onChange={(event) => edit("enabled", event.target.checked)}
                            />
                            Giveaways are on
                        </label>
                        <SearchPicker
                            {...picks}
                            label="Role a member needs to win, for new giveaways"
                            options={selectableRoles(props.catalog)}
                            value={values.requiredRoleId ? [String(values.requiredRoleId)] : []}
                            disabled={disabled}
                            onChange={(ids) => edit("requiredRoleId", ids[0] ?? "")}
                        />
                        <p className="field-help">
                            While giveaways are off or DEFCON is below 3, draws wait and run once that ends
                        </p>
                    </>
                )}
            />
            {running < GIVEAWAY_RUNNING ? (
                <ConfigForm<"giveaways">
                    {...common}
                    title="Start a giveaway"
                    description="NeonFlux posts a card and members enter by reacting. It needs View channel, Send messages, Add reactions and Read message history there"
                    submitLabel="Start giveaway"
                    snapshot={{ revision, values: { channelId: "", prize: "", minutes: "1440", winners: "1" } }}
                    operation={(values) => {
                        if (typeof values.channelId !== "string" || !values.channelId)
                            throw new FormInputError("Choose a channel for the giveaway")
                        const prize = String(values.prize ?? "").trim()
                        if (!isGiveawayPrize(prize))
                            throw new FormInputError(
                                `Write the prize on one line, in at most ${GIVEAWAY_PRIZE_LENGTH} characters`,
                            )
                        return {
                            type: "start",
                            channelId: values.channelId,
                            prize,
                            winners: numberValue(values.winners, ...GIVEAWAY_WINNERS, "the number of winners"),
                            lengthSeconds:
                                numberValue(values.minutes, ...LENGTH_MINUTES, "how many minutes it runs") * 60,
                        }
                    }}
                    fields={(values, edit, disabled) => (
                        <>
                            <SearchPicker
                                {...picks}
                                label="Channel"
                                options={publicationChannels(props.catalog)}
                                value={values.channelId ? [String(values.channelId)] : []}
                                disabled={disabled}
                                onChange={(ids) => edit("channelId", ids[0] ?? "")}
                            />
                            <label>
                                Prize
                                <input
                                    value={String(values.prize)}
                                    maxLength={GIVEAWAY_PRIZE_LENGTH}
                                    disabled={disabled}
                                    onChange={(event) => edit("prize", event.target.value)}
                                />
                            </label>
                            <NumberField
                                label="Minutes it runs"
                                value={String(values.minutes)}
                                min={LENGTH_MINUTES[0]}
                                max={LENGTH_MINUTES[1]}
                                disabled={disabled}
                                required={false}
                                onChange={(value) => edit("minutes", value)}
                            />
                            <NumberField
                                label="Winners"
                                value={String(values.winners)}
                                min={GIVEAWAY_WINNERS[0]}
                                max={GIVEAWAY_WINNERS[1]}
                                disabled={disabled}
                                required={false}
                                onChange={(value) => edit("winners", value)}
                            />
                        </>
                    )}
                />
            ) : (
                <section className="panel">
                    <h2>Start a giveaway</h2>
                    <p className="muted">
                        This server runs the maximum of {GIVEAWAY_RUNNING} giveaways. End or cancel one first
                    </p>
                </section>
            )}
            {data.giveaways.map((row) => {
                const key = `giveaway:${row.giveawayNo}`,
                    { card } = rowCard(common, props.removedDefinitions, key),
                    title = `#${row.giveawayNo} ${row.prize}`,
                    notTold = row.winners.filter((winner) => winner.dm === "failed" || winner.dm === "uncertain")
                return (
                    <details key={row.giveawayNo}>
                        <summary>
                            {title}: {stateText(row)}
                        </summary>
                        <div className="role-section">
                            <section className="panel" aria-label={`Status of giveaway ${row.giveawayNo}`}>
                                <p>In {channelName(row.channelId)}</p>
                                <p>
                                    Winners:{" "}
                                    {row.winners.length
                                        ? row.winners.map((winner) => userName(winner.userId)).join(", ")
                                        : noWinnersText(row)}
                                </p>
                                {row.entrants !== undefined && (
                                    <p>
                                        Valid entries read: {row.entrants}
                                        {row.capped
                                            ? `. Only the first ${GIVEAWAY_ENTRANTS_TEXT} entries by account age were read`
                                            : ""}
                                    </p>
                                )}
                                {notTold.length > 0 && (
                                    <p>Not told by DM: {notTold.map((winner) => userName(winner.userId)).join(", ")}</p>
                                )}
                                {row.problem && <p>Problem: {problems[row.problem]}</p>}
                            </section>
                            {row.state === "running" && row.phase === "wait" && (
                                <ConfigForm<"giveaways">
                                    {...card}
                                    draftKey={`giveaway-end:${row.giveawayNo}`}
                                    title="End now"
                                    description="Draws the winners now"
                                    submitLabel="End giveaway"
                                    submitUnchanged
                                    snapshot={{ revision, values: {} }}
                                    operation={() => ({ type: "end", giveawayNo: row.giveawayNo })}
                                    fields={() => null}
                                />
                            )}
                            {row.state === "running" && (
                                <ConfigForm<"giveaways">
                                    {...card}
                                    draftKey={`giveaway-cancel:${row.giveawayNo}`}
                                    title="Cancel"
                                    description="Draws no winners. The card says it was cancelled"
                                    submitLabel="Cancel giveaway"
                                    submitUnchanged
                                    snapshot={{ revision, values: {} }}
                                    operation={() => ({ type: "cancel", giveawayNo: row.giveawayNo })}
                                    fields={() => null}
                                />
                            )}
                            {row.state === "ended" && row.phase === "done" && row.messageId && (
                                <ConfigForm<"giveaways">
                                    {...card}
                                    draftKey={`giveaway-reroll:${row.giveawayNo}`}
                                    title="Draw again"
                                    description="Draws new winners from the reactions now on the card, leaving out earlier winners"
                                    submitLabel="Reroll"
                                    submitUnchanged
                                    snapshot={{ revision, values: { count: String(row.winnerCount) } }}
                                    operation={(values) => ({
                                        type: "reroll",
                                        giveawayNo: row.giveawayNo,
                                        count: numberValue(
                                            values.count,
                                            ...GIVEAWAY_WINNERS,
                                            "the number of new winners",
                                        ),
                                    })}
                                    fields={(values, edit, disabled) => (
                                        <NumberField
                                            label="New winners"
                                            value={String(values.count)}
                                            min={GIVEAWAY_WINNERS[0]}
                                            max={GIVEAWAY_WINNERS[1]}
                                            disabled={disabled}
                                            required={false}
                                            onChange={(value) => edit("count", value)}
                                        />
                                    )}
                                />
                            )}
                        </div>
                    </details>
                )
            })}
        </div>
    )
}
