import { domainMatches, hostname, links } from "./moderationDomain.ts"

// Deceptive links, judged from the message text alone. The bot never visits a URL, and the lookalike data stays local

/** Domains every deceptive-links rule protects, beside the rule's own patterns */
export const protectedDomains = [
    "fluxer.app",
    "fluxer.gg",
    "discord.com",
    "discord.gg",
    "steamcommunity.com",
    "steampowered.com",
    "paypal.com",
    "github.com",
    "google.com",
    "youtube.com",
    "twitch.tv",
]
const builtIn = new Set(protectedDomains)

// The domains the owner of each built-in protected domain really runs under its own name or links to in place of it. A
// server's own patterns have no row, since only that server knows what else it runs
const owners = [
    [
        "discord.com",
        "discord.gg",
        "discord.gift",
        "discord.new",
        "discord.media",
        "discord.dev",
        "discordapp.com",
        "discordapp.net",
        "dis.gd",
    ],
    ["fluxer.app", "fluxer.gg"],
    ["steamcommunity.com", "steampowered.com", "s.team"],
    ["paypal.com", "paypal.me", "paypal.de", "paypal.fr", "paypal.es", "paypal.it", "paypal.co.uk", "paypal.com.au"],
    ["github.com", "github.io", "github.blog", "github.dev", "github.community", "githubusercontent.com"],
    ["google.com", "google.org", "google.net", "google.dev", "google.cloud", "google.blog"],
    ["youtube.com", "youtu.be", "youtube.tv", "youtube.de", "youtube.fr", "youtube.es", "youtube.it", "youtube.co.uk"],
    ["twitch.tv", "twitch.com"],
]
const ownerOf = new Map(owners.flatMap((row) => row.map((domain) => [domain, row] as const)))
// Hosts where anyone can publish, so a link there can be a stranger's page and a label that names the host's owner does not vouch
// for it
const publicHosting = new Set([
    "github.io",
    "githubusercontent.com",
    "discordapp.com",
    "discordapp.net",
    "pages.dev",
    "workers.dev",
    "netlify.app",
    "vercel.app",
    "web.app",
    "firebaseapp.com",
    "herokuapp.com",
    "onrender.com",
])
// Google runs a site under nearly every country ending, as in google.de and google.co.uk
const googleCountry = /^google\.(?:com?\.)?[a-z]{2}$/
const ownerFor = (site: string) => ownerOf.get(googleCountry.test(site) ? "google.com" : site)
// Long-running third-party sites that are named after a brand with another ending, which members link in good faith
const namesakes = new Set(["discord.me", "discord.bio", "discords.com"])
// Endings that never resolve on the public internet, so a name under one reaches only its own network
const reserved = /^(?:local|localhost|internal|lan)$/
// Words phishing hosts add to a brand's name: Account takeover, money, prizes, trades and claims of authority. Free is left
// out, since tools and fan sites use it, and com is the ending written into a name, as in paypal-com.example.net
const lures = new Set(
    [
        "login signin password verify verification secure security account recovery support appeal copyright",
        "refund billing payment invoice wallet",
        "gift giveaway nitro premium reward promo claim drop",
        "trade tradeoffer",
        "staff moderator official",
        "com",
    ].flatMap((group) => group.split(" ")),
)
// Words that mark a name as somebody's tool or guide about the brand, not a page pretending to be it
const toolWords = new Set(["bot", "bots", "api", "sdk", "js", "py", "wiki", "guide"])
const isLure = (word: string) => lures.has(word.endsWith("s") ? word.slice(0, -1) : word)
// Endings a label must have to count as a bare address, since file names such as notes.txt and bot.ts look alike. Common
// web endings only, none of which is a common file type
const webEnding = /\.(?:com|net|org|edu|gov|info|io|co|gg|tv|me|dev|app|xyz|uk|de|fr|ru|jp)$/

// Greek, Cyrillic and Armenian letters that look like Latin ones, and digits that read as letters. A small subset of
// Unicode's confusable table that covers the common lookalikes, not the whole table
const lookalikes: Record<string, string> = {
    а: "a",
    с: "c",
    ԁ: "d",
    е: "e",
    һ: "h",
    і: "i",
    ј: "j",
    ӏ: "l",
    о: "o",
    р: "p",
    ԛ: "q",
    ѕ: "s",
    у: "y",
    х: "x",
    ԝ: "w",
    α: "a",
    η: "n",
    ι: "i",
    κ: "k",
    ν: "v",
    ο: "o",
    ρ: "p",
    υ: "u",
    χ: "x",
    ω: "w",
    հ: "h",
    ո: "n",
    ս: "u",
    օ: "o",
    ց: "g",
    ɑ: "a",
    ɡ: "g",
    ı: "i",
    "0": "o",
    "1": "l",
}
const foreign = /[Ͱ-ϿЀ-ԯ԰-֏]/

/** One punycode label after its xn-- prefix, as RFC 3492 decodes it, or undefined when it is malformed */
function punycode(input: string) {
    const base = 36,
        tMin = 1,
        tMax = 26
    const split = input.lastIndexOf("-")
    // oxlint-disable-next-line typescript/no-misused-spread -- Punycode works on code points (RFC 3492)
    const output = split > 0 ? [...input.slice(0, split)].map((c) => c.codePointAt(0)!) : []
    let n = 128,
        i = 0,
        bias = 72
    for (let index = split > 0 ? split + 1 : 0; index < input.length;) {
        const old = i
        for (let w = 1, k = base; ; k += base) {
            if (index >= input.length) return undefined
            const c = input.charCodeAt(index++)
            const digit =
                c >= 48 && c <= 57 ? c - 22 : c >= 97 && c <= 122 ? c - 97 : c >= 65 && c <= 90 ? c - 65 : base
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
        bias = k + Math.floor((36 * delta) / (delta + 38))
        n += Math.floor(i / length)
        i %= length
        if (n > 0x10ffff) return undefined
        output.splice(i++, 0, n)
    }
    return String.fromCodePoint(...output)
}
/** A host as it reads, with its xn-- labels decoded */
const readable = (host: string) =>
    host.split(".").map((label) => (label.startsWith("xn--") ? (punycode(label.slice(4)) ?? label) : label))
/** What a host looks like: Each lookalike as its Latin letter, and rn and vv as m and w */
const skeleton = (value: string) =>
    // oxlint-disable-next-line typescript/no-misused-spread -- Lookalikes fold one code point at a time
    [...value]
        .map((c) => lookalikes[c] ?? c)
        .join("")
        .replace(/rn/g, "m")
        .replace(/vv/g, "w")
/** How a name reads on screen, where cl can pass for d and l for i */
const reads = (value: string) => skeleton(value).replace(/cl/g, "d").replace(/l/g, "i")
/** How many labels end a host: One, or a country's two, as in example.co.uk */
const endingSize = (labels: string[]) =>
    labels.length > 2 && labels.at(-1)!.length === 2 && /^(?:com?|net|org|ne|or|ac|edu|gov)$/.test(labels.at(-2)!)
        ? 2
        : 1
/** The domain a host is registered under, as far as its ending shows */
const siteOf = (labels: string[]) => labels.slice(-endingSize(labels) - 1).join(".")
const brands = protectedDomains.map((domain) => {
    const word = domain.slice(0, domain.indexOf("."))
    return { domain, word, look: reads(word) }
})
/**
 * Whether the labels before a host's ending borrow a built-in brand: A registered name that reads as the brand under an ending the
 * owner does not run, or the brand's word beside a lure word, whole or glued together, unless a tool word says the name is about
 * the brand. Steam is an everyday word and real fan sites such as steamgifts.com use it, so it counts only in a name with a hyphen
 */
function borrows(parts: string[], protect: string[]) {
    const name = parts.at(-1)
    if (name === undefined) return false
    const whole = reads(name.replaceAll("-", "")),
        pieces = parts.flatMap((part) => part.split("-")),
        heard = pieces.map(reads),
        tool = pieces.some((piece) => toolWords.has(piece)),
        lure = pieces.some(isLure)
    const beside = (word: string, look: string) =>
        !tool &&
        ((lure && heard.includes(look)) ||
            pieces.some(
                (piece) =>
                    (piece.startsWith(word) && isLure(piece.slice(word.length))) ||
                    (piece.endsWith(word) && isLure(piece.slice(0, -word.length))),
            ))
    return brands.some(
        ({ domain, word, look }) =>
            protect.includes(domain) &&
            (whole === look ||
                beside(word, look) ||
                (word.startsWith("steam") && parts.some((part) => part.includes("-")) && beside("steam", "steam"))),
    )
}
/** At most one changed, added or removed character, or two swapped neighbors */
function oneEdit(a: string, b: string) {
    if (Math.abs(a.length - b.length) > 1) return false
    let start = 0
    while (start < a.length && a[start] === b[start]) start++
    if (start === a.length && a.length === b.length) return true
    if (a.length !== b.length)
        return a.length > b.length ? a.slice(start + 1) === b.slice(start) : a.slice(start) === b.slice(start + 1)
    return (
        a.slice(start + 1) === b.slice(start + 1) ||
        (a[start] === b[start + 1] && a[start + 1] === b[start] && a.slice(start + 2) === b.slice(start + 2))
    )
}

/**
 * Whether a host imitates a protected domain or hides its script: A label that mixes Latin letters with Greek, Cyrillic or
 * Armenian ones, or is made only of lookalikes under a Latin ending, a protected domain written in front of more of the host, such
 * as paypal.com.example.net or paypal.com-example.net, a host whose ending looks the same as a protected domain or one edit away
 * from it, and a host that borrows a built-in brand. Short protected names of fewer than six characters are compared only for an
 * exact look, so nearby names stay usable. A protected domain, its subdomains
 * and the domains its owner runs never match, except that a tenant of its public hosting is still read for a hidden script or a
 * protected domain in front. A label may be a file name such as discord.js, so a caller reading one can leave
 * out the brand check
 */
export function imitates(host: string, protect: string[], brandCheck = true) {
    const labels = readable(host),
        site = siteOf(labels)
    if (domainMatches([host], protect) || (ownerFor(site) && !publicHosting.has(site)) || namesakes.has(site))
        return false
    const latinEnding = /^[a-z]/.test(labels.at(-1)!)
    if (
        labels.some(
            (label) =>
                foreign.test(label) && (/[a-z]/.test(label) || (latinEnding && /^[\x21-\x7e]*$/.test(skeleton(label)))),
        )
    )
        return true
    const dashed = `.${labels.join(".").replaceAll("-", ".")}`,
        parts = labels.slice(0, -endingSize(labels))
    const lookalike = protect.some((domain) => {
        const spot = `.${domain.replaceAll("-", ".")}.`,
            front = dashed.indexOf(spot)
        // A country ending on a server's own domain, as in example.org.uk, may be the same organization
        if (front !== -1 && (builtIn.has(domain) || !/^[a-z]{2}$/.test(dashed.slice(front + spot.length)))) return true
        const count = domain.split(".").length
        if (labels.length >= count) {
            const tail = skeleton(labels.slice(-count).join(".")),
                look = skeleton(domain)
            return tail === look || (domain.length >= 6 && oneEdit(tail, look))
        }
        return false
    })
    return lookalike || (brandCheck && !ownerFor(site) && !reserved.test(labels.at(-1)!) && borrows(parts, protect))
}

const masked = /\[([^\]\n]{1,256})\]\(\s*<?(https?:\/\/[^\s<>()]+)>?\s*\)/gi
const named = /(https?:\/\/|\bwww\.)?((?:[^\s./:@[\]()<>]+\.)+[\p{L}\p{M}-]{2,63})/iu
// A label with one of these endings and no path is a file name, such as google.ts, although the same ending is a country's elsewhere
const codeFile = /\.(?:c|h|cs|go|js|kt|md|py|rb|rs|sh|ts)$/
function hostOf(url: string) {
    try {
        return new URL(url).hostname.toLowerCase().replace(/\.$/, "")
    } catch {
        return undefined
    }
}

/**
 * Whether a link's host and the host its label names are the same site, one a subdomain of the other, or belong to one owner, as
 * youtu.be and youtube.com do. A link on public hosting must be the very host the label names or the hosting itself, since its tenants are strangers. A
 * label with a scheme or www names one exact address, so only a bare label may also match another subdomain of its registered domain
 */
function sameSite(link: string, label: string, exact: boolean, wholeHost: boolean) {
    const opens = link.replace(/^www\./, ""),
        says = label.replace(/^www\./, ""),
        linkSite = siteOf(opens.split(".")),
        labelSite = siteOf(says.split("."))
    // Naming a host itself, or only the hosting a tenant lives on, says nothing false
    if (opens === says || (wholeHost && says === linkSite)) return true
    if (publicHosting.has(linkSite)) return false
    return (
        opens.endsWith(`.${says}`) ||
        says.endsWith(`.${opens}`) ||
        (!exact && linkSite === labelSite) ||
        (ownerFor(linkSite) !== undefined && ownerFor(linkSite) === ownerFor(labelSite))
    )
}
/** Whether a link's user name or password reads as an address, as in https://discord.com@example.net, which opens example.net */
function hidesHost(url: URL, protect: string[]) {
    if (!url.username && !url.password) return false
    const host = hostname(url)
    const site = siteOf(host.split("."))
    if (domainMatches([host], protect) || (ownerFor(site) && !publicHosting.has(site))) return false
    return [url.username, url.password].some((part) => {
        const name = part.split("%")[0]!.toLowerCase()
        return webEnding.test(name) || domainMatches([name], protect) || imitates(name, protect)
    })
}
/**
 * Whether a whole label is one lowercase bare address with a common web ending and a subdomain or a path, such as
 * docs.example.org or example.org/guide. Capitals read as a product name, such as Battle.net, and a plain name such as
 * socket.io can name a project whose code lives elsewhere
 */
function bareAddress(text: string) {
    const label = named.exec(text.trim())
    return (
        label?.index === 0 &&
        !/\s/.test(text.trim()) &&
        label[2] === label[2]!.toLowerCase() &&
        webEnding.test(label[2]!) &&
        (label[2]!.split(".").length > 2 || text.includes("/"))
    )
}

/**
 * Whether a message holds a deceptive link: A masked link whose label names a different address than the link opens, a link to a
 * host that imitates a protected domain, or a link whose user name reads as an address. A label names an address when it has a
 * scheme or www, when its domain is protected, run by a protected domain's owner or imitates one, or when the whole label is a
 * bare address with a common web ending and a subdomain or a path, so labels such as file.txt and socket.io are not addresses
 */
export function deceptiveLink(content: string, protect: string[]) {
    for (const match of content.matchAll(masked)) {
        // A label's markup, such as **bold** or `code`, is not part of the address it names
        const text = match[1]!.replace(/^[*_~`|"']+|[*_~`|"']+$/g, ""),
            target = hostOf(match[2]!),
            label = named.exec(text),
            shown = label ? hostOf(`https://${label[2]}`) : undefined
        if (!target || !shown) continue
        if (label![1] === undefined && !text.includes("/") && codeFile.test(label![2]!)) continue
        const claims =
            label![1] !== undefined ||
            domainMatches([shown], protect) ||
            ownerFor(siteOf(shown.split("."))) !== undefined ||
            imitates(shown, protect, webEnding.test(label![2]!)) ||
            bareAddress(text)
        if (claims && !sameSite(target, shown, label![1] !== undefined, !text.includes("/"))) return true
    }
    return links(content).some((url) => imitates(hostname(url), protect) || hidesHost(url, protect))
}
