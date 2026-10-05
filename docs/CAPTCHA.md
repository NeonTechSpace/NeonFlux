# Motion challenge evaluation

This guide is for operators who want to understand or reproduce the evaluation of the web verification challenge described in [the dashboard guide](WEB.md#web-verification)

## Design

The challenge targets one attacker: someone who screenshots or copies it into a multimodal chat model, which may run code on the images, without controlling the browser or computer

The [generator](../projects/backend/convex/motionCaptcha.ts) gives each of 550 dots a short vertical path with a random start phase. A dot moves up or down depending on whether the middle of its path lies inside the hidden symbol. Every frame is an even field of dots, and averaging frames gives even vertical streaks. Only two consecutive frames reveal the symbol. The animation repeats every two seconds with 60 frames. All symbols cover the same area, and dot colors do not depend on the symbol

The server stores a private seed and regenerates the current round's frames for each view. The browser draws them live on a [canvas](../projects/web/src/motion-canvas.tsx), so a screenshot holds one frame

## Run the screenshot evaluation

From `projects/`, run:

```powershell
pnpm --filter @neonflux/backend run captcha:screenshots 200
```

The command prints a new output directory under `projects/web/.local/` and never overwrites an existing one. It renders screenshots of the canvas above the six choices, runs density, contrast, edge and shift attacks plus positive controls, and grades complete answer pairs through the live answer check. It also writes model probe packages under `probes/`, with answers in `private/judge.json`. Grade a model's answers with:

```powershell
pnpm --filter @neonflux/backend run captcha:screenshots grade <output directory> <answers.json>
```

The answers file maps each probe ID to a line such as `B E`, with an optional second line for the second attempt. Attacks see only the public screenshot pixels and the generator's design, never seeds or answers

## Photosensitivity

The animation is designed to stay below the WCAG 2.3.1 [general and red flash thresholds](https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html). Before a round is served, the generator checks every 341 by 256 pixel field at each Chrome, Firefox and Safari zoom step from 100% to 500%. The two busiest frames in each field must together cover at most 25% of it. A round that fails is regenerated, which happens for about 1% of rounds. The canvas shows a blank frame when it starts or switches rounds, follows zoom changes, pauses while staff assistance is open and stops when time runs out. No dot color counts as saturated red

This is an automated check, not a clinical guarantee, and no professional analyzer such as PEAT or Harding was run. Screen magnification beyond browser zoom can enlarge dots past the checked size, so staff assistance remains the alternative

## Limits

- Two random screenshots land on consecutive frames about 3.3% of the time. Many screenshots, or screenshots timed one loop plus one frame apart, reveal the symbol
- Screen recordings, browser automation and scripts that read the frame data defeat the challenge. The 90-second deadline is the remaining defense
- The evaluation simulates camera exposure by averaging frames. Real cameras and displays were not tested
- Human recognition of these symbols is untested. Motion-defined symbols can exclude people with motion-perception differences, vestibular conditions or motion sensitivity
