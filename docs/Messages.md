# Messages

The Message Builder lets an authorized user compose a message, preview it, choose a text channel, and send it through the bot.

## What happens after Send

1. NeonFlux checks the message and saves the send request.
2. The connected bot sends the message to Fluxer with mentions disabled.
3. The dashboard shows whether the request is waiting, delivering, sent, not sent, or unconfirmed.

Delivery continues if you leave the page.

## Delivery results

| Result          | Meaning                                                                               |
| --------------- | ------------------------------------------------------------------------------------- |
| Queued          | The request is waiting for the connected bot.                                         |
| Delivering      | The bot is sending the message.                                                       |
| Sent            | Fluxer confirmed the message.                                                         |
| Not sent        | NeonFlux knows that nothing was sent, so you can revise the message and try again.    |
| Outcome unknown | Fluxer may have accepted the message, but NeonFlux did not receive a reliable answer. |

NeonFlux does not automatically retry an unconfirmed delivery because that could post a duplicate.
Check the channel, then record whether you found the message.
You can send a follow-up after accepting the duplicate risk.

## Mentions

User, role, and everyone mentions are disabled by default.
This also applies to copied text and message embeds.

## Templates

Templates follow the same permissions, delivery checks, and mention settings as a message you build from scratch.

For the service boundaries behind delivery, read [How NeonFlux works](How-NeonFlux-Works.md).
