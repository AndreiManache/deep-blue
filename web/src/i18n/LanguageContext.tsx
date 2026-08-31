import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { fetchProfile, saveProfile, type Language } from "../api/client";

interface LanguageContextValue {
  language: Language;
  // Updates app-wide state immediately and persists to the profile in the
  // background — a language switch is meant to be instant everywhere, not
  // gated behind the separate "Save profile" button the rest of the form uses.
  setLanguage: (language: Language) => void;
}

const LanguageContext = createContext<LanguageContextValue>({
  language: "en",
  setLanguage: () => {},
});

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>("en");

  useEffect(() => {
    fetchProfile()
      .then((res) => {
        if (res.profile?.language) setLanguageState(res.profile.language);
      })
      .catch(() => {
        /* falls back to English */
      });
  }, []);

  function setLanguage(next: Language) {
    setLanguageState(next);
    void saveProfile({ language: next }).catch(() => {
      /* the local switch already happened; a failed persist just means it
         won't stick past a reload — not worth surfacing an error for */
    });
  }

  return <LanguageContext.Provider value={{ language, setLanguage }}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  return useContext(LanguageContext);
}
