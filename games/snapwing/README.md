# Snapwing — Photographer vs Pilot

A two-player party game for one big screen. One person is a wildlife photographer trying to get the shot of the Zephyr, a glowing paper glider. The other person *is* the Zephyr, and wants to stay out of frame. Phones are the controllers: the photographer points their phone at the screen like a camera, the pilot flies with a thumb-stick.

Original characters, art, sounds and rules. No assets, no build step, no server of our own.

## Files

| File | What it is |
|---|---|
| `index.html` | The big screen: the game, the menu and the Party room. Open this on the TV, laptop or projector. |
| `controller.html` | The phone. Players open it, enter the room code, and their phone becomes a camera or a joystick. |
| `net.js` | Shared connection layer. Phones and the screen connect directly over WebRTC data channels (PeerJS). The public PeerJS signalling server only introduces them. |

Host all three files together on any HTTPS static host. HTTPS matters: browsers only expose the motion sensors on secure pages. GitHub Pages, Cloudflare Pages or a folder on any web server all work.

## How a party works

1. Open `index.html` on the big screen and pick **Party**. It shows a four-letter room code and a QR code.
2. Each player scans the QR or types the address on their phone, enters the code, and taps Join. The first phone is the photographer, the second is the pilot. One phone is enough, the CPU takes the other role.
3. Photographer: hold the phone upright, point it at the middle of the screen, tap **Recenter** once. From then on move the phone like a camera. Tap anywhere on the big pad to snap. Three frames per roll, then a 1.2 s rewind.
4. Pilot: drag anywhere on the left pad to fly, tap **Dash** on the right for a burst of speed with a smaller hitbox.
5. Six rounds. After round 3 the phones swap roles automatically and buzz to tell you.

**No motion sensor, or the aim feels wrong?** Tap **Mode** on the phone to switch to Trackpad: drag on the pad to move the viewfinder, tap to snap. The sensitivity slider changes how far you have to turn the phone to cross the screen.

## Other modes

| Mode | Who does what |
|---|---|
| 2 Players · one screen | Same keyboard and mouse. One aims with the mouse or arrow keys, one flies with W A S D or a gamepad. Swap seats at half time. |
| Solo · Photographer | You shoot, a CPU pilot dodges. Works with a mouse or a touch screen. |
| Solo · Pilot | You fly, a CPU photographer tracks you with a reaction delay. |

Keyboard and gamepad controls are listed on the How to play screen inside the game.

## Scoring

- **Capture**: 100, plus 12 per second left on the clock, plus 40 per spare frame.
- **Stay out of frame for 10 s**: 100, plus 30 per frame dodged.
- **Leave the frame** over the top line after the first 4 s: 160, plus 30 per frame dodged.

## How the phone aiming works

The phone reads its orientation sensors at up to 60 Hz. On Recenter it stores the current heading and tilt as "the middle of the screen". After that, yaw (turning left and right) maps to the viewfinder's x and pitch (tilting up and down) maps to y, across a field of view set by the sensitivity slider. Positions are sent to the screen about 30 times per second, and the screen smooths them. Sensors drift slowly, so tap Recenter whenever the viewfinder wanders.

A camera-based mode, where the phone camera actually sees the screen, is a possible later step. It would remove drift entirely but costs battery and depends on lighting.

## Tech

Plain HTML5 canvas and vanilla JavaScript. Fixed logical resolution (1280×720) letterboxed to any screen. Web Audio synthesises every sound. Records live in `localStorage`. PeerJS and the QR library load from a CDN only when Party mode is opened, so the rest of the game works offline.
