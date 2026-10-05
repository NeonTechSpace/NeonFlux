import { dashboardApi } from "./dashboard-api"
import type { SectionProps } from "./dashboard-sections"
import { useLiveQuery } from "./live-query"
import { SettingsForm } from "./settings-form"

/** The General section: The command prefix */
export function GeneralSection({ client, sessionToken, serverId, connected }: SectionProps) {
    const { data: remote, error } = useLiveQuery(client, dashboardApi.general, { sessionToken, serverId })
    return (
        <>
            {error && (
                <p className="notice error" role="alert">
                    Live settings are unavailable. Refresh your sign-in or check your server permission. Your draft has
                    been kept
                </p>
            )}
            {!remote ? (
                <section className="panel">
                    <p role="status">Loading live settings…</p>
                </section>
            ) : (
                <SettingsForm
                    title="General"
                    description="Set the command prefix for this server. Changes also reach the bot through the shared backend"
                    snapshot={{
                        revision: remote.revision,
                        values: { prefix: remote.prefix },
                    }}
                    connected={connected && !error}
                    save={(values, expectedRevision) =>
                        client.action(dashboardApi.save, {
                            sessionToken,
                            serverId,
                            section: "general",
                            expectedRevision,
                            prefix: String(values.prefix),
                        })
                    }
                    fields={(values, edit, disabled) => (
                        <>
                            <label>
                                Command prefix
                                <input
                                    required
                                    minLength={1}
                                    maxLength={5}
                                    value={String(values.prefix)}
                                    disabled={disabled}
                                    onChange={(event) => edit("prefix", event.target.value)}
                                />
                                <span className="field-help">
                                    One to five punctuation characters, such as ! or ?. Commands remain available in
                                    chat
                                </span>
                            </label>
                        </>
                    )}
                />
            )}
        </>
    )
}
