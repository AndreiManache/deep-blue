import { useEffect, useState } from "react";
import { fetchProfile } from "../api/client";
import { useLanguage } from "../i18n/LanguageContext";
import { Logo } from "./Logo";

// Copy tables per time slot, per language. `{name}` is dropped (with its
// comma) when the profile has no name saved, so every line reads naturally
// either way. Each language's array must stay the same length/order as the
// others so the deterministic seed picks the "same" line across languages.
const SLOTS: { until: number; lines: Record<"en" | "ro", string[]> }[] = [
  {
    until: 5,
    lines: {
      en: ["Late one{name}.", "Still up{name}?", "Midnight snack{name}?"],
      ro: ["Noapte târzie{name}.", "Încă treaz{name}?", "Gustare de la miezul nopții{name}?"],
    },
  },
  {
    until: 11,
    lines: {
      en: ["Morning{name}. What's for breakfast?", "Morning{name}.", "Good morning{name}. Fuelled up yet?"],
      ro: ["Dimineața{name}. Ce ai la micul dejun?", "Dimineața{name}.", "Bună dimineața{name}. Ai luat micul dejun?"],
    },
  },
  {
    until: 15,
    lines: {
      en: ["Midday check-in{name}.", "Lunchtime{name}. What's on the plate?"],
      ro: ["La prânz{name}.", "Ora de masă{name}. Ce ai în farfurie?"],
    },
  },
  {
    until: 18,
    lines: {
      en: ["Afternoon{name}. How's the day going?", "Afternoon{name}. Anything since lunch?"],
      ro: ["După-amiază{name}. Cum merge ziua?", "După-amiază{name}. Ai mai mâncat ceva de la prânz?"],
    },
  },
  {
    until: 22,
    lines: {
      en: ["Evening{name}. What did dinner look like?", "Evening{name}. Let's close out the day."],
      ro: ["Seara bună{name}. Cum a fost cina?", "Seara bună{name}. Să închidem ziua."],
    },
  },
  {
    until: 24,
    lines: {
      en: ["Late one{name}.", "Winding down{name}?"],
      ro: ["Noapte târzie{name}.", "Te pregătești de culcare{name}?"],
    },
  },
];

function pickLine(now: Date, name: string | null, language: "en" | "ro"): string {
  const hour = now.getHours();
  const slot = SLOTS.find((s) => hour < s.until) ?? SLOTS[SLOTS.length - 1]!;
  // Deterministic per day + slot: stable while the screen is open, fresh daily.
  const seed = now.getFullYear() * 1000 + now.getMonth() * 40 + now.getDate() + slot.until;
  const lines = slot.lines[language];
  const template = lines[seed % lines.length]!;
  const first = name?.trim().split(/\s+/)[0];
  return template.replace("{name}", first ? `, ${first}` : "");
}

export function Greeting() {
  const [name, setName] = useState<string | null>(null);
  const { language } = useLanguage();

  useEffect(() => {
    let cancelled = false;
    fetchProfile()
      .then((res) => {
        if (!cancelled) setName(res.profile?.name ?? null);
      })
      .catch(() => {
        /* greeting falls back to the nameless copy */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const line = pickLine(new Date(), name, language);

  return (
    <h1 className="text-balance px-2 text-center font-display text-[1.75rem] font-extrabold leading-tight tracking-tight text-ink">
      <Logo className="mr-2 inline-block size-6 align-middle" />
      {line}
    </h1>
  );
}
