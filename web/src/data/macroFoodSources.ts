// Curated, static content for the Dashboard's macro tooltip (ticket #24) —
// deliberately NOT model-generated: "good sources of protein/carbs/fat" is
// generic nutrition knowledge that doesn't depend on this user's specific
// day, so a small hand-picked list is both instant (no loading state, no
// LLM cost) and more reliable than re-asking a model the same question on
// every tap. Revisit only if this needs to become personalized later.

export type MacroKey = "protein" | "carbs" | "fat";

export interface FoodSource {
  name: string;
  note: string;
}

export const MACRO_FOOD_SOURCES: Record<MacroKey, { en: FoodSource[]; ro: FoodSource[] }> = {
  protein: {
    en: [
      { name: "Chicken breast", note: "~31g per 100g, very lean" },
      { name: "Eggs", note: "~13g per 100g, plus choline" },
      { name: "Greek yogurt", note: "~10g per 100g, plus probiotics" },
      { name: "Lentils", note: "~9g per 100g cooked — a great plant-based option" },
      { name: "Salmon", note: "~20g per 100g, plus omega-3s" },
      { name: "Cottage cheese", note: "~11g per 100g, low in fat too" },
    ],
    ro: [
      { name: "Piept de pui", note: "~31g la 100g, foarte slab" },
      { name: "Ouă", note: "~13g la 100g, plus colină" },
      { name: "Iaurt grecesc", note: "~10g la 100g, plus probiotice" },
      { name: "Linte", note: "~9g la 100g fiartă — o opțiune vegetală excelentă" },
      { name: "Somon", note: "~20g la 100g, plus omega-3" },
      { name: "Cașcaval cottage", note: "~11g la 100g, sărac și în grăsimi" },
    ],
  },
  carbs: {
    en: [
      { name: "Oats", note: "slow-release energy, plus fiber" },
      { name: "Brown rice", note: "steady energy, pairs with almost anything" },
      { name: "Sweet potato", note: "fiber and vitamin A alongside the carbs" },
      { name: "Bananas", note: "quick energy, good around exercise" },
      { name: "Quinoa", note: "carbs plus a complete protein" },
      { name: "Whole-grain bread", note: "more fiber than white bread, same convenience" },
    ],
    ro: [
      { name: "Fulgi de ovăz", note: "energie eliberată lent, plus fibre" },
      { name: "Orez brun", note: "energie constantă, se combină cu aproape orice" },
      { name: "Cartof dulce", note: "fibre și vitamina A alături de carbohidrați" },
      { name: "Banane", note: "energie rapidă, bune în jurul exercițiilor" },
      { name: "Quinoa", note: "carbohidrați plus o proteină completă" },
      { name: "Pâine integrală", note: "mai multe fibre decât pâinea albă, aceeași comoditate" },
    ],
  },
  fat: {
    en: [
      { name: "Avocado", note: "mostly unsaturated, plus potassium" },
      { name: "Olive oil", note: "a heart-healthy staple for cooking" },
      { name: "Almonds & walnuts", note: "unsaturated fats plus protein and fiber" },
      { name: "Salmon & other fatty fish", note: "omega-3 fats, harder to get elsewhere" },
      { name: "Eggs", note: "fat and protein together" },
      { name: "Full-fat Greek yogurt", note: "satisfying, and the fat helps absorb vitamin D" },
    ],
    ro: [
      { name: "Avocado", note: "mai ales grăsimi nesaturate, plus potasiu" },
      { name: "Ulei de măsline", note: "un ingredient sănătos pentru inimă, bun la gătit" },
      { name: "Migdale și nuci", note: "grăsimi nesaturate plus proteine și fibre" },
      { name: "Somon și alt pește gras", note: "grăsimi omega-3, mai greu de găsit altundeva" },
      { name: "Ouă", note: "grăsimi și proteine împreună" },
      { name: "Iaurt grecesc integral", note: "sățios, iar grăsimea ajută la absorbția vitaminei D" },
    ],
  },
};
