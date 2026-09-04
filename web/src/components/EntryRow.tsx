import { useEffect, useState } from "react";
import { Check, Pencil, Star, Trash2, X } from "lucide-react";
import {
  ApiError,
  editEntry,
  removeEntry,
  setFoodFavorite,
  timeLabel,
  type CorrectionReason,
  type FoodEntry,
} from "../api/client";
import { useLanguage } from "../i18n/LanguageContext";
import { useT, type StringKey } from "../i18n/useT";
import { cn } from "../lib/utils";
import { DetailSheet } from "./DetailSheet";

interface EntryRowProps {
  entry: FoodEntry;
  onChanged: () => void;
  onMutated?: () => void;
}

const inputClass =
  "w-full rounded-xl bg-white px-3 py-2.5 text-sm font-semibold text-ink shadow-sm ring-1 ring-ink/10 outline-none placeholder:font-medium placeholder:text-ink/30 focus:ring-2 focus:ring-coral/50";

// Quick-select reasons for a calorie edit — see server/src/corrections.ts
// (CORRECTION_REASONS), same string values on both sides.
const REASON_CHIPS: { value: CorrectionReason; labelKey: StringKey }[] = [
  { value: "wrong_portion", labelKey: "entry.reasonWrongPortion" },
  { value: "wrong_food", labelKey: "entry.reasonWrongFood" },
  { value: "has_label", labelKey: "entry.reasonHasLabel" },
  { value: "skip", labelKey: "entry.reasonSkip" },
];

// One logged item with inline edit + delete. Mutations call the API directly
// and then trigger a refresh via onChanged.
export function EntryRow({ entry, onChanged, onMutated }: EntryRowProps) {
  const t = useT();
  const { language } = useLanguage();
  const [editing, setEditing] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    description: entry.description,
    calories: String(entry.calories ?? ""),
  });
  const [correctionReason, setCorrectionReason] = useState<CorrectionReason | null>(null);
  const [evidenceUrl, setEvidenceUrl] = useState("");
  // Optimistic — flips instantly on tap rather than waiting on the round
  // trip, reverted if the request fails. Reset whenever a fresh `entry`
  // comes in (a real refetch), so it never drifts from server truth.
  const [favoriteOverride, setFavoriteOverride] = useState<boolean | null>(null);
  const [favoriteBusy, setFavoriteBusy] = useState(false);
  const isFavorite = favoriteOverride ?? entry.is_favorite;

  useEffect(() => {
    setForm({
      description: entry.description,
      calories: String(entry.calories ?? ""),
    });
    setCorrectionReason(null);
    setEvidenceUrl("");
    setError(null);
    setConfirmingDelete(false);
    setFavoriteOverride(null);
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
      setError(err instanceof ApiError ? err.message : t("entry.saveError"));
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
      setError(err instanceof ApiError ? err.message : t("entry.deleteError"));
      setConfirmingDelete(false);
    } finally {
      setBusy(false);
    }
  }

  // Starring/unstarring for the "Favorite foods" section of My Foods —
  // requires a food_key (composition-described meat has none, so the star
  // just doesn't render for those entries; see the render below).
  async function handleToggleFavorite() {
    if (favoriteBusy || !entry.food_key) return;
    const next = !isFavorite;
    setFavoriteOverride(next);
    setFavoriteBusy(true);
    try {
      await setFoodFavorite(entry.food_key, next);
    } catch {
      setFavoriteOverride(!next); // revert — the toast-less failure is rare enough not to need its own error banner here
    } finally {
      setFavoriteBusy(false);
    }
  }

  return (
    <div className={cn("flex items-center gap-3 py-3", editing && "rounded-2xl bg-ink3 px-3")}>
      <div className="size-2.5 shrink-0 rounded-full bg-coral" />
      <div
        className={cn("min-w-0 flex-1", !editing && "cursor-pointer")}
        onClick={editing ? undefined : () => setDetailOpen(true)}
        role={editing ? undefined : "button"}
        tabIndex={editing ? undefined : 0}
        aria-label={editing ? undefined : t("entry.detailLabel")}
        onKeyDown={
          editing
            ? undefined
            : (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setDetailOpen(true);
                }
              }
        }
      >
        {editing ? (
          <div className="space-y-2">
            <input
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder={t("entry.descriptionPlaceholder")}
              className={inputClass}
              aria-label={t("entry.descriptionPlaceholder")}
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
                      {t(chip.labelKey)}
                    </button>
                  ))}
                </div>
                <input
                  value={evidenceUrl}
                  onChange={(e) => setEvidenceUrl(e.target.value)}
                  placeholder={t("entry.evidenceLinkPlaceholder")}
                  className={inputClass}
                  aria-label={t("entry.evidenceLinkPlaceholder")}
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
                <Check className="size-3.5" /> {t("entry.save")}
              </button>
              <button
                className="inline-flex items-center gap-1.5 rounded-xl bg-white px-4 py-2 text-xs font-bold text-ink ring-1 ring-ink/10 disabled:opacity-60"
                onClick={() => setEditing(false)}
                disabled={busy}
              >
                <X className="size-3.5" /> {t("entry.cancel")}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="truncate text-sm font-bold text-ink">
              {entry.description || t("entry.untitled")}
              {entry.edited && (
                <span className="ml-1.5 text-[10px] font-semibold uppercase text-ink/35">
                  {t("entry.edited")}
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
                  ✓ {t("entry.verified")}{entry.agreement_count ? ` ${entry.agreement_count}` : ""}
                </span>
              )}
              {entry.source === "yours" && (
                <span className="inline-flex items-center rounded-full bg-ink/8 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink/45">
                  {t("entry.yourValue")}
                </span>
              )}
              {entry.source === "barcode" && (
                <span className="inline-flex items-center gap-0.5 rounded-full bg-sky/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-sky">
                  {t("entry.barcode")}
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
            {entry.food_key && (
              <button
                className={cn(
                  "grid size-8 place-items-center rounded-lg transition-colors",
                  isFavorite ? "text-sun hover:bg-sun/10" : "text-ink/40 hover:bg-ink3 hover:text-ink",
                )}
                onClick={handleToggleFavorite}
                disabled={favoriteBusy}
                aria-label={isFavorite ? t("entry.unfavoriteLabel") : t("entry.favoriteLabel")}
              >
                <Star className="size-3.5" fill={isFavorite ? "currentColor" : "none"} />
              </button>
            )}
            <button
              className="grid size-8 place-items-center rounded-lg text-ink/40 transition-colors hover:bg-ink3 hover:text-ink"
              onClick={() => {
                setEditing(true);
                setConfirmingDelete(false);
                setError(null);
              }}
              aria-label={t("entry.editLabel")}
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
              aria-label={confirmingDelete ? t("entry.confirmDeleteLabel") : t("entry.deleteLabel")}
            >
              {confirmingDelete ? (
                <span className="text-[11px] font-bold">{t("entry.sure")}</span>
              ) : (
                <Trash2 className="size-3.5" />
              )}
            </button>
          </div>
          {error && <div className="text-[11px] font-semibold text-coral">{error}</div>}
        </div>
      )}

      <DetailSheet
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        closeLabel={t("entry.closeDetail")}
        title={
          <div className="min-w-0">
            <div className="truncate font-display text-base font-extrabold text-ink">
              {entry.description || t("entry.untitled")}
            </div>
            <div className="text-xs font-semibold text-ink/40">
              {new Date(entry.created_at).toLocaleString(language === "ro" ? "ro-RO" : "en-US", {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </div>
          </div>
        }
      >
        <div className="space-y-5">
          <div className="flex items-end justify-between rounded-2xl bg-ink3 px-5 py-4">
            <div>
              <div className="text-3xl font-black text-ink">{Math.round(entry.calories || 0)}</div>
              <div className="text-xs font-bold uppercase tracking-wide text-ink/40">{t("entry.calories")}</div>
            </div>
            {entry.source === "verified" && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-leaf/15 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-leaf">
                ✓ {t("entry.verified")}{entry.agreement_count ? ` ${entry.agreement_count}` : ""}
              </span>
            )}
            {entry.source === "yours" && (
              <span className="inline-flex items-center rounded-full bg-ink/8 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-ink/45">
                {t("entry.yourValue")}
              </span>
            )}
            {entry.source === "barcode" && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-sky/15 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-sky">
                {t("entry.barcode")}
              </span>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-2xl bg-ink3 px-3 py-3 text-center">
              <div className="text-lg font-extrabold text-ink">
                {entry.protein_g != null ? Math.round(entry.protein_g) : "—"}
              </div>
              <div className="text-[11px] font-bold uppercase tracking-wide text-ink/40">{t("entry.protein")}</div>
            </div>
            <div className="rounded-2xl bg-ink3 px-3 py-3 text-center">
              <div className="text-lg font-extrabold text-ink">
                {entry.carbs_g != null ? Math.round(entry.carbs_g) : "—"}
              </div>
              <div className="text-[11px] font-bold uppercase tracking-wide text-ink/40">{t("entry.carbs")}</div>
            </div>
            <div className="rounded-2xl bg-ink3 px-3 py-3 text-center">
              <div className="text-lg font-extrabold text-ink">
                {entry.fat_g != null ? Math.round(entry.fat_g) : "—"}
              </div>
              <div className="text-[11px] font-bold uppercase tracking-wide text-ink/40">{t("entry.fat")}</div>
            </div>
          </div>

          {entry.grams != null && (
            <div className="flex items-center justify-between text-sm">
              <span className="font-semibold text-ink/50">{t("entry.grams")}</span>
              <span className="font-bold text-ink">{Math.round(entry.grams)} g</span>
            </div>
          )}

          {entry.raw_transcript && entry.raw_transcript !== entry.description && (
            <div>
              <div className="text-xs font-bold uppercase tracking-wide text-ink/40">{t("entry.youSaid")}</div>
              <p className="mt-1 text-sm font-medium leading-relaxed text-ink/70">"{entry.raw_transcript}"</p>
            </div>
          )}
        </div>
      </DetailSheet>
    </div>
  );
}
