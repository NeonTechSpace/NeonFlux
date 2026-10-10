import assert from "node:assert/strict"
import { test } from "node:test"
import { domainToASCII } from "node:url"
import { deceptiveLink, imitates, protectedDomains } from "../convex/moderationLinks.ts"

const protect = [...protectedDomains, "example.org"]

test("A masked link whose label names another address is deceptive, and one that names its own site or no address is not", () => {
    for (const content of ["[https://discord.com/gifts](https://evil.test/gift)", "Free [www.paypal.com](<https://evil.test>)", "[discord.com/nitro](https://discord.com.evil.test)",
        "[example.org](https://evil.test)"]) assert.equal(deceptiveLink(content, protect), true, content)
    for (const content of ["[click here](https://evil.test)", "[github.com](https://github.com/x)", "[www.github.com](https://github.com)", "[docs](https://docs.github.com)",
        "[file.txt](https://example.net/file.txt)", "[https://blog.example.net](https://example.net/blog)", "No links at all"]) assert.equal(deceptiveLink(content, protect), false, content)
})

test("Hosts that mix scripts, look like a protected domain or sit one edit away from it imitate it", () => {
    // Fluxer and browsers turn Unicode hosts into xn-- labels, which the check reads back
    for (const host of [domainToASCII("pаypal.com"), domainToASCII("dіscord.gg"), domainToASCII("аррӏе.test"), "dlscord.com", "steamcomrnunity.com", "githbu.com", "examp1e.org",
        "discord.co", "paypal.com.secure-login.test", "login.dlscord.com"]) assert.equal(imitates(host, protect), true, host)
    for (const host of ["discord.com", "sub.discord.com", "google.com.au", "gitlab.com", "discordapp.com", "github.io", "paypal.me", "example.net", "x.com", domainToASCII("пример.рф")]) {
        assert.equal(imitates(host, protect), false, host)
    }
    // Links in plain text are checked too, and an unprotected look-alike name is not
    assert.equal(deceptiveLink(`Claim it at https://${domainToASCII("ԁiscord.com")}/gift`, protect), true)
    assert.equal(deceptiveLink("https://dlscord.com", ["example.org"]), false)
})
