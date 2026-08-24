import { useEffect, useState } from "react";
import {
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

interface ProfilePageProps {
  onBack: () => void;
}

type FormState = {
  name: string;
  height_cm: string;
  weight_kg: string;
  age: string;
  sex: Sex | "";
  activity_level: ActivityLevel | "";
  goal_type: GoalType | "";
  goal_rate: GoalRate | "";
  goal_notes: string;
  language: Language | "";
};

const EMPTY_FORM: FormState = {
  name: "",
  height_cm: "",
  weight_kg: "",
  age: "",
  sex: "",
  activity_level: "",
  goal_type: "",
  goal_rate: "",
  goal_notes: "",
  language: "",
};

function toForm(profile: UserProfile | null): FormState {
  if (!profile) return EMPTY_FORM;
  return {
    name: profile.name ?? "",
    height_cm: profile.height_cm != null ? String(profile.height_cm) : "",
    weight_kg: profile.weight_kg != null ? String(profile.weight_kg) : "",
    age: profile.age != null ? String(profile.age) : "",
    sex: profile.sex ?? "",
    activity_level: profile.activity_level ?? "",
    goal_type: profile.goal_type ?? "",
    goal_rate: profile.goal_rate ?? "",
    goal_notes: profile.goal_notes ?? "",
    language: profile.language ?? "",
  };
}

export function ProfilePage({ onBack }: ProfilePageProps) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [targets, setTargets] = useState<Targets | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchProfile()
      .then(({ profile, targets }) => {
        setForm(toForm(profile));
        setTargets(targets);
      })
      .catch(() => setError("Could not load profile."))
      .finally(() => setLoading(false));
  }, []);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const { targets: newTargets } = await saveProfile({
        name: form.name.trim() || null,
        height_cm: form.height_cm ? Number(form.height_cm) : null,
        weight_kg: form.weight_kg ? Number(form.weight_kg) : null,
        age: form.age ? Number(form.age) : null,
        sex: form.sex || null,
        activity_level: form.activity_level || null,
        goal_type: form.goal_type || null,
        goal_rate: form.goal_rate || null,
        goal_notes: form.goal_notes.trim() || null,
        language: form.language || null,
      });
      setTargets(newTargets);
    } catch {
      setError("Could not save profile.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <button className="back-button" onClick={onBack} aria-label="Back">
          ←
        </button>
        <div className="dashboard-title">
          <h1>Profile</h1>
          <p>Used to personalize recommendations</p>
        </div>
      </div>

      <div className="calorie-total">
        <span>Daily target</span>
        <span className="value">
          {targets ? `${targets.calorie_target} cal` : "—"}
        </span>
      </div>
      {targets && <div className="target-protein">~{targets.protein_target_g}g protein / day</div>}
      {!targets && !loading && (
        <div className="empty-state">Fill in height, weight, age, sex, activity, and goal for a target.</div>
      )}

      {error && <div className="empty-state">{error}</div>}

      {!loading && (
        <form className="profile-form" onSubmit={handleSubmit}>
          <label>
            Name
            <input value={form.name} onChange={(e) => update("name", e.target.value)} />
          </label>

          <label>
            Conversation language
            <select value={form.language} onChange={(e) => update("language", e.target.value as Language | "")}>
              <option value="">— (defaults to English)</option>
              <option value="en">English</option>
              <option value="ro">Română</option>
            </select>
          </label>

          <div className="profile-form-row">
            <label>
              Height (cm)
              <input
                type="number"
                value={form.height_cm}
                onChange={(e) => update("height_cm", e.target.value)}
              />
            </label>
            <label>
              Weight (kg)
              <input
                type="number"
                value={form.weight_kg}
                onChange={(e) => update("weight_kg", e.target.value)}
              />
            </label>
            <label>
              Age
              <input type="number" value={form.age} onChange={(e) => update("age", e.target.value)} />
            </label>
          </div>

          <div className="profile-form-row">
            <label>
              Sex
              <select value={form.sex} onChange={(e) => update("sex", e.target.value as Sex | "")}>
                <option value="">—</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
              </select>
            </label>
            <label>
              Activity level
              <select
                value={form.activity_level}
                onChange={(e) => update("activity_level", e.target.value as ActivityLevel | "")}
              >
                <option value="">—</option>
                <option value="sedentary">Sedentary</option>
                <option value="light">Lightly active</option>
                <option value="moderate">Moderately active</option>
                <option value="active">Active</option>
                <option value="very_active">Very active</option>
              </select>
            </label>
          </div>

          <div className="profile-form-row">
            <label>
              Goal
              <select
                value={form.goal_type}
                onChange={(e) => update("goal_type", e.target.value as GoalType | "")}
              >
                <option value="">—</option>
                <option value="lose">Lose weight</option>
                <option value="maintain">Maintain</option>
                <option value="gain">Gain weight</option>
              </select>
            </label>
            <label>
              Pace
              <select
                value={form.goal_rate}
                onChange={(e) => update("goal_rate", e.target.value as GoalRate | "")}
              >
                <option value="">—</option>
                <option value="gentle">Gentle</option>
                <option value="moderate">Moderate</option>
                <option value="aggressive">Aggressive</option>
              </select>
            </label>
          </div>

          <label>
            Notes
            <textarea
              rows={3}
              placeholder="e.g. avoid losing muscle while cutting"
              value={form.goal_notes}
              onChange={(e) => update("goal_notes", e.target.value)}
            />
          </label>

          <button type="submit" className="pill-button" disabled={saving}>
            {saving ? "Saving…" : "Save profile"}
          </button>
        </form>
      )}
    </div>
  );
}
