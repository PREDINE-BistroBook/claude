/* Zen Recovery — join as a therapist: the public application form. POST /api/apply; the owner approves in the admin. */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const I = window.ZenI18n, t = I.t;
  let photo = null, pin = null;
  const shrink = (file, max, q) => new Promise((res, rej) => { const img = new Image(); img.onload = () => { const r = Math.min(1, max / Math.max(img.width, img.height)); const c = document.createElement("canvas"); c.width = Math.round(img.width * r); c.height = Math.round(img.height * r); c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); res(c.toDataURL("image/jpeg", q)); URL.revokeObjectURL(img.src); }; img.onerror = () => rej(new Error(t("That file isn't an image we can read."))); img.src = URL.createObjectURL(file); });
  $("#j-photo").addEventListener("change", async (e) => { const f = e.target.files[0]; if (!f) return; try { photo = await shrink(f, 512, .84); const p = $("#j-preview"); p.innerHTML = `<img src="${photo}" alt="">`; p.hidden = false; } catch (ex) { $("#j-err").textContent = ex.message; $("#j-err").hidden = false; } });
  $("#j-locate").addEventListener("click", () => { const b = $("#j-locate"); if (!navigator.geolocation) { $("#j-pin").textContent = t("This browser can't share a position."); return; } b.disabled = true; navigator.geolocation.getCurrentPosition((p) => { pin = { lat: Math.round(p.coords.latitude * 1e5) / 1e5, lng: Math.round(p.coords.longitude * 1e5) / 1e5 }; b.disabled = false; b.classList.add("on"); $("#j-pin").textContent = t("Pinned. Clients will see distances from here."); }, () => { b.disabled = false; $("#j-pin").textContent = t("Couldn't get the position. Allow location for this site and try again."); }, { timeout: 9000, maximumAge: 60000 }); });
  $("#join-form").addEventListener("submit", async (e) => {
    e.preventDefault(); const err = $("#j-err"); err.hidden = true;
    const v = (id) => $(id).value.trim();
    if (!v("#j-name") || !v("#j-email") || !v("#j-phone") || !v("#j-area")) { err.textContent = t("Your name, email, WhatsApp number and the neighbourhood you work in."); err.hidden = false; return; }
    if (!$("#j-agree").checked) { err.textContent = t("Please accept the terms first."); err.hidden = false; $("#j-agree").focus(); return; }
    const btn = $("#j-send"), label = btn.textContent; btn.disabled = true; btn.setAttribute("aria-busy", "true"); btn.textContent = t("One moment…");
    try {
      const r = await fetch("/api/apply", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: v("#j-name"), email: v("#j-email"), phone: v("#j-phone"), city: v("#j-city"), title: v("#j-title"), languages: v("#j-langs"), area: v("#j-area"), address: v("#j-address"), maps_url: v("#j-maps"), instagram: v("#j-insta"), bio: v("#j-bio"), story: v("#j-story"), certs: v("#j-certs"), photo, lat: pin?.lat ?? null, lng: pin?.lng ?? null, radius_km: Number($("#j-radius").value) || 0, agree: true, lang: I.lang }) });
      const d = (r.headers.get("content-type") || "").includes("json") ? await r.json() : {};
      if (!r.ok) throw new Error(d.error || t("Something went wrong. Try again in a minute."));
      $("#join-form").hidden = true; $("#join-done").hidden = false; $("#join-done").scrollIntoView({ block: "start", behavior: "smooth" }); if (window.Motion) window.Motion.scan();
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
    finally { btn.disabled = false; btn.removeAttribute("aria-busy"); btn.textContent = label; }
  });
})();
