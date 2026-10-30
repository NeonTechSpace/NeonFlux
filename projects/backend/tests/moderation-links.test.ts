import assert from "node:assert/strict"
import { test } from "node:test"
import { domainToASCII } from "node:url"
import { deceptiveLink, imitates, protectedDomains } from "../convex/moderationLinks.ts"

const protect = [...protectedDomains, "example.org"]

test("A masked link whose label names another address is deceptive, and one that names its own site or no address is not", () => {
    for (const content of [
        "[https://discord.com/gifts](https://evil.test/gift)",
        "Free [www.paypal.com](<https://evil.test>)",
        "[discord.com/nitro](https://discord.com.evil.test)",
        "[example.org](https://evil.test)",
    ])
        assert.equal(deceptiveLink(content, protect), true, content)
    for (const content of [
        "[click here](https://evil.test)",
        "[github.com](https://github.com/x)",
        "[www.github.com](https://github.com)",
        "[docs](https://docs.github.com)",
        "[file.txt](https://example.net/file.txt)",
        "[https://blog.example.net](https://example.net/blog)",
        "No links at all",
    ])
        assert.equal(deceptiveLink(content, protect), false, content)
})

test("Hosts that mix scripts, look like a protected domain or sit one edit away from it imitate it", () => {
    // Fluxer and browsers turn Unicode hosts into xn-- labels, which the check reads back
    for (const host of [
        domainToASCII("pаypal.com"),
        domainToASCII("dіscord.gg"),
        domainToASCII("аррӏе.test"),
        "dlscord.com",
        "steamcomrnunity.com",
        "githbu.com",
        "examp1e.org",
        "discord.co",
        "paypal.com.secure-login.test",
        "login.dlscord.com",
    ])
        assert.equal(imitates(host, protect), true, host)
    for (const host of [
        "discord.com",
        "sub.discord.com",
        "google.com.au",
        "gitlab.com",
        "discordapp.com",
        "github.io",
        "paypal.me",
        "example.net",
        "x.com",
        domainToASCII("пример.рф"),
    ]) {
        assert.equal(imitates(host, protect), false, host)
    }
    // Links in plain text are checked too, and an unprotected look-alike name is not
    assert.equal(deceptiveLink(`Claim it at https://${domainToASCII("ԁiscord.com")}/gift`, protect), true)
    assert.equal(deceptiveLink("https://dlscord.com", ["example.org"]), false)
})

const flags = (content: string) => deceptiveLink(content, protectedDomains)

test("A user name that reads as an address hides the host a link opens", () => {
    for (const content of [
        "https://discord.com@example.net/claim",
        "www.paypal.com@203.0.113.9/login",
        "https://github.com:token@example.net/",
        "https://shop.example.org@example.net/",
        "https://twitch.tv%2Flive@example.net/",
    ])
        assert.equal(flags(content), true, content)
    for (const content of [
        "https://git@github.com/a/b.git",
        "https://first.last@example.net/a/b.git",
        "https://user:secret@example.net/",
        "https://github.com@github.com/a",
        "https://example.net/@discord.com",
        "mail sam.jones@example.net about it",
    ])
        assert.equal(flags(content), false, content)
})

test("A brand's name under an ending its owner does not run imitates it, and the owner's own endings do not", () => {
    for (const host of [
        "discord.lol",
        "store.steampowered.example",
        "github.co.uk",
        "steamcommunity.com.ar",
        "twitch.bargains",
        "dlscord.lol",
        "disc0rd.lol",
        "discorcl.lol",
        "pay-pal.lol",
    ])
        assert.equal(imitates(host, protectedDomains), true, host)
    for (const host of [
        "discord.new",
        "cdn.discordapp.com",
        "github.dev",
        "www.google.co.jp",
        "youtu.be",
        "paypal.me",
        "discord.js.org",
        "discord.local",
        "discords.com",
    ])
        assert.equal(imitates(host, protectedDomains), false, host)
    assert.equal(imitates("example.lol", protect), false)
})

test("A protected domain in front of more of the host imitates it wherever it starts", () => {
    for (const host of [
        "www.discord.com.example.net",
        "login.paypal.com-example.net",
        "get-twitch.tv-example.net",
        "docs.github.com.example.co.uk",
    ])
        assert.equal(imitates(host, protectedDomains), true, host)
    assert.equal(imitates("www.google.com.br", protectedDomains), false)
    assert.equal(imitates("example.org.uk", protect), false)
    assert.equal(imitates("example.org.example.net", protect), true)
})

test("A brand's word beside a lure word imitates it, and other names with the word do not", () => {
    for (const host of [
        "paypal-billing-example.net",
        "example-discord-login.net",
        "discordrewards.example",
        "wallettwitch.example",
        "github-login.pages.example",
        "dlscord-giveaway.example",
        "steam-wallet.example",
        "steamtrade-example.net",
    ])
        assert.equal(imitates(host, protectedDomains), true, host)
    for (const host of [
        "discord-templates.example",
        "twitch-stats.example",
        "youtube-example.net",
        "discord-giveaway-bot.example",
        "login.example.net",
        "github-readme.example.net",
        "steamwallet.example",
        "steam-charts.example",
    ])
        assert.equal(imitates(host, protectedDomains), false, host)
})

test("A label that is a whole bare address counts, and file and product names do not", () => {
    for (const content of [
        "[docs.example.org/guide](https://example.net/guide)",
        "[example.org/guide](https://bit.example/a)",
        "[youtu.be/abc](https://example.net)",
    ])
        assert.equal(flags(content), true, content)
    for (const content of [
        "[discord.js](https://example.net/guide)",
        "[example.org](https://bit.example/a)",
        "[notes.md](https://example.net/notes.md)",
        "[github.png](https://example.net/a.png)",
        "[Example.org](https://example.net)",
        "[see example.org for more](https://example.net)",
        "[wiki.example.org](https://forum.example.org/t/1)",
        "[youtu.be/abc](https://www.youtube.com/watch?v=abc)",
        "[discord.gg/abc](https://discord.com/invite/abc)",
    ])
        assert.equal(flags(content), false, content)
})

test("A word in another script under its own ending is not a lookalike, and the same word under a Latin ending is", () => {
    assert.equal(imitates(domainToASCII("сосо.рф"), protectedDomains), false)
    assert.equal(imitates(domainToASCII("сосо.example"), protectedDomains), true)
})

test("A brand's public hosting and a shared host's tenants vouch for nothing, and a plain project name is no address", () => {
    for (const content of [
        "[github.com/login](https://stranger.github.io/login)",
        "[github.com/x](https://raw.githubusercontent.com/stranger/x/main/a.exe)",
        "[discord.com/x](https://cdn.discordapp.com/attachments/1/2/a.exe)",
        "[https://first.pages.example](https://second.pages.example)",
        "[first.github.io](https://second.github.io)",
        "[first.netlify.app](https://second.netlify.app/login)",
        "[github.io/login](https://stranger.github.io/login)",
        "[discord.com!](https://stranger.example)",
        "[**discord.com**](https://stranger.example)",
        "https://discord-nitro.vercel.app",
        "https://paypal-login.netlify.app",
        `https://${domainToASCII("dіscord.github.io")}/claim`,
        "https://github.com@stranger.github.io/",
        "https://paypals.com",
    ])
        assert.equal(deceptiveLink(content, protect), true, content)
    for (const content of [
        "[some-project.io](https://github.com/stranger/some-project)",
        "https://stranger.github.io/page",
        "https://raw.githubusercontent.com/stranger/x/main/readme.md",
        "https://cdn.discordapp.com/attachments/1/2/a.png",
        "https://google.github.io/styleguide",
        "https://discords.com/servers/x",
        "[google.ts](https://github.com/stranger/x/blob/main/src/google.ts)",
        "[stranger.github.io/tool](https://github.com/stranger/tool)",
        "[discordapp.com/invite/abc](https://discord.gg/abc)",
        "[github.io](https://docs.github.com/en/pages)",
        "[Join discord.gg!](https://discord.gg/abc)",
        "[**https://example.net**](https://example.net)",
        "[**discord.gg/abc**](https://discord.gg/abc)",
        "[`github.com/stranger/x`](https://github.com/stranger/x)",
        "https://discord-clone.netlify.app",
    ])
        assert.equal(deceptiveLink(content, protect), false, content)
})
