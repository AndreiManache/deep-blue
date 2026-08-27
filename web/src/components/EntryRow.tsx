import { useState } from "react";
import type { FoodEntry } from "../api/client";

interface EntryRowProps {
  entry: FoodEntry;
  onSave: (id: string, fields: { description: string; calories: number }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

type Mode = "view" | "edit" | "confirm-delete";

function formatMacro(value: number | null): string {
  return value === null ? "—" : `${value}g`;
}

export function EntryRow({ entry, onSave, onDelete }: EntryRowProps) {
  const [mode, setMode] = useState<Mode>("view");
  const [expanded, setExpanded] = useState(false);
  const [description, setDescription] = useState(entry.description);
  const [calories, setCalories] = useState(String(entry.calories));
  const [saving, setSaving] = useState(false);

  const time = new Date(entry.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  if (mode === "edit") {
    return (
      <div className="entry-item">
        <form
          className="edit-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const parsedCalories = Number(calories);
            if (!description.trim() || Number.isNaN(parsedCalories)) return;
            setSaving(true);
            try {
              await onSave(entry.id, { description: description.trim(), calories: parsedCalories });
              setMode("view");
            } finally {
              setSaving(false);
            }
          }}
        >
          <input
            name="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            autoFocus
          />
          <input
            name="calories"
            type="number"
            value={calories}
            onChange={(e) => setCalories(e.target.value)}
          />
          <button type="submit" className="icon-button" disabled={saving} aria-label="Save">
            ✓
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={() => {
              setDescription(entry.description);
              setCalories(String(entry.calories));
              setMode("view");
            }}
            aria-label="Cancel"
          >
            ✕
          </button>
        </form>
      </div>
    );
  }

  if (mode === "confirm-delete") {
    return (
      <div className="entry-item">
        <div className="entry-row">
          <div className="confirm-delete">Delete "{entry.description}"?</div>
          <button
            className="icon-button danger"
            onClick={() => onDelete(entry.id)}
            aria-label="Confirm delete"
          >
            ✓
          </button>
          <button className="icon-button" onClick={() => setMode("view")} aria-label="Cancel delete">
            ✕
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="entry-item">
      <div className="entry-row">
        <button
          className="icon-button expand-toggle"
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
          aria-label={expanded ? "Hide nutrients" : "Show nutrients"}
        >
          {expanded ? "▾" : "▸"}
        </button>
        <div className="entry-main">
          <div className="entry-description">{entry.description}</div>
          <div className="entry-meta">
            {time}
            {entry.edited ? " · edited" : ""}
            {entry.source === "verified" && (
              <span className="entry-badge verified">
                {" · ✓ verified"}
                {entry.agreement_count ? ` (${entry.agreement_count})` : ""}
              </span>
            )}
            {entry.source === "yours" && <span className="entry-badge"> · your value</span>}
          </div>
        </div>
        <div className="entry-calories">{entry.calories} cal</div>
        <button className="icon-button" onClick={() => setMode("edit")} aria-label="Edit entry">
          ✎
        </button>
        <button className="icon-button danger" onClick={() => setMode("confirm-delete")} aria-label="Delete entry">
          🗑
        </button>
      </div>

      {expanded && (
        <div className="entry-details">
          <div className="macro">
            <span className="macro-label">Protein</span>
            <span className="macro-value">{formatMacro(entry.protein_g)}</span>
          </div>
          <div className="macro">
            <span className="macro-label">Carbs</span>
            <span className="macro-value">{formatMacro(entry.carbs_g)}</span>
          </div>
          <div className="macro">
            <span className="macro-label">Fat</span>
            <span className="macro-value">{formatMacro(entry.fat_g)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
