---
title: Automod
description: Rules that catch spam, mention floods, bad links and blocked words, with a dry run to test them first
---

Automod checks every message against the server's rules and can log it, delete it, warn the author or time them out. It starts off and in `dry-run` mode, which records what rules catch without acting. Test the rules first, then switch to `enforce`

## How it works

- A rule has a name, a type, an action and sometimes patterns
- Actions are `log`, `delete`, `warn` and `timeout`
- Staff and members in exempt roles are never sanctioned, and exempt channels are skipped
- A message gets at most one automated sanction across automod and [security](./moderation.md)
- When NeonFlux lacks the permission or role position to act on an author, an enforcing rule logs the case instead
- Webhook and bot messages are skipped unless `!automod bots on` is set

### Rule types

| Type              | Catches                                                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `spam`            | Too many messages in a window, 5 in 10 seconds by default                                                                       |
| `repeat`          | The same message repeated, 3 in 30 seconds by default                                                                           |
| `mentions`        | Too many mentions in one message, 5 by default                                                                                  |
| `mention-rate`    | Mentions added up across messages in a window, 10 in 30 seconds by default                                                      |
| `link-rate`       | Links added up across messages in a window, 6 in 30 seconds by default                                                          |
| `words`           | Blocked words or phrases from the rule's patterns                                                                               |
| `domains`         | Links to listed hosts, or to any host not listed                                                                                |
| `invites`         | Server invite links                                                                                                             |
| `deceptive-links` | Masked links whose label names another address, addresses hidden in a link's user name, and hosts that imitate well-known sites |

## Set it up

1. Create a rule, for example `!automod create links domains delete "example.org"`
2. Check the rule with `!automod show links`
3. Turn automod on with `!automod module on`. The mode stays `dry-run`, so nothing is acted on
4. Watch for a while. Each catch shows in `!mod list` as a log-only case marked `(dry run)`
5. Switch to `!automod mode enforce` when the rules catch the right messages

The dashboard has the same settings under **Moderation and safety**, in the **Automod policy** form. Lists longer than one message holds, such as many patterns, are easier to set there, where several can be pasted at once

## Example

```text
Sam: !automod create repeated repeat log
Sam: !automod create prohibited words warn "free nitro"
Sam: !automod create links domains delete "example.org"
Sam: !automod module on
Sam: !automod mode enforce
```

The first rule logs repeated messages. The second warns anyone who writes `free nitro` as a whole phrase. The third deletes messages with links to the listed domain, since `domains` rules default to blocking the listed hosts

## Commands

| Command                                                                                     | What it does                                 |
| ------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `!automod create <name> <type> <action> ["pattern"...]`                                     | Adds a rule                                  |
| `!automod list`, `!automod show <name>`                                                     | Lists rules or shows one                     |
| `!automod update <name> action\|threshold\|window\|duration\|priority\|domain-mode <value>` | Changes a setting                            |
| `!automod update <name> patterns "first" "second"`                                          | Replaces the patterns. `none` clears them    |
| `!automod update <name> patterns add\|remove "first"`                                       | Adds or removes some patterns                |
| `!automod update <name> channels\|exempt-channels\|exempt-roles <mentions or IDs>...\|all`  | Sets where the rule applies and who it skips |
| `!automod enable\|disable\|delete <name>`                                                   | Turns a rule on or off, or deletes it        |
| `!automod module on\|off`                                                                   | Turns automod on or off                      |
| `!automod mode dry-run\|enforce`                                                            | Chooses between recording and acting         |
| `!automod bots on\|off`                                                                     | Checks webhook and bot messages too          |
| `!automod status`                                                                           | Shows whether automod is on and its mode     |

## Patterns

- Patterns are literal text, not regular expressions
- A `words` pattern matches whole words, so `bad` catches `that is bad!` but not `badge`
- A `*` at the start or end lifts that edge, so `cat*` also catches `cats` and `*cat` catches `bobcat`
- Matching ignores case, so `BAD` matches `bad`
- Words in scripts written without spaces, such as Chinese, Japanese and Thai, match inside text
- In `domains` rules, `block` mode matches listed hosts and their subdomains, and `allow` mode flags any other host
- NeonFlux never visits a link

## Limits

- Thresholds allow 1 to 100, windows 1 to 300 seconds and priority -100 to 100
- A server holds up to 100 rules and 2000 patterns across all rules. Each rule holds up to 1000 patterns of up to 200 characters
- Replies name the first 20 patterns, channels or roles of a list and count the rest
- Warnings from automod count toward the [warning limit](./moderation.md#warning-limit), but in dry run the limit only logs
- With `!automod bots on`, a bot message has no member to warn or time out, so `warn` only logs and `timeout` deletes the message
