// Server-side source of truth for what can be bought and for how much.
// The browser sends only a service id; the Worker looks the price up here.
// Prices are in minor units (cents / piastres). All values are PLACEHOLDERS until Zen confirms them.
// Keep in sync with the CITIES object in public/index.html (names, ids, prices).

export const PLATFORM_FEE_BPS = 200; // 2.00% of every booking, kept by the platform (Locali & Ordinazioni)

export const CITIES = {
  cairo: {
    name: "Cairo", currency: "egp", tz: "Africa/Cairo",
    services: {
      "cai-man":   { name: "Manual therapy · 60 min · Cairo",       amount: 100000 },
      "cai-dry":   { name: "Dry cupping · 45 min · Cairo",     amount: 90000 },
      "cai-slide": { name: "Sliding cupping · 60 min · Cairo", amount: 120000 },
      "cai-fire":  { name: "Fire cupping · 45 min · Cairo",    amount: 100000 },
      "cai-hij":   { name: "Hijama · 60 min · Cairo",          amount: 110000 },
      "cai-face":  { name: "Facial cupping · 30 min · Cairo",  amount: 70000 },
    },
  },
  dahab: {
    name: "Dahab", currency: "egp", tz: "Africa/Cairo",
    services: {
      "dah-man":   { name: "Manual therapy · 60 min · Dahab",       amount: 100000 },
      "dah-dry":   { name: "Dry cupping · 45 min · Dahab",     amount: 90000 },
      "dah-slide": { name: "Sliding cupping · 60 min · Dahab", amount: 120000 },
      "dah-fire":  { name: "Fire cupping · 45 min · Dahab",    amount: 100000 },
      "dah-face":  { name: "Facial cupping · 30 min · Dahab",  amount: 70000 },
    },
  },
  florence: {
    name: "Florence", currency: "eur", tz: "Europe/Rome",
    services: {
      "flo-man":   { name: "Manual therapy · 60 min · Florence",    amount: 6000 },
      "flo-dry":   { name: "Dry cupping · 45 min · Florence",     amount: 5500 },
      "flo-slide": { name: "Sliding cupping · 60 min · Florence", amount: 7000 },
      "flo-fire":  { name: "Fire cupping · 45 min · Florence",    amount: 6500 },
      "flo-face":  { name: "Facial cupping · 30 min · Florence",  amount: 4500 },
    },
  },
};

export const SLOTS = { morning: "Morning (9–12)", afternoon: "Afternoon (12–17)", evening: "Evening (17–20)" };
