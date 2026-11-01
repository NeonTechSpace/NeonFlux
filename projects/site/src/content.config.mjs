import { defineCollection } from "astro:content"
import { glob } from "astro/loaders"
import { z } from "astro/zod"

const docs = defineCollection({
    loader: glob({
        pattern: "*/**/*.md",
        base: "./content/docs",
        generateId: ({ entry }) => entry.replace(/\.md$/, ""),
    }),
    schema: z.object({
        title: z.string(),
        navTitle: z.string().optional(),
        description: z.string(),
    }),
})

export const collections = { docs }
