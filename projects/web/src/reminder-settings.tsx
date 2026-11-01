import { REMINDER_MEMBER_LIMITS } from "@neonflux/contracts/reminders"
import { ConfigForm } from "./configuration-form"
import type { ConfigSectionProps } from "./configuration-form"
import { NumberField } from "./configuration-fields"
import { numberValue } from "./configuration-values"

// Staff see only the switch and the limit. A member's reminders stay between them and NeonFlux
export function ReminderSettingsSection(props: ConfigSectionProps<"reminders">) {
    const { data, configRevision: revision, jobs } = props.remote
    return (
        <div className="role-section">
            <ConfigForm<"reminders">
                queue={props.queue}
                connected={props.connected}
                jobs={jobs}
                title="Personal reminders"
                description="Members set reminders with !remind 2h take out the bins, and NeonFlux sends them by DM. The chat commands !remind module and !remind limit change the same settings"
                submitLabel="Save reminders"
                snapshot={{
                    revision,
                    values: { enabled: data.settings.enabled, memberLimit: String(data.settings.memberLimit) },
                }}
                operation={(values) => ({
                    type: "settings",
                    patch: {
                        enabled: Boolean(values.enabled),
                        memberLimit: numberValue(
                            values.memberLimit,
                            ...REMINDER_MEMBER_LIMITS,
                            "how many reminders each member keeps",
                        ),
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
                            Reminders are on
                        </label>
                        <NumberField
                            label="Reminders each member keeps"
                            value={String(values.memberLimit)}
                            min={REMINDER_MEMBER_LIMITS[0]}
                            max={REMINDER_MEMBER_LIMITS[1]}
                            disabled={disabled}
                            required={false}
                            onChange={(value) => edit("memberLimit", value)}
                        />
                        <p className="field-help">
                            While reminders are off, members cannot set new ones and those already set wait. A member
                            who has closed their DMs gets one post in the channel they set the reminder in, unless the
                            server's automod rules would catch its text
                        </p>
                    </>
                )}
            />
        </div>
    )
}
