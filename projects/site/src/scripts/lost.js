const root = document.documentElement
const tog = document.getElementById("tog")
const still = () => root.hasAttribute("data-still")

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

const replies = ["Nobody home", "Still empty", "It was empty last time too", "The homepage has more in it"]
const knock = document.getElementById("knock")
const reply = document.getElementById("reply")
let knocks = 0
knock.addEventListener("click", () => {
    reply.textContent = replies[knocks % replies.length]
    knocks++
    if (still()) return
    knock.classList.remove("hit")
    void knock.offsetWidth
    knock.classList.add("hit")
})
