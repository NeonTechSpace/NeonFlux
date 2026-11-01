// The feature pages' facts. The page script draws them, and each page's title, description and first HTML come from here
export const FE = [
    {
        k: "mod",
        n: "Moderation",
        l: "Warn, time out, kick and ban, with a record of every case",
        f: [
            "Every action gets a case number, and !mod show brings it back",
            "Members get a DM when they're warned, timed out, kicked or banned",
            "Members can appeal",
            "A role you choose can read private cases on the website",
            "Keep cases as long as you choose, or until you erase them",
            "Jail a member, and give the same roles back when you release them",
        ],
        d: "moderation",
        e: 5,
        c: "moderation",
        cls: "slam",
    },
    {
        k: "auto",
        n: "Automod",
        l: "Catches spam, scam links and banned words",
        f: [
            "Rules for spam, mass mentions, scam links and banned words",
            "Paste in long lists of words and patterns",
            "Try rules in dry run first, where they only log",
            "Stricter safety levels for when a raid hits",
        ],
        d: "automod",
        e: 0,
    },
    {
        k: "guard",
        n: "Protection",
        l: "Anti-nuke, server-wide lockdown and jail, for when an account goes bad",
        f: [
            "Anti-nuke spots one account deleting channels or banning people in a burst, and can take its roles",
            "It starts in dry run, where it only records and alerts",
            "It can only alert about the owner and anyone ranked at or above the bot, and a slow burn is reported, not stopped",
            "Lockdown stops posting across the server at once, then gives each channel back what it had",
            "Jail takes a member's roles and leaves one channel, and release gives the same roles back",
        ],
        d: "protection",
        docs: [
            ["anti-nuke", "Anti-nuke commands"],
            ["lockdown", "Lockdown commands"],
            ["jail", "Jail commands"],
        ],
        notInBox: true,
    },
    {
        k: "roles",
        n: "Roles",
        l: "Members pick their own roles, on the website or by reacting in chat",
        f: [
            "Separate menus, each pick-one or pick-many",
            "Choose which roles and members can use it",
            "Staff roles can't be picked",
        ],
        d: "roles",
        e: 3,
        c: "role-picker",
    },
    {
        k: "ver",
        n: "Verification",
        l: "New members pass a check before they get in",
        f: [
            "A browser check and a moving puzzle",
            "Staff can step in for anyone who can't use motion",
            "Or have people react to the rules",
        ],
        d: "verification",
        e: 2,
    },
    {
        k: "wel",
        n: "Welcome",
        l: "Greet people, say goodbye and show newcomers where to start",
        f: ["A short checklist for newcomers", "Newcomer roles given automatically"],
        d: "welcome",
        e: 1,
    },
    {
        k: "tic",
        n: "Tickets",
        l: "Members ask staff for help in private",
        f: [
            "Your own questions when a ticket opens",
            "You choose which roles handle support",
            "Saved replies staff can send",
            "You choose how long tickets are kept",
        ],
        d: "tickets",
        e: 4,
    },
    {
        k: "help",
        n: "Help desk",
        l: "A forum with saved answers, and ideas members can vote on",
        f: [
            "Saved answers, posted with !answer",
            "The author or staff close a post with !solved",
            "Suggestions in text and forum channels",
        ],
        d: "help-desk",
        e: 7,
    },
    {
        k: "lev",
        n: "Levels",
        l: "Members earn levels by chatting, and roles at levels you set",
        f: ["A leaderboard and !rank"],
        d: "leveling",
        e: 11,
    },
    {
        k: "eve",
        n: "Events",
        l: "Post an event, collect RSVPs and send reminders",
        f: ["Birthdays and anniversaries too"],
        d: "events",
        e: 8,
    },
    {
        k: "pro",
        n: "Profiles",
        l: "A page for each member, and a place to show what they made",
        f: ["Members write their own on the website"],
        d: "profiles",
        e: 12,
    },
    {
        k: "msg",
        n: "Messages",
        l: "Announcements on schedule, plus YouTube, Twitch and Bluesky alerts",
        f: [
            "Alerts when a streamer goes live, a video goes up or a Bluesky account posts",
            "Sticky messages, custom replies and cleanup",
        ],
        d: "messages",
        e: 6,
    },
    {
        k: "voi",
        n: "Voice",
        l: "Temporary voice rooms, and finding people to play with",
        f: [
            "Join one channel and get your own room",
            "Name rooms with a pattern, like Mia's room",
            "Lock a room, hide it or change its limit from chat, a reaction card or a web page",
            "Post what you want to play and others join",
        ],
        d: "voice",
        e: 9,
    },
]

// The opening box on the homepage draws exactly these. Its shader and picture sheet are made for this many
export const BOX = FE.filter((feature) => !feature.notInBox)

export const homeTitle = "NeonFlux: The open-source Fluxer bot you can own"
export const homeDescription =
    "An open-source Fluxer bot you can host for yourself or for others, with moderation, roles, tickets, welcome messages, leveling and events"

export const featurePath = (feature) => `/features/${feature.d}/`
// A feature's docs links as [address, label]. Most have one page, and a feature that spans several names them
export const featureDocs = (feature) =>
    feature.docs?.map(([slug, label]) => [`/docs/features/${slug}/`, label]) ?? [
        [`/docs/features/${feature.d}/`, "All the commands for this"],
    ]
export const featureTitle = (feature) => `${feature.n} for Fluxer servers | NeonFlux`
export const featureDescription = (feature) =>
    `${feature.l}. Part of NeonFlux, an open-source Fluxer bot you can host yourself`
