/**
 * ORDERING SYSTEM — FIRST-CUT TEMPLATE (branding layer only)
 * ============================================================
 * Built from a real byte-level diff of the two live bundles (Sergio Bar, Carrozze).
 * See README.md in this directory for the full evidence trail and what's NOT covered here.
 *
 * What this file proves, by construction (not assertion):
 *   - Every literal that actually differed between the two real PAGINA_ENTRA bundles is now a
 *     CLIENT_CONFIG lookup.
 *   - Everything that was IDENTICAL between the two real bundles (the PIN-pad logic, the
 *     #FF9C8C error red, which is a shared semantic color, not a brand token) stayed as shared
 *     code, untouched.
 *   - Feeding CLIENT_CONFIG_SERGIO into pagina_entra() reproduces Sergio's real PAGINA_ENTRA.
 *     Feeding CLIENT_CONFIG_CARROZZE in reproduces Carrozze's real PAGINA_ENTRA.
 *
 *   ACTUALLY VERIFIED, not just asserted: pagina_entra(), faviconIcoSvg(), and
 *   paginaNonConfigurato() were each run under Node for both configs and diffed byte-for-byte
 *   against the real PAGINA_ENTRA / /favicon.ico / 404-page content extracted from the two live
 *   bundles. faviconIcoSvg() and paginaNonConfigurato() match exactly. pagina_entra() matches
 *   exactly except two purely cosmetic differences: the real bundles write "✓"/"✨"
 *   where this file writes the literal characters "✓"/"✨" (same code points, just a different
 *   JS escaping style) and a trailing newline. No functional or value difference remains.
 *
 *   That verification pass caught two real mistakes in an earlier draft of this file, both fixed
 *   and both worth knowing about since they're genuine findings, not just template bugs:
 *     1. The post-login avatar-circle background does NOT use the same named token in both real
 *        venues — Sergio's real page uses `oro`, Carrozze's uses `oroHi`. A first pass that
 *        assumed one formula for both silently produced a shade neither venue actually ships.
 *        Now an explicit `branding.avatarBg` field per venue (see below).
 *     2. The favicon badge background is a THIRD, distinct color in Carrozze's real bundle
 *        (`#4A0C16`) — not `oro`, not `fondo`, not `carta`. It appears only in favicon/icon
 *        contexts (14 occurrences, checked) and doesn't reduce to any other token in the
 *        palette. Sergio's favicon badge happens to reuse `oro`, which made the coincidence easy
 *        to mistake for a rule. Now explicit `branding.faviconBg` / `branding.faviconStroke`
 *        fields, set per venue rather than derived.
 *   Point being: even in the "easy," fully-templatable part of this codebase, guessing at a
 *   shared formula from one example produces wrong output — the safe pattern is explicit
 *   per-venue fields, verified against the real bundle, not inferred color relationships.
 *
 * What this file deliberately does NOT include:
 *   - The ~800-line shared backend (session/auth, Guardia watchdog, fiscal VAT resolution,
 *     bill/split-bill, kitchen order flow, the 35-route /api/* table). Confirmed byte-identical
 *     between both live deployments today — it needs ZERO client-specific changes. Copy it
 *     verbatim from either live bundle; do not retype it here. Retyping it into a second file
 *     just creates a second place for it to drift (see README's anti-seed-shield finding —
 *     that's exactly this failure mode, already happened once).
 *   - PAGINA, PAGINA_CLIENTE, PAGINA_SERVIZIO — the three big compiled React/SPA pages. These
 *     are NOT cleanly templatable from the compiled Worker bundle (no :root token block exists
 *     anywhere in them; colors are baked per-utility-class, Tailwind-build-output-shaped; no
 *     source maps). See README "The real blocker" for the specific, checked reasons and the
 *     concrete next step (pull pre-build source via the Higgsfield MCP tools). Left as marked
 *     placeholders below rather than force-templated.
 */

// ─────────────────────────────────────────────────────────────────────────
// CLIENT_CONFIG — the shape. One object per venue lives in D1 in the real
// system (see README: domain routing and per-venue data are already
// DB-driven for the backend). What follows is the analogous shape for the
// branding literals that are NOT yet DB-driven — currently hand-edited
// into the Worker script per client, which is the gap this template closes
// for the 5 small pages + backend inline literals.
// ─────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} ClientConfig
 * @property {string} nome                 - venue display name (e.g. used in <title> suffixes)
 * @property {Object} branding
 * @property {string} branding.fondo       - page background (was hardcoded "#F7F0E1" / "#170406")
 * @property {string} branding.carta       - card/surface color ("#FCF8EF" / "#2A050C")
 * @property {string} branding.bordo       - border color
 * @property {string} branding.testo       - primary text color ("#17352A" / "#F7F0E1")
 * @property {string} branding.testoRgb    - same color as "r,g,b" triplet, for rgba() usage
 *                                            (both real bundles build translucent text colors
 *                                            from this — rgba(23,53,42,.5) / rgba(247,240,225,.5))
 * @property {string} branding.oro         - accent/ink color used on SVG strokes, PIN dots, etc.
 * @property {string} branding.oroHi       - lighter accent, used for the PIN-entered dots color
 *                                            ("#2E7D64" / "#E8CE7A")
 * @property {string} branding.oroRgb      - accent color as "r,g,b", for rgba() button borders
 * @property {string} branding.faviconBg   - background of the favicon's rounded-square badge.
 *                                            NOTE: this is its own, third color, distinct from
 *                                            `oro`/`fondo`/`carta` — checked directly against
 *                                            both real bundles. Sergio's favicon badge happens to
 *                                            reuse `oro` (#1C5247), but Carrozze's uses "#4A0C16",
 *                                            a color that appears ONLY as this badge background
 *                                            (14 occurrences, all in favicon/icon contexts) and
 *                                            nowhere else in Carrozze's palette — a genuinely
 *                                            distinct, one-off brand color neither `fondo`
 *                                            (#170406) nor `carta` (#2A050C) capture. Do not
 *                                            derive this from another token; it doesn't reduce.
 *                                            UPDATE (2026-08-31, real source): confirmed not a
 *                                            coincidence — Carrozze's real pre-build source
 *                                            (`app/src/carrozze.tsx`, see README "Follow-up: real
 *                                            pre-build source") names this exact value `--ossa`
 *                                            ("bone" — the carriage-wheel motif), a deliberate
 *                                            design token, not a one-off. Confirmed live: 14
 *                                            occurrences of #4A0C16 in the deployed bundle,
 *                                            matching the earlier bundle-only count exactly.
 * @property {string} branding.faviconStroke - stroke color for the favicon's icon lines. NOTE:
 *                                            which named token this equals ALSO differs by venue
 *                                            (Sergio: `fondo`; Carrozze: `oro` — the inverse
 *                                            relationship), so this is its own explicit field
 *                                            rather than a formula from faviconBg.
 * @property {string} branding.avatarBg    - background of the little round avatar/initial shown
 *                                            on the post-login "Ciao, X!" welcome screen. NOTE:
 *                                            in the two real bundles this is NOT the same named
 *                                            token both times — Sergio's real page uses `oro`
 *                                            here, Carrozze's real page uses `oroHi`. Rather than
 *                                            force one formula and silently produce a shade
 *                                            neither venue actually ships, this is its own field,
 *                                            set explicitly per venue below. Worth knowing: the
 *                                            token-to-UI-role mapping isn't fully consistent
 *                                            between the two real, live pages — another sign
 *                                            these are hand-edited copies, not one systematically
 *                                            themed source.
 * @property {string} icon
 * @property {string} icon.faviconInner    - inner SVG markup for the favicon data-URI
 *                                            (bespoke per-venue illustration — see README, this
 *                                            is creative content, not a computable value)
 * @property {string} icon.headerSvg       - the header-icon <svg>...</svg> markup shown on
 *                                            PAGINA_ENTRA (same "bespoke asset" caveat)
 * @property {Object} flags
 * @property {boolean} flags.hideBorrowedSocialLink
 *                                          - generalized form of the real `SBNOIG` boolean found
 *                                            in both bundles' PAGINA_SERVIZIO: true when this
 *                                            venue's page still carries placeholder social-link
 *                                            content borrowed from another venue's template and
 *                                            needs it hidden until the venue has its own profile.
 * @property {string} [flags.borrowedSocialLinkSelector]
 *                                          - e.g. 'a[href*="instagram.com/bar_carrozze_"]' — only
 *                                            meaningful when hideBorrowedSocialLink is true.
 */

// The two real venues, values extracted directly from their live bundles (verified against the
// diff transcript — see README "Quantifying the duplication" for how these were found).

const CLIENT_CONFIG_SERGIO = {
  nome: "Sergio bar",
  branding: {
    fondo: "#F7F0E1",
    carta: "#FCF8EF",
    bordo: "#E5DBC9",
    testo: "#17352A",
    testoRgb: "23,53,42",
    oro: "#1C5247",
    oroHi: "#2E7D64",
    oroRgb: "28,82,71",
    avatarBg: "#1C5247", // real value: same as `oro` for Sergio — see avatarBg note above
    faviconBg: "#1C5247", // real value: same as `oro` for Sergio (coincidence, not derived — see note above)
    faviconStroke: "#F7F0E1", // real value: same as `fondo` for Sergio
  },
  icon: {
    // Sergio's real favicon/header icon: a cup-and-tray line drawing (Duomo-adjacent bar theme).
    faviconInner:
      "%3Cg transform='translate%283.5,14.6%29 scale%280.62%29' fill='none' stroke='%23{{STROKE}}' " +
      "stroke-width='3.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M16 51h60'/%3E" +
      "%3Cpath d='M26 51v-8h40v8'/%3E%3Cpath d='M33 51v-4M46 51v-4M59 51v-4'/%3E" +
      "%3Cpath d='M26 43C27 24 39 11 46 7C53 11 65 24 66 43'/%3E" +
      "%3Cpath d='M37 43C38 27 43 15 46 8M55 43C54 27 49 15 46 8'/%3E" +
      "%3Cpath d='M40 7h12M42 7V3h8v4M46 3V0.8'/%3E%3C/g%3E",
    headerSvg:
      '<svg width="54" height="34" viewBox="0 0 92 56" fill="none" stroke="{{ORO}}" stroke-width="3.4" ' +
      'stroke-linecap="round" stroke-linejoin="round"><path d="M16 51h60"/><path d="M26 51v-8h40v8"/>' +
      '<path d="M33 51v-4M46 51v-4M59 51v-4"/><path d="M26 43C27 24 39 11 46 7C53 11 65 24 66 43"/>' +
      '<path d="M37 43C38 27 43 15 46 8M55 43C54 27 49 15 46 8"/><path d="M40 7h12M42 7V3h8v4M46 3V0.8"/></svg>',
  },
  flags: {
    // Real value confirmed in Sergio's PAGINA_SERVIZIO: `var SBNOIG = true;`
    hideBorrowedSocialLink: true,
    borrowedSocialLinkSelector: 'a[href*="instagram.com/bar_carrozze_"]',
  },
};

const CLIENT_CONFIG_CARROZZE = {
  nome: "Le Carrozze",
  branding: {
    fondo: "#170406",
    carta: "#2A050C",
    bordo: "#2C343A", // from the /sala vanilla-page :root block; kept distinct from `oro` deliberately
    testo: "#F7F0E1",
    testoRgb: "247,240,225",
    oro: "#C9A227",
    oroHi: "#E8CE7A",
    oroRgb: "201,162,39",
    avatarBg: "#E8CE7A", // real value: same as `oroHi` for Carrozze, NOT `oro` — see avatarBg note above.
    // NOTE (2026-08-31, real source): Carrozze's real pre-build prototype (carrozze.tsx) names its
    // own "--oro-hi" token #F0DC9A, NOT #E8CE7A — a confirmed drift between that source snapshot
    // and the live deployment (both hexes are live in the bundle, but #E8CE7A dominates with 50
    // occurrences vs #F0DC9A's 6). #E8CE7A is correct here because it's the value pagina_entra()
    // was byte-verified against below — this note is a warning, not a fix: even Carrozze's real
    // source can be stale, so don't trust a source value over a live-bundle-verified one.
    faviconBg: "#4A0C16", // real value: a genuinely distinct color, not derived from any other token — see note above.
    // Confirmed by real source: this is `--ossa` in carrozze.tsx, a deliberately named brand token
    // (the carriage-wheel "bone" motif), not an unexplained one-off — see the faviconBg jsdoc above.
    faviconStroke: "#C9A227", // real value: same as `oro` for Carrozze (inverse of Sergio's fondo-stroke choice)
  },
  icon: {
    // Real Carrozze icon: a wheel/carriage motif — genuinely different path data from Sergio's,
    // not a recolor of the same asset. Confirms this slot is bespoke creative content per venue.
    faviconInner:
      "%3Cg stroke='%23{{STROKE}}' stroke-width='3' fill='none' stroke-linecap='round' " +
      "stroke-linejoin='round'%3E%3Ccircle cx='21' cy='45' r='7'/%3E%3Ccircle cx='45' cy='43' r='9'/%3E" +
      "%3Cpath d='M11 39h13l4-9h19l5 9h5'/%3E%3C/g%3E",
    headerSvg:
      '<svg width="54" height="34" viewBox="0 0 92 56" fill="none" stroke="{{ORO}}" stroke-width="3.4" ' +
      'stroke-linecap="round">\n    <circle cx="26" cy="38" r="13"/><circle cx="64" cy="36" r="17"/>\n    ' +
      '<path d="M12 24h30l22 12"/><path d="M42 24l-5-13"/></svg>',
  },
  flags: {
    // Real value confirmed in Carrozze's PAGINA_SERVIZIO: `var SBNOIG = false;`
    // (Carrozze's own Instagram link is the real one — nothing borrowed, nothing to hide.)
    hideBorrowedSocialLink: false,
  },
};

// A color that is IDENTICAL in both real bundles — #FF9C8C, the PIN-gate error-state red — is
// deliberately NOT in CLIENT_CONFIG. It's shared semantic UI color, not a brand token, per the
// README's caution about blind hex find-and-replace. Shared constants like this belong with the
// rest of the shared code, not in per-venue config.
const SHARED_UI = {
  erroreColore: "#FF9C8C",
};

// ─────────────────────────────────────────────────────────────────────────
// PAGINA_ENTRA — fully templated. This is the smallest of the 3 "hard"
// candidates... actually the smallest of the 5 easy ones, and the one
// worked through in full here as proof the pattern holds end to end,
// including the bespoke SVG icon slot and the flag-driven behavior.
//
// To verify: call pagina_entra(CLIENT_CONFIG_SERGIO) and diff the result
// against the real `PAGINA_ENTRA` constant from the Sergio bundle. Every
// literal that differed in the real diff is substituted here; everything
// that was identical in the real diff (markup structure, the PIN-pad
// script, SHARED_UI.erroreColore) is untouched shared code below.
// ─────────────────────────────────────────────────────────────────────────

function pagina_entra(cfg) {
  const b = cfg.branding;
  const faviconSvg =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E" +
    `%3Crect width='64' height='64' rx='12' fill='%23${b.faviconBg.slice(1)}'/%3E` +
    cfg.icon.faviconInner.replace("{{STROKE}}", b.faviconStroke.slice(1)) +
    "%3C/svg%3E";

  return `<!doctype html><html lang="it"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex"><link rel="icon" href="${faviconSvg}">
<title>Accesso riservato</title>
<style>
 *{box-sizing:border-box}
 body{margin:0;min-height:100vh;display:grid;place-items:center;background:${b.fondo};color:${b.testo};
   font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;padding:24px}
 .b{width:100%;max-width:340px;text-align:center}
 svg{margin-bottom:16px}
 h1{font-size:20px;font-weight:600;margin:0 0 4px;letter-spacing:.03em}
 p{color:rgba(${b.testoRgb},.5);font-size:14px;margin:0 0 26px}
 .p{height:44px;font-size:32px;letter-spacing:16px;color:${b.oroHi};margin-bottom:8px}
 .t{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
 .t button{padding:20px;border-radius:12px;border:1px solid rgba(${b.oroRgb},.3);
   background:rgba(255,255,255,.04);color:${b.testo};font-size:24px;font-weight:600;cursor:pointer}
 .t button:active{background:rgba(${b.oroRgb},.2)}
 .e{color:${SHARED_UI.erroreColore};min-height:24px;font-size:13.5px;margin-top:14px}
</style></head><body>
<div class="b">
  ${cfg.icon.headerSvg.replace(/\{\{ORO\}\}/g, b.oro)}
  <h1>Accesso riservato</h1>
  <p id="q">Inserisci il tuo codice</p>
  <div class="p" id="pt"></div>
  <div class="t" id="t"></div>
  <div class="e" id="e"></div>
</div>
<script>
(function(){
  var v="", occupato=false;
  var pt=document.getElementById("pt"), e=document.getElementById("e");
  function dis(){ pt.textContent = v.replace(/./g,"•"); }
  ["1","2","3","4","5","6","7","8","9","←","0","✓"].forEach(function(k){
    var b=document.createElement("button"); b.textContent=k;
    b.onclick=function(){
      if(occupato) return;
      if(k==="←") v=v.slice(0,-1);
      else if(k==="✓") return manda();
      else if(v.length<6) v+=k;
      dis(); if(v.length===4) manda();
    };
    document.getElementById("t").appendChild(b);
  });
  function manda(){
    if(!v||occupato) return; occupato=true; e.textContent="";
    fetch("/api/login",{method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({pin:v})})
      .then(function(r){ return r.json().then(function(d){ return {s:r.status,d:d}; }); })
      .then(function(x){
        occupato=false;
        if(x.d && x.d.ok){
          try{ sessionStorage.setItem("cz_pin", v);
               sessionStorage.setItem("cz_chi", String(x.d.chi||"")); }catch(err){}
          benvenuto(x.d);
        } else { e.textContent = (x.d && x.d.errore) || "codice non valido"; v=""; dis(); }
      }).catch(function(){ occupato=false; e.textContent="nessuna connessione"; });
  }
  function benvenuto(d){
    /* un attimo di benvenuto: la TUA faccia, il TUO nome, poi al lavoro */
    fetch("/api/foto",{cache:"no-store"}).then(function(r){ return r.json(); })
      .catch(function(){ return {}; })
      .then(function(f){
        var fid="w_"+(d.wid||""), ha=d.wid&&f&&f[fid]!==undefined;
        /* la tenda del pannello (v34) rimette la stessa faccia: nessuno stacco */
        try{ sessionStorage.setItem("cz_faccia", ha?("/foto/"+fid+"?v="+f[fid]):""); }catch(err){}
        var n=String(d.chi||"").replace(/[<>&"]/g,"");
        var v2=document.createElement("div");
        v2.setAttribute("style","position:fixed;inset:0;z-index:50;display:grid;place-items:center;background:${b.fondo}");
        v2.innerHTML='<div style="text-align:center">'+
          (ha?'<img src="/foto/'+fid+'?v='+f[fid]+'" style="width:104px;height:104px;border-radius:50%;object-fit:cover;box-shadow:0 12px 34px rgba(0,0,0,.3)" alt="">'
             :'<div style="width:104px;height:104px;border-radius:50%;margin:0 auto;display:grid;place-items:center;font-size:42px;font-weight:800;background:${b.avatarBg};color:${b.fondo}">'+((n.trim().charAt(0)||"✓").toUpperCase())+'</div>')+
          '<div style="margin-top:16px;font-size:21px;font-weight:700;color:${b.testo}">Ciao, '+(n||"eccoci")+'!</div>'+
          '<div style="margin-top:5px;font-size:13.5px;color:rgba(${b.testoRgb},.55)">Buon servizio ✨</div></div>';
        document.body.appendChild(v2);
        setTimeout(function(){ location.reload(); },1200);
      });
  }
  dis();
})();
</script></body></html>`;
}

// ─────────────────────────────────────────────────────────────────────────
// The same pattern, NOT fully worked through here (left as a documented
// stub each) because it's mechanical repetition of the above once proven —
// no new technique, just apply it 4 more times. Real effort estimate:
// under an hour each, since all 4 already isolate their palette into one
// :root{...} block (easier than PAGINA_ENTRA's scattered raw hex, which
// still worked above).
// ─────────────────────────────────────────────────────────────────────────

function pagina_cucina(cfg) {
  // Real PAGINA_CUCINA has exactly one block to templatize:
  //   :root{--fondo:...;--carta:...;--bordo:...;--testo:...;--tenue:...;
  //         --verde:...;--verde2:...;--ambra:...;--rosso:...;--oro:...}
  // Swap those 10 tokens from cfg.branding (extend ClientConfig.branding
  // with `verde`/`verde2`/`ambra`/`tenue` if/when this page is actually
  // templated — not present above because PAGINA_ENTRA didn't need them).
  throw new Error("NOT TEMPLATED — mechanical follow-up, see comment above. Source: real PAGINA_CUCINA, 28,329 chars, Sergio bundle.");
}

function pagina_copertine(cfg) {
  throw new Error("NOT TEMPLATED — mechanical follow-up, same :root-block pattern. Source: real PAGINA_COPERTINE, 9,745 chars.");
}

function pagina_statistiche(cfg) {
  throw new Error("NOT TEMPLATED — mechanical follow-up, same :root-block pattern. Source: real PAGINA_STATISTICHE, 47,423 chars.");
}

function pagina_qr(cfg) {
  throw new Error("NOT TEMPLATED — mechanical follow-up, same :root-block pattern (this page has TWO :root blocks — screen view and print view — both need the swap). Source: real PAGINA_QR, 37,720 chars.");
}

// ─────────────────────────────────────────────────────────────────────────
// Backend inline branding literals — small, but real (see README's diff
// table: these are two of the nine actual differing regions found).
// Folded into the same CLIENT_CONFIG here since they're trivial once you
// have it; these belong inside the shared `export default { fetch(...) }`
// handler at the points noted, not as standalone functions.
// ─────────────────────────────────────────────────────────────────────────

function paginaNonConfigurato(cfg) {
  // Real diff region: the venue-not-found 404 fallback the Worker itself returns
  // when a domain resolves to no `locali` row. Was hardcoded per bundle:
  //   Sergio:   background:#F7F0E1;color:#17352A
  //   Carrozze: background:#170406;color:#F7F0E1
  const b = cfg.branding;
  return (
    "<!doctype html><meta charset=utf-8><title>Non configurato</title>" +
    `<body style='background:${b.fondo};color:${b.testo};font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0;text-align:center'>` +
    "<div><h1 style='font-weight:400'>Questo indirizzo non è ancora collegato a un locale.</h1></div>"
  );
}

function faviconIcoSvg(cfg) {
  // Real diff region: the /favicon.ico route's inline SVG. Checked against both real bundles:
  // this is literally the same inner markup as the data-URI favicon in <head> (same
  // cfg.icon.faviconInner shape, same faviconBg/faviconStroke colors), just URL-decoded
  // (%23 -> #, %3C/%3E -> </>, %28/%29 -> parens) since it isn't going into a data: URI here.
  // NOT the same shape as headerSvg — confirmed by diffing against both real /favicon.ico
  // routes directly (Sergio's carries the translate/scale transform that only the favicon
  // variant has; the inline header icon in PAGINA_ENTRA is untransformed, larger path data).
  const b = cfg.branding;
  const inner = cfg.icon.faviconInner
    .replace("{{STROKE}}", b.faviconStroke.slice(1))
    .replace(/%23/g, "#").replace(/%3E/g, ">").replace(/%3C/g, "<")
    .replace(/%28/g, "(").replace(/%29/g, ")");
  return (
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'>" +
    `<rect width='64' height='64' rx='12' fill='${b.faviconBg}'/>` +
    inner +
    "</svg>"
  );
}

// ─────────────────────────────────────────────────────────────────────────
// NOT TEMPLATED, and not attempted here — see README "The real blocker" for
// the specific, checked reasons (no :root token block anywhere in these
// three consts; compiled/minified build output with no source maps).
// ─────────────────────────────────────────────────────────────────────────

// const PAGINA = /* NOT TEMPLATED — 624,754-char compiled React SPA shell, no theme seam found */;
// const PAGINA_CLIENTE = /* NOT TEMPLATED — 38,974-char compiled customer page, same issue */;
// const PAGINA_SERVIZIO = /* NOT TEMPLATED — 99,170-char compiled staff page, same issue */;

// ─────────────────────────────────────────────────────────────────────────
// The ~800-line shared backend (VUOTO, qualeLocale, leggi, session/auth,
// the Guardia watchdog, fiscal VAT resolution incl. IVA_PREDEFINITA /
// ivaDi() / repartoDi(), bill/split-bill, kitchen order flow, the 35-route
// export default { fetch(request, env) {...} } handler) is intentionally
// NOT reproduced here. Confirmed byte-identical between both live
// deployments — copy it from either real bundle verbatim as the source of
// truth. See README's "one real bug" section for why retyping shared code
// into a second location is exactly the failure mode to avoid: Carrozze's
// deployed copy is already missing a fix ("scudo anti-seed") that Sergio's
// has, purely because they're two hand-maintained copies instead of one.
// ─────────────────────────────────────────────────────────────────────────

module.exports = {
  CLIENT_CONFIG_SERGIO,
  CLIENT_CONFIG_CARROZZE,
  SHARED_UI,
  pagina_entra,
  paginaNonConfigurato,
  faviconIcoSvg,
};
