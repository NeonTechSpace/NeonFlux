import {
    COMMAND_RULE_LIMIT,
    LIMITABLE_COMMANDS,
    isLimitableCommand,
    type CommandRule,
    type CommandRuleName,
} from "@neonflux/contracts/command-rules"
import { ConfigForm, rowCard, savedRows } from "./configuration-form"
import type { ConfigSectionProps } from "./configuration-form"
import { FormInputError } from "./settings-form"
import type { FormValues } from "./settings-form"
import { SearchPicker } from "./search-picker"
import { messageChannels, selectableRoles } from "./catalog-options"

const list = (value: string | boolean | undefined) => (typeof value === "string" && value ? value.split(",") : [])
const save = (command: CommandRuleName, values: FormValues) => ({
    type: "set" as const,
    command,
    channelIds: list(values.channelIds),
    roleIds: list(values.roleIds),
})

export function CommandRulesSettings(props: ConfigSectionProps<"commandrules">) {
    const { data, configRevision: revision, jobs } = props.remote,
        common = { queue: props.queue, connected: props.connected, jobs },
        saved = savedRows(data.rules, props.removedDefinitions, (rule) => `rule:${rule.command}`)
    const channels = messageChannels(props.catalog),
        roles = selectableRoles(props.catalog)
    const names = (ids: readonly string[], options: readonly { id: string; name: string }[], none: string) =>
        ids.map((id) => options.find((option) => option.id === id)?.name ?? id).join(", ") || none
    const summary = (rule: CommandRule) =>
        `!${rule.command}: ${names(rule.channelIds, channels, "Every channel")}. ${names(rule.roleIds, roles, "Everyone")}`
    const fields = (values: FormValues, edit: (key: string, value: string | boolean) => void, disabled: boolean) => (
        <>
            <SearchPicker
                catalog
                multiple
                label="Works in these channels"
                options={channels}
                loading={props.catalogLoading}
                allowManual={props.catalogError}
                value={list(values.channelIds)}
                disabled={disabled}
                onChange={(ids) => edit("channelIds", ids.join(","))}
            />
            <SearchPicker
                catalog
                multiple
                label="Only these roles can use it"
                options={roles}
                loading={props.catalogLoading}
                allowManual={props.catalogError}
                value={list(values.roleIds)}
                disabled={disabled}
                onChange={(ids) => edit("roleIds", ids.join(","))}
            />
            <p className="field-help">
                Leave channels empty for every channel and roles empty for everyone. A thread counts as its parent
                channel. Rules never apply to the server owner or Administrators, or to commands in a DM
            </p>
        </>
    )
    return (
        <div className="role-section">
            <section className="panel">
                <h2>Command rules</h2>
                <p className="muted">
                    Rules {saved.length}/{COMMAND_RULE_LIMIT}. A rule limits where a built-in command works and who can
                    use it. Safety, recovery and setup commands always work. The chat command !commands changes the same
                    rules
                </p>
            </section>
            <ConfigForm<"commandrules">
                {...common}
                title="Add or change a rule"
                description="Saving replaces the command's rule"
                resetAfterApplied
                submitLabel="Save rule"
                submitUnchanged
                snapshot={{ revision, values: { command: "rank", channelIds: "", roleIds: "" } }}
                operation={(values) => {
                    const command = String(values.command)
                    if (!isLimitableCommand(command)) throw new FormInputError("Choose a command")
                    const operation = save(command, values)
                    if (!operation.channelIds.length && !operation.roleIds.length)
                        throw new FormInputError("Choose a channel or a role")
                    if (saved.length >= COMMAND_RULE_LIMIT && !saved.some((rule) => rule.command === command))
                        throw new FormInputError(`A server can have at most ${COMMAND_RULE_LIMIT} command rules`)
                    return operation
                }}
                fields={(values, edit, disabled) => (
                    <>
                        <label>
                            Command
                            <select
                                value={String(values.command)}
                                disabled={disabled}
                                onChange={(event) => edit("command", event.target.value)}
                            >
                                {LIMITABLE_COMMANDS.map((command) => (
                                    <option key={command} value={command}>
                                        !{command}
                                    </option>
                                ))}
                            </select>
                        </label>
                        {fields(values, edit, disabled)}
                    </>
                )}
            />
            {data.rules.map((rule) => {
                const { card } = rowCard(common, props.removedDefinitions, `rule:${rule.command}`)
                return (
                    <details key={rule.command}>
                        <summary>{summary(rule)}</summary>
                        <div className="role-section">
                            <ConfigForm<"commandrules">
                                {...card}
                                draftKey={`rule:${rule.command}`}
                                title={`Rule for !${rule.command}`}
                                description="Emptying both lists removes the rule"
                                snapshot={{
                                    revision,
                                    values: {
                                        channelIds: rule.channelIds.join(","),
                                        roleIds: rule.roleIds.join(","),
                                    },
                                }}
                                operation={(values) => save(rule.command, values)}
                                fields={fields}
                            />
                            <ConfigForm<"commandrules">
                                {...card}
                                draftKey={`rule-remove:${rule.command}`}
                                title={`Remove the rule for !${rule.command}`}
                                description="The command works everywhere for everyone again"
                                submitLabel="Remove rule"
                                submitUnchanged
                                snapshot={{ revision, values: {}, context: rule.updatedAt }}
                                operation={() => ({ type: "clear", command: rule.command })}
                                fields={() => null}
                            />
                        </div>
                    </details>
                )
            })}
        </div>
    )
}
