import { useEffect, useState, type ReactNode } from "react";
import {
  ApiError,
  fetchProfile,
  saveProfile,
  type ActivityLevel,
  type GoalRate,
  type GoalType,
  type Language,
  type Sex,
  type Targets,
  type UserProfile,
} from "../api/client";
import { BackHeader } from "./BackHeader";
import { cn } from "../lib/utils";

interface ProfilePageProps {
  onBack: () => void;
}

const inputClass =
  "w-full rounded-2xl bg-white px-4 py-3.5 text-sm font-semibold text-ink shadow-sm ring-1 ring-ink/5 outline-none placeholder:font-medium placeholder:text-ink/30 focus:ring-2 focus:ring-coral/50";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-ink/40">
        {label}
      </span>
      {children}
    </label>
  );
}

function Chips<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={cn(
            "rounded-full px-4 py-2 text-xs font-bold transition-colors",
            value === opt.value
              ? "bg-ink text-cream"
              : "bg-white text-ink/60 ring-1 ring-ink/10 hover:bg-ink3",
          )}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function ProfilePage({ onBack }: ProfilePageProps) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [targets, setTargets] = useState<Targets | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchProfile()
      .then((res) => {
        setProfile(
          res.profile ?? {
            name: null,
            height_cm: null,
            weight_kg: null,
            age: null,
            sex: null,
            activity_level: null,
            goal_type: null,
            goal_rate: null,
            goal_notes: null,
            language: null,
            updated_at: "",
          },
        );
        setTargets(res.targets);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load profile."))
      .finally(() => setLoading(false));
  }, []);

  function patch<K extends keyof UserProfile>(key: K, value: UserProfile[K]) {
    setProfile((p) => (p ? { ...p, [key]: value } : p));
  }

  function numField(v: string): number | null {
    const n = Number(v);
    return v.trim() === "" || Number.isNaN(n) ? null : n;
  }

  async function handleSave() {
    if (!profile || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await saveProfile(profile);
      setProfile(res.profile);
      setTargets(res.targets);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save profile.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col gap-6 px-6 pb-16 pt-5">
      <BackHeader title="Profile" subtitle="What powers your targets" onBack={onBack} />

      {loading ? (
        <p className="py-10 text-center text-sm font-medium text-ink/40">Loading…</p>
      ) : !profile ? (
        <p className="py-10 text-center text-sm font-semibold text-coral">
          {error ?? "Could not load profile."}
        </p>
      ) : (
        <>
          <section className="space-y-4 rounded-[2rem] bg-white p-5 shadow-sm ring-1 ring-ink/5">
            <h2 className="font-display text-lg font-extrabold tracking-tight text-ink">You</h2>
            <Field label="Name">
              <input
                className={inputClass}
                value={profile.name ?? ""}
                onChange={(e) => patch("name", e.target.value || null)}
                placeholder="What should Deep Blue call you?"
              />
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Height (cm)">
                <input
                  className={inputClass}
                  inputMode="decimal"
                  value={profile.height_cm ?? ""}
                  onChange={(e) => patch("height_cm", numField(e.target.value))}
                  placeholder="175"
                />
              </Field>
              <Field label="Weight (kg)">
                <input
                  className={inputClass}
                  inputMode="decimal"
                  value={profile.weight_kg ?? ""}
                  onChange={(e) => patch("weight_kg", numField(e.target.value))}
                  placeholder="70"
                />
              </Field>
              <Field label="Age">
                <input
                  className={inputClass}
                  inputMode="numeric"
                  value={profile.age ?? ""}
                  onChange={(e) => patch("age", numField(e.target.value))}
                  placeholder="30"
                />
              </Field>
            </div>
            <Field label="Sex">
              <Chips<Sex>
                options={[
                  { value: "male", label: "Male" },
                  { value: "female", label: "Female" },
                ]}
                value={profile.sex}
                onChange={(v) => patch("sex", v)}
              />
            </Field>
            <Field label="Language">
              <Chips<Language>
                options={[
                  { value: "en", label: "English" },
                  { value: "ro", label: "Română" },
                ]}
                value={profile.language}
                onChange={(v) => patch("language", v)}
              />
            </Field>
          </section>

          <section className="space-y-4 rounded-[2rem] bg-white p-5 shadow-sm ring-1 ring-ink/5">
            <h2 className="font-display text-lg font-extrabold tracking-tight text-ink">
              Activity &amp; goal
            </h2>
            <Field label="Activity level">
              <Chips<ActivityLevel>
                options={[
                  { value: "sedentary", label: "Sedentary" },
                  { value: "light", label: "Light" },
                  { value: "moderate", label: "Moderate" },
                  { value: "active", label: "Active" },
                  { value: "very_active", label: "Very active" },
                ]}
                value={profile.activity_level}
                onChange={(v) => patch("activity_level", v)}
              />
            </Field>
            <Field label="Goal">
              <Chips<GoalType>
                options={[
                  { value: "lose", label: "Lose" },
                  { value: "maintain", label: "Maintain" },
                  { value: "gain", label: "Gain" },
                ]}
                value={profile.goal_type}
                onChange={(v) => patch("goal_type", v)}
              />
            </Field>
            <Field label="Pace">
              <Chips<GoalRate>
                options={[
                  { value: "gentle", label: "Gentle" },
                  { value: "moderate", label: "Moderate" },
                  { value: "aggressive", label: "Aggressive" },
                ]}
                value={profile.goal_rate}
                onChange={(v) => patch("goal_rate", v)}
              />
            </Field>
            <Field label="Notes for your coach">
              <textarea
                className={cn(inputClass, "min-h-24 resize-y")}
                value={profile.goal_notes ?? ""}
                onChange={(e) => patch("goal_notes", e.target.value || null)}
                placeholder="e.g. vegetarian, training for a marathon, hate counting…"
              />
            </Field>
          </section>

          {targets && (
            <section className="rounded-[2rem] bg-ink p-5 text-cream shadow-sm">
              <h2 className="font-display text-lg font-extrabold tracking-tight">
                Your daily targets
              </h2>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <TargetStat label="Calories" value={`${Math.round(targets.calorie_target)} kcal`} accent="text-sky" />
                <TargetStat label="Protein" value={`${Math.round(targets.protein_target_g)} g`} accent="text-sky" />
                <TargetStat label="Carbs" value={`${Math.round(targets.carbs_target_g)} g`} accent="text-sun" />
                <TargetStat label="Fat" value={`${Math.round(targets.fat_target_g)} g`} accent="text-coral" />
              </div>
              <p className="mt-4 text-xs font-medium text-white/40">
                BMR {Math.round(targets.bmr)} · TDEE {Math.round(targets.tdee)} — Mifflin-St Jeor formula,
                recomputed when you save.
              </p>
            </section>
          )}

          {error && (
            <p className="rounded-2xl bg-coral/10 px-4 py-3 text-sm font-semibold text-coral ring-1 ring-coral/20">
              {error}
            </p>
          )}

          <button
            className="w-full rounded-2xl bg-coral py-4 text-sm font-bold text-white shadow-lg shadow-coral/40 transition-transform active:scale-[0.98] disabled:opacity-60"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? "Saving…" : savedFlash ? "Saved ✓" : "Save profile"}
          </button>
        </>
      )}
    </div>
  );
}

function TargetStat({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="rounded-2xl bg-white/5 px-4 py-3">
      <div className="text-[10px] font-bold uppercase tracking-wider text-white/40">{label}</div>
      <div className={cn("mt-0.5 font-display text-xl font-extrabold", accent)}>{value}</div>
    </div>
  );
}
