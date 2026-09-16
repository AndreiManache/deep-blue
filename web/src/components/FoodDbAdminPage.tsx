import { useEffect, useMemo, useState } from "react";
import { BadgeCheck, Check, Pencil, Plus, Trash2 } from "lucide-react";
import {
  ApiError,
  deleteAdminFood,
  fetchAdminFoods,
  upsertAdminFood,
  verifyAdminFood,
  type Confidence,
  type CookingState,
  type DensitySource,
  type FoodDensityRow,
} from "../api/client";
import { BackHeader } from "./BackHeader";
import { cn } from "../lib/utils";

interface FoodDbAdminPageProps {
  onBack: () => void;
}

const COOKING_STATES: CookingState[] = ["n/a", "raw", "cooked"];

const SOURCE_STYLE: Record<DensitySource, string> = {
  admin: "bg-leaf/15 text-leaf",
  curated: "bg-sky/15 text-sky",
  usda: "bg-sun/20 text-ink/70",
  llm: "bg-coral/15 text-coral",
};

const CONFIDENCE_STYLE: Record<Confidence, string> = {
  high: "text-leaf",
  medium: "text-sun",
  low: "text-coral",
};

const inputClass =
  "w-full rounded-xl bg-white px-3 py-2 text-sm font-semibold text-ink shadow-sm ring-1 ring-ink/10 outline-none placeholder:font-medium placeholder:text-ink/30 focus:ring-2 focus:ring-coral/50";

const emptyForm = { food_key: "", cooking_state: "n/a" as CookingState, calories: "", protein_g: "", carbs_g: "", fat_g: "" };

// Admin CRUD over the authoritative food database (food_density). Shows the
// review queue (AI-resolved rows awaiting a human OK) first, a form to hand-
// author or edit a food (which becomes a verified 'admin' row that overrides
// any AI value), and the full searchable list with provenance/confidence.
export function FoodDbAdminPage({ onBack }: FoodDbAdminPageProps) {
  const [foods, setFoods] = useState<FoodDensityRow[]>([]);
  const [reviewCount, setReviewCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function load() {
    setLoading(true);
    fetchAdminFoods()
      .then((res) => {
        setFoods(res.foods);
        setReviewCount(res.review_count);
        setError(null);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load the food database."))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? foods.filter((f) => f.food_key.includes(q)) : foods;
  }, [foods, search]);

  function startEdit(row: FoodDensityRow) {
    setForm({
      food_key: row.food_key,
      cooking_state: row.cooking_state,
      calories: String(row.calories),
      protein_g: row.protein_g == null ? "" : String(row.protein_g),
      carbs_g: row.carbs_g == null ? "" : String(row.carbs_g),
      fat_g: row.fat_g == null ? "" : String(row.fat_g),
    });
    setEditing(true);
    setFormError(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function resetForm() {
    setForm(emptyForm);
    setEditing(false);
    setFormError(null);
  }

  async function handleSave() {
    if (saving) return;
    const calories = Number(form.calories);
    if (!form.food_key.trim() || !Number.isFinite(calories) || calories < 0) {
      setFormError("A food name and a calories value (per 100g) are required.");
      return;
    }
    const numOrNull = (s: string) => (s.trim() === "" ? null : Number(s));
    setSaving(true);
    setFormError(null);
    try {
      await upsertAdminFood({
        food_key: form.food_key.trim().toLowerCase(),
        cooking_state: form.cooking_state,
        calories,
        protein_g: numOrNull(form.protein_g),
        carbs_g: numOrNull(form.carbs_g),
        fat_g: numOrNull(form.fat_g),
      });
      resetForm();
      load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Could not save this food.");
    } finally {
      setSaving(false);
    }
  }

  async function handleVerify(row: FoodDensityRow) {
    try {
      await verifyAdminFood(row.food_key, row.cooking_state);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not verify this food.");
    }
  }

  async function handleDelete(row: FoodDensityRow) {
    try {
      await deleteAdminFood(row.food_key, row.cooking_state);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not delete this food.");
    }
  }

  return (
    <div className="flex min-h-dvh flex-col gap-5 px-6 pb-16 pt-5">
      <BackHeader
        title="Food database"
        subtitle={`${foods.length} foods${reviewCount > 0 ? ` · ${reviewCount} to review` : ""}`}
        onBack={onBack}
      />

      {/* Add / edit form */}
      <div className="rounded-[2rem] bg-white p-5 shadow-sm ring-1 ring-ink/5">
        <h2 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-ink/40">
          <Plus className="size-4 text-leaf" />
          {editing ? "Edit food" : "Add a food"} <span className="font-medium normal-case text-ink/30">· per 100g</span>
        </h2>
        <div className="space-y-2">
          <div className="flex gap-2">
            <input
              className={cn(inputClass, "flex-1")}
              placeholder="food name (e.g. grilled halloumi)"
              value={form.food_key}
              onChange={(e) => setForm((f) => ({ ...f, food_key: e.target.value }))}
              aria-label="Food name"
            />
            <select
              className={cn(inputClass, "w-28")}
              value={form.cooking_state}
              onChange={(e) => setForm((f) => ({ ...f, cooking_state: e.target.value as CookingState }))}
              aria-label="Cooking state"
            >
              {COOKING_STATES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-4 gap-2">
            <input className={inputClass} placeholder="kcal" inputMode="decimal" value={form.calories}
              onChange={(e) => setForm((f) => ({ ...f, calories: e.target.value }))} aria-label="Calories per 100g" />
            <input className={inputClass} placeholder="P" inputMode="decimal" value={form.protein_g}
              onChange={(e) => setForm((f) => ({ ...f, protein_g: e.target.value }))} aria-label="Protein per 100g" />
            <input className={inputClass} placeholder="C" inputMode="decimal" value={form.carbs_g}
              onChange={(e) => setForm((f) => ({ ...f, carbs_g: e.target.value }))} aria-label="Carbs per 100g" />
            <input className={inputClass} placeholder="F" inputMode="decimal" value={form.fat_g}
              onChange={(e) => setForm((f) => ({ ...f, fat_g: e.target.value }))} aria-label="Fat per 100g" />
          </div>
          {formError && <p className="text-xs font-semibold text-coral">{formError}</p>}
          <div className="flex gap-2 pt-1">
            <button
              className="inline-flex items-center gap-1.5 rounded-xl bg-coral px-4 py-2 text-xs font-bold text-white disabled:opacity-60"
              onClick={handleSave}
              disabled={saving}
            >
              <Check className="size-3.5" /> {editing ? "Save changes" : "Add food"}
            </button>
            {editing && (
              <button
                className="rounded-xl bg-white px-4 py-2 text-xs font-bold text-ink ring-1 ring-ink/10"
                onClick={resetForm}
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      </div>

      <input
        className={inputClass}
        placeholder="Search foods…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        aria-label="Search foods"
      />

      {loading && <p className="py-10 text-center text-sm font-medium text-ink/40">Loading…</p>}
      {error && (
        <p className="rounded-2xl bg-coral/10 px-4 py-3 text-sm font-semibold text-coral ring-1 ring-coral/20">{error}</p>
      )}

      {!loading && !error && (
        <div className="space-y-2">
          {filtered.map((row) => (
            <div
              key={`${row.food_key}|${row.cooking_state}`}
              className={cn(
                "rounded-2xl bg-white p-4 shadow-sm ring-1 ring-ink/5",
                row.needs_review === 1 && "ring-2 ring-sun/40",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-bold text-ink">{row.food_key}</span>
                    {row.cooking_state !== "n/a" && (
                      <span className="rounded-full bg-ink/5 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink/50">
                        {row.cooking_state}
                      </span>
                    )}
                    {row.verified === 1 && <BadgeCheck className="size-4 text-leaf" />}
                  </div>
                  <div className="mt-1 text-xs font-semibold text-ink/50">
                    {Math.round(row.calories)} kcal
                    {row.protein_g != null && ` · P ${row.protein_g}`}
                    {row.carbs_g != null && ` · C ${row.carbs_g}`}
                    {row.fat_g != null && ` · F ${row.fat_g}`}
                    <span className="text-ink/30"> / 100g</span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide", SOURCE_STYLE[row.source])}>
                      {row.source}
                    </span>
                    <span className={cn("text-[10px] font-bold uppercase tracking-wide", CONFIDENCE_STYLE[row.confidence])}>
                      {row.confidence}
                    </span>
                    {row.needs_review === 1 && (
                      <span className="rounded-full bg-sun/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink/70">
                        review
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  {(row.needs_review === 1 || row.verified === 0) && (
                    <button
                      className="grid size-8 place-items-center rounded-lg text-leaf transition-colors hover:bg-leaf/10"
                      onClick={() => handleVerify(row)}
                      aria-label="Approve as verified"
                      title="Approve"
                    >
                      <Check className="size-4" />
                    </button>
                  )}
                  <button
                    className="grid size-8 place-items-center rounded-lg text-ink/40 transition-colors hover:bg-ink3 hover:text-ink"
                    onClick={() => startEdit(row)}
                    aria-label="Edit"
                    title="Edit"
                  >
                    <Pencil className="size-3.5" />
                  </button>
                  <button
                    className="grid size-8 place-items-center rounded-lg text-coral/60 transition-colors hover:bg-coral/10 hover:text-coral"
                    onClick={() => handleDelete(row)}
                    aria-label="Delete"
                    title="Delete"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <p className="py-10 text-center text-sm font-medium text-ink/40">No foods match.</p>
          )}
        </div>
      )}
    </div>
  );
}
