import type { APIRoute } from "astro"
import { getCollection } from "astro:content"
import { buildLlmsTxt } from "../llms.js"

const metas = import.meta.glob("../../content/docs/*/meta.json", { eager: true })

export const GET: APIRoute = async () => {
    const entries = await getCollection("docs")
    const body = buildLlmsTxt(entries, metas)
    return new Response(body, {
        headers: {
            "Content-Type": "text/plain; charset=utf-8",
        },
    })
}
