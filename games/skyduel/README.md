# SkyDuel — Marksman vs Pilot

A modern, two-player take on the classic light-gun sky-shooter: one person aims the gun, the other one *is* the target. Original characters, art and rules — nothing borrowed.

**Play it:** open `index.html` in any modern browser. One file, no build step, no assets, no dependencies. Works offline. Drop it on any static host (Cloudflare Pages, GitHub Pages, a folder on a laptop plugged into a TV).

## The game

- **Marksman** aims a reticle and has three shots per magazine, then a 1.2 s reload. Hit the Zephyr before the 10 s round timer runs out. Faster hits and spare shots score more.
- **Pilot** flies the Zephyr, a glowing paper glider. Survive the timer, or after 4 s fly over the escape line at the top of the sky for a bonus. Every shot dodged adds points. A **dash** gives a burst of speed and a smaller hitbox, on a 1.8 s cooldown.
- **Match** is six rounds. In 2-player mode the roles swap after round 3, so both people shoot and both fly. Each round has its own sky: dawn, high noon, golden hour, dusk, midnight, aurora.
- **Pip the fox** pops out of the grass with commentary after every round.

## Modes

| Mode | Who does what |
|---|---|
| 2 Players · local duel | Same screen. One on the mouse or arrow keys, one on WASD or a gamepad. Swap at half time. |
| Solo · Marksman | You shoot, a CPU pilot dodges. Works on touch screens. |
| Solo · Pilot | You fly, a CPU marksman tracks you with a reaction delay. |

## Controls

| Role | Input | Keys |
|---|---|---|
| Marksman | Mouse / touch | Move to aim, click or tap to shoot, right-click to reload |
| Marksman | Keyboard | Arrow keys aim · Enter or Ctrl shoots · R or Backspace reloads |
| Marksman | Gamepad | Right stick aims · RT or Ⓐ shoots · Ⓧ or Ⓑ reloads |
| Pilot | Keyboard | W A S D fly · Space or Shift dashes |
| Pilot | Gamepad | Left stick flies · Ⓐ or RB dashes |
| Anyone | Global | Esc / P / Start pauses · M mutes · F fullscreen · G swaps gamepad slots |

In 2-player mode the first connected gamepad is the pilot and the second is the marksman (press G to swap). In solo modes the first gamepad belongs to whichever role you hold. All sound is synthesised in the browser with Web Audio, so there is nothing to download.

## Tech

Plain HTML5 canvas and vanilla JavaScript in a single ~800-line file. Fixed logical resolution (1280×720) letterboxed to any screen. Records (fastest hit, best score) live in `localStorage`.
