import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronRight, UtensilsCrossed } from "lucide-react";
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
import { useLanguage } from "../i18n/LanguageContext";
import { useT } from "../i18n/useT";
import { BackHeader } from "./BackHeader";
import { cn } from "../lib/utils";

interface ProfilePageProps {
  onBack: () => void;
  onOpenMyFoods: () => void;
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

export function ProfilePage({ onBack, onOpenMyFoods }: ProfilePageProps) {
  const t = useT();
  const { language, setLanguage } = useLanguage();
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
      .catch((err) => setError(err instanceof Error ? err.message : t("profile.loadError")))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function patch<K extends keyof UserProfile>(key: K, value: UserProfile[K]) {
    setProfile((p) => (p ? { ...p, [key]: value } : p));
  }

  function numField(v: string): number | null {
    const n = Number(v);
    return v.trim() === "" || Number.isNaN(n) ? null : n;
  }

  async function saveNow(toSave: UserProfile) {
    setSaving(true);
    setError(null);
    try {
      const res = await saveProfile(toSave);
      setTargets(res.targets);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1500);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("profile.saveError"));
    } finally {
      setSaving(false);
    }
  }

  // Auto-saves on every field change instead of requiring a "Save profile"
  // button press (2026-08-31, requested explicitly) — debounced so typing a
  // name or a height value doesn't fire a request per keystroke. The first
  // time `profile` becomes non-null is the initial fetch landing, not a
  // user edit, so that one is skipped rather than immediately re-saving
  // unchanged data on every page open.
  const initializedRef = useRef(false);
  useEffect(() => {
    if (!profile) return;
    if (!initializedRef.current) {
      initializedRef.current = true;
      return;
    }
    const timeout = window.setTimeout(() => void saveNow(profile), 700);
    return () => window.clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  return (
    <div className="flex min-h-dvh flex-col gap-6 px-6 pb-16 pt-5">
      <BackHeader title={t("profile.title")} subtitle={t("profile.subtitle")} onBack={onBack} />

      <button
        className="flex items-center justify-between rounded-2xl bg-white px-4 py-3.5 text-sm font-bold text-ink shadow-sm ring-1 ring-ink/5 transition-colors hover:bg-ink3"
        onClick={onOpenMyFoods}
      >
        <span className="flex items-center gap-2">
          <UtensilsCrossed className="size-4 text-coral" />
          {t("profile.myFoods")}
        </span>
        <ChevronRight className="size-4 text-ink/30" />
      </button>

      <div className="rounded-2xl bg-white px-4 py-3.5 shadow-sm ring-1 ring-ink/5">
        <Field label={t("profile.language")}>
          <Chips<Language>
            options={[
              { value: "en", label: t("profile.languageEnglish") },
              { value: "ro", label: t("profile.languageRomanian") },
            ]}
            value={language}
            onChange={(v) => {
              setLanguage(v);
              patch("language", v);
            }}
          />
        </Field>
      </div>

      {loading ? (
        <p className="py-10 text-center text-sm font-medium text-ink/40">{t("profile.loading")}</p>
      ) : !profile ? (
        <p className="py-10 text-center text-sm font-semibold text-coral">
          {error ?? t("profile.loadError")}
        </p>
      ) : (
        <>
          <section className="space-y-4 rounded-[2rem] bg-white p-5 shadow-sm ring-1 ring-ink/5">
            <h2 className="font-display text-lg font-extrabold tracking-tight text-ink">{t("profile.sectionYou")}</h2>
            <Field label={t("profile.name")}>
              <input
                className={inputClass}
                value={profile.name ?? ""}
                onChange={(e) => patch("name", e.target.value || null)}
                placeholder={t("profile.namePlaceholder")}
              />
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label={t("profile.height")}>
                <input
                  className={inputClass}
                  inputMode="decimal"
                  value={profile.height_cm ?? ""}
                  onChange={(e) => patch("height_cm", numField(e.target.value))}
                  placeholder="175"
                />
              </Field>
              <Field label={t("profile.weight")}>
                <input
                  className={inputClass}
                  inputMode="decimal"
                  value={profile.weight_kg ?? ""}
                  onChange={(e) => patch("weight_kg", numField(e.target.value))}
                  placeholder="70"
                />
              </Field>
              <Field label={t("profile.age")}>
                <input
                  className={inputClass}
                  inputMode="numeric"
                  value={profile.age ?? ""}
                  onChange={(e) => patch("age", numField(e.target.value))}
                  placeholder="30"
                />
              </Field>
            </div>
            <Field label={t("profile.sex")}>
              <Chips<Sex>
                options={[
                  { value: "male", label: t("profile.sexMale") },
                  { value: "female", label: t("profile.sexFemale") },
                ]}
                value={profile.sex}
                onChange={(v) => patch("sex", v)}
              />
            </Field>
          </section>

          <section className="space-y-4 rounded-[2rem] bg-white p-5 shadow-sm ring-1 ring-ink/5">
            <h2 className="font-display text-lg font-extrabold tracking-tight text-ink">
              {t("profile.sectionActivityGoal")}
            </h2>
            <Field label={t("profile.activityLevel")}>
              <Chips<ActivityLevel>
                options={[
                  { value: "sedentary", label: t("profile.activitySedentary") },
                  { value: "light", label: t("profile.activityLight") },
                  { value: "moderate", label: t("profile.activityModerate") },
                  { value: "active", label: t("profile.activityActive") },
                  { value: "very_active", label: t("profile.activityVeryActive") },
                ]}
                value={profile.activity_level}
                onChange={(v) => patch("activity_level", v)}
              />
            </Field>
            <Field label={t("profile.goal")}>
              <Chips<GoalType>
                options={[
                  { value: "lose", label: t("profile.goalLose") },
                  { value: "maintain", label: t("profile.goalMaintain") },
                  { value: "gain", label: t("profile.goalGain") },
                ]}
                value={profile.goal_type}
                onChange={(v) => patch("goal_type", v)}
              />
            </Field>
            <Field label={t("profile.pace")}>
              <Chips<GoalRate>
                options={[
                  { value: "gentle", label: t("profile.paceGentle") },
                  { value: "moderate", label: t("profile.paceModerate") },
                  { value: "aggressive", label: t("profile.paceAggressive") },
                ]}
                value={profile.goal_rate}
                onChange={(v) => patch("goal_rate", v)}
              />
            </Field>
            <Field label={t("profile.notes")}>
              <textarea
                className={cn(inputClass, "min-h-24 resize-y")}
                value={profile.goal_notes ?? ""}
                onChange={(e) => patch("goal_notes", e.target.value || null)}
                placeholder={t("profile.notesPlaceholder")}
              />
            </Field>
          </section>

          {targets && (
            <section className="rounded-[2rem] bg-ink p-5 text-cream shadow-sm">
              <h2 className="font-display text-lg font-extrabold tracking-tight">
                {t("profile.dailyTargets")}
              </h2>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <TargetStat label={t("profile.calories")} value={`${Math.round(targets.calorie_target)} kcal`} accent="text-sky" />
                <TargetStat label={t("profile.protein")} value={`${Math.round(targets.protein_target_g)} g`} accent="text-sky" />
                <TargetStat label={t("profile.carbs")} value={`${Math.round(targets.carbs_target_g)} g`} accent="text-sun" />
                <TargetStat label={t("profile.fat")} value={`${Math.round(targets.fat_target_g)} g`} accent="text-coral" />
              </div>
              <p className="mt-4 text-xs font-medium text-white/40">
                {t("profile.targetsFooter", { bmr: Math.round(targets.bmr), tdee: Math.round(targets.tdee) })}
              </p>
            </section>
          )}

          {error && (
            <p className="rounded-2xl bg-coral/10 px-4 py-3 text-sm font-semibold text-coral ring-1 ring-coral/20">
              {error}
            </p>
          )}

          {(saving || savedFlash) && (
            <p className="text-center text-xs font-semibold text-ink/40">
              {saving ? t("profile.saving") : t("profile.saved")}
            </p>
          )}
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
