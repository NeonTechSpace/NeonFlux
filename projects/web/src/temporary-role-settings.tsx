import {
    TEMPORARY_ROLE_DEFAULTS,
    TEMPORARY_ROLE_MAX_SECONDS,
    TEMPORARY_ROLE_MIN_SECONDS,
} from "@neonflux/contracts/temporary-roles"
import type { TemporaryRoleProblem } from "@neonflux/contracts/temporary-roles"
import { ConfigForm, rowCard, savedRows } from "./configuration-form"
import type { ConfigSectionProps } from "./configuration-form"
import { idsValue } from "./configuration-values"
import { FormInputError } from "./settings-form"
import type { FormValues } from "./settings-form"
import { SearchPicker } from "./search-picker"
import { selectableRoles } from "./catalog-options"
import { localTime } from "./time"

const units = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 } as const
/**
 * A duration in the chat command's form, such as 90s, 30m, 12h, 7d, 2w or 1d12h, from 1 minute to 100 years. Units come
 * in w, d, h, m, s order and each at most once, as in chat. Empty means none
 */
function durationValue(value: string | boolean | undefined, label: string): number | null {
    const text = typeof value === "string" ? value.trim().toLowerCase() : ""
    if (!text) return null
    const match = /^(?:(\d{1,8})w)?(?:(\d{1,8})d)?(?:(\d{1,8})h)?(?:(\d{1,8})m)?(?:(\d{1,8})s)?$/.exec(text),
        seconds = match
            ? (["w", "d", "h", "m", "s"] as const).reduce(
                  (sum, unit, index) => sum + Number(match[index + 1] ?? 0) * units[unit],
                  0,
              )
            : 0
    if (seconds < TEMPORARY_ROLE_MIN_SECONDS || seconds > TEMPORARY_ROLE_MAX_SECONDS)
        throw new FormInputError(
            `Enter the ${label} as a number with s, m, h, d or w, such as 7d or 1d12h, from 1 minute to 100 years, or leave it empty`,
        )
    return seconds
}
function durationText(seconds: number | undefined) {
    if (seconds === undefined) return ""
    const [unit, size] = Object.entries(units)
        .reverse()
        .find(([, size]) => seconds % size === 0)!
    return `${seconds / size}${unit}`
}
const problems: Record<TemporaryRoleProblem, string> = {
    permission: "NeonFlux lacks Manage roles. Grant it to the NeonFlux role",
    role: "The role ranks at or above the NeonFlux role or has staff permissions. Move the NeonFlux role above it",
    refused: "Fluxer refused the role change",
    uncertain:
        "Fluxer did not confirm the last role change, so NeonFlux does not repeat it. An Administrator runs !temprole reconcile @member",
    unavailable: "NeonFlux could not read the member or the roles",
    waiting:
        "Waits for the member, who needs to accept the rules, or a timeout, quarantine or the DEFCON level blocks the role. NeonFlux tries again within 10 minutes",
}

export function TemporaryRoleSettings(props: ConfigSectionProps<"temproles">) {
    const { data, configRevision: revision, jobs } = props.remote,
        common = { queue: props.queue, connected: props.connected, jobs }
    const roleName = (id: string) => props.catalog?.roles.find((role) => role.id === id)?.name ?? `Role ${id}`,
        now = Date.now()
    const roles = selectableRoles(props.catalog),
        picks = { loading: props.catalogLoading, allowManual: props.catalogError, catalog: true }
    const fields = (values: FormValues, edit: (key: string, value: string | boolean) => void, disabled: boolean) => (
        <>
            <label>
                Default duration
                <input
                    maxLength={16}
                    value={String(values.defaultSeconds)}
                    disabled={disabled}
                    onChange={(event) => edit("defaultSeconds", event.target.value)}
                />
            </label>
            <label>
                Longest duration
                <input
                    maxLength={16}
                    value={String(values.maxSeconds)}
                    disabled={disabled}
                    onChange={(event) => edit("maxSeconds", event.target.value)}
                />
            </label>
            <p className="field-help">
                Use s, m, h, d or w, such as 30m, 12h, 7d, 2w or 1d12h. Without a default, staff name a duration for
                each grant, and without a longest duration a grant lasts as long as staff choose
            </p>
        </>
    )
    const operation = (roleId: string) => (values: FormValues) => {
        const defaultSeconds = durationValue(values.defaultSeconds, "default duration"),
            maxSeconds = durationValue(values.maxSeconds, "longest duration")
        if (defaultSeconds !== null && maxSeconds !== null && defaultSeconds > maxSeconds)
            throw new FormInputError("The default duration is longer than the longest duration")
        return { type: "role" as const, roleId, defaultSeconds, maxSeconds }
    }
    return (
        <div className="role-section">
            <section className="panel" aria-labelledby="temporary-grants">
                <h2 id="temporary-grants">Active temporary roles</h2>
                <p className="muted">
                    Staff with Manage roles give a role for a set time in chat with !temprole add @member @role 7d, and
                    renew, shorten or end it with !temprole set and remove. NeonFlux removes each role when its time
                    ends
                </p>
                {data.grants.length ? (
                    <ul>
                        {data.grants.map((grant) => (
                            <li key={grant.grantId}>
                                {`Member ${grant.userId}: ${roleName(grant.roleId)}, `}
                                {grant.problem ? (
                                    // NeonFlux tries a grant again only once it has ended, except one that waits for its member
                                    <strong>
                                        {grant.endsAt > now && grant.problem === "waiting"
                                            ? `ends ${localTime(grant.endsAt)}. ${problems.waiting}`
                                            : grant.endsAt > now
                                              ? `ends ${localTime(grant.endsAt)} and needs attention. ${problems[grant.problem]}`
                                              : `ended ${localTime(grant.endsAt)} and not removed yet. ${problems[grant.problem]}`}
                                    </strong>
                                ) : (
                                    `ends ${localTime(grant.endsAt)}`
                                )}
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p>No temporary roles are active</p>
                )}
                {data.more && (
                    <p className="muted">Showing the 100 that end first. !temprole list pages through all of them</p>
                )}
            </section>
            {data.settings.roles.map((row) => {
                const { card } = rowCard(common, props.removedDefinitions, `role:${row.roleId}`)
                return (
                    <details key={row.roleId}>
                        <summary>{`${roleName(row.roleId)}: Default ${durationText(row.defaultSeconds) || "none"}, longest ${durationText(row.maxSeconds) || "none"}`}</summary>
                        <div className="role-section">
                            <ConfigForm<"temproles">
                                {...card}
                                draftKey={`role:${row.roleId}`}
                                title={`Defaults for ${roleName(row.roleId)}`}
                                description="Clearing both durations removes this role's defaults"
                                snapshot={{
                                    revision,
                                    values: {
                                        defaultSeconds: durationText(row.defaultSeconds),
                                        maxSeconds: durationText(row.maxSeconds),
                                    },
                                }}
                                operation={operation(row.roleId)}
                                fields={fields}
                            />
                        </div>
                    </details>
                )
            })}
            <ConfigForm<"temproles">
                {...common}
                title="Add role defaults"
                description={`Give a role a default duration, a longest duration or both. ${savedRows(data.settings.roles, props.removedDefinitions, (row) => `role:${row.roleId}`).length} of ${TEMPORARY_ROLE_DEFAULTS} roles have defaults`}
                submitLabel="Save defaults"
                snapshot={{ revision, values: { roleId: "[]", defaultSeconds: "", maxSeconds: "" } }}
                operation={(values) => {
                    const [roleId] = idsValue(values.roleId, 1, "role")
                    if (!roleId) throw new FormInputError("Choose a role")
                    return operation(roleId)(values)
                }}
                fields={(values, edit, disabled) => (
                    <>
                        <SearchPicker
                            {...picks}
                            label="Role"
                            options={roles}
                            value={JSON.parse(String(values.roleId)) as string[]}
                            disabled={disabled}
                            onChange={(next) => edit("roleId", JSON.stringify(next))}
                        />
                        {fields(values, edit, disabled)}
                    </>
                )}
            />
        </div>
    )
}
