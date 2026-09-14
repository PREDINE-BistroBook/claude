/* Osteria La Galleria — the ingredient library.
   Every dish on the menu is a recipe: a base (plate, bowl, board, glass…) and a list of ingredients in cooking
   order. Each ingredient here has a name in both languages and a drawing that lands on the plate. The site adds
   them one after another, naming each, until the finished dish. Flat, engraved manner; 400×300 box; the plate is
   centred on (200,164). */
(function () {
  const C = { paper: "#F6EFE1", gold: "#C9A55C", ink: "#1E1A17", line: "rgba(30,26,23,.55)",
    red: "#B8433A", red2: "#D9584A", wine: "#5A1420", meat: "#7A2230", meat2: "#93303F", pink: "#E28F8A", rose: "#E7A9A0",
    green: "#3F7A4A", leaf: "#6FA46A", leaf2: "#8CBF7A", bread: "#E4C48A", crust: "#B98A4E", cheese: "#F1D488", cream: "#F3E6C4",
    brown: "#8A5A2E", brown2: "#5E3C21", dark: "#2A2320", silver: "#C9CFD6", orange: "#E8865A", amber: "#D9A05B", white: "#FBF8F2", yellow: "#F0C64A", purple: "#5B3A5A", blue: "#22405F" };
  const s = (d, fill, extra) => '<path d="' + d + '" fill="' + fill + '" stroke="' + C.line + '" stroke-width="1"' + (extra || "") + "/>";
  const circ = (x, y, r, fill, extra) => '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="' + fill + '" stroke="' + C.line + '" stroke-width="1"' + (extra || "") + "/>";
  const ell = (x, y, rx, ry, fill, extra) => '<ellipse cx="' + x + '" cy="' + y + '" rx="' + rx + '" ry="' + ry + '" fill="' + fill + '" stroke="' + C.line + '" stroke-width="1"' + (extra || "") + "/>";
  const g = (x, y, r, inner) => '<g transform="translate(' + x + " " + y + ") rotate(" + (r || 0) + ')">' + inner + "</g>";
  const at = (pts, fn) => pts.map(p => fn(...(Array.isArray(p) ? p : [p]))).join("");

  /* ---------- bases ---------- */
  const BASE = {
    plate: { it: "Il piatto", en: "The plate", svg: ell(200, 172, 152, 94, "rgba(0,0,0,.28)", ' stroke="none"') + ell(200, 164, 150, 92, C.paper, ' stroke="' + C.gold + '" stroke-width="2"') + ell(200, 164, 116, 68, "none", ' stroke="' + C.gold + '" stroke-opacity=".45"') },
    bowl: { it: "La scodella", en: "The bowl", svg: ell(200, 180, 140, 80, "rgba(0,0,0,.28)", ' stroke="none"') + ell(200, 170, 136, 76, C.paper, ' stroke="' + C.gold + '" stroke-width="2"') + ell(200, 164, 112, 58, "#EFE3CC", ' stroke="' + C.gold + '" stroke-opacity=".4"') },
    board: { it: "Il tagliere di legno", en: "The wooden board", svg: '<rect x="44" y="84" width="312" height="168" rx="16" fill="rgba(0,0,0,.28)"/><rect x="40" y="78" width="312" height="168" rx="16" fill="' + C.brown + '" stroke="' + C.brown2 + '"/><path d="M60 100h270M60 130h270M60 160h270M60 190h270M60 220h270" stroke="' + C.brown2 + '" stroke-opacity=".35"/><circle cx="330" cy="98" r="6" fill="' + C.brown2 + '"/>' },
    pinsa: { it: "L'impasto di pinsa, alto e leggero", en: "The pinsa base, light and airy", svg: ell(200, 176, 160, 92, "rgba(0,0,0,.28)", ' stroke="none"') + s("M52 164c0-58 66-98 148-98s148 40 148 98-66 98-148 98S52 222 52 164z", C.bread, ' stroke="' + C.crust + '" stroke-width="7"') + at([[110, 120], [300, 140], [140, 230], [260, 236], [90, 190]], (x, y) => circ(x, y, 4, C.crust, ' stroke="none" opacity=".7"')) },
    glass: { it: "Il calice", en: "The glass", svg: '<path d="M150 60h100l-10 110a40 40 0 0 1-80 0z" fill="rgba(255,255,255,.06)" stroke="' + C.paper + '" stroke-width="2.5"/><rect x="196" y="205" width="8" height="46" fill="' + C.paper + '"/><ellipse cx="200" cy="254" rx="42" ry="8" fill="' + C.paper + '"/>' },
    flute: { it: "Il flûte", en: "The flute", svg: '<path d="M180 40h40l-6 150a14 14 0 0 1-28 0z" fill="rgba(255,255,255,.06)" stroke="' + C.paper + '" stroke-width="2.5"/><rect x="196" y="204" width="8" height="40" fill="' + C.paper + '"/><ellipse cx="200" cy="248" rx="36" ry="7" fill="' + C.paper + '"/>' },
    mug: { it: "Il boccale", en: "The mug", svg: '<path d="M140 70h120v150q0 20-20 20h-80q-20 0-20-20z" fill="rgba(255,255,255,.06)" stroke="' + C.paper + '" stroke-width="3"/><path d="M260 100h20q16 0 16 16v50q0 16-16 16h-20" fill="none" stroke="' + C.paper + '" stroke-width="8"/>' },
    cup: { it: "La tazzina", en: "The cup", svg: ell(200, 220, 110, 24, C.paper, ' stroke="' + C.gold + '" stroke-width="2"') + '<path d="M140 120h120v60q0 40-40 40h-40q-40 0-40-40z" fill="' + C.paper + '" stroke="' + C.gold + '" stroke-width="2"/><path d="M260 140h16q22 0 22 22t-22 22h-16" fill="none" stroke="' + C.gold + '" stroke-width="6"/>' },
    cupBig: { it: "La tazza", en: "The cup", svg: ell(200, 220, 110, 24, C.paper, ' stroke="' + C.gold + '" stroke-width="2"') + '<path d="M130 110h140v60q0 50-50 50h-40q-50 0-50-50z" fill="' + C.paper + '" stroke="' + C.gold + '" stroke-width="2"/><path d="M270 130h16q22 0 22 22t-22 22h-16" fill="none" stroke="' + C.gold + '" stroke-width="6"/>' },
    tumbler: { it: "Il bicchiere", en: "The glass", svg: '<path d="M160 70h80v160q0 20-20 20h-40q-20 0-20-20z" fill="rgba(255,255,255,.06)" stroke="' + C.paper + '" stroke-width="2.5"/>' },
    spritz: { it: "Il calice grande", en: "The large glass", svg: '<path d="M140 60h120l-10 130a50 50 0 0 1-100 0z" fill="rgba(255,255,255,.06)" stroke="' + C.paper + '" stroke-width="2.5"/><rect x="196" y="230" width="8" height="24" fill="' + C.paper + '"/><ellipse cx="200" cy="256" rx="40" ry="7" fill="' + C.paper + '"/>' },
    small: { it: "Il bicchierino", en: "The small glass", svg: '<path d="M170 100h60v110a30 30 0 0 1-60 0z" fill="rgba(255,255,255,.06)" stroke="' + C.paper + '" stroke-width="2.5"/><rect x="196" y="238" width="8" height="14" fill="' + C.paper + '"/><ellipse cx="200" cy="254" rx="30" ry="6" fill="' + C.paper + '"/>' },
    bottle: { it: "Bottiglia e bicchiere", en: "Bottle and glass", svg: '<path d="M176 50h48v30l14 20v130q0 20-20 20h-36q-20 0-20-20V100l14-20z" fill="rgba(255,255,255,.06)" stroke="' + C.paper + '" stroke-width="2.5"/><path d="M176 50h48v14h-48z" fill="' + C.paper + '"/><path d="M270 140h60l-6 90a24 24 0 0 1-48 0z" fill="rgba(255,255,255,.06)" stroke="' + C.paper + '" stroke-width="2.5"/>' },
  };

  /* ---------- drawing primitives ---------- */
  const leaf = (x, y, r, col, sc) => g(x, y, r, '<g transform="scale(' + (sc || 1) + ')">' + s("M0 0c14-18 34-18 46 0-12 18-32 18-46 0z", col || C.leaf) + '<path d="M2 0h42" stroke="' + C.green + '" stroke-width="1.5"/></g>');
  const basil = (x, y, r) => leaf(x, y, r, C.leaf2, .9);
  const rocket = (x, y, r) => g(x, y, r, s("M0 0c6-14 4-26 12-34 6 8 4 20 10 34-6-2-16-2-22 0z", C.green));
  const tomatoCube = (x, y, r) => g(x, y, r, s("M-9-9h18v18h-18z", C.red2) + circ(-3, -3, 2, C.red, ' stroke="none"') + circ(4, 4, 2, C.red, ' stroke="none"'));
  const tomatoSlice = (x, y) => circ(x, y, 17, C.red2) + circ(x, y, 11, C.red, ' stroke="none"') + at([[0, -6], [5, 3], [-5, 3]], (dx, dy) => circ(x + dx, y + dy, 2, C.cream, ' stroke="none"'));
  const cherry = (x, y, r) => circ(x, y, r || 8, C.red2) + circ(x - (r || 8) * .3, y - (r || 8) * .35, (r || 8) * .3, "#F0A090", ' stroke="none"');
  const olive = (x, y, col) => ell(x, y, 7, 5, col || C.dark) + circ(x, y, 2, C.paper, ' stroke="none" opacity=".6"');
  const shaving = (x, y, r, col) => g(x, y, r, s("M0 0c8-6 20-6 30 0-6 6-16 8-30 0z", col || C.cream));
  const ham = (x, y, r, col) => g(x, y, r, s("M0 0c14-14 40-16 60-6-12 10-16 22-6 30-22 4-46 0-54-24z", col || C.pink) + '<path d="M8 4c14-8 30-10 44-6M14 12c12-4 26-6 36-4" stroke="' + C.white + '" stroke-width="2.5" fill="none" opacity=".9"/>');
  const melon = (x, y, r) => g(x, y, r, s("M0 0a40 40 0 0 1 80 0l-6 8h-68z", C.orange) + s("M0 0a40 40 0 0 1 80 0h-8a32 32 0 0 0-64 0z", C.leaf2));
  const mozzBall = (x, y, r) => circ(x, y, r, C.white) + s("M" + (x - r * .5) + " " + (y - r * .55) + "c6-6 14-6 20 0", "none", ' stroke="' + C.line + '"') + circ(x + r * .3, y + r * .2, r * .18, C.cream, ' stroke="none"');
  const mozzChunk = (x, y, r) => g(x, y, r, s("M0 0l18-8 14 10-6 16-20 4-8-12z", C.white));
  const cheeseWedge = (x, y, r, col, w, h) => g(x, y, r, s("M0 0l" + (w || 60) + "-14 6 " + (h || 36) + "-" + (w || 60) + " 14z", col || C.cheese) + s("M0 0l" + (w || 60) + "-14-2-8-58 14z", "#E6D3A8"));
  const salamiSlice = (x, y, col) => circ(x, y, 17, col || C.meat) + at([[-6, -4], [6, 5], [0, 8], [7, -6], [-7, 6]], (dx, dy) => circ(x + dx, y + dy, 2.6, C.cream, ' stroke="none"'));
  const crostino = (x, y, top) => circ(x, y, 20, C.bread, ' stroke="' + C.crust + '" stroke-width="3"') + (top ? ell(x, y, 12, 9, top, ' stroke="none"') : "");
  const breadSlice = (x, y, r) => g(x, y, r, s("M-50-30q0-20 20-22h60q20 2 20 22v40q0 20-20 22h-60q-20-2-20-22z", C.bread, ' stroke="' + C.crust + '" stroke-width="5"') + '<path d="M-36-16h40M-30 4h56M-36 22h30" stroke="' + C.crust + '" stroke-width="2" opacity=".5"/>');
  const nest = (x, y, w, col, n, spread) => { let out = ""; for (let i = 0; i < (n || 9); i++) { const yy = y - 36 + i * 9, a = 60 + (i % 3) * 8; out += '<path d="M' + (x - a - 30) + " " + yy + "c30-" + (spread || 18) + " 60 " + (spread || 18) + " 90 0s60 " + (spread || 18) + " 90 0" + '" fill="none" stroke="' + col + '" stroke-width="' + w + '" stroke-linecap="round"/>'; } return out; };
  const sauce = (x, y, col, op) => s("M" + (x - 70) + " " + y + "c20-24 56-30 90-22 30 6 52 22 46 40-8 22-46 30-84 26-40-4-66-24-52-44z", col, ' opacity="' + (op || .9) + '" stroke="none"');
  const drizzle = (x, y, col) => '<path d="M' + (x - 60) + " " + y + "c20-10 40 10 60 0s40-10 60 0" + '" fill="none" stroke="' + col + '" stroke-width="4" stroke-linecap="round" opacity=".85"/>';
  const dots = (pts, r, col) => at(pts, (x, y) => circ(x, y, r, col, ' stroke="none"'));
  const gnocco = (x, y, r) => g(x, y, r, ell(0, 0, 17, 11, C.cream, ' stroke="' + C.crust + '" stroke-width="2"') + '<path d="M-10-6v12M-3-8v16M4-8v16M11-6v12" stroke="' + C.crust + '" stroke-width="1.5" opacity=".7"/>');
  const raviolo = (x, y, r, sq) => g(x, y, r, s(sq ? "M-22-22h44v44h-44z" : "M-24-16h48v32h-48z", C.cream, ' stroke="' + C.crust + '" stroke-width="2.5" stroke-dasharray="3 3"') + ell(0, 0, 10, 8, C.bread, ' stroke="none" opacity=".8"'));
  const tortello = (x, y, r) => g(x, y, r, s("M-26 0c0-14 12-22 26-22s26 8 26 22-12 22-26 22S-26 14-26 0z", C.cream, ' stroke="' + C.crust + '" stroke-width="2.5"') + '<path d="M-20 0h40" stroke="' + C.crust + '" stroke-width="1.5" stroke-dasharray="3 3"/>');
  const mushroom = (x, y, r, col) => g(x, y, r, s("M-20 0c0-18 40-18 40 0v6h-40z", col || C.brown) + s("M-8 6h16v16h-16z", "#C9A97B"));
  const truffleShaving = (x, y, r) => g(x, y, r, s("M0 0l26-6 8 10-24 8z", C.dark) + '<path d="M4 1l22-5" stroke="#4A3F38" stroke-width="1.2"/>');
  const walnut = (x, y) => circ(x, y, 9, C.brown) + '<path d="M' + (x - 5) + " " + (y - 3) + "c3 3 7 3 10 0M" + (x - 5) + " " + (y + 3) + 'c3 3 7 3 10 0" stroke="' + C.brown2 + '" stroke-width="1.5" fill="none"/>';
  const guancialeCube = (x, y, r) => g(x, y, r, s("M-8-8h16v16h-16z", C.rose) + s("M-8-8h16v6h-16z", C.meat2));
  const clam = (x, y, r) => g(x, y, r, s("M-18 0a18 18 0 0 1 36 0z", "#EAD9C6") + '<path d="M-12 0l12-16M0 0l0-18M12 0l-12-16" stroke="' + C.line + '" stroke-width="1"/>');
  const mussel = (x, y, r) => g(x, y, r, s("M-20 0c0-16 14-28 20-30 6 2 20 14 20 30-6 4-14 6-20 6s-14-2-20-6z", C.blue) + s("M-12 0c0-10 6-18 12-22 6 4 12 12 12 22-4 2-8 3-12 3s-8-1-12-3z", C.orange));
  const shrimp = (x, y, r) => g(x, y, r, '<path d="M-24 0c12-28 40-28 48 0" fill="none" stroke="' + C.orange + '" stroke-width="10" stroke-linecap="round"/><path d="M-24 0c12-28 40-28 48 0" fill="none" stroke="' + C.line + '" stroke-width="1"/><path d="M22-2l10 8" stroke="' + C.orange + '" stroke-width="4" stroke-linecap="round"/>');
  const eggHalf = (x, y, r) => g(x, y, r, ell(0, 0, 16, 20, C.white) + ell(0, 2, 9, 11, C.yellow, ' stroke="none"'));
  const onionRing = (x, y) => circ(x, y, 12, "none", ' stroke="' + C.purple + '" stroke-width="3"') + circ(x, y, 7, "none", ' stroke="' + C.purple + '" stroke-width="2" opacity=".6"');
  const cucumber = (x, y) => circ(x, y, 12, C.leaf2, ' stroke="' + C.green + '" stroke-width="2"') + circ(x, y, 7, "#D9EBC0", ' stroke="none"') + dots([[x - 3, y], [x + 3, y - 2], [x, y + 3]], 1.2, C.green);
  const feta = (x, y, r) => g(x, y, r, s("M-10-8h20v16h-20z", C.white) + s("M-10-8h20l-4-5h-20z", "#EDE7DA"));
  const potato = (x, y, r) => g(x, y, r, s("M-22 0c0-14 44-14 44 0 0 12-44 12-44 0z", C.amber, ' stroke="' + C.crust + '" stroke-width="2"') + '<path d="M-12-4c8 4 16 4 24 0" stroke="' + C.crust + '" stroke-width="2" fill="none" opacity=".7"/>');
  const avocado = (x, y, r) => g(x, y, r, s("M0-22c12 0 20 12 20 24 0 10-8 20-20 20S-20 12-20 2c0-12 8-24 20-24z", "#A8C97A") + s("M0-14c8 0 12 8 12 16 0 8-4 14-12 14s-12-6-12-14c0-8 4-16 12-16z", "#D6E4A4", ' stroke="none"'));
  const fennel = (x, y, r) => g(x, y, r, s("M-18 0c0-8 8-14 18-14s18 6 18 14-8 12-18 12-18-4-18-12z", "#EDF0E0") + '<path d="M-10 0c4 6 16 6 20 0M-6-6c4 4 8 4 12 0" stroke="' + C.leaf + '" stroke-width="1.5" fill="none"/>');
  const corn = (pts) => dots(pts, 3, C.yellow);
  const tunaChunk = (x, y, r) => g(x, y, r, s("M-16-10c10-6 24-6 32 0v20c-8 6-22 6-32 0z", C.rose) + '<path d="M-10-4c8-2 16-2 22 0M-10 4c8-2 16-2 22 0" stroke="' + C.white + '" stroke-width="1.5" fill="none"/>');
  const crouton = (x, y, r) => g(x, y, r, s("M-8-8h16v16h-16z", C.bread, ' stroke="' + C.crust + '" stroke-width="2"'));
  const grillMarks = (pts) => '<path d="' + pts.map(([x, y, l]) => "M" + x + " " + y + "l" + l + " " + Math.round(l * .9)).join("") + '" stroke="' + C.dark + '" stroke-width="4" opacity=".55" stroke-linecap="round"/>';
  const rosemary = (x, y, r) => g(x, y, r, '<path d="M0 0l60-10" stroke="' + C.green + '" stroke-width="2"/>' + at([[8, -2], [18, -3], [28, -5], [38, -7], [48, -8]], (px, py) => '<path d="M' + px + " " + py + "l-3-9M" + px + " " + py + 'l4-9" stroke="' + C.leaf + '" stroke-width="2.5" stroke-linecap="round"/>'));
  const salt = (pts) => dots(pts, 2, C.white);
  const pepper = (pts) => dots(pts, 1.8, C.dark);
  const oilPool = (x, y) => ell(x, y, 26, 12, C.amber, ' stroke="none" opacity=".7"');
  const steakTbone = () => s("M120 140c20-40 80-60 140-40 30 10 50 34 40 66-10 30-50 50-100 50-50 0-90-30-80-76z", C.meat) + '<path d="M130 140c20-32 70-50 120-34" fill="none" stroke="' + C.crust + '" stroke-width="8" stroke-linecap="round" opacity=".6"/>' + s("M206 108l6 100c0 8-6 12-12 12s-12-4-12-12l6-100c0-8 4-12 12-12s6 4 0 12z", C.paper, ' stroke="' + C.gold + '"') + s("M150 132c0-8 6-12 14-12l92 8c8 1 12 6 10 14s-8 12-16 10l-90-8c-8-1-10-6-10-12z", C.paper, ' stroke="' + C.gold + '"');
  const steakRib = () => s("M124 150c10-44 70-64 130-52 40 8 66 34 58 66-8 30-56 50-110 48-48-2-88-28-78-62z", C.meat) + s("M118 112c-14 14-22 40-20 62 2 12-4 22-14 22s-14-10-12-22c2-30 14-60 34-80 8-8 20 6 12 18z", C.paper, ' stroke="' + C.gold + '"') + '<path d="M144 140c20-30 70-46 120-32" fill="none" stroke="' + C.crust + '" stroke-width="8" stroke-linecap="round" opacity=".6"/>';
  const fillet = (x, y) => ell(x, y + 14, 60, 48, C.meat) + ell(x, y, 60, 40, C.meat2) + '<path d="M' + (x - 40) + " " + (y - 16) + 'c20-14 60-14 80 0" fill="none" stroke="' + C.crust + '" stroke-width="6" stroke-linecap="round" opacity=".6"/>';
  const beefSlice = (x, y, r) => g(x, y, r, s("M0 0h22v48h-22z", C.meat) + s("M5 5h12v38h-12z", C.pink, ' stroke="none"') + '<path d="M0 0h22" stroke="' + C.dark + '" stroke-width="3" opacity=".5"/>');
  const chickenSlice = (x, y, r) => g(x, y, r, s("M0 0h20v46h-20z", C.amber) + s("M4 4h12v38h-12z", C.cream, ' stroke="none"'));
  const chickenBreast = (x, y) => s("M" + (x - 80) + " " + y + "c10-40 60-60 110-46 40 12 60 40 46 66-14 24-70 34-110 20-30-10-50-20-46-40z", C.amber) + '<path d="M' + (x - 60) + " " + (y - 10) + 'c30-16 80-20 120-8" fill="none" stroke="' + C.crust + '" stroke-width="6" stroke-linecap="round" opacity=".6"/>';
  const porkSteak = (x, y) => s("M" + (x - 76) + " " + y + "c6-40 60-58 110-46 36 10 56 34 46 62-12 28-66 40-110 26-34-10-52-22-46-42z", C.rose) + '<path d="M' + (x - 60) + " " + (y - 8) + 'c30-14 80-18 120-6" fill="none" stroke="' + C.crust + '" stroke-width="6" stroke-linecap="round" opacity=".6"/>' + s("M" + (x - 76) + " " + y + "c-2-10 6-16 14-14l20 4-10 12z", C.white);
  const lambChop = (x, y, r) => g(x, y, r, s("M0 0c-6-30 20-56 50-50s40 40 26 60-70 20-76-10z", C.meat) + '<path d="M56-48l36-36" stroke="' + C.paper + '" stroke-width="10" stroke-linecap="round"/><path d="M56-48l36-36" stroke="' + C.line + '" stroke-width="1" fill="none"/>');
  const ossobuco = (x, y) => circ(x, y, 58, C.meat) + circ(x, y, 46, C.meat2, ' stroke="none"') + circ(x, y, 16, C.paper, ' stroke="' + C.gold + '" stroke-width="3"') + circ(x, y, 6, C.rose, ' stroke="none"') + '<path d="M' + (x - 40) + " " + (y - 30) + 'c14-10 30-12 46-6" stroke="' + C.crust + '" stroke-width="5" fill="none" opacity=".6" stroke-linecap="round"/>';
  const stewChunks = (x, y) => at([[x - 40, y - 10, -10], [x + 10, y - 20, 15], [x + 40, y + 10, -20], [x - 10, y + 20, 8], [x + 44, y - 26, 30]], (px, py, r) => g(px, py, r, s("M-18-14h36v28h-36z", C.brown2)));
  const fishFillet = (x, y) => s("M" + (x - 100) + " " + y + "c40-44 100-60 160-46 22 4 40 20 56 46-16 26-34 42-56 46-60 14-120-2-160-46z", C.silver, ' stroke="#8B96A3" stroke-width="2"') + '<path d="M' + (x - 60) + " " + (y - 24) + "c20 10 60 12 100 8M" + (x - 60) + " " + (y + 26) + 'c20-10 60-12 100-8" fill="none" stroke="#8B96A3" stroke-width="1.5"/>' + s("M" + (x + 90) + " " + (y - 34) + "l40-30-10 64 10 60-40-30", C.silver, ' stroke="#8B96A3" stroke-width="2"');
  const lobster = (x, y) => s("M" + (x - 80) + " " + y + "c30-40 90-40 120-10 20 18 30 30 46 30-14 10-30 4-46-6-30 20-80 26-120-14z", C.red) + '<path d="M' + (x - 50) + " " + (y - 22) + "l-24-24M" + (x - 36) + " " + (y - 30) + 'l-14-30" stroke="' + C.red + '" stroke-width="8" stroke-linecap="round"/>' + circ(x - 50, y - 4, 4, C.ink, ' stroke="none"') + '<path d="M' + (x - 30) + " " + (y - 2) + "c10 4 20 6 30 4M" + (x - 20) + " " + (y + 10) + 'c10 4 20 6 30 4" stroke="' + C.wine + '" stroke-width="2" fill="none"/>';
  const vegSlice = (x, y, r, col, inner) => g(x, y, r, ell(0, 0, 16, 9, col) + (inner ? ell(0, 0, 9, 4, inner, ' stroke="none"') : "") + '<path d="M-10-4l6 8M4-6l6 8" stroke="' + C.dark + '" stroke-width="2" opacity=".45"/>');
  const spinachLeaf = (x, y, r) => leaf(x, y, r, C.green, 1.1);
  const beans = (pts) => at(pts, (x, y, r) => g(x, y, r, ell(0, 0, 11, 6.5, C.paper, ' stroke="' + C.crust + '" stroke-width="1.5"') + '<path d="M-2-5v10" stroke="' + C.crust + '" stroke-width="1" opacity=".6"/>'));
  const cake = (a, b) => s("M140 120l100-20 40 70-100 26z", b) + s("M140 120l100-20v50l-100 20z", a) + s("M140 170l100-20v30l-100 20z", b);
  const anchovy = (x, y, r) => g(x, y, r, s("M0 0c10-6 24-6 34 0-10 6-24 6-34 0z", "#8B7355") + '<path d="M4 0h26" stroke="' + C.white + '" stroke-width="1"/>');
  const caper = (x, y) => circ(x, y, 4, C.green);
  const pepperStrip = (x, y, r, col) => g(x, y, r, s("M0 0c14-10 30-10 44 0-14 10-30 10-44 0z", col));
  const mortadella = (x, y, r) => g(x, y, r, s("M0 0c14-14 40-16 60-6-12 10-16 22-6 30-22 4-46 0-54-24z", C.rose) + dots([[14, 6], [30, 2], [40, 14], [22, 16]], 3, C.white) + dots([[34, 8], [18, 12]], 2, C.green));
  const burrata = (x, y) => circ(x, y, 22, C.white) + s("M" + (x - 6) + " " + (y - 20) + "c4-8 10-8 14 0-4 4-10 4-14 0z", C.white) + '<path d="M' + (x - 10) + " " + (y + 6) + 'c6 4 14 4 20 0" stroke="' + C.line + '" stroke-width="1" fill="none"/>';
  const pistachio = (pts) => dots(pts, 3, "#7FA35A");
  const apple = (x, y, r) => g(x, y, r, s("M0 0a14 14 0 0 1 28 0l-2 6h-24z", C.cream) + s("M0 0a14 14 0 0 1 28 0h-4a10 10 0 0 0-20 0z", C.red));
  const wineIn = (col) => '<path d="M150 60h100l-10 110a40 40 0 0 1-80 0z" fill="' + col + '"/><path d="M150 60h100l-10 110a40 40 0 0 1-80 0z" fill="none" stroke="' + C.paper + '" stroke-width="2.5"/>';
  const ice = (pts) => at(pts, (x, y) => '<rect x="' + x + '" y="' + y + '" width="26" height="26" rx="4" fill="' + C.paper + '" opacity=".5"/>');
  const orangeSlice = (x, y) => circ(x, y, 22, C.amber) + circ(x, y, 7, C.cream, ' stroke="none"') + '<path d="M' + x + " " + (y - 22) + "v44M" + (x - 22) + " " + y + "h44M" + (x - 15) + " " + (y - 15) + "l30 30M" + (x + 15) + " " + (y - 15) + 'l-30 30" stroke="' + C.cream + '" stroke-width="1.5"/>';
  const steam = '<path d="M180 90c-6-10 6-16 0-26M200 86c-6-10 6-16 0-26M220 90c-6-10 6-16 0-26" stroke="' + C.paper + '" stroke-width="2" fill="none" opacity=".7"/>';

  /* ---------- the ingredients ---------- */
  const ING = {
    /* bread, starters */
    "pane-tostato": { it: "Pane toscano tostato", en: "Toasted Tuscan bread", svg: breadSlice(150, 160, -12) + breadSlice(250, 170, 10) },
    "pomodoro-dadini": { it: "Pomodoro fresco a dadini", en: "Diced fresh tomato", svg: at([[126, 150, 10], [150, 168, -20], [138, 184, 30], [166, 150, 5], [232, 162, -15], [256, 182, 25], [246, 154, 40], [270, 170, 0]], tomatoCube) },
    basilico: { it: "Basilico", en: "Basil", svg: basil(152, 140, -30) + basil(232, 146, 20) },
    "olio-evo": { it: "Olio extravergine", en: "Extra-virgin olive oil", svg: drizzle(200, 172, C.amber) },
    crostini: { it: "Crostini di pane", en: "Bread crostini", svg: crostino(130, 150) + crostino(190, 130) + crostino(250, 150) + crostino(160, 195) + crostino(220, 200) },
    pate: { it: "Patè di fegatini", en: "Chicken-liver pâté", svg: ell(130, 150, 12, 9, C.brown2, ' stroke="none"') + ell(190, 130, 12, 9, C.brown2, ' stroke="none"') },
    "crema-carciofi": { it: "Crema di carciofi", en: "Artichoke cream", svg: ell(250, 150, 12, 9, "#8FA86A", ' stroke="none"') + ell(160, 195, 12, 9, "#8FA86A", ' stroke="none"') },
    "pomodoro-crostini": { it: "Pomodoro", en: "Tomato", svg: ell(220, 200, 12, 9, C.red2, ' stroke="none"') },
    "fonduta-pecorino": { it: "Fonduta di pecorino", en: "Pecorino fondue", svg: ell(200, 176, 96, 46, C.cheese, ' stroke="none" opacity=".95"') + drizzle(200, 176, "#E6C25A") },
    souffle: { it: "Soufflè di carciofi", en: "Artichoke soufflé", svg: s("M150 168c0-10 8-18 18-18h64c10 0 18 8 18 18v10c0 10-8 18-18 18h-64c-10 0-18-8-18-18z", "#B9B37A") + s("M154 152c8-30 84-30 92 0 -8 8-84 8-92 0z", "#D6CF98") + '<path d="M170 136c20-8 40-8 60 0" stroke="' + C.crust + '" stroke-width="3" fill="none" opacity=".6"/>' },
    carciofi: { it: "Carciofi", en: "Artichokes", svg: at([[150, 132, -20], [250, 128, 20]], (x, y, r) => g(x, y, r, s("M0 0c-14-6-14-22-4-30 2 10 10 14 14 20-2-10 4-20 12-24 0 12 6 18 4 30-8 4-18 6-26 4z", "#8FA86A"))) },
    bufala: { it: "Mozzarella di bufala", en: "Buffalo mozzarella", svg: mozzBall(150, 158, 30) + mozzBall(260, 176, 26) },
    "pomodoro-fette": { it: "Pomodoro a fette", en: "Sliced tomato", svg: tomatoSlice(200, 140) + tomatoSlice(214, 188) + tomatoSlice(112, 186) },
    prosciutto: { it: "Prosciutto crudo", en: "Dry-cured ham", svg: ham(96, 150, -12) + ham(160, 130, 8) + ham(230, 148, -6) + ham(120, 190, 14) },
    melone: { it: "Melone", en: "Melon", svg: melon(190, 178, -10) + melon(250, 150, 15) },
    pecorini: { it: "Pecorini di diversa stagionatura", en: "Pecorini of different ages", svg: cheeseWedge(110, 150, 0, C.cheese) + cheeseWedge(180, 128, 10, C.cream, 64, 40) + cheeseWedge(240, 170, -8, "#E6C25A", 56, 32) },
    miele: { it: "Miele", en: "Honey", svg: circ(292, 168, 20, C.amber, ' stroke="none"') + '<path d="M284 154c10 8 12 20 4 30" fill="none" stroke="' + C.cream + '" stroke-width="3"/>' },
    "composta-cipolle": { it: "Composta di cipolle caramellate", en: "Caramelised onion chutney", svg: ell(126, 196, 20, 12, C.brown) + '<path d="M116 194c6-4 14-4 20 0" stroke="' + C.brown2 + '" stroke-width="1.5" fill="none"/>' },
    "salame-toscano": { it: "Salame toscano", en: "Tuscan salami", svg: salamiSlice(84, 122) + salamiSlice(112, 142) + salamiSlice(90, 168) },
    finocchiona: { it: "Finocchiona", en: "Finocchiona (fennel salami)", svg: salamiSlice(150, 118, C.meat2) + salamiSlice(178, 140, C.meat2) + dots([[150, 118], [178, 140]], 1.5, C.green) },
    "prosciutto-board": { it: "Prosciutto crudo", en: "Dry-cured ham", svg: ham(200, 110, 8, C.pink) + ham(256, 130, -6) },
    "pecorini-board": { it: "Tre pecorini", en: "Three pecorini", svg: cheeseWedge(90, 200, 0, C.cheese, 52, 30) + cheeseWedge(150, 190, 6, C.cream, 52, 30) + cheeseWedge(208, 200, -4, "#E6C25A", 52, 30) },
    "tartine-pate": { it: "Tartine con patè di fegatini", en: "Canapés with liver pâté", svg: crostino(300, 180, C.brown2) + crostino(272, 214, C.brown2) },
    "bruschette-carciofi": { it: "Bruschette con pomodoro e carciofi", en: "Bruschette with tomato and artichoke", svg: crostino(320, 226, C.red2) + crostino(240, 226, "#8FA86A") },
    bresaola: { it: "Bresaola", en: "Bresaola", svg: at([[112, 140, -14], [160, 124, 4], [206, 140, -8], [252, 124, 10], [132, 180, 12], [232, 182, -10]], (x, y, r) => g(x, y, r, s("M-26-16c14-8 38-8 52 0v30c-14 8-38 8-52 0z", C.wine))) },
    rucola: { it: "Rucola", en: "Rocket", svg: at([[120, 200, -20], [150, 206, 10], [180, 210, -10], [220, 208, 20], [260, 204, -15], [290, 196, 15], [200, 120, 0], [240, 126, 30]], rocket) },
    grana: { it: "Scaglie di grana", en: "Grana shavings", svg: shaving(140, 160, -10) + shaving(200, 150, 15) + shaving(250, 170, -25) + shaving(170, 190, 30) },
    /* soups */
    fagioli: { it: "Fagioli cannellini", en: "Cannellini beans", svg: beans([[150, 150, 10], [190, 162, -20], [230, 150, 30], [256, 168, 0], [176, 184, 20], [210, 186, -10], [240, 184, 40], [160, 130, 0], [220, 128, 20]]) },
    "cavolo-nero": { it: "Cavolo nero e verdure", en: "Black cabbage and vegetables", svg: spinachLeaf(150, 146, -30) + spinachLeaf(230, 156, 25) + dots([[176, 168], [246, 140]], 5, C.orange) + dots([[200, 176], [164, 124]], 4, "#D9B25A") },
    "pane-raffermo": { it: "Pane raffermo", en: "Day-old bread", svg: crouton(176, 156, 10) + crouton(216, 172, -20) + crouton(238, 150, 30) + crouton(190, 190, 15) },
    "pomodoro-pappa": { it: "Pomodoro", en: "Tomato", svg: ell(200, 164, 106, 54, C.red, ' stroke="none" opacity=".95"') },
    "verdure-stagione-zuppa": { it: "Verdure di stagione", en: "Seasonal vegetables", svg: dots([[160, 150], [230, 176], [200, 140]], 6, C.orange) + dots([[180, 178], [246, 150]], 5, C.leaf) + dots([[214, 160], [150, 176]], 5, "#D9B25A") + at([[190, 158, 10]], (x, y, r) => g(x, y, r, s("M-8-6h16v12h-16z", C.cream))) },
    brodo: { it: "Brodo", en: "Broth", svg: ell(200, 164, 110, 56, "#C9A15A", ' stroke="none" opacity=".8"') },
    /* pasta */
    spaghetti: { it: "Spaghetti", en: "Spaghetti", svg: nest(200, 164, 5, C.bread, 11, 16) },
    pici: { it: "Pici, pasta fresca tirata a mano", en: "Pici, hand-rolled fresh pasta", svg: nest(200, 164, 9, C.cream, 8, 20) },
    tagliatelle: { it: "Tagliatelle fresche", en: "Fresh tagliatelle", svg: nest(200, 164, 8, C.cream, 9, 18) },
    pappardelle: { it: "Pappardelle fresche", en: "Fresh pappardelle", svg: nest(200, 164, 13, C.cream, 7, 22) },
    linguine: { it: "Linguine", en: "Linguine", svg: nest(200, 164, 6, C.bread, 10, 16) },
    "sugo-pomodoro": { it: "Sugo di pomodoro biologico", en: "Organic tomato sauce", svg: sauce(200, 150, C.red, .88) },
    "pomodoro-mugello": { it: "Pomodoro bio del Mugello", en: "Organic Mugello tomato", svg: sauce(200, 150, C.red, .88) },
    ragu: { it: "Ragù di carne", en: "Meat ragù", svg: sauce(200, 150, C.meat, .9) + dots([[170, 150], [230, 152], [200, 170], [186, 136]], 3.5, C.rose) },
    "ragu-cinghiale": { it: "Ragù di cinghiale", en: "Wild boar ragù", svg: sauce(200, 150, C.brown2, .92) + dots([[170, 150], [230, 152], [200, 170]], 4, C.brown) },
    sfoglia: { it: "Sfoglia fresca all'uovo", en: "Fresh egg pasta sheets", svg: s("M130 130h140v90h-140z", C.bread) },
    "ragu-lasagna": { it: "Ragù di carne", en: "Meat ragù", svg: at([140, 158, 176, 194], y => '<rect x="130" y="' + y + '" width="140" height="8" fill="' + C.meat + '"/>') },
    besciamella: { it: "Besciamella", en: "Béchamel", svg: at([149, 167, 185], y => '<rect x="130" y="' + y + '" width="140" height="6" fill="' + C.cream + '"/>') },
    "gratin-parmigiano": { it: "Gratinatura al parmigiano", en: "Parmesan gratin", svg: s("M130 126h140v10h-140z", C.amber) + s("M130 130l14-14h140l-14 14z", C.cheese) },
    guanciale: { it: "Guanciale croccante", en: "Crisp pork jowl", svg: at([[160, 150, 10], [200, 140, -20], [240, 158, 30], [184, 180, 0], [226, 184, 15]], guancialeCube) },
    "crema-uovo-pecorino": { it: "Crema di uovo e pecorino", en: "Egg and pecorino cream", svg: sauce(200, 150, C.cheese, .75) },
    "pepe-nero": { it: "Pepe nero", en: "Black pepper", svg: pepper([[150, 160], [176, 142], [210, 166], [236, 146], [196, 186], [256, 176], [166, 190]]) },
    gnocchi: { it: "Gnocchi fatti a mano", en: "Handmade gnocchi", svg: at([[140, 140, 0], [172, 128, 10], [204, 140, -10], [236, 128, 5], [268, 142, 0], [156, 170, 15], [188, 182, -5], [220, 170, 10], [252, 182, 0], [172, 206, -10], [216, 206, 10]], gnocco) },
    gnocchetti: { it: "Gnocchetti fatti a mano", en: "Handmade small gnocchi", svg: at([[140, 140, 0], [166, 130, 10], [192, 140, -10], [218, 130, 5], [244, 142, 0], [270, 134, 8], [152, 168, 15], [178, 180, -5], [204, 168, 10], [230, 180, 0], [256, 170, 6], [166, 204, -10], [200, 208, 10], [236, 204, 4]], (x, y, r) => g(x, y, r, '<g transform="scale(.8)">' + gnocco(0, 0, 0) + "</g>")) },
    "mozzarella-fusa": { it: "Mozzarella", en: "Mozzarella", svg: at([[160, 150, 0], [226, 156, 20], [196, 186, -10]], mozzChunk) },
    "crema-gorgonzola": { it: "Crema di gorgonzola", en: "Gorgonzola cream", svg: sauce(200, 150, "#E9E3D0", .9) + dots([[176, 154], [222, 166], [200, 140]], 3, "#8FA0A8") },
    noci: { it: "Noci", en: "Walnuts", svg: walnut(160, 150) + walnut(236, 160) + walnut(198, 190) + walnut(252, 130) },
    porcini: { it: "Funghi porcini", en: "Porcini mushrooms", svg: mushroom(150, 140, -10) + mushroom(240, 160, 10) + mushroom(200, 186, 0, "#A67C4E") },
    pesto: { it: "Pesto di basilico", en: "Basil pesto", svg: sauce(200, 150, C.green, .85) },
    pomodorini: { it: "Pomodorini", en: "Cherry tomatoes", svg: cherry(160, 152, 9) + cherry(236, 146, 9) + cherry(206, 184, 8) + cherry(262, 178, 8) },
    tortelli: { it: "Tortelli ripieni di patate", en: "Potato-filled tortelli", svg: tortello(140, 140, -10) + tortello(200, 128, 5) + tortello(260, 142, 10) + tortello(166, 186, 8) + tortello(232, 188, -6) },
    ravioli: { it: "Ravioli freschi", en: "Fresh ravioli", svg: raviolo(150, 138, -8, true) + raviolo(210, 128, 4, true) + raviolo(266, 146, 10, true) + raviolo(170, 190, 6, true) + raviolo(236, 190, -6, true) },
    "salsa-tartufata": { it: "Salsa tartufata", en: "Truffle sauce", svg: sauce(200, 150, "#6B5A4A", .8) },
    "tartufo-fresco": { it: "Tartufo fresco grattato al tavolo", en: "Fresh truffle, shaved at the table", svg: truffleShaving(150, 130, 20) + truffleShaving(215, 118, -25) + truffleShaving(240, 150, 40) + truffleShaving(175, 168, -10) + truffleShaving(260, 185, 15) + truffleShaving(200, 200, -35) },
    riso: { it: "Riso mantecato", en: "Creamy risotto rice", svg: ell(200, 160, 96, 52, C.cream) + dots([[150, 150], [170, 172], [200, 140], [230, 176], [250, 152], [214, 160], [186, 158], [160, 186], [240, 190]], 4, C.paper) },
    burro: { it: "Burro e parmigiano", en: "Butter and parmesan", svg: drizzle(200, 166, C.yellow) },
    /* mains */
    peposo: { it: "Manzo brasato al Chianti", en: "Beef braised in Chianti", svg: ell(200, 170, 90, 44, C.wine, ' stroke="none"') + stewChunks(200, 160) },
    "pepe-in-grani": { it: "Pepe nero in grani", en: "Whole black peppercorns", svg: pepper([[150, 170], [176, 150], [210, 176], [240, 150], [200, 196], [260, 180], [166, 196]]) },
    ossobuco: { it: "Ossobuco di vitella", en: "Veal ossobuco", svg: ossobuco(200, 160) },
    "sugo-ossobuco": { it: "Il suo sugo", en: "Its own gravy", svg: ell(200, 176, 118, 50, C.brown, ' stroke="none" opacity=".6"') },
    gremolata: { it: "Gremolata: prezzemolo e limone", en: "Gremolata: parsley and lemon", svg: dots([[170, 130], [230, 126], [250, 176], [160, 186], [200, 200]], 3, C.leaf) + dots([[190, 124], [246, 150]], 2.5, C.yellow) },
    "cozze-vongole": { it: "Cozze e vongole", en: "Mussels and clams", svg: clam(140, 150, -10) + clam(262, 178, 20) + mussel(250, 130, 20) + mussel(160, 196, -20) },
    gamberi: { it: "Gamberi", en: "Prawns", svg: shrimp(200, 178, 0) + shrimp(150, 130, -30) },
    calamari: { it: "Calamari", en: "Squid rings", svg: at([[236, 150], [176, 152]], (x, y) => circ(x, y, 10, "none", ' stroke="' + C.white + '" stroke-width="5"')) },
    vongole: { it: "Vongole veraci", en: "Clams", svg: clam(140, 150, -10) + clam(226, 178, 20) + clam(250, 136, -5) + clam(170, 196, 10) },
    "aglio-olio-prezzemolo": { it: "Aglio, olio e prezzemolo", en: "Garlic, oil and parsley", svg: drizzle(200, 168, C.amber) + dots([[160, 150], [206, 136], [244, 168], [186, 190]], 3, C.leaf) },
    "pomodorino-sugo": { it: "Sugo ai pomodorini", en: "Cherry-tomato sauce", svg: sauce(200, 150, C.red2, .7) },
    astice: { it: "Mezzo astice", en: "Half lobster", svg: lobster(200, 150) },
    orata: { it: "Filetto di orata", en: "Sea-bream fillet", svg: fishFillet(200, 160) },
    "verdure-stagione": { it: "Verdure di stagione", en: "Seasonal vegetables", svg: vegSlice(120, 210, -10, C.leaf2, "#D9EBC0") + vegSlice(300, 210, 10, C.orange) + vegSlice(150, 226, 20, C.purple) + tomatoSlice(280, 226) },
    "limone-fish": { it: "Limone", en: "Lemon", svg: circ(110, 130, 14, C.yellow) + circ(110, 130, 5, C.cream, ' stroke="none"') },
    /* steaks */
    fiorentina: { it: "Bistecca con l'osso a T, alta tre dita", en: "T-bone steak, three fingers thick", svg: steakTbone() },
    costola: { it: "Costata con l'osso", en: "Rib steak on the bone", svg: steakRib() },
    entrecote: { it: "Entrecôte", en: "Entrecôte", svg: s("M120 150c10-44 70-64 130-52 40 8 66 34 58 66-8 30-56 50-110 48-48-2-88-28-78-62z", C.meat) + '<path d="M140 140c20-30 70-46 120-32" fill="none" stroke="' + C.crust + '" stroke-width="8" stroke-linecap="round" opacity=".6"/>' },
    filetto: { it: "Filetto di Chianina IGP", en: "Chianina IGP tenderloin", svg: fillet(200, 150) },
    brace: { it: "Sulla brace", en: "On the embers", svg: grillMarks([[140, 160, 40], [160, 150, 40], [240, 150, 30], [180, 190, 30]]) },
    "sale-grosso": { it: "Sale grosso, dopo la cottura", en: "Coarse salt, after cooking", svg: salt([[150, 140], [180, 130], [210, 150], [244, 140], [170, 170], [230, 176], [200, 196], [260, 166]]) },
    rosmarino: { it: "Rosmarino", en: "Rosemary", svg: rosemary(230, 216, -12) },
    "tagliata-manzo": { it: "Manzo a fette, al sangue", en: "Sliced beef, rare", svg: beefSlice(128, 156, -26) + beefSlice(152, 146, -18) + beefSlice(178, 140, -10) + beefSlice(204, 138, -2) + beefSlice(230, 140, 6) + beefSlice(256, 146, 14) },
    "tagliata-pollo": { it: "Petto di pollo a fette", en: "Sliced chicken breast", svg: chickenSlice(130, 156, -26) + chickenSlice(154, 146, -18) + chickenSlice(178, 140, -10) + chickenSlice(202, 138, -2) + chickenSlice(226, 140, 6) + chickenSlice(250, 146, 14) },
    "porcini-carne": { it: "Funghi porcini trifolati", en: "Sautéed porcini", svg: mushroom(140, 196, -10) + mushroom(200, 204, 6) + mushroom(258, 198, 12) },
    costolette: { it: "Costolette d'agnello", en: "Lamb chops", svg: lambChop(110, 176, 0) + lambChop(190, 186, 0) },
    "patate-forno": { it: "Patate al forno", en: "Roast potatoes", svg: potato(150, 150, 0) + potato(190, 138, 12) + potato(230, 150, -8) + potato(170, 178, -14) + potato(212, 184, 8) + potato(250, 176, 20) + potato(192, 206, 0) },
    "patate-lato": { it: "Patate al forno", en: "Roast potatoes", svg: potato(268, 150, 8) + potato(292, 176, -10) + potato(262, 198, 14) },
    maiale: { it: "Bistecca di maiale, 300 g", en: "Pork steak, 300 g", svg: porkSteak(200, 156) },
    "petto-pollo": { it: "Petto di pollo", en: "Chicken breast", svg: chickenBreast(200, 160) },
    "salsa-pomodoro-origano": { it: "Sugo di pomodoro e origano", en: "Tomato sauce and oregano", svg: s("M120 160c10-40 60-60 110-46 40 12 60 40 46 66-14 24-70 34-110 20-30-10-50-20-46-40z", C.red, ' stroke="none" opacity=".9"') + dots([[160, 150], [230, 140], [250, 186], [176, 190]], 2, C.green) },
    "mozzarella-parm": { it: "Mozzarella filante", en: "Melted mozzarella", svg: s("M150 150c30-20 80-20 110 0-20 24-80 28-110 0z", C.cream) },
    parmigiano: { it: "Parmigiano", en: "Parmesan", svg: shaving(160, 146, -10, "#E6D3A8") + shaving(220, 156, 20, "#E6D3A8") },
    "salsa-gorgonzola-brandy": { it: "Salsa al gorgonzola e brandy", en: "Gorgonzola and brandy sauce", svg: '<path d="M130 200c40 14 100 14 140 0" fill="none" stroke="#E9E3D0" stroke-width="16" stroke-linecap="round" opacity=".92"/>' + dots([[170, 204], [230, 206]], 3, "#8FA0A8") },
    "salsa-pepe-verde": { it: "Salsa al pepe verde", en: "Green-pepper sauce", svg: '<path d="M130 200c40 14 100 14 140 0" fill="none" stroke="' + C.cream + '" stroke-width="16" stroke-linecap="round" opacity=".92"/>' + dots([[150, 198], [180, 206], [214, 208], [246, 204]], 3, C.green) },
    /* salads and sides */
    insalata: { it: "Insalata", en: "Lettuce", svg: at([[150, 150, -30], [200, 138, 10], [250, 156, 40], [176, 176, 20], [226, 182, -20], [126, 178, -60], [270, 130, 60]], (x, y, r) => leaf(x, y, r, C.leaf2)) },
    "insalata-mista": { it: "Insalata mista", en: "Mixed salad", svg: at([[150, 150, -30], [200, 138, 10], [250, 156, 40], [176, 176, 20], [226, 182, -20]], (x, y, r) => leaf(x, y, r, C.leaf2)) + rocket(130, 190, -10) + rocket(280, 140, 20) },
    "mozzarella-cubes": { it: "Mozzarella", en: "Mozzarella", svg: at([[160, 184, 0], [222, 150, 10], [246, 190, -8]], (x, y, r) => g(x, y, r, s("M-9-9h18v18h-18z", C.white))) },
    olive: { it: "Olive", en: "Olives", svg: olive(190, 160) + olive(240, 170) + olive(170, 132) + olive(212, 194) },
    mais: { it: "Mais", en: "Sweetcorn", svg: corn([[150, 176], [162, 160], [200, 168], [214, 140], [236, 160], [258, 178], [186, 196], [270, 150]]) },
    cetriolo: { it: "Cetriolo", en: "Cucumber", svg: cucumber(154, 156) + cucumber(246, 184) },
    cipolla: { it: "Cipolla", en: "Onion", svg: onionRing(206, 186) + onionRing(232, 138) },
    feta: { it: "Feta", en: "Feta", svg: feta(176, 148, 10) + feta(224, 170, -8) + feta(200, 194, 14) },
    tonno: { it: "Tonno", en: "Tuna", svg: tunaChunk(160, 150, -10) + tunaChunk(236, 156, 12) },
    "uova-sode": { it: "Uova sode", en: "Boiled eggs", svg: eggHalf(120, 182, -20) + eggHalf(276, 184, 20) },
    "pollo-grigliato": { it: "Pollo alla griglia", en: "Grilled chicken", svg: chickenSlice(150, 136, -20) + chickenSlice(186, 130, -6) + chickenSlice(222, 132, 8) },
    vinaigrette: { it: "Salsa vinaigrette", en: "Vinaigrette", svg: drizzle(200, 170, C.amber) },
    "parmigiano-reggiano": { it: "Parmigiano Reggiano", en: "Parmigiano Reggiano", svg: shaving(150, 176, -10, "#E6D3A8") + shaving(224, 160, 20, "#E6D3A8") + shaving(190, 196, 10, "#E6D3A8") },
    "pan-tostato": { it: "Pan tostato", en: "Croutons", svg: crouton(130, 150, 10) + crouton(258, 146, -20) + crouton(240, 196, 30) + crouton(166, 200, 0) },
    avocado: { it: "Avocado", en: "Avocado", svg: avocado(150, 160, -20) + avocado(250, 170, 20) },
    finocchio: { it: "Finocchio", en: "Fennel", svg: fennel(200, 150, 0) + fennel(176, 190, 10) },
    spinaci: { it: "Spinaci saltati", en: "Sautéed spinach", svg: at([[150, 150, -30], [200, 138, 10], [250, 156, 40], [176, 176, 20], [226, 182, -20], [200, 200, 0]], spinachLeaf) },
    "olio-pepe-rosmarino": { it: "Olio, pepe e rosmarino", en: "Olive oil, pepper and rosemary", svg: drizzle(200, 170, C.amber) + pepper([[160, 150], [230, 176], [200, 196]]) + rosemary(230, 214, -10) },
    "verdure-grigliate": { it: "Verdure grigliate", en: "Grilled vegetables", svg: vegSlice(140, 150, -10, C.purple, "#8A6A8A") + vegSlice(200, 140, 10, C.leaf2, "#D9EBC0") + vegSlice(258, 154, -6, C.orange) + vegSlice(170, 186, 14, C.orange) + vegSlice(232, 190, -14, C.purple, "#8A6A8A") + pepperStrip(180, 210, 0, C.red2) },
    "insalata-verde": { it: "Insalata verde", en: "Green salad", svg: at([[150, 150, -30], [200, 138, 10], [250, 156, 40], [176, 176, 20], [226, 182, -20], [126, 178, -60]], (x, y, r) => leaf(x, y, r, C.leaf2)) },
    /* pinsa toppings */
    "pomodoro-pinsa": { it: "Pomodoro", en: "Tomato", svg: s("M84 164c0-46 54-78 116-78s116 32 116 78-54 78-116 78S84 210 84 164z", C.red, ' stroke="none"') },
    "bianca": { it: "Base bianca", en: "White base", svg: s("M84 164c0-46 54-78 116-78s116 32 116 78-54 78-116 78S84 210 84 164z", C.cream, ' stroke="none"') },
    "mozzarella-pinsa": { it: "Mozzarella", en: "Mozzarella", svg: dots([[140, 150], [190, 130], [240, 150], [170, 185], [220, 190], [270, 175], [200, 160]], 15, C.cream) },
    "basilico-pinsa": { it: "Basilico", en: "Basil", svg: basil(150, 118, -20) + basil(230, 205, 20) },
    origano: { it: "Origano", en: "Oregano", svg: dots([[130, 150], [180, 120], [250, 140], [160, 200], [220, 210], [280, 190], [210, 160]], 2, C.green) },
    capperi: { it: "Capperi", en: "Capers", svg: caper(150, 168) + caper(212, 140) + caper(262, 170) + caper(190, 200) + caper(236, 200) },
    acciughe: { it: "Acciughe", en: "Anchovies", svg: anchovy(130, 140, -10) + anchovy(220, 130, 10) + anchovy(160, 190, 5) + anchovy(240, 190, -8) },
    "salame-toscano-pinsa": { it: "Salame toscano", en: "Tuscan salami", svg: at([[140, 150], [200, 130], [260, 150], [170, 190], [230, 195]], (x, y) => salamiSlice(x, y, C.meat)) },
    "salame-piccante": { it: "Salame piccante", en: "Spicy salami", svg: at([[140, 150], [200, 130], [260, 150], [170, 190], [230, 195]], (x, y) => salamiSlice(x, y, C.red)) },
    "prosciutto-cotto": { it: "Prosciutto cotto", en: "Cooked ham", svg: ham(110, 150, -12, C.rose) + ham(220, 140, 6, C.rose) + ham(150, 195, 10, C.rose) },
    funghi: { it: "Funghi", en: "Mushrooms", svg: at([[150, 130, -10], [250, 130, 10], [200, 200, 0], [290, 180, 20]], (x, y, r) => g(x, y, r, '<g transform="scale(.7)">' + mushroom(0, 0, 0, "#D8C4A6") + "</g>")) },
    "prosciutto-parma": { it: "Prosciutto di Parma", en: "Parma ham", svg: ham(110, 150, -12) + ham(220, 140, 6) + ham(150, 195, 10) + ham(260, 190, -4) },
    "rucola-pinsa": { it: "Rucola", en: "Rocket", svg: at([[140, 170, -20], [190, 210, 10], [250, 200, -10], [290, 150, 20], [200, 120, 0]], rocket) },
    "bufala-pinsa": { it: "Mozzarella di bufala", en: "Buffalo mozzarella", svg: mozzChunk(170, 150, 0) + mozzChunk(240, 170, 20) + mozzChunk(200, 195, -10) },
    peperoni: { it: "Peperoni", en: "Peppers", svg: pepperStrip(130, 150, -10, C.red2) + pepperStrip(220, 130, 10, C.yellow) + pepperStrip(160, 200, 5, C.leaf2) },
    melanzane: { it: "Melanzane", en: "Aubergines", svg: vegSlice(250, 150, 10, C.purple, "#8A6A8A") + vegSlice(200, 200, -10, C.purple, "#8A6A8A") },
    zucchine: { it: "Zucchine", en: "Courgettes", svg: vegSlice(150, 130, 0, C.leaf2, "#D9EBC0") + vegSlice(270, 200, -10, C.leaf2, "#D9EBC0") },
    "olive-pinsa": { it: "Olive", en: "Olives", svg: olive(190, 160) + olive(240, 190) + olive(170, 176) + olive(270, 140) },
    mortadella: { it: "Mortadella", en: "Mortadella", svg: mortadella(110, 150, -12) + mortadella(220, 140, 6) + mortadella(150, 195, 10) },
    burrata: { it: "Burrata", en: "Burrata", svg: burrata(200, 166) },
    pistacchio: { it: "Granella di pistacchio", en: "Pistachio crumble", svg: pistachio([[180, 150], [224, 156], [210, 190], [186, 184], [240, 176], [160, 176], [200, 140], [232, 140]]) },
    champignon: { it: "Champignon", en: "Button mushrooms", svg: at([[150, 130, -10], [250, 136, 10], [200, 204, 0]], (x, y, r) => g(x, y, r, '<g transform="scale(.7)">' + mushroom(0, 0, 0, "#D8C4A6") + "</g>")) },
    /* desserts */
    "pasta-frolla": { it: "Pasta frolla", en: "Shortcrust pastry", svg: cake(C.bread, C.crust) },
    mele: { it: "Mele a fette", en: "Sliced apples", svg: apple(150, 118, -10) + apple(180, 112, -10) + apple(210, 106, -10) },
    "zucchero-cannella": { it: "Zucchero e cannella", en: "Sugar and cinnamon", svg: dots([[160, 116], [190, 110], [220, 104], [240, 100]], 2, C.brown) + salt([[172, 112], [204, 106], [234, 98]]) },
    savoiardi: { it: "Savoiardi inzuppati nel caffè", en: "Sponge fingers soaked in coffee", svg: s("M140 130h110v80h-110z", "#D9B98A") + s("M250 130l20-20v80l-20 20z", "#C9A97B") + at([150, 182], y => '<rect x="140" y="' + y + '" width="110" height="12" fill="' + C.brown + '"/>') },
    mascarpone: { it: "Crema al mascarpone", en: "Mascarpone cream", svg: at([[140, 12], [162, 20], [194, 16]], (y, h) => '<rect x="140" y="' + y + '" width="110" height="' + h + '" fill="' + C.cream + '"/>') + s("M140 130l20-20h110l-20 20z", C.cream) },
    cacao: { it: "Cacao amaro", en: "Bitter cocoa", svg: s("M140 130l20-20h110l-20 20z", C.brown) + '<path d="M150 126l100-2" stroke="' + C.dark + '" stroke-width="4" stroke-dasharray="3 3"/>' },
    "base-cioccolato": { it: "Torta al cioccolato", en: "Chocolate cake", svg: cake("#4A2C22", C.dark) },
    ganache: { it: "Ganache al cioccolato", en: "Chocolate ganache", svg: s("M140 140l100-20v10l-100 20z", C.brown) + '<path d="M160 200c20 8 40 6 60-2" stroke="' + C.paper + '" stroke-width="4" fill="none"/>' },
    "base-biscotto": { it: "Base di biscotto", en: "Biscuit base", svg: s("M140 170l100-20v30l-100 20z", C.bread) },
    "crema-formaggio": { it: "Crema di formaggio", en: "Cream-cheese filling", svg: s("M140 120l100-20 40 70-100 26z", C.cream) + s("M140 120l100-20v50l-100 20z", C.white) },
    "frutti-di-bosco": { it: "Frutti di bosco", en: "Berries", svg: '<path d="M150 132c20-2 50-8 80-14" stroke="' + C.red + '" stroke-width="8" stroke-linecap="round" fill="none"/>' + circ(270, 190, 8, C.wine) + circ(258, 204, 6, C.red) },
    "panna-cotta": { it: "Panna cotta", en: "Panna cotta", svg: s("M150 190c0-40 20-60 50-60s50 20 50 60z", C.paper, ' stroke="' + C.crust + '" stroke-width="2"') + ell(200, 190, 50, 10, C.cream, ' stroke="none"') },
    "salsa-frutti-rossi": { it: "Salsa ai frutti rossi", en: "Red-fruit sauce", svg: s("M170 140c20-10 40-10 60 0-10 12-50 12-60 0z", C.red, ' stroke="none"') + '<path d="M186 150l-6 30M214 150l6 30" stroke="' + C.red + '" stroke-width="5" stroke-linecap="round"/>' + circ(268, 176, 8, C.wine) },
    cantucci: { it: "Cantucci alle mandorle", en: "Almond cantucci", svg: at([[120, 150, -20], [160, 170, -20], [200, 190, -20]], (x, y, r) => g(x, y, r, s("M0 0h80q10 0 10 12t-10 12h-80q-10 0-10-12t10-12z", C.bread, ' stroke="' + C.crust + '" stroke-width="2"') + dots([[20, 12], [52, 10]], 4, C.brown))) },
    vinsanto: { it: "Un bicchiere di Vinsanto", en: "A glass of Vin Santo", svg: s("M270 110h30l-4 60a11 11 0 0 1-22 0z", C.amber, ' stroke="none"') + '<path d="M270 110h30l-4 60a11 11 0 0 1-22 0z" fill="none" stroke="' + C.paper + '" stroke-width="2"/><rect x="282" y="180" width="6" height="26" fill="' + C.paper + '"/>' },
    ananas: { it: "Ananas", en: "Pineapple", svg: circ(170, 150, 34, C.amber) + circ(170, 150, 10, C.cream, ' stroke="none"') + '<path d="M170 116v68M136 150h68M146 126l48 48M194 126l-48 48" stroke="' + C.cream + '" stroke-width="2"/>' + circ(240, 180, 30, C.amber) + circ(240, 180, 9, C.cream, ' stroke="none"') },
    "frutta-fresca": { it: "Frutta fresca di stagione", en: "Fresh seasonal fruit", svg: circ(272, 130, 12, C.wine) + cherry(130, 200, 10) + apple(250, 210, 0) },
    /* drinks */
    "vino-rosso": { it: "Vino rosso", en: "Red wine", svg: wineIn(C.wine) },
    "vino-riserva": { it: "Vino rosso Riserva", en: "Riserva red wine", svg: wineIn("#4A0F1C") },
    "vino-bianco": { it: "Vino bianco", en: "White wine", svg: wineIn("#E9D89A") },
    "rose": { it: "Rosé", en: "Rosé", svg: wineIn("#E8A0A0") },
    prosecco: { it: "Prosecco", en: "Prosecco", svg: '<path d="M180 40h40l-6 150a14 14 0 0 1-28 0z" fill="#E9D89A"/><path d="M180 40h40l-6 150a14 14 0 0 1-28 0z" fill="none" stroke="' + C.paper + '" stroke-width="2.5"/>' },
    bollicine: { it: "Bollicine", en: "Bubbles", svg: dots([[190, 80], [206, 110], [196, 140], [210, 60], [200, 170]], 3, C.paper) },
    moscato: { it: "Moscato", en: "Moscato", svg: wineIn("#F2E3A0") },
    "gallo-nero": { it: "Chianti Classico", en: "Chianti Classico", svg: wineIn("#6B1A2A") },
    vermentino: { it: "Vermentino", en: "Vermentino", svg: wineIn("#EDE4B8") },
    brunello: { it: "Brunello di Montalcino", en: "Brunello di Montalcino", svg: wineIn("#4A1420") },
    bolgheri: { it: "Bolgheri", en: "Bolgheri", svg: wineIn("#521826") },
    nobile: { it: "Nobile di Montepulciano", en: "Nobile di Montepulciano", svg: wineIn("#5E1A2C") },
    birra: { it: "Birra", en: "Beer", svg: '<path d="M140 70h120v150q0 20-20 20h-80q-20 0-20-20z" fill="' + C.amber + '"/><path d="M160 110v100M180 120v90" stroke="' + C.paper + '" stroke-width="2" opacity=".4"/>' },
    "birra-scura": { it: "Birra ambrata", en: "Amber beer", svg: '<path d="M140 70h120v150q0 20-20 20h-80q-20 0-20-20z" fill="#B0602A"/>' },
    "birra-chiara": { it: "Birra chiara", en: "Pale beer", svg: '<path d="M140 70h120v150q0 20-20 20h-80q-20 0-20-20z" fill="#EBC15A"/>' },
    schiuma: { it: "Schiuma", en: "Head of foam", svg: '<path d="M130 76c10-24 34-30 60-24 20-14 44-8 54 10 16-4 30 8 28 24H130z" fill="' + C.paper + '"/>' },
    ghiaccio: { it: "Ghiaccio", en: "Ice", svg: ice([[170, 110], [220, 130], [190, 160]]) },
    aperol: { it: "Aperol e prosecco", en: "Aperol and prosecco", svg: '<path d="M140 60h120l-10 130a50 50 0 0 1-100 0z" fill="' + C.orange + '" opacity=".85"/>' },
    "fetta-arancia": { it: "Fetta d'arancia", en: "Orange slice", svg: orangeSlice(250, 80) + '<path d="M200 40l6 20" stroke="' + C.paper + '" stroke-width="3"/>' },
    amaro: { it: "Amaro", en: "Amaro", svg: '<path d="M170 100h60v110a30 30 0 0 1-60 0z" fill="#6B3A1E"/>' },
    liquore: { it: "Liquore", en: "Liqueur", svg: '<path d="M170 100h60v110a30 30 0 0 1-60 0z" fill="' + C.amber + '"/>' },
    "liquore-riserva": { it: "Liquore riserva", en: "Reserve liqueur", svg: '<path d="M170 100h60v110a30 30 0 0 1-60 0z" fill="#9A6A2E"/>' },
    espresso: { it: "Espresso", en: "Espresso", svg: ell(200, 122, 60, 14, C.dark, ' stroke="none"') },
    "crema-caffe": { it: "La crema", en: "The crema", svg: ell(200, 122, 30, 6, C.brown, ' stroke="none" opacity=".85"') + steam },
    "acqua-calda": { it: "Acqua calda", en: "Hot water", svg: ell(200, 112, 70, 16, "#5A3A2A", ' stroke="none"') + steam },
    "latte-montato": { it: "Latte montato", en: "Frothed milk", svg: ell(200, 112, 70, 16, C.cream, ' stroke="none"') },
    "latte-caldo": { it: "Latte caldo", en: "Hot milk", svg: ell(200, 112, 70, 16, "#D9B98A", ' stroke="none"') },
    "cacao-cappuccino": { it: "Un velo di cacao", en: "A dusting of cocoa", svg: s("M170 112c10-10 24-8 30 0 6-8 20-10 30 0-10 8-20 8-30 2-10 6-20 6-30-2z", C.brown, ' stroke="none"') },
    "caffe-tazza": { it: "Caffè", en: "Coffee", svg: ell(200, 112, 70, 16, C.dark, ' stroke="none"') },
    "decaffeinato": { it: "Caffè decaffeinato", en: "Decaffeinated coffee", svg: ell(200, 122, 60, 14, "#3A2E28", ' stroke="none"') },
    "caffe-shakerato": { it: "Caffè shakerato con ghiaccio", en: "Espresso shaken with ice", svg: '<path d="M150 60h100l-10 110a40 40 0 0 1-80 0z" fill="#3B2A22"/><path d="M150 60h100l-10 110a40 40 0 0 1-80 0z" fill="none" stroke="' + C.paper + '" stroke-width="2.5"/>' + ice([[170, 90], [206, 120]]) },
    "schiuma-caffe": { it: "Schiuma di caffè", en: "Coffee foam", svg: ell(200, 66, 48, 12, "#C9A97B", ' stroke="none"') },
    cioccolata: { it: "Cioccolata fusa", en: "Melted chocolate", svg: ell(200, 112, 70, 16, "#4A2C22", ' stroke="none"') },
    panna: { it: "Panna", en: "Whipped cream", svg: ell(200, 108, 30, 10, C.cream, ' stroke="none"') },
    grappa: { it: "Un goccio di grappa", en: "A dash of grappa", svg: ell(200, 122, 20, 5, "#E9D89A", ' stroke="none" opacity=".9"') },
    "succo": { it: "Succo di frutta", en: "Fruit juice", svg: '<path d="M160 70h80v160q0 20-20 20h-40q-20 0-20-20z" fill="' + C.orange + '" opacity=".85"/>' },
    bibita: { it: "Bibita fresca", en: "Cold soft drink", svg: '<path d="M160 70h80v160q0 20-20 20h-40q-20 0-20-20z" fill="' + C.paper + '" opacity=".25"/>' + dots([[176, 110], [206, 150], [186, 190], [214, 100]], 4, C.paper) },
    cannuccia: { it: "Cannuccia", en: "Straw", svg: '<path d="M228 60l10-30" stroke="' + C.paper + '" stroke-width="3"/>' },
    "acqua-the": { it: "Acqua bollente", en: "Boiling water", svg: ell(200, 112, 70, 16, "#F0DDAA", ' stroke="none"') + steam },
    "bustina-the": { it: "Tè o tisana a scelta", en: "Tea or infusion of your choice", svg: '<path d="M200 112l40-50" stroke="' + C.paper + '" stroke-width="2"/><rect x="232" y="50" width="20" height="14" fill="' + C.paper + '"/>' + ell(200, 112, 70, 16, C.amber, ' stroke="none" opacity=".7"') },
    arance: { it: "Arance", en: "Oranges", svg: orangeSlice(250, 80) },
    spremuta: { it: "Spremuta fresca", en: "Fresh-squeezed juice", svg: '<path d="M160 70h80v160q0 20-20 20h-40q-20 0-20-20z" fill="' + C.amber + '"/>' },
    "acqua-minerale": { it: "Acqua minerale, naturale o frizzante", en: "Mineral water, still or sparkling", svg: '<path d="M176 50h48v30l14 20v130q0 20-20 20h-36q-20 0-20-20V100l14-20z" fill="' + C.paper + '" opacity=".25"/><path d="M270 140h60l-6 90a24 24 0 0 1-48 0z" fill="' + C.paper + '" opacity=".25"/>' },
  };

  window.ART = { BASE: BASE, ING: ING };
})();
