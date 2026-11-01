---
title: NeonFlux docs
description: An open-source bot for Fluxer, for one server or many
---

## First commands

Most features are off until a server turns them on. Send these in a staff channel, in this order:

1. `!help` lists the available commands
2. `!setup` shows what is on, what is missing and what is off
3. `!setup tickets`, or any other feature name, shows that feature's next step
4. `!health permissions` names any permission NeonFlux lacks

[First steps](./features/first-steps.md) walks through the rest, including the dashboard

## Common tasks

- [Stop spam, mention floods and bad links](./features/automod.md)
- [Warn, time out or ban with a record of why](./features/moderation.md)
- [Check new members before they can post](./features/verification.md)
- [Greet people who join](./features/welcome.md)
- [Let members pick their own roles](./features/roles.md)
- [Give members a private line to staff](./features/tickets.md)
- [Run events with RSVPs and reminders](./features/events.md)

## Host it yourself

Running NeonFlux takes the backend, then the bot, and optionally the dashboard. The [overview](./self-hosting/overview.md) lists what is needed before starting

## When something is wrong

- `!health` shows whether NeonFlux reaches Fluxer and its data service
- `!recovery` counts what failed or still needs doing, by area
