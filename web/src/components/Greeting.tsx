import { useEffect, useState } from "react";
import { fetchProfile } from "../api/client";
import { Logo } from "./Logo";

// Copy tables per time slot. `{name}` is dropped (with its comma) when the
// profile has no name saved, so every line reads naturally either way.
const SLOTS: { until: number; lines: string[] }[] = [
  { until: 5, lines: ["Late one{name}.", "Still up{name}?", "Midnight snack{name}?"] },
  {
    until: 11,
    lines: ["Morning{name}. What's for breakfast?", "Morning{name}.", "Good morning{name}. Fuelled up yet?"],
  },
  { until: 15, lines: ["Midday check-in{name}.", "Lunchtime{name}. What's on the plate?"] },
  {
    until: 18,
    lines: ["Afternoon{name}. How's the day going?", "Afternoon{name}. Anything since lunch?"],
  },
  {
    until: 22,
    lines: ["Evening{name}. What did dinner look like?", "Evening{name}. Let's close out the day."],
  },
  { until: 24, lines: ["Late one{name}.", "Winding down{name}?"] },
];

function pickLine(now: Date, name: string | null): string {
  const hour = now.getHours();
  const slot = SLOTS.find((s) => hour < s.until) ?? SLOTS[SLOTS.length - 1]!;
  // Deterministic per day + slot: stable while the screen is open, fresh daily.
  const seed = now.getFullYear() * 1000 + now.getMonth() * 40 + now.getDate() + slot.until;
  const template = slot.lines[seed % slot.lines.length]!;
  const first = name?.trim().split(/\s+/)[0];
  return template.replace("{name}", first ? `, ${first}` : "");
}

export function Greeting() {
  const [name, setName] = useState<string | null>(null);

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

  const line = pickLine(new Date(), name);

  return (
    <h1 className="flex items-center justify-center gap-2 px-2 text-center font-display text-[1.75rem] font-extrabold leading-tight tracking-tight text-ink">
      <Logo className="size-6 shrink-0" />
      <span className="text-balance">{line}</span>
    </h1>
  );
}
