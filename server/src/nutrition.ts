// Deterministic fat/lean composition math, moved out of the system prompt.
// As a ~250-word prose rule the model applied it correctly only ~75% of the
// time; as code it gives the same answer every time. The model's job is now
// extraction (weight, ratio, preparation), not arithmetic.

export type Preparation = "raw" | "cooked" | "cured";

// Lean muscle tissue is ~70-75% water by weight, not protein — the protein
// fraction rises as moisture is lost to cooking/curing. Same figures the
// old prompt rule used (~20-25% raw, ~25-30% cooked/cured).
const PROTEIN_FRACTIONS: Record<Preparation, number> = {
  raw: 0.22,
  cooked: 0.27,
  cured: 0.3,
};

export interface CompositionInput {
  total_weight_g: number;
  fat_ratio_pct: number;
  preparation?: Preparation;
}

export interface ComputedNutrition {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

// The ratio describes VISUAL composition — how much of the cut looks like
// fat versus lean muscle. Adipose tissue genuinely is ~all fat by weight
// (9 cal/g directly); lean tissue contributes protein × 4 cal/g only for
// its protein fraction, never its full weight.
export function computeCompositionNutrition(input: CompositionInput): ComputedNutrition {
  const fatWeight = input.total_weight_g * (input.fat_ratio_pct / 100);
  const leanWeight = input.total_weight_g - fatWeight;
  const proteinG = leanWeight * PROTEIN_FRACTIONS[input.preparation ?? "cooked"];
  return {
    calories: Math.round(fatWeight * 9 + proteinG * 4),
    protein_g: Math.round(proteinG),
    carbs_g: 0,
    fat_g: Math.round(fatWeight),
  };
}
