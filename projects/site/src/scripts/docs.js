const $ = (id) => document.getElementById(id)
const root = document.documentElement
const still = () => root.hasAttribute("data-still")

/* ---------- the same animations switch as the homepage, and the same remembered choice ---------- */
const tog = $("tog")
tog.setAttribute("aria-checked", String(!still()))
tog.addEventListener("click", () => {
    const off = !still()
    root.toggleAttribute("data-still", off)
    tog.setAttribute("aria-checked", String(!off))
    try {
        localStorage.setItem("nf.motion", off ? "off" : "on")
    } catch {
        // Storage is blocked, the choice lasts for this page
    }
})

/* ---------- narrow screens: the page list opens from the menu button ---------- */
const menu = $("menu"),
    side = $("side")
const setMenu = (open) => {
    menu.setAttribute("aria-expanded", String(open))
    side.classList.toggle("open", open)
}
menu.addEventListener("click", () => setMenu(menu.getAttribute("aria-expanded") !== "true"))
side.addEventListener("click", (event) => {
    if (event.target instanceof Element && event.target.closest("a")) setMenu(false)
})
document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setMenu(false)
})
const scrollBox = $("scroll")
window.addEventListener("pagehide", () => {
    try {
        sessionStorage.setItem("nf.side", String(scrollBox.scrollTop))
        sessionStorage.setItem("nf.part", side.querySelector(".parts").dataset.at)
    } catch {
        // Storage is blocked, the list starts at its top
    }
})

/* ---------- the two parts of the docs. Arrow keys move between the tabs ---------- */
const partsBar = side.querySelector(".parts")
const tabs = [...partsBar.querySelectorAll("[role=tab]")]
const choosePart = (tab) => {
    for (const other of tabs) {
        const selected = other === tab
        other.setAttribute("aria-selected", String(selected))
        other.tabIndex = selected ? 0 : -1
        $(other.getAttribute("aria-controls")).hidden = !selected
    }
    partsBar.dataset.at = String(tabs.indexOf(tab))
    scrollBox.scrollTop = 0
}
for (const tab of tabs) {
    tab.addEventListener("click", () => choosePart(tab))
    tab.addEventListener("keydown", (event) => {
        const at = tabs.indexOf(tab)
        const to = { ArrowLeft: at - 1, ArrowRight: at + 1, Home: 0, End: tabs.length - 1 }[event.key]
        if (to === undefined) return
        event.preventDefault()
        const next = tabs[(to + tabs.length) % tabs.length]
        next.focus()
        choosePart(next)
    })
}

/* ---------- the top bar leaves while reading down and returns on the way back up ---------- */
const bar = $("bar")
let lastY = scrollY,
    barFrame = 0
const setBar = (hidden) => root.toggleAttribute("data-bar-hidden", hidden)
window.addEventListener(
    "scroll",
    () => {
        barFrame ||= requestAnimationFrame(() => {
            barFrame = 0
            const y = scrollY
            if (y < bar.offsetHeight * 2 || y < lastY - 4) setBar(false)
            else if (y > lastY + 4 && !side.classList.contains("open") && !bar.contains(document.activeElement))
                setBar(true)
            if (Math.abs(y - lastY) > 4) lastY = y
        })
    },
    { passive: true },
)
bar.addEventListener("focusin", () => setBar(false))

/* ---------- version menu closes on an outside click ---------- */
const ver = $("ver")
if (ver)
    document.addEventListener("click", (event) => {
        if (ver.open && event.target instanceof Node && !ver.contains(event.target)) ver.open = false
    })

/* ---------- code blocks can be copied, and long ones open on request ---------- */
for (const pre of document.querySelectorAll(".prose pre")) {
    const code = pre.textContent
    const more = pre.nextElementSibling?.matches(".code-more") ? pre.nextElementSibling : null
    const button = document.createElement("button")
    button.type = "button"
    button.className = "copy"
    button.textContent = "Copy"
    button.addEventListener("click", () => {
        navigator.clipboard
            .writeText(code)
            .then(() => (button.textContent = "Copied"))
            .catch(() => (button.textContent = "Select it"))
            .finally(() => setTimeout(() => (button.textContent = "Copy"), 1500))
    })
    const wrap = document.createElement("div")
    wrap.className = "code"
    pre.replaceWith(wrap)
    wrap.append(pre, button)
    if (more) wrap.append(more)
}
const setCodeOpen = (frame, open) => {
    const rest = frame.querySelector(".code-rest"),
        more = frame.querySelector(".code-more")
    if (open) rest.removeAttribute("hidden")
    else rest.setAttribute("hidden", "until-found")
    more.setAttribute("aria-expanded", String(open))
    more.textContent = open ? more.dataset.hide : more.dataset.show
}
// Closing pulls the button up, so the page follows to keep it where the reader's pointer is
const keepInPlace = (anchor, change) => {
    const before = anchor.getBoundingClientRect().top
    change()
    window.scrollBy({ top: anchor.getBoundingClientRect().top - before, behavior: "instant" })
}
let codeSliding = false
const slideCode = (frame, more, open) => {
    if (codeSliding) return
    if (still()) {
        keepInPlace(more, () => setCodeOpen(frame, open))
        return
    }
    if (open) setCodeOpen(frame, true)
    const rest = frame.querySelector(".code-rest")
    const height = rest.offsetHeight
    const motion = rest.animate(
        { height: open ? ["0px", `${height}px`] : [`${height}px`, "0px"], overflow: ["clip", "clip"] },
        { duration: Math.min(700, 280 + height / 5), easing: "cubic-bezier(0.32, 0.72, 0, 1)", fill: "both" },
    )
    codeSliding = true
    if (!open) more.setAttribute("aria-expanded", "false")
    let top = more.getBoundingClientRect().top
    const follow = () => {
        if (open || motion.playState !== "running") return
        const now = more.getBoundingClientRect().top
        if (now !== top) window.scrollBy({ top: now - top, behavior: "instant" })
        top = more.getBoundingClientRect().top
        requestAnimationFrame(follow)
    }
    requestAnimationFrame(follow)
    motion.finished
        .catch(() => {})
        .then(() => {
            codeSliding = false
            if (open) motion.cancel()
            else
                keepInPlace(more, () => {
                    setCodeOpen(frame, false)
                    motion.cancel()
                })
        })
        .catch(() => {})
}
document.addEventListener("click", (event) => {
    const more = event.target instanceof Element ? event.target.closest(".code-more") : null
    if (more) slideCode(more.closest(".code"), more, more.getAttribute("aria-expanded") !== "true")
})
// The browser's own find opened the hidden part to show a match
document.addEventListener("beforematch", (event) => {
    const frame = event.target.closest?.(".code")
    if (frame?.querySelector(".code-more")) setCodeOpen(frame, true)
})

/* ---------- the outline follows the heading being read, and glides to the one chosen ---------- */
const outline = $("outline")
if (outline) {
    const links = new Map(
        [...outline.querySelectorAll("a")].map((link) => [decodeURIComponent(link.hash.slice(1)), link]),
    )
    const headings = [...links.keys()].flatMap((id) => $(id) ?? [])
    const mark = () => {
        const passed = headings.filter((heading) => heading.getBoundingClientRect().top < 140)
        const atEnd = scrollY > 0 && scrollY + innerHeight >= root.scrollHeight - 2
        const current = atEnd ? headings.at(-1) : (passed.at(-1) ?? headings[0])
        for (const [id, link] of links) {
            if (id === current?.id) link.setAttribute("aria-current", "true")
            else link.removeAttribute("aria-current")
        }
    }
    let waiting = false
    window.addEventListener(
        "scroll",
        () => {
            if (waiting) return
            waiting = true
            requestAnimationFrame(() => {
                waiting = false
                mark()
            })
        },
        { passive: true },
    )
    mark()
    outline.addEventListener("click", (event) => {
        const link = event.target instanceof Element ? event.target.closest("a") : null
        if (!link || still()) return
        // Set for this one move, so arriving at a heading from another page never scrolls slowly into place
        root.style.scrollBehavior = "smooth"
        const settle = () => (root.style.scrollBehavior = "")
        window.addEventListener("scrollend", settle, { once: true })
        setTimeout(settle, 1500)
    })
}

/* ---------- search, within the version being read ---------- */
const dialog = $("search"),
    input = $("q"),
    hits = $("hits"),
    state = $("state"),
    version = document.body.dataset.version
let engine
const loadEngine = () => {
    // A runtime address, so the bundler leaves it alone. The search index exists only in the built site
    const path = "/pagefind/pagefind.js"
    engine ??= import(/* @vite-ignore */ path).then(async (api) => {
        await api.init()
        return api
    })
    return engine
}
const openSearch = () => {
    dialog.showModal()
    input.select()
    loadEngine().catch(() => (state.textContent = "Search works on the built site"))
}
$("find").addEventListener("click", openSearch)
document.addEventListener("keydown", (event) => {
    const typing = event.target instanceof HTMLElement && event.target.matches("input,textarea,select")
    if ((event.key === "/" && !typing) || (event.key === "k" && (event.metaKey || event.ctrlKey))) {
        event.preventDefault()
        openSearch()
    }
})
dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close()
})
// A search box's first Escape only clears its text, and one press should close the dialog
input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") dialog.close()
})
let latest = 0
const showResults = async (query) => {
    const turn = ++latest
    if (!query.trim()) {
        hits.replaceChildren()
        state.textContent = ""
        return
    }
    const api = await loadEngine()
    const found = await api.debouncedSearch(query, { filters: { version } }, 150)
    if (!found || turn !== latest) return
    const data = await Promise.all(found.results.slice(0, 8).map((result) => result.data()))
    if (turn !== latest) return
    state.textContent = data.length ? "" : `Nothing found for "${query}"`
    hits.replaceChildren(
        ...data.map((hit) => {
            const item = document.createElement("li")
            const link = document.createElement("a")
            const title = document.createElement("strong")
            const excerpt = document.createElement("span")
            link.href = hit.url
            title.textContent = hit.meta.title ?? hit.url
            // Pagefind escapes the page's text and marks the matching words itself
            excerpt.innerHTML = hit.excerpt
            link.append(title, excerpt)
            item.append(link)
            return item
        }),
    )
}
input.addEventListener("input", () => {
    showResults(input.value).catch(() => (state.textContent = "Search works on the built site"))
})
