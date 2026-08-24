import { ELEVENLABS_VOICE_ID, ELEVENLABS_VOICE_ID_RO } from "./config.js";
import { db } from "./db.js";

export type Sex = "male" | "female";
export type ActivityLevel = "sedentary" | "light" | "moderate" | "active" | "very_active";
export type GoalType = "lose" | "maintain" | "gain";
export type GoalRate = "gentle" | "moderate" | "aggressive";
export type Language = "en" | "ro";

export interface UserProfile {
  name: string | null;
  height_cm: number | null;
  weight_kg: number | null;
  age: number | null;
  sex: Sex | null;
  activity_level: ActivityLevel | null;
  goal_type: GoalType | null;
  goal_rate: GoalRate | null;
  goal_notes: string | null;
  language: Language | null;
  updated_at: string;
}

export interface ProfileUpdateInput {
  name?: string | null;
  height_cm?: number | null;
  weight_kg?: number | null;
  age?: number | null;
  sex?: Sex | null;
  activity_level?: ActivityLevel | null;
  goal_type?: GoalType | null;
  goal_rate?: GoalRate | null;
  goal_notes?: string | null;
  language?: Language | null;
}

export interface Targets {
  bmr: number;
  tdee: number;
  calorie_target: number;
  protein_target_g: number;
}

const selectStmt = db.prepare(`SELECT * FROM user_profile WHERE id = :id`);

export function getProfile(userId: string): UserProfile | null {
  const row = selectStmt.get({ id: userId }) as unknown as (UserProfile & { id: string }) | undefined;
  if (!row) return null;
  const { id: _id, ...profile } = row;
  return profile;
}

const upsertStmt = db.prepare(`
  INSERT INTO user_profile (id, name, height_cm, weight_kg, age, sex, activity_level, goal_type, goal_rate, goal_notes, language, updated_at)
  VALUES (:id, :name, :height_cm, :weight_kg, :age, :sex, :activity_level, :goal_type, :goal_rate, :goal_notes, :language, :updated_at)
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name,
    height_cm = excluded.height_cm,
    weight_kg = excluded.weight_kg,
    age = excluded.age,
    sex = excluded.sex,
    activity_level = excluded.activity_level,
    goal_type = excluded.goal_type,
    goal_rate = excluded.goal_rate,
    goal_notes = excluded.goal_notes,
    language = excluded.language,
    updated_at = excluded.updated_at
`);

export function upsertProfile(userId: string, fields: ProfileUpdateInput): UserProfile {
  const existing = getProfile(userId);

  const merged: UserProfile = {
    name: fields.name !== undefined ? fields.name : (existing?.name ?? null),
    height_cm: fields.height_cm !== undefined ? fields.height_cm : (existing?.height_cm ?? null),
    weight_kg: fields.weight_kg !== undefined ? fields.weight_kg : (existing?.weight_kg ?? null),
    age: fields.age !== undefined ? fields.age : (existing?.age ?? null),
    sex: fields.sex !== undefined ? fields.sex : (existing?.sex ?? null),
    activity_level:
      fields.activity_level !== undefined ? fields.activity_level : (existing?.activity_level ?? null),
    goal_type: fields.goal_type !== undefined ? fields.goal_type : (existing?.goal_type ?? null),
    goal_rate: fields.goal_rate !== undefined ? fields.goal_rate : (existing?.goal_rate ?? null),
    goal_notes: fields.goal_notes !== undefined ? fields.goal_notes : (existing?.goal_notes ?? null),
    language: fields.language !== undefined ? fields.language : (existing?.language ?? null),
    updated_at: new Date().toISOString(),
  };

  upsertStmt.run({ id: userId, ...merged } as unknown as Record<string, string | number | null>);
  return merged;
}

// Shared by /greeting and the /chat reply path so voice/STT language always
// agree with each other and with the profile setting.
export function resolveVoiceId(profile: UserProfile | null): string {
  return profile?.language === "ro" ? ELEVENLABS_VOICE_ID_RO : ELEVENLABS_VOICE_ID;
}

export function resolveSpeechLang(profile: UserProfile | null): string {
  return profile?.language === "ro" ? "ro-RO" : "en-US";
}

const ACTIVITY_MULTIPLIERS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

const LOSE_DEFICIT: Record<GoalRate, number> = { gentle: 0.1, moderate: 0.2, aggressive: 0.25 };
const GAIN_SURPLUS: Record<GoalRate, number> = { gentle: 0.1, moderate: 0.15, aggressive: 0.2 };

// Returns null (never a guess) unless every input the Mifflin-St Jeor
// formula needs is actually set.
export function computeTargets(profile: UserProfile | null): Targets | null {
  if (!profile) return null;
  const { height_cm, weight_kg, age, sex, activity_level, goal_type } = profile;
  if (
    height_cm == null ||
    weight_kg == null ||
    age == null ||
    sex == null ||
    activity_level == null ||
    goal_type == null
  ) {
    return null;
  }

  const bmr =
    sex === "male"
      ? 10 * weight_kg + 6.25 * height_cm - 5 * age + 5
      : 10 * weight_kg + 6.25 * height_cm - 5 * age - 161;
  const tdee = bmr * ACTIVITY_MULTIPLIERS[activity_level];

  const rate = profile.goal_rate ?? "moderate";
  let calorie_target = tdee;
  if (goal_type === "lose") {
    calorie_target = tdee * (1 - LOSE_DEFICIT[rate]);
  } else if (goal_type === "gain") {
    calorie_target = tdee * (1 + GAIN_SURPLUS[rate]);
  }

  return {
    bmr: Math.round(bmr),
    tdee: Math.round(tdee),
    calorie_target: Math.round(calorie_target),
    protein_target_g: Math.round(weight_kg * 1.8),
  };
}
