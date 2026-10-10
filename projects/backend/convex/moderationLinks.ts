import { domainMatches, domains } from "./moderationDomain.ts"

// Deceptive links, judged from the message text alone. The bot never visits a URL, and the lookalike data stays local

/** Domains every deceptive-links rule protects, beside the rule's own patterns */
export const protectedDomains = ["fluxer.app", "fluxer.gg", "discord.com", "discord.gg", "steamcommunity.com", "steampowered.com", "paypal.com", "github.com", "google.com", "youtube.com", "twitch.tv"]

// Greek, Cyrillic and Armenian letters that look like Latin ones, and digits that read as letters. A small subset of
// Unicode's confusable table that covers the common lookalikes, not the whole table
const lookalikes: Record<string, string> = {
    "а": "a", "с": "c", "ԁ": "d", "е": "e", "һ": "h", "і": "i", "ј": "j", "ӏ": "l", "о": "o", "р": "p", "ԛ": "q", "ѕ": "s", "у": "y", "х": "x", "ԝ": "w",
    "α": "a", "η": "n", "ι": "i", "κ": "k", "ν": "v", "ο": "o", "ρ": "p", "υ": "u", "χ": "x", "ω": "w",
    "հ": "h", "ո": "n", "ս": "u", "օ": "o", "ց": "g", "ɑ": "a", "ɡ": "g", "ı": "i", "0": "o", "1": "l",
}
const foreign = /[Ͱ-ϿЀ-ԯ԰-֏]/

/** One punycode label after its xn-- prefix, as RFC 3492 decodes it, or undefined when it is malformed */
function punycode(input: string) {
    const base = 36, tMin = 1, tMax = 26
    const split = input.lastIndexOf("-")
    const output = split > 0 ? [...input.slice(0, split)].map(c => c.codePointAt(0)!) : []
    let n = 128, i = 0, bias = 72
    for (let index = split > 0 ? split + 1 : 0; index < input.length;) {
        const old = i
        for (let w = 1, k = base; ; k += base) {
            if (index >= input.length) return undefined
            const c = input.charCodeAt(index++)
            const digit = c >= 48 && c <= 57 ? c - 22 : c >= 97 && c <= 122 ? c - 97 : c >= 65 && c <= 90 ? c - 65 : base
            if (digit >= base) return undefined
            i += digit * w
            const t = k <= bias ? tMin : k >= bias + tMax ? tMax : k - bias
            if (digit < t) break
            w *= base - t
        }
        const length = output.length + 1
        let delta = old === 0 ? Math.floor((i - old) / 700) : Math.floor((i - old) / 2)
        delta += Math.floor(delta / length)
        let k = 0
        for (; delta > 455; k += base) delta = Math.floor(delta / 35)
        bias = k + Math.floor(36 * delta / (delta + 38))
        n += Math.floor(i / length)
        i %= length
        if (n > 0x10ffff) return undefined
        output.splice(i++, 0, n)
    }
    return String.fromCodePoint(...output)
}
/** A host as it reads, with its xn-- labels decoded */
const readable = (host: string) => host.split(".").map(label => label.startsWith("xn--") ? punycode(label.slice(4)) ?? label : label)
/** What a host looks like: Each lookalike as its Latin letter, and rn and vv as m and w */
const skeleton = (value: string) => [...value].map(c => lookalikes[c] ?? c).join("").replace(/rn/g, "m").replace(/vv/g, "w")
/** At most one changed, added or removed character, or two swapped neighbors */
function oneEdit(a: string, b: string) {
    if (Math.abs(a.length - b.length) > 1) return false
    let start = 0
    while (start < a.length && a[start] === b[start]) start++
    if (start === a.length && a.length === b.length) return true
    if (a.length !== b.length) return (a.length > b.length ? a.slice(start + 1) === b.slice(start) : a.slice(start) === b.slice(start + 1))
    return a.slice(start + 1) === b.slice(start + 1) || a[start] === b[start + 1] && a[start + 1] === b[start] && a.slice(start + 2) === b.slice(start + 2)
}

/**
 * Whether a host imitates a protected domain or hides its script: A label that mixes Latin letters with Greek, Cyrillic or
 * Armenian ones, or is made only of lookalikes, a protected domain that starts another one, such as paypal.com.example.net,
 * and a host whose ending looks the same as a protected domain or one edit away from it. Short protected names of fewer than
 * six characters are compared only for an exact look, so nearby names stay usable. A protected domain and its subdomains never match
 */
export function imitates(host: string, protect: string[]) {
    if (domainMatches([host], protect)) return false
    const labels = readable(host), shown = labels.join(".")
    if (labels.some(label => foreign.test(label) && (/[a-z]/.test(label) || /^[\x21-\x7e]*$/.test(skeleton(label))))) return true
    return protect.some(domain => {
        const count = domain.split(".").length
        if (labels.length < count) return false
        const tail = skeleton(labels.slice(-count).join(".")), look = skeleton(domain)
        // A country ending, as in google.com.au, is the same organization
        return shown.startsWith(`${domain}.`) && !/^[a-z]{2}$/.test(shown.slice(domain.length + 1)) || tail === look || domain.length >= 6 && oneEdit(tail, look)
    })
}

const masked = /\[([^\]\n]{1,256})\]\(\s*<?(https?:\/\/[^\s<>()]+)>?\s*\)/gi
const named = /(https?:\/\/|\bwww\.)?((?:[^\s./:@[\]()<>]+\.)+[^\s./:@[\]()<>\d]{2,63})/i
function hostOf(url: string) {
    try { return new URL(url).hostname.toLowerCase().replace(/\.$/, "") } catch { return undefined }
}

/**
 * Whether a message holds a deceptive link: A masked link whose label names a different address than the link opens, or a
 * link to a host that imitates a protected domain. A label names an address when it has a scheme or www, or when its domain is
 * protected or imitates one, so plain labels such as file.txt are not addresses. A label and a link to the same site, or one a
 * subdomain of the other, match
 */
export function deceptiveLink(content: string, protect: string[]) {
    for (const match of content.matchAll(masked)) {
        const target = hostOf(match[2]!), label = named.exec(match[1]!), shown = label ? hostOf(`https://${label[2]}`) : undefined
        if (!target || !shown) continue
        const claims = label![1] !== undefined || domainMatches([shown], protect) || imitates(shown, protect)
        const opens = target.replace(/^www\./, ""), says = shown.replace(/^www\./, "")
        if (claims && opens !== says && !opens.endsWith(`.${says}`) && !says.endsWith(`.${opens}`)) return true
    }
    return domains(content).some(host => imitates(host, protect))
}
