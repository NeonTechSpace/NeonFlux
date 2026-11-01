---
title: Roles
description: Roles from reactions, a website menu, new joins and timers, all with the bot keeping track of what it gave
---

NeonFlux can give roles in several ways, listed in the table below. Reaction panels and a website menu let members choose, autorole and reservations act on joins, and temporary roles end by themselves. Reaction panels, the role picker and autorole each start off. For the rules role, see [Verification](./verification.md)

## How it works

- The bot needs Manage roles and a role above every role it assigns
- It assigns only roles with ordinary permissions, never the everyone role, privileged roles or staff roles, and it does not create roles
- Roles are added and removed one at a time, and unrelated roles are kept
- It removes a role only if it added it during the member's current stay and no other feature still needs it
- A role change Fluxer does not confirm is never repeated, and the next choice of that role waits until staff run the matching `reconcile` command
- Setup is for the owner or an Administrator, except temporary roles. Giving and ending them needs Manage roles, and `!temprole default` and `!temprole max` need Manage community

| Way            | Who picks                                       | Where                             |
| -------------- | ----------------------------------------------- | --------------------------------- |
| Reaction panel | The member reacts to a message                  | `!roles`, **Reaction roles**      |
| Role picker    | The member claims or drops roles on the website | `!rolepicker`, **Role picker**    |
| Autorole       | Nobody, new joins get it                        | `!autorole`, **Autorole**         |
| Reservation    | Nobody, a listed user gets it on join           | `!autorole reserve`, **Autorole** |
| Temporary role | Staff give it for a set time                    | `!temprole`, **Temporary roles**  |

## Set it up

### Reaction role panels

1. Write the panel message with `!publish create colors` and `!publish set colors content "Choose a color"`
2. Create the panel with `!roles create colors exclusive`, or `toggle` to allow any combination
3. Map emojis to roles with `!roles map colors 🔵 @Blue`
4. Post it with `!roles publish colors #roles colors`
5. Turn reaction roles on with `!roles module on`

A panel maps up to 20 emojis. Toggle panels allow any combination and exclusive panels allow one choice. Members can also use `!roles choose colors 🔵`, or `none` to clear

### Role picker

1. Add a menu with `!rolepicker menu add colors single "Pick one colour"`, or `multi` for several roles
2. Add roles with `!rolepicker menu role add colors @Red @Blue`
3. Turn it on with `!rolepicker on`

Members then open the dashboard for the server and use **Choose your roles**. Each menu shows **Claim** or **Drop** next to every role. In a single choice menu, claiming a role drops the member's other role from that menu

### Autorole and reservations

1. Add roles with `!autorole add @Newcomer`
2. Turn it on with `!autorole module on`
3. Optionally reserve roles for a user ID with `!autorole reserve <user-id> @Founder`

Autorole applies to future joins and to humans by default. `!autorole humans off` includes bots. When verification is configured, autorole waits for it

A reservation gives an exact user ID extra roles when that user joins or rejoins, even before they are a member. It does not change current members

### Temporary roles

Staff give a member a role for a set time, and NeonFlux removes it when the time ends

1. Give a role with `!temprole add @member @Winner 7d`
2. Optionally set defaults with `!temprole default @Winner 7d` and a longest time with `!temprole max @Winner 30d`

## Example

```text
Sam: !roles create colors exclusive
Sam: !roles map colors 🔵 @Blue
Sam: !roles map colors 🟢 @Green
Sam: !roles publish colors #roles colors
Sam: !roles module on

Jo reacts with 🔵 on the panel
Jo receives the Blue role
Jo reacts with 🟢 instead
Jo receives the Green role and loses Blue
```

## Commands

| Command                                                        | What it does                                                  |
| -------------------------------------------------------------- | ------------------------------------------------------------- |
| `!roles list`, `!roles show <name>`                            | Lists panels or shows one                                     |
| `!roles unmap <name> <emoji>`                                  | Removes a reaction's role                                     |
| `!roles requires\|excludes <name> <emoji> @roles...\|none`     | Requires or excludes roles for a choice                       |
| `!roles enable\|disable\|delete <name>`                        | Turns a panel on or off, or deletes it                        |
| `!roles retire <name>`                                         | Retires a posted panel and takes back its roles               |
| `!roles reconcile <name> [@user]`                              | Checks panel roles after an unconfirmed change. Administrator |
| `!rolepicker menu list`, `!rolepicker menu show <name>`        | Lists menus or shows one                                      |
| `!rolepicker menu remove <name>`                               | Removes a menu. Roles members chose stay                      |
| `!rolepicker access allow\|block role\|user <mentions or IDs>` | Controls who may use the picker                               |
| `!rolepicker reconcile @user`                                  | Checks an unconfirmed picker change. Administrator            |
| `!autorole list`, `!autorole remove @role`                     | Lists or removes autoroles                                    |
| `!autorole reservations`                                       | Lists reservations                                            |
| `!autorole unreserve <user-id>`                                | Removes a reservation. Roles already given stay               |
| `!temprole set @member @role <duration>`                       | Renews or shortens a grant, counted from now                  |
| `!temprole remove @member @role`                               | Ends a grant early and removes the role                       |
| `!temprole list [@member]`                                     | Lists grants, earliest end first                              |
| `!temprole reconcile @member`                                  | Settles grants after an unconfirmed change. Administrator     |

## Limits

- Each emoji and each role appears once on a panel, and a posted panel keeps at least one role
- Posting a panel again posts a fresh message, and the earlier message stops giving roles
- A server has up to 100 role picker menus holding up to 1,000 roles together, and a role belongs to one menu
- A block always wins over an allow in the role picker's access lists. With no allowed roles or users, every member who is not blocked may use it
- Members can send 10 claims or drops and 10 role checks a minute in each server
- Up to 200 users can have a reservation, with one to 20 roles each
- Autorole gives roles in rounds of five and Fluxer allows 20 role changes per server every 10 seconds, so a long list takes a while
- Temporary role durations run from 1 minute to 100 years, such as `30m`, `12h`, `7d`, `2w` or `1d12h`. A member holds one grant per role
- Only roles NeonFlux adds can become temporary, so a role the member already holds cannot
- A temporary role of a member who left is lost with the membership, and the grant waits until its end time
- A member who is timed out, quarantined or has not accepted configured rules cannot receive a temporary role
- Settled role history is kept for 180 days
