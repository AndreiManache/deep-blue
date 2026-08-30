import { useEffect, useState } from "react";
import { Check, Pencil, Trash2, X } from "lucide-react";
import {
  ApiError,
  editEntry,
  removeEntry,
  timeLabel,
  type CorrectionReason,
  type FoodEntry,
} from "../api/client";
import { cn } from "../lib/utils";

interface EntryRowProps {
  entry: FoodEntry;
  onChanged: () => void;
  onMutated?: () => void;
}

const inputClass =
  "w-full rounded-xl bg-white px-3 py-2.5 text-sm font-semibold text-ink shadow-sm ring-1 ring-ink/10 outline-none placeholder:font-medium placeholder:text-ink/30 focus:ring-2 focus:ring-coral/50";

// Quick-select reasons for a calorie edit — see server/src/corrections.ts
// (CORRECTION_REASONS), same string values on both sides.
const REASON_CHIPS: { value: CorrectionReason; label: string }[] = [
  { value: "wrong_portion", label: "Wrong portion size" },
  { value: "wrong_food", label: "Wrong food or recipe" },
  { value: "has_label", label: "I have the real label" },
  { value: "skip", label: "Just a typo, skip this" },
];

// One logged item with inline edit + delete. Mutations call the API directly
// and then trigger a refresh via onChanged.
export function EntryRow({ entry, onChanged, onMutated }: EntryRowProps) {
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    description: entry.description,
    calories: String(entry.calories ?? ""),
  });
  const [correctionReason, setCorrectionReason] = useState<CorrectionReason | null>(null);
  const [evidenceUrl, setEvidenceUrl] = useState("");

  useEffect(() => {
    setForm({
      description: entry.description,
      calories: String(entry.calories ?? ""),
    });
    setCorrectionReason(null);
    setEvidenceUrl("");
    setError(null);
    setConfirmingDelete(false);
  }, [entry]);

  const kcal = Number(form.calories);
  const caloriesChanged =
    form.calories.trim() !== "" && !Number.isNaN(kcal) && kcal !== entry.calories;

  async function handleSave() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await editEntry(entry.id, {
        description: form.description.trim() || entry.description,
        ...(caloriesChanged ? { calories: kcal } : {}),
        ...(caloriesChanged && correctionReason ? { correction_reason: correctionReason } : {}),
        ...(caloriesChanged && evidenceUrl.trim() ? { correction_evidence_url: evidenceUrl.trim() } : {}),
      });
      setEditing(false);
      onChanged();
      onMutated?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save changes.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (busy) return;
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await removeEntry(entry.id);
      setEditing(false);
      onChanged();
      onMutated?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't delete this entry.");
      setConfirmingDelete(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={cn("flex items-center gap-3 py-3", editing && "rounded-2xl bg-ink3 px-3")}>
      <div className="size-2.5 shrink-0 rounded-full bg-coral" />
      <div className="min-w-0 flex-1">
        {editing ? (
          <div className="space-y-2">
            <input
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Description"
              className={inputClass}
              aria-label="Entry description"
            />
            <input
              value={form.calories}
              onChange={(e) => setForm((f) => ({ ...f, calories: e.target.value }))}
              placeholder="kcal"
              inputMode="decimal"
              className={inputClass}
              aria-label="Calories"
            />
            {caloriesChanged && (
              <div className="space-y-1.5">
                <div className="flex flex-wrap gap-1.5">
                  {REASON_CHIPS.map((chip) => (
                    <button
                      key={chip.value}
                      type="button"
                      className={cn(
                        "rounded-full px-2.5 py-1 text-[11px] font-bold transition-colors",
                        correctionReason === chip.value
                          ? "bg-coral text-white"
                          : "bg-white text-ink/50 ring-1 ring-ink/10 hover:bg-ink3",
                      )}
                      onClick={() => setCorrectionReason((r) => (r === chip.value ? null : chip.value))}
                    >
                      {chip.label}
                    </button>
                  ))}
                </div>
                <input
                  value={evidenceUrl}
                  onChange={(e) => setEvidenceUrl(e.target.value)}
                  placeholder="Link to a label or menu (optional)"
                  className={inputClass}
                  aria-label="Evidence link"
                />
              </div>
            )}
            {error && (
              <div className="rounded-xl bg-coral/10 px-3 py-2 text-xs font-semibold text-coral">
                {error}
              </div>
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
                onClick={() => setEditing(false)}
                disabled={busy}
              >
                <X className="size-3.5" /> Cancel
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="truncate text-sm font-bold text-ink">
              {entry.description || "(untitled)"}
              {entry.edited && (
                <span className="ml-1.5 text-[10px] font-semibold uppercase text-ink/35">
                  edited
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 text-xs font-medium text-ink/45">
              <span>
                {Math.round(entry.calories || 0)} kcal
                {entry.protein_g != null && ` · P ${Math.round(entry.protein_g)}`}
                {entry.carbs_g != null && ` · C ${Math.round(entry.carbs_g)}`}
                {entry.fat_g != null && ` · F ${Math.round(entry.fat_g)}`}
              </span>
              {entry.source === "verified" && (
                <span className="inline-flex items-center gap-0.5 rounded-full bg-leaf/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-leaf">
                  ✓ verified{entry.agreement_count ? ` ${entry.agreement_count}` : ""}
                </span>
              )}
              {entry.source === "yours" && (
                <span className="inline-flex items-center rounded-full bg-ink/8 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink/45">
                  your value
                </span>
              )}
              {entry.source === "barcode" && (
                <span className="inline-flex items-center gap-0.5 rounded-full bg-sky/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-sky">
                  barcode
                </span>
              )}
            </div>
          </>
        )}
      </div>
      {!editing && (
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="text-[11px] font-semibold text-ink/35">
            {timeLabel(entry.created_at)}
          </span>
          <div className="flex gap-1">
            <button
              className="grid size-8 place-items-center rounded-lg text-ink/40 transition-colors hover:bg-ink3 hover:text-ink"
              onClick={() => {
                setEditing(true);
                setConfirmingDelete(false);
                setError(null);
              }}
              aria-label="Edit entry"
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
              aria-label={confirmingDelete ? "Confirm delete" : "Delete entry"}
            >
              {confirmingDelete ? (
                <span className="text-[11px] font-bold">Sure?</span>
              ) : (
                <Trash2 className="size-3.5" />
              )}
            </button>
          </div>
          {error && <div className="text-[11px] font-semibold text-coral">{error}</div>}
        </div>
      )}
    </div>
  );
}
