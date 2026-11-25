import { useId } from "react"

/** NeonFlux angular robot emblem, shared by the topbar, sign-in, access and verification views */
export function BrandMark({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
    const gradientId = useId()
    const glowId = useId()
    return (
        <span className={`brand-mark brand-mark-${size}`} aria-hidden="true">
            <svg viewBox="0 0 40 40" fill="none">
                <defs>
                    <linearGradient id={gradientId} x1="4" y1="4" x2="36" y2="36" gradientUnits="userSpaceOnUse">
                        <stop offset="0%" stopColor="#38e8ff" />
                        <stop offset="52%" stopColor="#6ea0ff" />
                        <stop offset="100%" stopColor="#b07fff" />
                    </linearGradient>
                    <linearGradient id={glowId} x1="10" y1="16" x2="30" y2="26" gradientUnits="userSpaceOnUse">
                        <stop offset="0%" stopColor="#7cf7ff" />
                        <stop offset="100%" stopColor="#d8b4fe" />
                    </linearGradient>
                </defs>
                {/* Angular antenna crest */}
                <path d="M20 4.5L23.5 9.5H16.5L20 4.5Z" fill={`url(#${gradientId})`} />
                {/* Chamfered robotic chassis */}
                <path
                    d="M11 10.5H29L34.5 16V27.5L29 33.5H11L5.5 27.5V16L11 10.5Z"
                    fill="#0d1025"
                    stroke={`url(#${gradientId})`}
                    strokeWidth="2.2"
                    strokeLinejoin="round"
                />
                {/* Side ear pods */}
                <path d="M3 18.5H5.5V25H3V18.5ZM34.5 18.5H37V25H34.5V18.5Z" fill={`url(#${gradientId})`} />
                {/* Visor frame */}
                <path
                    d="M11.5 16.5H28.5L30.5 19V24.5L28.5 26.5H11.5L9.5 24.5V19L11.5 16.5Z"
                    fill="#151938"
                    stroke="rgb(110 160 255 / 45%)"
                    strokeWidth="1.1"
                />
                {/* Luminous twin angular eyes */}
                <path d="M13 20L17.5 19.2V23.8L13 23V20Z" fill={`url(#${glowId})`} />
                <path d="M27 20L22.5 19.2V23.8L27 23V20Z" fill={`url(#${glowId})`} />
                {/* Signal mouth notch */}
                <path d="M16.5 29.5H23.5" stroke={`url(#${gradientId})`} strokeWidth="2" strokeLinecap="round" />
            </svg>
        </span>
    )
}
