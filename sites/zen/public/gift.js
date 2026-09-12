/* Zen Recovery — gift a session page. Needs site.js first. */
Zen.on("catalog", () => giftServices());
Zen.on("lang", () => giftServices());
/* ---------- gift a session ---------- */
function giftServices() { const c = CITIES[$("#g-city").value]; $("#g-service").innerHTML = c.services.map(s => `<option value="${s.id}">${t(s.name)} · ${s.dur} ${t("min")} — ${money(s.price, c.currency)}</option>`).join(""); giftPrice(); }
function giftPrice() { const c = CITIES[$("#g-city").value]; const s = c.services.find(x => x.id === $("#g-service").value); $("#g-pay").textContent = t("Pay {amount} and send", { amount: money(s.price, c.currency) }); }
$("#g-city").addEventListener("change", giftServices); $("#g-service").addEventListener("change", giftPrice); giftServices();
$("#gift-form").addEventListener("submit", async (e) => {
  e.preventDefault(); const err = $("#g-err"); err.hidden = true; if (!e.target.reportValidity()) return;
  const c = CITIES[$("#g-city").value], s = c.services.find(x => x.id === $("#g-service").value);
  const btn = $("#g-pay"); btn.disabled = true;
  try {
    const r = await fetch("/api/gift/checkout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ city: $("#g-city").value, service: s.id, buyer_name: $("#g-buyer").value.trim(), buyer_email: $("#g-buyer-email").value.trim(), recipient_name: $("#g-to").value.trim(), recipient_email: $("#g-to-email").value.trim(), message: $("#g-msg").value.trim() }) });
    const data = (r.headers.get("content-type") || "").includes("json") ? await r.json().catch(() => ({})) : { preview: true };
    if (r.ok && data.url) { location.href = data.url; return; }
    if (data.preview) tell(t("Payments aren't switched on yet"), t("Once Zen's Stripe account is connected, this takes you to a secure card page for {amount} and the gift code goes out by email.", { amount: money(s.price, c.currency) }));
    else { err.textContent = data.error || t("Something went wrong. Try again in a minute."); err.hidden = false; }
  } catch { tell(t("Preview only"), t("Nothing was charged. On the live site this takes you to a secure Stripe card page for {amount}.", { amount: money(s.price, c.currency) })); }
  finally { btn.disabled = false; }
});
