---
title: Events
description: Staff post events with dates and reminders, and members RSVP in chat
---

Events let staff post a card for a gathering, with a date, an optional repeat, reminders and seats. Members reply Going, Maybe or Not going with a command. Events start off

## How it works

Staff create an event as a draft, set its time, then publish it. Publishing posts one card in the event's channel. The card shows the next date that has not ended and how the event repeats

Each date gets a number. Members RSVP to the next open date, or to a date by its number

- **Going** takes a seat, or a place on the waitlist when the event is full
- **Maybe**, **Not going** and **none** use no seat
- RSVPs close when a date starts or the event is cancelled
- A waitlisted member moves up when a seat frees, if still in the server and cleared by verification

Times use an exact local minute and a time zone, such as `Europe/Berlin`. Members see each date in their own timezone

### Reminders

Reminders go out 1440 and 60 minutes before the start by default. A reminder that is already past when it would be set up is skipped. One that is late by more than five minutes is not sent

Changing a published event's time moves its upcoming dates and edits the card. Members who replied Going or Maybe get a DM that lists their changed dates. Cancelling the whole event sends no DM

### Repeats and discussion threads

An event can repeat daily or weekly, for a number of dates, until a day, or with no end. A time that does not exist on a repeat date, such as when clocks change, is skipped

Discussion threads start off. With `!event threads on`, each event published afterwards gets a thread on its card. The thread closes when the event ends or is cancelled

A forum or media channel can be the destination. The card then becomes a forum post, and members run event commands in any post of that forum

## Set it up

1. Open the **Events** section of the dashboard for the server, or use the chat commands below
2. Create the event with a short name, a channel and a title
3. Set the first date, the time zone and the length in minutes
4. Optionally add a repeat, seats and reminders
5. Turn the module on with `!event module on`
6. Publish with `!event publish <name>`

The dashboard form also sets **Ends** for a repeat, and the same discussion threads switch

## Example

```text
Mod:   !event create study #study-hall "Study group" "Bring questions"
Mod:   !event time study 2026-11-01T18:00 Europe/Berlin 60 reject
Mod:   !event repeat study weekly 1 4
Mod:   !event dates study
Mod:   !event module on
Mod:   !event publish study

Rin:   !event rsvp study going
```

The bot answers Rin with the event name, the date in Rin's own timezone and the recorded reply. `reject` means a date whose local time happens twice on a clock change is skipped rather than guessed, and a first date like that is refused

## Commands

Members use the first six rows. The rest are for owners and Administrators

| Command                                                                                | What it does                                                      |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `!event list [next]`                                                                   | List events in this channel                                       |
| `!event show <name>`                                                                   | Show one event                                                    |
| `!event dates <name> [next]`                                                           | List the dates and their numbers                                  |
| `!event rsvp <name> [date] going\|maybe\|not-going\|none`                              | Answer for the next open date, or for one date by its number      |
| `!event mine`                                                                          | List the member's Going and Maybe replies here                    |
| `!event attendees <name> <date> [next]`                                                | List attendees and the waitlist                                   |
| `!event create <name> #channel "title" ["description"]`                                | Create a draft                                                    |
| `!event time <name> YYYY-MM-DDTHH:mm <zone> <minutes> [reject\|earlier\|later]`        | Set the first date and length                                     |
| `!event repeat <name> off\|daily\|weekly <every> [<dates>\|until YYYY-MM-DD\|ongoing]` | Set a repeat                                                      |
| `!event move <name> <date> YYYY-MM-DDTHH:mm [reject\|earlier\|later]`                  | Move one date that has not started                                |
| `!event title <name> "title" ["description"]`                                          | Change the text                                                   |
| `!event template <name> <template>\|off`                                               | Use a publishing template for the card                            |
| `!event capacity <name> off\|<seats>`                                                  | Limit Going seats                                                 |
| `!event reminders <name> off\|<minutes> [minutes ...]`                                 | Set reminders, in minutes before the start                        |
| `!event publish <name>`                                                                | Post the card                                                     |
| `!event cancel <name>`                                                                 | Cancel the event                                                  |
| `!event status [<name> [next]]`                                                        | Show whether events are on, or one event's card and reminders     |
| `!event reconcile <name> [post-number]`                                                | Recheck a card or reminder that was not confirmed                 |
| `!event forget <name> [confirm]`                                                       | Remove an ended event's data                                      |
| `!event module on\|off`                                                                | Turn events on or off                                             |
| `!event threads on\|off`                                                               | Turn discussion threads on or off for events published afterwards |

## Limits

- An event name has up to 32 lowercase letters, numbers, underscores or hyphens
- A title has up to 256 characters and a description up to 1000
- A server keeps up to 50 events that are not cancelled or completed
- A reminder list has up to 20 entries
- A repeating event's reminders reach at most 179 days ahead, and less for daily repeats
- Capacity cannot drop below the Going replies of a date that has not started
- Cancelling or turning events off never deletes or edits posted messages
- RSVPs are kept 30 days after a date ends, and ended event history 180 days
- Automatic cards and reminders pause while the server is at DEFCON 2 or the module is off
- Events do not run in direct messages
