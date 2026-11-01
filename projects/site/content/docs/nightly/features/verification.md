---
title: Verification
description: Members accept the server rules to get an access role, with an optional browser challenge
---

Rules verification gives new members an access role once they accept the rules. A member reacts to a rules message or sends `!verify`. With advanced verification on, the member also passes a short challenge in the browser

## How it works

- Staff post a rules message and map a reaction on it to an access role
- A member who reacts or sends `!verify` gets the role, or a private link to the challenge when advanced verification is on
- `!verify status` shows whether the acceptance was saved and the role granted
- The bot gives only ordinary roles, never the everyone role or a staff role, and needs Manage roles with a role above the access role
- Autorole waits for verification when it is configured. See [Roles](./roles.md)

Plain reaction verification is an acknowledgement, not a CAPTCHA. While the rules panel has a role or a published message, member features such as role grants, temporary roles, events and birthday consent wait until a member accepts the rules, even with verification off

### Advanced verification

Advanced verification replaces the plain reaction with a browser challenge called Guide the spark

1. The member opens the private link, signs in and passes a Cloudflare Turnstile check
2. The member presses Start
3. The member drags the glowing spark, with a mouse, touch or arrow keys, along the current into the goal ring
4. The bot gives the role once the server confirms the answer

- A link expires after ten minutes
- Start sets one 90-second deadline with two attempts, and reloading does not restart it
- A link opened under another Fluxer account says to sign out and sign in as the account that received it
- The **Request staff assistance** block on the page shows a reference that staff use with `!verify review <reference>`

> **Experimental:** The challenge targets solving from a single screenshot. It does not stop screen recordings, browser automation or scripts, and following a moving current can exclude some people. Keep staff assistance available

Running the dashboard with this challenge needs a Turnstile key, as described in [dashboard setup](../self-hosting/dashboard.md)

## Set it up

1. Write the rules message as a draft with `!publish create rules`, then `!publish set rules content "Read and accept the current server rules"`
2. Choose the access role and reaction with `!verify configure @Member ✅`
3. Post the panel with `!verify publish #rules rules`
4. Turn it on with `!verify module on`
5. Run `!health` and `!setup` to check that NeonFlux has the permissions and the panel is published

The dashboard has the same settings under **Verification**. Its **Advanced visual challenge** switch turns on the browser challenge

## Example

```text
Sam: !verify configure @Member ✅
Sam: !verify publish #rules rules
Sam: !verify module on

Jo reacts with ✅ on the rules message
Jo receives the Member role
```

With advanced verification on, Jo instead receives a private link, signs in to the dashboard with the same Fluxer account and completes the challenge before the role is given

## Commands

| Command                                 | What it does                                                                        |
| --------------------------------------- | ----------------------------------------------------------------------------------- |
| `!verify`                               | Gives the next step to a member, whether to react, open the link or nothing is left |
| `!verify status`                        | Shows whether the acceptance was saved and the role granted                         |
| `!verify configure @role <emoji>`       | Chooses the access role and reaction. Owner or Administrator                        |
| `!verify publish #channel <draft-name>` | Posts the rules panel from a draft                                                  |
| `!verify module on\|off`                | Turns rules verification on or off                                                  |
| `!verify review <reference>`            | Helps a member who cannot finish the challenge. Administrator                       |
| `!verify reconcile [@user]`             | Checks access roles after an unconfirmed change. Administrator                      |
| `!verify withdraw [@user]`              | Takes a member's access role back. Administrator                                    |
| `!verify retire`                        | Retires the rules panel and takes back its roles. Administrator                     |

## Limits

- Each server issues at most 500 new challenge links an hour
- A role change Fluxer does not confirm is never repeated, so staff check it with `!verify reconcile`
- `!health` warns when a role feature is on while the server has a Fluxer verification level, since Fluxer skips that level for any member who holds a role
