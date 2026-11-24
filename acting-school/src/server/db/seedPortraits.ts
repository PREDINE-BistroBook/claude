import { deflateSync } from 'node:zlib';

/**
 * Demo headshots for the seed script: a stylised head-and-shoulders silhouette
 * on a coloured gradient, drawn pixel by pixel and encoded as PNG with nothing
 * but node:zlib. No faces — just enough that the talent grid isn't all initials.
 */

type RGB = readonly [number, number, number];

export type HairStyle = 'short' | 'long' | 'bun' | 'curly' | 'buzz';

export interface PortraitLook {
  bg: readonly [RGB, RGB];
  skin: RGB;
  hair: RGB;
  shirt: RGB;
  hairStyle: HairStyle;
}

const W = 360;
const H = 480;
/** Samples per pixel along each axis (anti-aliasing). */
const SS = 2;

const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const shade = (c: RGB, f: number): RGB => [c[0] * f, c[1] * f, c[2] * f];
const inEllipse = (x: number, y: number, cx: number, cy: number, rx: number, ry: number) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;

function sample(look: PortraitLook, x: number, y: number): RGB {
  const cx = W / 2;
  // Background: vertical gradient with a soft light behind the head.
  let c = mix(look.bg[0], look.bg[1], y / H);
  const glow = Math.max(0, 1 - Math.hypot(x - cx, y - 200) / 260);
  c = mix(c, [255, 255, 255], glow * 0.18);

  const headCy = 215;
  const style = look.hairStyle;

  // Long hair falls behind the head and shoulders.
  if (style === 'long' && y > 150 && y < 380 && inEllipse(x, y, cx, 250, 96, 140)) c = shade(look.hair, 0.92);
  if (style === 'bun' && Math.hypot(x - cx, y - 112) <= 34) c = look.hair;

  // Shoulders and torso, a little darker towards the edges, with a round neckline.
  const neckline = inEllipse(x, y, cx, 350, 46, 26);
  if (inEllipse(x, y, cx, 535, 196, 188)) {
    const edge = Math.abs(x - cx) / 196;
    c = neckline ? shade(look.skin, 0.88) : shade(look.shirt, 1 - edge * 0.25);
  }
  // Neck (in shadow under the jaw).
  if (x > cx - 31 && x < cx + 31 && y > 260 && (y < 350 || neckline)) c = shade(look.skin, y < 305 ? 0.8 : 0.88);
  // Ears, then the head.
  if (inEllipse(x, y, cx - 70, 228, 12, 21) || inEllipse(x, y, cx + 70, 228, 12, 21)) c = shade(look.skin, 0.93);
  if (inEllipse(x, y, cx, headCy, 70, 88)) {
    // A little modelling: lighter on one side.
    c = shade(look.skin, 1.02 - Math.max(0, (x - cx) / 70) * 0.08);
  }

  // Hair on top of the head.
  const rel = (x - cx) / 78;
  const hairline = 168 + rel * rel * 52;
  if (style === 'curly') {
    const a = Math.atan2(y - 190, x - cx);
    const r = 86 + Math.sin(a * 11) * 6;
    if (Math.hypot((x - cx) * (86 / 90), y - 190) <= r && y < hairline + 14) c = look.hair;
  } else if (inEllipse(x, y, cx, 196, 77, 87) && y < hairline) {
    c = style === 'buzz' ? mix(look.skin, look.hair, 0.55) : look.hair;
  }
  return c;
}

function crc32(buf: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/** Render one portrait as PNG bytes (360×480, RGB). */
export function renderPortrait(look: PortraitLook): Uint8Array<ArrayBuffer> {
  const stride = W * 3 + 1;
  const raw = Buffer.alloc(stride * H);
  for (let y = 0; y < H; y++) {
    raw[y * stride] = 0; // filter: none
    for (let x = 0; x < W; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const p = sample(look, x + (sx + 0.5) / SS, y + (sy + 0.5) / SS);
          r += p[0];
          g += p[1];
          b += p[2];
        }
      }
      const n = SS * SS;
      const o = y * stride + 1 + x * 3;
      raw[o] = Math.min(255, Math.round(r / n));
      raw[o + 1] = Math.min(255, Math.round(g / n));
      raw[o + 2] = Math.min(255, Math.round(b / n));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return new Uint8Array(Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 6 })), chunk('IEND', new Uint8Array())]));
}

const SKINS: RGB[] = [
  [241, 208, 182],
  [224, 180, 145],
  [198, 145, 106],
  [160, 108, 74],
  [118, 78, 54],
];
const HAIRS: RGB[] = [
  [38, 28, 24],
  [70, 46, 30],
  [120, 82, 48],
  [196, 160, 102],
  [24, 22, 26],
  [150, 150, 152],
];
const SHIRTS: RGB[] = [
  [44, 62, 92],
  [120, 40, 52],
  [36, 96, 84],
  [60, 60, 66],
  [176, 120, 52],
  [92, 70, 130],
  [230, 230, 228],
];
const BACKDROPS: (readonly [RGB, RGB])[] = [
  [[250, 214, 165], [222, 120, 96]],
  [[176, 214, 240], [92, 132, 200]],
  [[200, 236, 210], [74, 156, 132]],
  [[232, 210, 246], [140, 104, 190]],
  [[246, 236, 200], [200, 170, 90]],
  [[214, 220, 228], [110, 122, 140]],
  [[250, 200, 210], [196, 90, 120]],
  [[190, 232, 236], [60, 140, 160]],
];

const HAIR_BY_NAME: Record<string, RGB> = {
  black: [24, 22, 26],
  'dark brown': [52, 36, 28],
  brown: [96, 64, 40],
  auburn: [124, 58, 34],
  red: [168, 72, 40],
  blonde: [210, 176, 112],
  grey: [160, 160, 162],
};

/**
 * A look for one person (`person` picks skin, hair and style, so every photo of
 * them matches); `variant` changes only the backdrop and the shirt, for a
 * second or third shot. `hair` is a colour name like "Auburn" when known.
 */
export function lookFor(person: number, gender: 'female' | 'male' | 'other' | null, opts: { hair?: string | null; variant?: number } = {}): PortraitLook {
  const female: HairStyle[] = ['long', 'bun', 'long', 'curly', 'short'];
  const male: HairStyle[] = ['short', 'buzz', 'curly', 'short'];
  const styles = gender === 'female' ? female : gender === 'male' ? male : (['short', 'curly', 'long'] as HairStyle[]);
  const v = opts.variant ?? 0;
  // Grey only when asked for; everyone else gets one of the natural colours.
  const natural = HAIRS.filter((h) => h[0] !== h[2] || h[0] < 100);
  const hair = (opts.hair && HAIR_BY_NAME[opts.hair.toLowerCase()]) || natural[(person * 5 + 2) % natural.length]!;
  return {
    bg: BACKDROPS[(person + v * 3) % BACKDROPS.length]!,
    skin: SKINS[(person * 3 + 1) % SKINS.length]!,
    hair,
    shirt: SHIRTS[(person * 2 + 3 + v * 2) % SHIRTS.length]!,
    hairStyle: styles[person % styles.length]!,
  };
}
