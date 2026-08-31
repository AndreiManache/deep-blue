import { useLanguage } from "./LanguageContext";
import { strings } from "./strings";

export type StringKey = keyof typeof strings;

// {var}-style interpolation only — every dynamic value used across this
// app's copy is a short number or word, never markup, so a plain replace is
// enough and keeps this dependency-free.
function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replaceAll(`{${key}}`, String(value));
  }
  return result;
}

export function useT() {
  const { language } = useLanguage();
  return (key: StringKey, vars?: Record<string, string | number>): string => {
    const entry = strings[key];
    if (!entry) return key;
    return interpolate(entry[language] ?? entry.en, vars);
  };
}
