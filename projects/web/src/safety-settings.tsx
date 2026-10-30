import { SERVER_ROLES, STRUCTURE_CHANNELS } from "@neonflux/contracts/common"
import { warningLimit } from "@neonflux/contracts/moderation"
import type { AutomodRule, ModerationSettings, StaffClass } from "@neonflux/contracts/moderation"
import { ConfigForm, rowCard } from "./configuration-form"
import type { ConfigSectionProps } from "./configuration-form"
import { ChoiceField, NumberField, StringList } from "./configuration-fields"
import { idValue, idsValue, nameValue, numberValue, stringsValue } from "./configuration-values"
import { FormInputError } from "./settings-form"
import type { FormValues } from "./settings-form"
import { SearchPicker } from "./search-picker"
import { messageChannels, publicationChannels, selectableRoles } from "./catalog-options"

const staffScopes: StaffClass[] = ["moderation", "cases", "automod", "security", "appeals"]
const flags = ["manualModerationEnabled", "appealsEnabled"] as const
const flagLabels = { manualModerationEnabled: "Manual moderation enabled", appealsEnabled: "Appeals enabled" }
// Mentions and links over time add up a member's messages in the window. Deceptive links protect a built-in list of domains and the rule's patterns
const ruleTypes: Record<AutomodRule["type"], string> = {
    spam: "Spam",
    repeat: "Repeat",
    mentions: "Mentions in one message",
    "mention-rate": "Mentions over time",
    "link-rate": "Links over time",
    words: "Words",
    domains: "Domains",
    invites: "Invites",
    "deceptive-links": "Deceptive links",
}
/** Only the settings that differ from the saved ones, so switching one protection off stays a disable-only request that DEFCON 1 allows */
function changedSettings(patch: Partial<ModerationSettings>, current: ModerationSettings): Partial<ModerationSettings> {
    // Stored settings may list the staff scopes in another order, which is not a change
    const canonical = (value: unknown) =>
        JSON.stringify(value, (_, nested) =>
            nested && typeof nested === "object" && !Array.isArray(nested)
                ? Object.fromEntries(Object.entries(nested).sort(([a], [b]) => (a < b ? -1 : 1)))
                : nested,
        )
    const changed = Object.fromEntries(
        Object.entries(patch).filter(
            ([key, value]) => canonical(value) !== canonical(current[key as keyof ModerationSettings]),
        ),
    )
    if (!Object.keys(changed).length) throw new FormInputError("These values match the current settings")
    return changed
}
function ruleValues(rule?: AutomodRule): FormValues {
    return {
        name: rule?.name ?? "",
        type: rule?.type ?? "spam",
        enabled: rule?.enabled ?? true,
        priority: String(rule?.priority ?? 0),
        action: rule?.action ?? "log",
        threshold: String(rule?.threshold ?? 5),
        windowSeconds: String(rule?.windowSeconds ?? 10),
        durationSeconds: String(rule?.durationSeconds ?? 60),
        patterns: JSON.stringify(rule?.patterns ?? []),
        domainMode: rule?.domainMode ?? "block",
        channelIds: JSON.stringify(rule?.channelIds ?? []),
        exemptChannelIds: JSON.stringify(rule?.exemptChannelIds ?? []),
        exemptRoleIds: JSON.stringify(rule?.exemptRoleIds ?? []),
    }
}
function ruleValue(values: FormValues): AutomodRule {
    return {
        name: nameValue(values.name, "rule name"),
        type: values.type as AutomodRule["type"],
        enabled: Boolean(values.enabled),
        priority: numberValue(values.priority, -100, 100, "priority"),
        action: values.action as AutomodRule["action"],
        threshold: numberValue(values.threshold, 1, 100, "threshold"),
        windowSeconds: numberValue(values.windowSeconds, 1, 300, "window seconds"),
        durationSeconds: numberValue(values.durationSeconds, 1, 31536000, "timeout seconds"),
        patterns: stringsValue(values.patterns, 1000, 200, "patterns"),
        domainMode: values.domainMode as AutomodRule["domainMode"],
        channelIds: idsValue(values.channelIds, STRUCTURE_CHANNELS, "rule channels"),
        exemptChannelIds: idsValue(values.exemptChannelIds, STRUCTURE_CHANNELS, "exempt channels"),
        exemptRoleIds: idsValue(values.exemptRoleIds, SERVER_ROLES, "exempt roles"),
    }
}
export function SafetySettings(props: ConfigSectionProps<"moderation">) {
    const { remote, queue, connected } = props,
        { data, configRevision: revision, jobs } = remote,
        { settings, privateDataRoleId, rules, watchlist } = data
    // The server owner alone chooses who may view private cases, and the bot rechecks ownership before it applies the change
    const owner = props.catalog?.ownerId !== undefined && props.catalog.ownerId === props.userId
    const common = { queue, connected, jobs },
        picks = { loading: props.catalogLoading, allowManual: props.catalogError, catalog: true },
        channels = publicationChannels(props.catalog),
        roles = selectableRoles(props.catalog)
    const limit = warningLimit(settings)
    const settingValues: FormValues = {
        manualModerationEnabled: settings.manualModerationEnabled,
        appealsEnabled: settings.appealsEnabled,
        logChannelId: settings.logChannelId ?? "",
        keepCases: settings.caseRetentionDays ? "days" : "keep",
        caseRetentionDays: String(settings.caseRetentionDays ?? 180),
        ...Object.fromEntries(
            staffScopes.map((scope) => [`staff:${scope}`, JSON.stringify(settings.staffRoleIds[scope])]),
        ),
    }
    return (
        <div className="role-section">
            <ConfigForm<"moderation">
                {...common}
                title="Moderation and staff"
                description="Configure moderation, appeals, staff roles and the existing moderation log destination"
                snapshot={{ revision, values: settingValues }}
                operation={(values) => ({
                    type: "settings",
                    patch: changedSettings(
                        {
                            manualModerationEnabled: Boolean(values.manualModerationEnabled),
                            appealsEnabled: Boolean(values.appealsEnabled),
                            logChannelId: values.logChannelId
                                ? idValue(values.logChannelId, "moderation log channel")
                                : null,
                            staffRoleIds: Object.fromEntries(
                                staffScopes.map((scope) => [
                                    scope,
                                    idsValue(values[`staff:${scope}`], SERVER_ROLES, `${scope} staff roles`),
                                ]),
                            ) as ModerationSettings["staffRoleIds"],
                            caseRetentionDays:
                                values.keepCases === "days"
                                    ? numberValue(values.caseRetentionDays, 1, 3650, "days to keep cases")
                                    : null,
                        },
                        // Settings saved before the choice existed keep cases until erased, the same as null
                        { ...settings, caseRetentionDays: settings.caseRetentionDays ?? null },
                    ),
                })}
                fields={(values, edit, disabled) => (
                    <>
                        {flags.map((key) => (
                            <label key={key}>
                                <input
                                    type="checkbox"
                                    checked={Boolean(values[key])}
                                    disabled={disabled}
                                    onChange={(event) => edit(key, event.target.checked)}
                                />
                                {flagLabels[key]}
                            </label>
                        ))}
                        <SearchPicker
                            {...picks}
                            label="Moderation log channel"
                            options={channels}
                            value={values.logChannelId ? [String(values.logChannelId)] : []}
                            disabled={disabled}
                            onChange={(ids) => edit("logChannelId", ids[0] ?? "")}
                        />
                        <span className="field-help">Changing staff roles needs a current Owner or Administrator</span>
                        {staffScopes.map((scope) => (
                            <SearchPicker
                                {...picks}
                                key={scope}
                                label={`${scope[0]!.toUpperCase()}${scope.slice(1)} staff roles`}
                                options={roles}
                                value={JSON.parse(String(values[`staff:${scope}`])) as string[]}
                                multiple
                                disabled={disabled}
                                onChange={(ids) => edit(`staff:${scope}`, JSON.stringify(ids))}
                            />
                        ))}
                        <ChoiceField
                            label="Keep cases"
                            value={String(values.keepCases)}
                            onChange={(value) => edit("keepCases", value)}
                            disabled={disabled}
                            options={[
                                { value: "keep", label: "Until erased" },
                                { value: "days", label: "For a number of days" },
                            ]}
                        />
                        {values.keepCases === "days" && (
                            <NumberField
                                label="Days to keep cases"
                                value={String(values.caseRetentionDays)}
                                onChange={(value) => edit("caseRetentionDays", value)}
                                disabled={disabled}
                                min={1}
                                max={3650}
                            />
                        )}
                    </>
                )}
            />
            <ConfigForm<"moderation">
                {...common}
                title="Warning limit"
                description="Time out a member automatically after repeated warnings within a number of days. The member then starts again from zero"
                snapshot={{
                    revision,
                    values: {
                        enabled: limit.warningPenaltyEnabled,
                        count: String(limit.warningPenaltyCount),
                        days: String(limit.warningPenaltyDays),
                        seconds: String(limit.warningPenaltySeconds),
                    },
                }}
                operation={(values) => ({
                    type: "settings",
                    patch: changedSettings(
                        {
                            warningPenaltyEnabled: Boolean(values.enabled),
                            warningPenaltyCount: numberValue(values.count, 2, 20, "warnings before a timeout"),
                            warningPenaltyDays: numberValue(values.days, 1, 365, "days warnings count"),
                            warningPenaltySeconds: numberValue(values.seconds, 1, 31536000, "timeout seconds"),
                        },
                        // Settings saved before the limit existed have it off
                        { ...settings, ...limit },
                    ),
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
                            Warning limit enabled
                        </label>
                        <NumberField
                            label="Warnings before a timeout"
                            value={String(values.count)}
                            onChange={(value) => edit("count", value)}
                            disabled={disabled}
                            min={2}
                            max={20}
                        />
                        <NumberField
                            label="Days warnings count"
                            value={String(values.days)}
                            onChange={(value) => edit("days", value)}
                            disabled={disabled}
                            min={1}
                            max={365}
                        />
                        <NumberField
                            label="Timeout (seconds)"
                            value={String(values.seconds)}
                            onChange={(value) => edit("seconds", value)}
                            disabled={disabled}
                            min={1}
                            max={31536000}
                        />
                        {settings.automodMode !== "enforce" && (
                            <p className="field-help">
                                Automod mode is dry run, so reaching the limit is only logged until the mode is Enforce
                            </p>
                        )}
                    </>
                )}
            />
            <ConfigForm<"moderation">
                {...common}
                connected={connected && owner}
                title="Private data role"
                description={`Members with this role and the server owner can view private cases, appeals and member history on this website. Administrators also need the role. ${owner ? "Leave it empty so only you can view them" : "Only the server owner can change it"}`}
                snapshot={{ revision, values: { roleId: privateDataRoleId ?? "" } }}
                operation={(values) => ({
                    type: "private-role",
                    roleId: values.roleId ? idValue(values.roleId, "private data role") : null,
                })}
                fields={(values, edit, disabled) => (
                    <SearchPicker
                        {...picks}
                        label="Private data role"
                        options={roles}
                        value={values.roleId ? [String(values.roleId)] : []}
                        disabled={disabled}
                        onChange={(ids) => edit("roleId", ids[0] ?? "")}
                    />
                )}
            />
            <ConfigForm<"moderation">
                {...common}
                title="Automod policy"
                description="Choose dry-run or enforcement before configuring rules"
                snapshot={{
                    revision,
                    values: {
                        enabled: settings.automodEnabled,
                        mode: settings.automodMode,
                        bots: settings.automodBotMessagesEnabled,
                    },
                }}
                operation={(values) => ({
                    type: "settings",
                    patch: changedSettings(
                        {
                            automodEnabled: Boolean(values.enabled),
                            automodMode: values.mode as "dry-run" | "enforce",
                            automodBotMessagesEnabled: Boolean(values.bots),
                        },
                        settings,
                    ),
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
                            Automod enabled
                        </label>
                        <label>
                            <input
                                type="checkbox"
                                checked={Boolean(values.bots)}
                                disabled={disabled}
                                onChange={(event) => edit("bots", event.target.checked)}
                            />
                            Check webhook and other bots' messages
                        </label>
                        <p className="muted">
                            NeonFlux never checks its own messages. On these messages a warning only logs and a timeout
                            deletes the message
                        </p>
                        <ChoiceField
                            label="Automod mode"
                            value={String(values.mode)}
                            onChange={(value) => edit("mode", value)}
                            disabled={disabled}
                            options={[
                                { value: "dry-run", label: "Dry run" },
                                { value: "enforce", label: "Enforce" },
                            ]}
                        />
                    </>
                )}
            />
            <ConfigForm<"moderation">
                {...common}
                title="Security policy"
                description="Configure join bursts, honeypots and the user watchlist"
                snapshot={{
                    revision,
                    values: {
                        enabled: settings.securityEnabled,
                        mode: settings.securityMode,
                        joinEnabled: settings.joinEnabled,
                        joinThreshold: String(settings.joinThreshold),
                        joinWindowSeconds: String(settings.joinWindowSeconds),
                        joinDefcon2: settings.joinDefcon2,
                        honeypotEnabled: settings.honeypotEnabled,
                        honeypotChannelIds: JSON.stringify(settings.honeypotChannelIds),
                        watchlistEnabled: settings.watchlistEnabled,
                    },
                }}
                operation={(values) => ({
                    type: "settings",
                    patch: changedSettings(
                        {
                            securityEnabled: Boolean(values.enabled),
                            securityMode: values.mode as "dry-run" | "enforce",
                            joinEnabled: Boolean(values.joinEnabled),
                            joinThreshold: numberValue(values.joinThreshold, 2, 100, "join threshold"),
                            joinWindowSeconds: numberValue(values.joinWindowSeconds, 1, 300, "join window"),
                            joinDefcon2: Boolean(values.joinDefcon2),
                            honeypotEnabled: Boolean(values.honeypotEnabled),
                            honeypotChannelIds: idsValue(
                                values.honeypotChannelIds,
                                STRUCTURE_CHANNELS,
                                "honeypot channels",
                            ),
                            watchlistEnabled: Boolean(values.watchlistEnabled),
                        },
                        settings,
                    ),
                })}
                fields={(values, edit, disabled) => (
                    <>
                        {[
                            ["enabled", "Security enabled"],
                            ["joinEnabled", "Join burst detection enabled"],
                            ["joinDefcon2", "Raise DEFCON to level 2 on a join burst"],
                            ["honeypotEnabled", "Honeypots enabled"],
                            ["watchlistEnabled", "Watchlist enabled"],
                        ].map(([key, label]) => (
                            <label key={key}>
                                <input
                                    type="checkbox"
                                    checked={Boolean(values[key!])}
                                    disabled={disabled}
                                    onChange={(event) => edit(key!, event.target.checked)}
                                />
                                {label}
                            </label>
                        ))}
                        <ChoiceField
                            label="Security mode"
                            value={String(values.mode)}
                            onChange={(value) => edit("mode", value)}
                            disabled={disabled}
                            options={[
                                { value: "dry-run", label: "Dry run" },
                                { value: "enforce", label: "Enforce" },
                            ]}
                        />
                        <NumberField
                            label="Join burst threshold"
                            value={String(values.joinThreshold)}
                            onChange={(value) => edit("joinThreshold", value)}
                            disabled={disabled}
                            min={2}
                            max={100}
                        />
                        <NumberField
                            label="Join burst window (seconds)"
                            value={String(values.joinWindowSeconds)}
                            onChange={(value) => edit("joinWindowSeconds", value)}
                            disabled={disabled}
                            min={1}
                            max={300}
                        />
                        <SearchPicker
                            {...picks}
                            label="Honeypot channels"
                            options={messageChannels(props.catalog)}
                            multiple
                            value={JSON.parse(String(values.honeypotChannelIds)) as string[]}
                            disabled={disabled}
                            onChange={(ids) => edit("honeypotChannelIds", JSON.stringify(ids))}
                        />
                    </>
                )}
            />
            <ConfigForm<"moderation">
                {...common}
                title="DEFCON"
                description="Set the effective security level with current Owner or Administrator permission. Level 1 pauses ordinary command and delivery work"
                snapshot={{ revision, values: { defcon: String(settings.defcon) } }}
                operation={(values) => ({
                    type: "settings",
                    patch: { defcon: numberValue(values.defcon, 1, 3, "DEFCON level") as 1 | 2 | 3 },
                })}
                fields={(values, edit, disabled) => (
                    <ChoiceField
                        label="DEFCON level"
                        value={String(values.defcon)}
                        onChange={(value) => edit("defcon", value)}
                        disabled={disabled}
                        options={[
                            { value: "3", label: "3: Normal" },
                            { value: "2", label: "2: Restricted" },
                            { value: "1", label: "1: Emergency" },
                        ]}
                    />
                )}
            />
            <section className="panel">
                <h2>Automod rules</h2>
                <p className="muted">Each rule keeps its type and name. Create a new rule to use a different type</p>
            </section>
            {rules.map((rule) => {
                const { missing, card } = rowCard(common, props.removedDefinitions, `rule:${rule.name}`)
                return (
                    <details key={rule.name}>
                        <summary>
                            {rule.name}: {rule.enabled ? "Enabled" : "Disabled"} {rule.type} rule
                        </summary>
                        <div className="role-section">
                            {missing && (
                                <p className="notice" role="status">
                                    Not in loaded pages. This draft is kept for copying. Load remaining pages to check
                                    whether it moved
                                </p>
                            )}
                            <ConfigForm<"moderation">
                                {...card}
                                title={`Rule: ${rule.name}`}
                                description="Edit the rule's limits, patterns, action and exemptions"
                                snapshot={{ revision, values: ruleValues(rule) }}
                                operation={(values) => {
                                    const { name, type, ...patch } = ruleValue(values)
                                    return { type: "rule-update", name, patch }
                                }}
                                fields={(values, edit, disabled) => (
                                    <RuleFields
                                        values={values}
                                        edit={edit}
                                        disabled={disabled}
                                        existing
                                        props={props}
                                    />
                                )}
                            />
                            <ConfigForm<"moderation">
                                {...card}
                                title={`Delete rule: ${rule.name}`}
                                description="Remove this rule from future automod evaluation"
                                submitUnchanged
                                snapshot={{ revision, values: {}, context: rule }}
                                operation={() => ({ type: "rule-delete", name: rule.name })}
                                submitLabel="Delete rule"
                                fields={() => null}
                            />
                        </div>
                    </details>
                )
            })}
            <ConfigForm<"moderation">
                {...common}
                title="Create automod rule"
                description="Configure a named rule. Native permissions and safety policy still apply before enforcement"
                snapshot={{ revision, values: ruleValues() }}
                submitLabel="Create rule"
                operation={(values) => ({ type: "rule-create", rule: ruleValue(values) })}
                fields={(values, edit, disabled) => (
                    <RuleFields values={values} edit={edit} disabled={disabled} props={props} />
                )}
            />
            {remote.nextCursors?.rules && (
                <button
                    type="button"
                    className="secondary"
                    disabled={props.loadingPage}
                    onClick={() => props.loadPage?.("rules", remote.nextCursors!.rules!)}
                >
                    Load more rules
                </button>
            )}
            <section className="panel">
                <h2>User watchlist</h2>
                <p className="muted">
                    Configuration entries apply to exact user IDs, including users who have not joined
                </p>
            </section>
            {watchlist.map((entry) => {
                const { missing, card } = rowCard(common, props.removedDefinitions, `watchlist:${entry.userId}`)
                return (
                    <details key={entry.userId}>
                        <summary>User {entry.userId}</summary>
                        <div className="role-section">
                            {missing && (
                                <p className="notice" role="status">
                                    Not in loaded pages. This draft is kept for copying. Load remaining pages to check
                                    whether it moved
                                </p>
                            )}
                            <ConfigForm<"moderation">
                                {...card}
                                title={`Watchlist user: ${entry.userId}`}
                                description="Update the configured reason"
                                snapshot={{ revision, values: { reason: entry.reason } }}
                                operation={(values) => ({
                                    type: "watchlist-add",
                                    userId: entry.userId,
                                    reason: String(values.reason),
                                })}
                                fields={(values, edit, disabled) => (
                                    <label>
                                        Watchlist reason
                                        <textarea
                                            required
                                            maxLength={512}
                                            value={String(values.reason)}
                                            disabled={disabled}
                                            onChange={(event) => edit("reason", event.target.value)}
                                        />
                                    </label>
                                )}
                            />
                            <ConfigForm<"moderation">
                                {...card}
                                title={`Remove watchlist user: ${entry.userId}`}
                                description="Stop applying this entry to future observations"
                                submitUnchanged
                                snapshot={{ revision, values: {}, context: entry }}
                                submitLabel="Remove watchlist entry"
                                operation={() => ({ type: "watchlist-remove", userId: entry.userId })}
                                fields={() => null}
                            />
                        </div>
                    </details>
                )
            })}
            <ConfigForm<"moderation">
                {...common}
                title="Add watchlist user"
                description="Enter an exact user ID and the configuration reason"
                snapshot={{ revision, values: { userId: "", reason: "" } }}
                submitLabel="Add watchlist entry"
                operation={(values) => ({
                    type: "watchlist-add",
                    userId: idValue(values.userId, "watchlist user ID"),
                    reason: String(values.reason),
                })}
                fields={(values, edit, disabled) => (
                    <>
                        <label>
                            Watchlist user ID
                            <input
                                required
                                inputMode="numeric"
                                maxLength={19}
                                value={String(values.userId)}
                                disabled={disabled}
                                onChange={(event) => edit("userId", event.target.value)}
                            />
                        </label>
                        <label>
                            Watchlist reason
                            <textarea
                                required
                                maxLength={512}
                                value={String(values.reason)}
                                disabled={disabled}
                                onChange={(event) => edit("reason", event.target.value)}
                            />
                        </label>
                    </>
                )}
            />
            {remote.nextCursors?.watchlist && (
                <button
                    type="button"
                    className="secondary"
                    disabled={props.loadingPage}
                    onClick={() => props.loadPage?.("watchlist", remote.nextCursors!.watchlist!)}
                >
                    Load more watchlist users
                </button>
            )}
        </div>
    )
}
function RuleFields({
    values,
    edit,
    disabled,
    existing,
    props,
}: {
    values: FormValues
    edit: (key: string, value: string | boolean) => void
    disabled: boolean
    existing?: boolean
    props: ConfigSectionProps<"moderation">
}) {
    const picks = { loading: props.catalogLoading, allowManual: props.catalogError, catalog: true },
        channels = messageChannels(props.catalog),
        roles = selectableRoles(props.catalog)
    return (
        <>
            {!existing && (
                <>
                    <label>
                        Rule name
                        <input
                            required
                            maxLength={32}
                            value={String(values.name)}
                            disabled={disabled}
                            onChange={(event) => edit("name", event.target.value)}
                        />
                    </label>
                    <ChoiceField
                        label="Rule type"
                        value={String(values.type)}
                        onChange={(value) => edit("type", value)}
                        disabled={disabled}
                        options={Object.entries(ruleTypes).map(([value, label]) => ({ value, label }))}
                    />
                </>
            )}
            <label>
                <input
                    type="checkbox"
                    checked={Boolean(values.enabled)}
                    disabled={disabled}
                    onChange={(event) => edit("enabled", event.target.checked)}
                />
                Rule enabled
            </label>
            <ChoiceField
                label="Rule action"
                value={String(values.action)}
                onChange={(value) => edit("action", value)}
                disabled={disabled}
                options={["log", "delete", "warn", "timeout"].map((value) => ({
                    value,
                    label: value[0]!.toUpperCase() + value.slice(1),
                }))}
            />
            <NumberField
                label="Rule priority"
                value={String(values.priority)}
                onChange={(value) => edit("priority", value)}
                disabled={disabled}
                min={-100}
                max={100}
            />
            <NumberField
                label="Rule threshold"
                value={String(values.threshold)}
                onChange={(value) => edit("threshold", value)}
                disabled={disabled}
                min={1}
                max={100}
            />
            <NumberField
                label="Rule window (seconds)"
                value={String(values.windowSeconds)}
                onChange={(value) => edit("windowSeconds", value)}
                disabled={disabled}
                min={1}
                max={300}
            />
            <NumberField
                label="Rule timeout (seconds)"
                value={String(values.durationSeconds)}
                onChange={(value) => edit("durationSeconds", value)}
                disabled={disabled}
                min={1}
                max={31536000}
            />
            <StringList
                label="Rule patterns"
                value={String(values.patterns)}
                onChange={(value) => edit("patterns", value)}
                disabled={disabled}
                max={1000}
                maxLength={200}
                paste
            />
            {values.type === "words" && (
                <p className="field-help">Whole words. Put * at the start or end to match part of a word</p>
            )}
            <ChoiceField
                label="Domain match mode"
                value={String(values.domainMode)}
                onChange={(value) => edit("domainMode", value)}
                disabled={disabled}
                options={[
                    { value: "block", label: "Block listed domains" },
                    { value: "allow", label: "Allow listed domains" },
                ]}
            />
            <SearchPicker
                {...picks}
                label="Rule channels"
                options={channels}
                multiple
                value={JSON.parse(String(values.channelIds)) as string[]}
                disabled={disabled}
                onChange={(ids) => edit("channelIds", JSON.stringify(ids))}
            />
            <SearchPicker
                {...picks}
                label="Exempt channels"
                options={channels}
                multiple
                value={JSON.parse(String(values.exemptChannelIds)) as string[]}
                disabled={disabled}
                onChange={(ids) => edit("exemptChannelIds", JSON.stringify(ids))}
            />
            <SearchPicker
                {...picks}
                label="Exempt roles"
                options={roles}
                multiple
                value={JSON.parse(String(values.exemptRoleIds)) as string[]}
                disabled={disabled}
                onChange={(ids) => edit("exemptRoleIds", JSON.stringify(ids))}
            />
        </>
    )
}
