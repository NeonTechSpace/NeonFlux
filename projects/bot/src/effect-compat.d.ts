import type { TextDecoder } from "node:util"

declare global {
    // Effect 4.0.0 references this DOM type even in Node-only applications
    // Remove the alias when Effect no longer requires the missing global type
    type TextDecoderOptions = NonNullable<ConstructorParameters<typeof TextDecoder>[1]>
}
