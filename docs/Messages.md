# Messages

The Message Builder lets an authorized user compose a message, preview it, choose a text channel, and send it through the bot.

## What happens after Send

1. The web app validates the message and saves a queued operation in Convex.
2. A bot worker claims that operation.
3. The worker records that sending has started.
4. The Fluxer adapter sends the validated message with mentions suppressed.
5. The worker records a final or uncertain result for the dashboard.

The dashboard shows queue and delivery state. Users do not need to understand the worker implementation.

## Delivery results

| Result             | Meaning                                                                               |
| ------------------ | ------------------------------------------------------------------------------------- |
| Sent               | Fluxer confirmed the message.                                                         |
| Failed             | NeonFlux knows Fluxer rejected it or that it was unsafe to attempt.                   |
| Waiting to retry   | The failure happened before sending, so a later attempt is safe.                      |
| Delivery uncertain | Fluxer may have accepted the message, but NeonFlux did not receive a reliable answer. |

An uncertain result is never retried automatically. An operator can record that the message was found, record that it was not found, or deliberately send a follow-up while accepting the duplicate risk. That decision is stored with the operation.

## Mentions

User, role, and everyone mentions are suppressed by the Fluxer adapter by default. This prevents copied text or advanced message JSON from unexpectedly notifying a server.

## Templates

Templates reuse the same validated outgoing-message format. They do not bypass authorization, durable delivery, or mention suppression.

For the service boundaries behind delivery, read [How NeonFlux works](How-NeonFlux-Works.md).
