import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { keyToLabel, translationsEn } from "pptx-react-viewer/i18n";

// pptx-react-viewer uses react-i18next internally even in presentation-only
// mode. Without an initialized instance, opening the first real .pptx throws
// while reading i18n.options.resources and takes down the whole React screen.
if (!i18n.isInitialized)
  void i18n.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: { en: { translation: translationsEn } },
    interpolation: { escapeValue: false },
    parseMissingKeyHandler: keyToLabel,
  });

export default i18n;
