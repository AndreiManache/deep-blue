// Curated seed for the authoritative food database (food_density).
//
// Vetted per-100g densities for common foods, from well-established reference
// values (USDA SR Legacy / FoodData Central order of magnitude). Every row is
// source='curated', confidence='high', verified=1 — they are the trusted
// baseline the resolver reaches for before ever asking the model to guess.
// Admin can edit/extend these in the panel; USDA fills the long tail on first
// encounter (later slice). cooking_state matters wherever water loss or added
// fat changes the density enough to corrupt a shared value if mixed.
//
// NOTE: these are the food's own density. Absorbed cooking fat is a separate
// line item (its own slice) — a "fried" row here is the item as commonly
// prepared; when the cooking-fat component ships, fried/pan rows move to their
// no-added-fat base so the fat isn't double-counted.

export type CookingState = "raw" | "cooked" | "n/a";

export interface CuratedFood {
  food_key: string;
  cooking_state: CookingState;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

// per 100g throughout.
export const CURATED_FOODS: CuratedFood[] = [
  // --- Poultry ---
  { food_key: "chicken breast", cooking_state: "raw", calories: 120, protein_g: 22.5, carbs_g: 0, fat_g: 2.6 },
  { food_key: "chicken breast", cooking_state: "cooked", calories: 165, protein_g: 31, carbs_g: 0, fat_g: 3.6 },
  { food_key: "chicken thigh", cooking_state: "raw", calories: 145, protein_g: 18, carbs_g: 0, fat_g: 8 },
  { food_key: "chicken thigh", cooking_state: "cooked", calories: 209, protein_g: 26, carbs_g: 0, fat_g: 11 },
  { food_key: "turkey breast", cooking_state: "cooked", calories: 135, protein_g: 30, carbs_g: 0, fat_g: 1 },

  // --- Red meat / pork ---
  { food_key: "ground beef", cooking_state: "raw", calories: 215, protein_g: 18, carbs_g: 0, fat_g: 15 },
  { food_key: "ground beef", cooking_state: "cooked", calories: 250, protein_g: 26, carbs_g: 0, fat_g: 15 },
  { food_key: "beef steak", cooking_state: "cooked", calories: 271, protein_g: 27, carbs_g: 0, fat_g: 18 },
  { food_key: "pork chop", cooking_state: "cooked", calories: 231, protein_g: 26, carbs_g: 0, fat_g: 14 },
  { food_key: "bacon", cooking_state: "cooked", calories: 541, protein_g: 37, carbs_g: 1.4, fat_g: 42 },

  // --- Fish / seafood ---
  { food_key: "salmon", cooking_state: "raw", calories: 208, protein_g: 20, carbs_g: 0, fat_g: 13 },
  { food_key: "salmon", cooking_state: "cooked", calories: 206, protein_g: 22, carbs_g: 0, fat_g: 12 },
  { food_key: "tuna", cooking_state: "cooked", calories: 130, protein_g: 29, carbs_g: 0, fat_g: 1 },
  { food_key: "canned tuna in water", cooking_state: "n/a", calories: 116, protein_g: 26, carbs_g: 0, fat_g: 1 },
  { food_key: "shrimp", cooking_state: "cooked", calories: 99, protein_g: 24, carbs_g: 0.2, fat_g: 0.3 },

  // --- Eggs ---
  { food_key: "boiled egg", cooking_state: "cooked", calories: 155, protein_g: 13, carbs_g: 1.1, fat_g: 11 },
  { food_key: "fried egg", cooking_state: "cooked", calories: 196, protein_g: 14, carbs_g: 0.8, fat_g: 15 },
  { food_key: "scrambled eggs", cooking_state: "cooked", calories: 166, protein_g: 11, carbs_g: 1.6, fat_g: 12 },

  // --- Grains / staples ---
  { food_key: "white rice", cooking_state: "raw", calories: 365, protein_g: 7, carbs_g: 80, fat_g: 0.7 },
  { food_key: "white rice", cooking_state: "cooked", calories: 130, protein_g: 2.7, carbs_g: 28, fat_g: 0.3 },
  { food_key: "brown rice", cooking_state: "cooked", calories: 123, protein_g: 2.7, carbs_g: 26, fat_g: 1 },
  { food_key: "pasta", cooking_state: "raw", calories: 371, protein_g: 13, carbs_g: 75, fat_g: 1.5 },
  { food_key: "pasta", cooking_state: "cooked", calories: 158, protein_g: 6, carbs_g: 31, fat_g: 0.9 },
  { food_key: "white bread", cooking_state: "n/a", calories: 265, protein_g: 9, carbs_g: 49, fat_g: 3.2 },
  { food_key: "whole wheat bread", cooking_state: "n/a", calories: 247, protein_g: 13, carbs_g: 41, fat_g: 3.4 },
  { food_key: "oats", cooking_state: "raw", calories: 389, protein_g: 17, carbs_g: 66, fat_g: 7 },
  { food_key: "oatmeal", cooking_state: "cooked", calories: 71, protein_g: 2.5, carbs_g: 12, fat_g: 1.5 },

  // --- Potatoes ---
  { food_key: "potato", cooking_state: "raw", calories: 77, protein_g: 2, carbs_g: 17, fat_g: 0.1 },
  { food_key: "potato", cooking_state: "cooked", calories: 87, protein_g: 1.9, carbs_g: 20, fat_g: 0.1 },
  { food_key: "french fries", cooking_state: "cooked", calories: 312, protein_g: 3.4, carbs_g: 41, fat_g: 15 },

  // --- Legumes ---
  { food_key: "lentils", cooking_state: "cooked", calories: 116, protein_g: 9, carbs_g: 20, fat_g: 0.4 },
  { food_key: "chickpeas", cooking_state: "cooked", calories: 164, protein_g: 9, carbs_g: 27, fat_g: 2.6 },
  { food_key: "black beans", cooking_state: "cooked", calories: 132, protein_g: 9, carbs_g: 24, fat_g: 0.5 },

  // --- Vegetables ---
  { food_key: "broccoli", cooking_state: "raw", calories: 34, protein_g: 2.8, carbs_g: 7, fat_g: 0.4 },
  { food_key: "broccoli", cooking_state: "cooked", calories: 35, protein_g: 2.4, carbs_g: 7, fat_g: 0.4 },
  { food_key: "tomato", cooking_state: "raw", calories: 18, protein_g: 0.9, carbs_g: 3.9, fat_g: 0.2 },
  { food_key: "carrot", cooking_state: "raw", calories: 41, protein_g: 0.9, carbs_g: 10, fat_g: 0.2 },
  { food_key: "spinach", cooking_state: "raw", calories: 23, protein_g: 2.9, carbs_g: 3.6, fat_g: 0.4 },
  { food_key: "onion", cooking_state: "raw", calories: 40, protein_g: 1.1, carbs_g: 9, fat_g: 0.1 },
  { food_key: "cucumber", cooking_state: "raw", calories: 15, protein_g: 0.7, carbs_g: 3.6, fat_g: 0.1 },

  // --- Dairy ---
  { food_key: "whole milk", cooking_state: "n/a", calories: 61, protein_g: 3.2, carbs_g: 4.8, fat_g: 3.3 },
  { food_key: "skim milk", cooking_state: "n/a", calories: 34, protein_g: 3.4, carbs_g: 5, fat_g: 0.1 },
  { food_key: "greek yogurt", cooking_state: "n/a", calories: 59, protein_g: 10, carbs_g: 3.6, fat_g: 0.4 },
  { food_key: "cheddar cheese", cooking_state: "n/a", calories: 403, protein_g: 25, carbs_g: 1.3, fat_g: 33 },

  // --- Fats ---
  { food_key: "butter", cooking_state: "n/a", calories: 717, protein_g: 0.9, carbs_g: 0.1, fat_g: 81 },
  { food_key: "olive oil", cooking_state: "n/a", calories: 884, protein_g: 0, carbs_g: 0, fat_g: 100 },

  // --- Fruit ---
  { food_key: "banana", cooking_state: "raw", calories: 89, protein_g: 1.1, carbs_g: 23, fat_g: 0.3 },
  { food_key: "apple", cooking_state: "raw", calories: 52, protein_g: 0.3, carbs_g: 14, fat_g: 0.2 },
  { food_key: "orange", cooking_state: "raw", calories: 47, protein_g: 0.9, carbs_g: 12, fat_g: 0.1 },
];
