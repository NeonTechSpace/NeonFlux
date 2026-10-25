import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import test from "node:test"
import { errorTags, operations, reasons, stages } from "../src/cause-fields.ts"

// Every error class the bot declares, with the literal values of its stage, reason and operation fields, read from the
// source so a new class or value cannot be missed. A type alias in the same file, such as PermissionReadOperation, is followed
const source = new URL("../src/", import.meta.url)
const files = readdirSync(source)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => ({ name, text: readFileSync(new URL(name, source), "utf8") }))

test("the cause summary knows every error class of the bot and every value of its stage, reason and operation", () => {
    const fields: Record<string, ReadonlySet<string>> = { stage: stages, reason: reasons, operation: operations }
    let classes = 0
    for (const { name, text } of files)
        for (const [, tag, body] of text.matchAll(/TaggedError\("(\w+)"\)<\{([\s\S]*?)\}>/g)) {
            classes++
            assert(errorTags.has(tag!), `${name}: ${tag}`)
            for (const property of body!.split("readonly ").slice(1)) {
                const match = /^(\w+)\??:([\s\S]*)$/.exec(property)
                const known = match && fields[match[1]!]
                if (!known) continue
                let type = match[2]!
                for (const alias of type.match(/\b[A-Z]\w+\b/g) ?? [])
                    type += new RegExp(`type ${alias} =([^\\n]*(?:\\n\\s+\\|[^\\n]*)*)`).exec(text)?.[1] ?? ""
                for (const [, value] of type.matchAll(/"([^"]+)"/g))
                    assert(known.has(value!), `${name}: ${tag}.${match[1]} ${value}`)
            }
        }
    assert(classes > 70, `only ${classes} error classes found`)
    // Operations a store names directly rather than by its backend path
    for (const { name, text } of files)
        for (const [, value] of text.matchAll(/StoreError\(\{ operation: "([^"]+)"/g))
            assert(operations.has(value!), `${name}: ${value}`)
})
