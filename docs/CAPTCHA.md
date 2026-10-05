# Guide the spark

This guide is for operators who need to understand or reproduce the website verification challenge described in [the dashboard guide](WEB.md#web-verification)

## Play and design

Guide the spark shows a field of soft neon particles on a 320-pixel canvas. The member drags a glowing spark with a mouse or touch, or focuses the canvas and uses the arrow keys, to follow a current from the start to the goal ring. The journey is designed to take about 5 to 10 seconds. Human completion times and motion perception have not been tested

The [backend generator](../projects/backend/convex/motionCaptcha.ts) keeps a private 128-bit seed. It generates one smooth route per challenge, the sum of three waves with seeded strengths and phases, and regenerates the same checked frames for each view. Only frames reach the [browser canvas](../projects/web/src/motion-canvas.tsx), never the seed or route geometry. A failed attempt uses the same route and deadline

All 320 particles share their size, palette and lifetime. Positions use a uniform horizontal phase and a uniform offset from the route. This coordinate transform preserves area, and horizontal motion at either sign preserves uniform density in every frame. Within 16 grid units of the route particles move toward the goal. Outside that band their directions are mixed. The animation has 240 frames at 30 frames per second and repeats every eight seconds, with continuous positions across the loop

The spark follows the member's input at 40 grid units per second. The browser gives no route correctness feedback. It draws neither a route line nor a path trail. Reaching the goal submits the sampled path automatically

## Server check

The server regenerates the route from the private seed and checks the submitted trace. Coordinates use a 256-unit square, so one grid unit is 1.25 CSS pixels at the normal canvas size

| Check | Bound |
| --- | --- |
| Start | Within 6 grid units of (24, 128) |
| Goal | Within 9 grid units of (232, 128) |
| Route | At most 13 grid units vertically from the smooth route, including the segments between samples |
| Duration | At least 4 seconds and at most 25.5 seconds, no longer than the server's elapsed challenge time |
| Speed | At most 64 grid units per second between consecutive samples |
| Sampling | First timestamp is zero, later timestamps increase strictly, no gap exceeds 250 milliseconds |
| Size | 2 to 256 samples, with finite in-bounds coordinates and integer millisecond timestamps |

The browser samples every 100 milliseconds and adds a final sample at the goal. The 13-unit tolerance leaves room for input error inside the visible 16-unit current band. The speed limit allows input variation above the browser's 40-unit movement speed while rejecting jumps. The server checks straight segments between samples at intervals no greater than one grid unit and reserves a 0.03-unit margin for the curve between checked positions, so points on either side of a bend cannot bridge outside the corridor

One Start sets a 90-second deadline and allows two attempts. Well-formed traces that fail the route or timing checks consume an attempt. Malformed or oversized requests are rejected before consuming one. Reaching the browser's sampling limit submits the trace for checking. Reloading, retrying or opening staff assistance does not extend the deadline. The page shows a ring timer, a verification complete state, and a Time's up state that tells the member to react to the server's verification panel for a new link

## Screenshot evaluation

From `projects/`, run:

```powershell
pnpm --filter @neonflux/backend run captcha:screenshots 200
```

The offline evaluation renders single frames with the canvas's pixel geometry. Density, color contrast and edge attacks each rank eight candidate routes with shared endpoints, so exact route chance is 12.5%. It also submits the guessed route as a timed path to the backend check and compares acceptance with random candidate paths. Nearby routes can fit the same tolerance, so path acceptance chance can be higher than exact route chance. Candidate geometry is supplied to the attacks to make this test more informed than an ordinary screenshot. Seeds and the correct route index remain private to the judge. The evaluation includes a planted density leak and consecutive-frame motion as positive controls, and fails if the best single-frame attack exceeds either chance baseline by three standard errors or the controls stop working

The command creates a new directory under `projects/web/.local/` containing eight example PNG frames and `report.json`, with each attack's hit rate and 95% Wilson interval. It never overwrites an existing output directory. This evaluation measures these raster attacks, not every possible screenshot solver

## Photosensitivity

Before serving frames, the generator checks every 341 by 256 pixel field at common Chrome, Firefox and Safari zoom steps from 100% to 500%. The two busiest particle frames plus two conservative spark footprints must cover at most 25% of any field. A field that fails is regenerated from the same seed stream. Particle squares round down to whole device pixels, and the backing store follows browser zoom. Start and goal rings stay fixed, and no palette color is saturated red

Playback starts with a blank frame, pauses when staff assistance is open, and ends when the deadline passes. The soft motion and conservative area guard are designed to stay below the WCAG 2.3.1 [general and red flash thresholds](https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html)

This is an automated bound, not a clinical guarantee. No professional analyzer such as PEAT or Harding was run. Magnification beyond browser zoom can enlarge the field beyond the checked sizes, so staff assistance remains available

## Threat model and limits

The challenge targets someone who tries to solve one screenshot without controlling the browser or computer. A single frame has no intentional route marker, particle density change or color cue

Screen recordings, multiple frames, browser automation and scripts reading the frame payload can recover the route. The backend checks the submitted trace and server elapsed time, but client timings cannot prove human input. Fixed endpoints also let a solver try guessed paths. A random route of the same family fits the tolerance of the real one about 3% of the time, so two blind attempts succeed about 6% of the time, and the existing issue limits bound repeated links

Human usability, real cameras and displays, and external screenshot solvers remain untested. People with motion-perception differences, vestibular conditions, motion sensitivity or difficulty using pointer and keyboard input may need staff assistance
