import { useEffect, useState } from "react";
import { Check, Pencil, Plus, RotateCcw, Trash2, X } from "lucide-react";
import {
  ApiError,
  deleteMyFood,
  fetchMyFoods,
  logFoodAgain,
  upsertMyFood,
  type FoodBasis,
  type MyFoodItem,
} from "../api/client";
import { BackHeader } from "./BackHeader";
import { cn } from "../lib/utils";

interface MyFoodsPageProps {
  onBack: () => void;
  // Bumps the same refetch signal barcode logging uses — quick-relogging
  // happens outside the conversation pipeline too, so the Dashboard has no
  // other way to know a new entry appeared.
  onLogged: () => void;
}

const inputClass =
  "w-full rounded-xl bg-white px-3 py-2.5 text-sm font-semibold text-ink shadow-sm ring-1 ring-ink/10 outline-none placeholder:font-medium placeholder:text-ink/30 focus:ring-2 focus:ring-coral/50";

function basisLabel(basis: FoodBasis): string {
  return basis === "per_100g" ? "per 100g" : "per item";
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

interface FoodFormState {
  food_key: string;
  basis: FoodBasis;
  calories: string;
  protein_g: string;
  carbs_g: string;
  fat_g: string;
}

function blankForm(): FoodFormState {
  return { food_key: "", basis: "per_100g", calories: "", protein_g: "", carbs_g: "", fat_g: "" };
}

function formFromItem(item: MyFoodItem): FoodFormState {
  return {
    food_key: item.food_key,
    basis: item.basis,
    calories: String(item.calories),
    protein_g: item.protein_g != null ? String(item.protein_g) : "",
    carbs_g: item.carbs_g != null ? String(item.carbs_g) : "",
    fat_g: item.fat_g != null ? String(item.fat_g) : "",
  };
}

export function MyFoodsPage({ onBack, onLogged }: MyFoodsPageProps) {
  const [items, setItems] = useState<MyFoodItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  function load() {
    fetchMyFoods()
      .then(setItems)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load your foods."))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  return (
    <div className="flex min-h-dvh flex-col gap-6 px-6 pb-16 pt-5">
      <BackHeader
        title="My Foods"
        subtitle={`${items.length} food${items.length === 1 ? "" : "s"} you've taught Deep Blue`}
        onBack={onBack}
      />

      {!adding && (
        <button
          className="flex items-center justify-center gap-1.5 rounded-2xl bg-ink px-4 py-3 text-sm font-bold text-cream transition-colors hover:bg-ink/80"
          onClick={() => setAdding(true)}
        >
          <Plus className="size-4" /> Add a food
        </button>
      )}
      {adding && (
        <FoodForm
          initial={blankForm()}
          onCancel={() => setAdding(false)}
          onSaved={(item) => {
            setItems((prev) => [item, ...prev.filter((i) => i.food_key !== item.food_key)]);
            setAdding(false);
          }}
        />
      )}

      {loading && <p className="py-10 text-center text-sm font-medium text-ink/40">Loading…</p>}
      {error && (
        <p className="rounded-2xl bg-coral/10 px-4 py-3 text-sm font-semibold text-coral ring-1 ring-coral/20">
          {error}
        </p>
      )}
      {!loading && !error && items.length === 0 && !adding && (
        <p className="py-10 text-center text-sm font-medium text-ink/40">
          Nothing yet — foods you log or correct will show up here, or add one directly.
        </p>
      )}

      <div className="space-y-3">
        {items.map((item) => (
          <FoodCard
            key={item.food_key}
            item={item}
            onSaved={(updated) =>
              setItems((prev) => prev.map((i) => (i.food_key === item.food_key ? updated : i)))
            }
            onDeleted={() => setItems((prev) => prev.filter((i) => i.food_key !== item.food_key))}
            onLogged={onLogged}
          />
        ))}
      </div>
    </div>
  );
}

interface FoodCardProps {
  item: MyFoodItem;
  onSaved: (item: MyFoodItem) => void;
  onDeleted: () => void;
  onLogged: () => void;
}

function FoodCard({ item, onSaved, onDeleted, onLogged }: FoodCardProps) {
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loggingAgain, setLoggingAgain] = useState(false);
  const [quantity, setQuantity] = useState(item.basis === "per_100g" ? "100" : "1");
  const [justLogged, setJustLogged] = useState(false);

  async function handleLogAgain() {
    const qty = Number(quantity);
    if (quantity.trim() === "" || Number.isNaN(qty) || qty <= 0) {
      setError("Enter a valid quantity.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await logFoodAgain(item.food_key, qty);
      onLogged();
      setLoggingAgain(false);
      setJustLogged(true);
      setTimeout(() => setJustLogged(false), 2000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't log this food.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await deleteMyFood(item.food_key);
      onDeleted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't delete this food.");
      setConfirmingDelete(false);
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <FoodForm
        initial={formFromItem(item)}
        lockKey
        onCancel={() => setEditing(false)}
        onSaved={(updated) => {
          onSaved(updated);
          setEditing(false);
        }}
      />
    );
  }

  return (
    <div className="rounded-[2rem] bg-white p-5 shadow-sm ring-1 ring-ink/5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-display text-sm font-extrabold capitalize tracking-tight text-ink">
            {item.food_key}
          </div>
          <div className="text-xs font-semibold text-ink/40">
            Updated {fmtTime(item.updated_at)} · {basisLabel(item.basis)}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            className="grid size-8 place-items-center rounded-lg text-ink/40 transition-colors hover:bg-ink3 hover:text-ink"
            onClick={() => setLoggingAgain((v) => !v)}
            aria-label="Log this again"
          >
            <RotateCcw className="size-3.5" />
          </button>
          <button
            className="grid size-8 place-items-center rounded-lg text-ink/40 transition-colors hover:bg-ink3 hover:text-ink"
            onClick={() => setEditing(true)}
            aria-label="Edit food"
          >
            <Pencil className="size-3.5" />
          </button>
          <button
            className={cn(
              "grid h-8 place-items-center rounded-lg transition-colors",
              confirmingDelete
                ? "w-auto bg-coral px-2.5 text-white"
                : "w-8 text-coral/60 hover:bg-coral/10 hover:text-coral",
            )}
            onClick={handleDelete}
            disabled={busy}
            aria-label={confirmingDelete ? "Confirm delete" : "Delete food"}
          >
            {confirmingDelete ? <span className="text-[11px] font-bold">Sure?</span> : <Trash2 className="size-3.5" />}
          </button>
        </div>
      </div>
      <div className="mt-2 text-xs font-medium text-ink/45">
        {Math.round(item.calories)} kcal
        {item.protein_g != null && ` · P ${Math.round(item.protein_g)}`}
        {item.carbs_g != null && ` · C ${Math.round(item.carbs_g)}`}
        {item.fat_g != null && ` · F ${Math.round(item.fat_g)}`}
      </div>

      {loggingAgain && (
        <div className="mt-3 flex items-center gap-2 border-t border-ink/5 pt-3">
          <input
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder={item.basis === "per_100g" ? "grams" : "how many"}
            inputMode="decimal"
            className={cn(inputClass, "flex-1")}
            aria-label={item.basis === "per_100g" ? "Grams to log" : "Quantity to log"}
          />
          <button
            className="inline-flex items-center gap-1.5 rounded-xl bg-coral px-4 py-2.5 text-xs font-bold text-white disabled:opacity-60"
            onClick={handleLogAgain}
            disabled={busy}
          >
            <Check className="size-3.5" /> Log
          </button>
        </div>
      )}
      {justLogged && (
        <div className="mt-3 flex items-center gap-1.5 border-t border-ink/5 pt-3 text-xs font-bold text-leaf">
          <Check className="size-3.5" /> Logged
        </div>
      )}
      {error && <div className="mt-2 text-[11px] font-semibold text-coral">{error}</div>}
    </div>
  );
}

interface FoodFormProps {
  initial: FoodFormState;
  lockKey?: boolean;
  onCancel: () => void;
  onSaved: (item: MyFoodItem) => void;
}

function FoodForm({ initial, lockKey, onCancel, onSaved }: FoodFormProps) {
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (busy) return;
    const kcal = Number(form.calories);
    if (!form.food_key.trim()) {
      setError("Name this food first.");
      return;
    }
    if (form.calories.trim() === "" || Number.isNaN(kcal)) {
      setError("Calories must be a number.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const item = await upsertMyFood({
        food_key: form.food_key.trim(),
        basis: form.basis,
        calories: kcal,
        protein_g: form.protein_g.trim() !== "" ? Number(form.protein_g) : null,
        carbs_g: form.carbs_g.trim() !== "" ? Number(form.carbs_g) : null,
        fat_g: form.fat_g.trim() !== "" ? Number(form.fat_g) : null,
      });
      onSaved(item);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save this food.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 rounded-[2rem] bg-ink3 p-5">
      <input
        value={form.food_key}
        onChange={(e) => setForm((f) => ({ ...f, food_key: e.target.value }))}
        placeholder="Food name (e.g. greek yogurt)"
        className={inputClass}
        disabled={lockKey}
        aria-label="Food name"
      />
      <div className="flex gap-1.5">
        {(["per_100g", "per_item"] as const).map((basis) => (
          <button
            key={basis}
            type="button"
            className={cn(
              "flex-1 rounded-xl px-3 py-2 text-xs font-bold transition-colors",
              form.basis === basis ? "bg-coral text-white" : "bg-white text-ink/50 ring-1 ring-ink/10",
            )}
            onClick={() => setForm((f) => ({ ...f, basis }))}
          >
            {basisLabel(basis)}
          </button>
        ))}
      </div>
      <input
        value={form.calories}
        onChange={(e) => setForm((f) => ({ ...f, calories: e.target.value }))}
        placeholder={`kcal ${basisLabel(form.basis)}`}
        inputMode="decimal"
        className={inputClass}
        aria-label="Calories"
      />
      <div className="grid grid-cols-3 gap-2">
        <input
          value={form.protein_g}
          onChange={(e) => setForm((f) => ({ ...f, protein_g: e.target.value }))}
          placeholder="Protein g"
          inputMode="decimal"
          className={inputClass}
          aria-label="Protein grams"
        />
        <input
          value={form.carbs_g}
          onChange={(e) => setForm((f) => ({ ...f, carbs_g: e.target.value }))}
          placeholder="Carbs g"
          inputMode="decimal"
          className={inputClass}
          aria-label="Carbs grams"
        />
        <input
          value={form.fat_g}
          onChange={(e) => setForm((f) => ({ ...f, fat_g: e.target.value }))}
          placeholder="Fat g"
          inputMode="decimal"
          className={inputClass}
          aria-label="Fat grams"
        />
      </div>
      {error && (
        <div className="rounded-xl bg-coral/10 px-3 py-2 text-xs font-semibold text-coral">{error}</div>
      )}
      <div className="flex gap-2 pt-1">
        <button
          className="inline-flex items-center gap-1.5 rounded-xl bg-coral px-4 py-2 text-xs font-bold text-white disabled:opacity-60"
          onClick={handleSave}
          disabled={busy}
        >
          <Check className="size-3.5" /> Save
        </button>
        <button
          className="inline-flex items-center gap-1.5 rounded-xl bg-white px-4 py-2 text-xs font-bold text-ink ring-1 ring-ink/10 disabled:opacity-60"
          onClick={onCancel}
          disabled={busy}
        >
          <X className="size-3.5" /> Cancel
        </button>
      </div>
    </div>
  );
}
