import { useEffect, useRef, useState } from "react"
import type { ConvexReactClient } from "convex/react"
import { isId } from "@neonflux/contracts/common"
import { deliverablePublishingContent } from "@neonflux/contracts/publishing-base"
import type { PublishingDraft } from "@neonflux/contracts/publishing"
import type { DashboardCatalog } from "@neonflux/backend/dashboard-contracts"
import { dashboardApi } from "./dashboard-api"
import { ChoiceField } from "./configuration-fields"
import { JobStatus } from "./job-status"
import { useLiveQuery } from "./live-query"
import { MessagePreview } from "./message-builder"
import { validateMessage } from "./message-content"
import { publicationChannels } from "./catalog-options"
import { requestError } from "./request-error"
import { SearchPicker } from "./search-picker"
import { FormInputError } from "./settings-form"

const idOf = (draft: Pick<PublishingDraft, "kind" | "name">) => `${draft.kind}:${draft.name}`
/** Sends a saved draft or template to a channel through the same queue as the Messages section. What is sent is the saved
 *  version on screen at the click, and it follows live changes to that version */
export function SavedMessageSend({
    client,
    sessionToken,
    serverId,
    connected,
    catalog,
    catalogLoading,
    catalogError,
    drafts,
}: {
    client: ConvexReactClient
    sessionToken: string
    serverId: string
    connected: boolean
    catalog?: DashboardCatalog | undefined
    catalogLoading: boolean
    catalogError: boolean
    drafts: PublishingDraft[]
}) {
    const { data } = useLiveQuery(client, dashboardApi.messages, { sessionToken, serverId })
    const [selected, setSelected] = useState(""),
        [channel, setChannel] = useState(""),
        [sending, setSending] = useState(false),
        [error, setError] = useState(""),
        [sent, setSent] = useState<{ key: string; jobId: string }>()
    const request = useRef<{ key: string; id: string } | undefined>(undefined)
    const draft = drafts.find((value) => idOf(value) === selected)
    const key = JSON.stringify({ channel, draft: selected, content: draft?.content }),
        job = data?.jobs.find((value) => value.id === sent?.jobId),
        locked = sent?.key === key && job?.state !== "failed",
        empty = draft !== undefined && !deliverablePublishingContent(draft.content)
    // A failed request sent nothing, so the same message can be requested again with a new request ID. Its status stays shown
    useEffect(() => {
        if (job?.state === "failed") request.current = undefined
    }, [job?.state])
    return (
        <section className="panel" aria-labelledby="saved-send-title">
            <h2 id="saved-send-title">Send a saved message</h2>
            <p className="muted">
                Pick a draft or template and a channel, then request a send through the running bot. The saved version
                shown below is the one sent
            </p>
            {drafts.length === 0 ? (
                <p className="muted">No saved messages are loaded yet. Create a draft or template first</p>
            ) : (
                <form
                    onSubmit={async (event) => {
                        event.preventDefault()
                        if (!connected || sending || locked || !draft) return
                        setError("")
                        try {
                            if (!isId(channel)) throw new FormInputError("Choose a channel")
                            const message = validateMessage(draft.content)
                            if (request.current?.key !== key) request.current = { key, id: crypto.randomUUID() }
                            setSending(true)
                            const result = await client.action(dashboardApi.queueMessage, {
                                sessionToken,
                                serverId,
                                channelId: channel,
                                content: message,
                                requestId: request.current.id,
                            })
                            if (!result.jobId) throw new Error("Request was not queued")
                            setSent({ key, jobId: result.jobId })
                        } catch (cause) {
                            setError(
                                cause instanceof FormInputError
                                    ? cause.message
                                    : requestError(
                                          cause,
                                          "Send request failed. Retry to check the same request safely",
                                      ),
                            )
                        } finally {
                            setSending(false)
                        }
                    }}
                >
                    <ChoiceField
                        label="Saved message"
                        value={selected}
                        disabled={sending}
                        onChange={(value) => {
                            setSelected(value)
                            setError("")
                        }}
                        options={[
                            { value: "", label: "Choose a saved message" },
                            ...drafts.map((value) => ({
                                value: idOf(value),
                                label: `${value.kind === "draft" ? "Draft" : "Template"}: ${value.name}, version ${value.revision}`,
                            })),
                        ]}
                    />
                    {draft && <MessagePreview message={draft.content} heading="Saved message" />}
                    <SearchPicker
                        catalog
                        label="Send to channel"
                        options={publicationChannels(catalog)}
                        loading={catalogLoading}
                        allowManual={catalogError}
                        disabled={sending}
                        value={channel ? [channel] : []}
                        onChange={(ids) => {
                            setChannel(ids[0] ?? "")
                            setError("")
                        }}
                    />
                    {empty && (
                        <p className="notice" role="status">
                            This saved version is empty. Add content before sending
                        </p>
                    )}
                    <div className="actions">
                        <button type="submit" disabled={!connected || sending || locked || !draft || empty}>
                            {sending ? "Requesting…" : locked ? "Request queued" : "Send"}
                        </button>
                        {locked && (
                            <button
                                type="button"
                                className="secondary"
                                onClick={() => {
                                    request.current = undefined
                                    setSent(undefined)
                                }}
                            >
                                Send it again
                            </button>
                        )}
                    </div>
                </form>
            )}
            {error && (
                <p className="notice error" role="alert">
                    {error}
                </p>
            )}
            {sent && (
                <p className="field-help" role="status">
                    {job ? <JobStatus state={job.state} error={job.error} kind="message" /> : "Message request queued"}
                </p>
            )}
        </section>
    )
}
