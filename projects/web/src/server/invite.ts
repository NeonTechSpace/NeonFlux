import { authorizeUrl } from "./auth.ts"

// Permissions NeonFlux's features use, requested when a server admin adds the bot. The web package does not depend on
// the SDK, so the bits are named here by their Fluxer permission names
// Fluxer lets the bot deny only permissions it holds, so channel locks need the thread ones to cover threads
const bit = (position: bigint) => 1n << position
const NEONFLUX_BOT_PERMISSIONS =
    bit(1n) | // Kick members
    bit(2n) | // Ban members
    bit(4n) | // Manage channels
    bit(6n) | // Add reactions
    bit(7n) | // View activity log
    bit(10n) | // View channel
    bit(11n) | // Send messages
    bit(13n) | // Manage messages
    bit(14n) | // Embed links
    bit(16n) | // Read message history
    bit(28n) | // Manage roles
    bit(35n) | // Create public threads
    bit(36n) | // Create private threads
    bit(38n) | // Send messages in threads
    bit(40n) // Time out members

// Hosted Fluxer API. Sign-in discovery accepts only this host, so the invite link uses the same authorize route
const hostedFluxerApi = "https://api.fluxer.app"
export function inviteUrl(clientId: string): string {
    return authorizeUrl(
        hostedFluxerApi,
        new URLSearchParams({ client_id: clientId, scope: "bot", permissions: String(NEONFLUX_BOT_PERMISSIONS) }),
    )
}
