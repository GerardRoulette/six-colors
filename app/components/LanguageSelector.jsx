'use client'

import React, { createContext, useState, useContext, useEffect, useCallback } from 'react';
// Nested copy dictionaries keyed by locale code; `t()` looks up strings here.
import en from '../locales/en';
import ru from '../locales/ru';

// Map of locale code → dictionary. Used by lookup, the prompt, and the toggle.
const translations = { en, ru };
// localStorage key for the chosen locale so the prompt is skipped on later visits.
const STORAGE_KEY = 'language';
// Flag emoji shown on prompt buttons and the toolbar switcher, keyed by locale.
const FLAGS = { en: '🇬🇧', ru: '🇷🇺' };
// Human-readable language names for prompt labels and toggle titles.
const LABELS = { en: 'English', ru: 'Русский' };

// Shared i18n state: locale, changeLanguage, t, ready, needsChoice. Default null so the hook can detect a missing provider.
const LanguageContext = createContext(null);

// Walk a nested dictionary with a dotted key (`gameOver.tie` → dict.gameOver.tie). Returns undefined if any segment is missing.
function lookup(dict, key) {
  if (!dict || !key) return undefined;
  return key.split('.').reduce((acc, part) => (acc == null ? acc : acc[part]), dict);
}

// Replace `{name}` placeholders in a locale string with values from `vars`. Unknown names are left as `{name}`.
function interpolate(str, vars) {
  if (!vars) return str;
  return str.replace(/\{(\w+)\}/g, (_, name) => (vars[name] != null ? String(vars[name]) : `{${name}}`));
}

// Root i18n wrapper: loads locale from localStorage, exposes `t`, and mounts the first-run prompt. The language toggle lives in the game toolbar.
export function LanguageProvider({ children }) {
  // Active locale code (`en` | `ru`). Starts as English until storage is read.
  const [locale, setLocale] = useState('en');
  // False until the first-run localStorage read finishes, so we do not flash the wrong chrome.
  const [ready, setReady] = useState(false);
  // True when there is no saved locale: show the bilingual chooser instead of the toggle.
  const [needsChoice, setNeedsChoice] = useState(false);

  // On mount: restore a valid saved locale, or ask the user to pick one.
  useEffect(() => {
    // Previously chosen locale code, or null on first visit / invalid storage.
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && translations[saved]) {
      setLocale(saved);
      setNeedsChoice(false);
    } else {
      setNeedsChoice(true);
    }
    setReady(true);
  }, []);

  // Keep <html lang="..."> in sync once we know the locale (helps a11y and translation tools).
  useEffect(() => {
    if (ready) document.documentElement.lang = locale;
  }, [locale, ready]);

  // Persist a valid locale, hide the first-run prompt, and update React state. `lang` is `en` or `ru`.
  const changeLanguage = useCallback((lang) => {
    if (!translations[lang]) return;
    setLocale(lang);
    localStorage.setItem(STORAGE_KEY, lang);
    setNeedsChoice(false);
  }, []);

  // Translate a dotted key in the current locale, then interpolate `{placeholders}`. Missing keys return the key string.
  const t = useCallback((key, vars) => {
    // Nested lookup result; non-strings (missing key or an object node) fall back to returning `key`.
    const value = lookup(translations[locale], key);
    if (typeof value !== 'string') return key;
    return interpolate(value, vars);
  }, [locale]);

  return (
    <LanguageContext.Provider value={{ locale, changeLanguage, t, ready, needsChoice }}>
      {children}
      {ready && needsChoice && <LanguagePrompt onChoose={changeLanguage} />}
    </LanguageContext.Provider>
  );
}

// Read i18n context. Throws if used outside LanguageProvider so missing wrapping is obvious.
export function useTranslation() {
  // Provider value, or null when this hook is used without LanguageProvider.
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error('useTranslation must be used within LanguageProvider');
  }
  return ctx;
}

// First-run overlay: bilingual title (locale is not chosen yet) and a button per language.
function LanguagePrompt({ onChoose }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="language-prompt-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.55)',
      }}
    >
      <div
        style={{
          background: 'white',
          color: '#171717',
          borderRadius: 12,
          padding: '28px 32px',
          textAlign: 'center',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.35)',
          minWidth: 280,
        }}
      >
        <div id="language-prompt-title" style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>
          Choose language
        </div>
        <div style={{ fontSize: 18, marginBottom: 20, color: '#444' }}>
          Выберите язык
        </div>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
          {Object.keys(translations).map((lang) => (
            <button
              key={lang}
              type="button"
              onClick={() => onChoose(lang)}
              style={{
                minWidth: 120,
                padding: '12px 16px',
                fontSize: 18,
                fontWeight: 600,
                border: '1px solid #fff',
                borderRadius: 10,
                background: '#000',
                color: '#fff',
                cursor: 'pointer',
              }}
            >
              <span style={{ fontSize: 28, display: 'block', marginBottom: 4 }}>{FLAGS[lang]}</span>
              {LABELS[lang]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// Compact flag buttons for switching locale. Sits in the toolbar above the board (not a corner overlay).
// `locale` is the active code; `onChange(lang)` persists the new locale via the provider.
export function LanguageToggle({ locale, onChange }) {
  return (
    <div
      role="group"
      aria-label="Language"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '3px 8px',
        height: 38,
        borderRadius: 8,
        background: '#000',
        border: '1px solid #fff',
        color: '#fff',
      }}
    >
      {Object.keys(translations).map((lang, index) => {
        // Whether this button is the currently selected locale (pressed styling + aria-pressed).
        const active = locale === lang;
        return (
          <React.Fragment key={lang}>
            {index > 0 && (
              // Visual slash between flag buttons; not a control.
              <span aria-hidden="true" style={{ color: '#fff', fontSize: 16, fontWeight: 600, lineHeight: 1 }}>
                |
              </span>
            )}
            <button
              type="button"
              onClick={() => onChange(lang)}
              title={LABELS[lang]}
              aria-label={LABELS[lang]}
              aria-pressed={active}
              style={{
                width: 32,
                height: 32,
                padding: 0,
                fontSize: 18,
                lineHeight: 1,
                // White outline on the selected flag; transparent on the other so size stays the same.
                border: active ? '1px solid #fff' : '1px solid transparent',
                borderRadius: 6,
                background: 'transparent',
                color: '#fff',
                cursor: 'pointer',
                opacity: active ? 1 : 0.45,
              }}
            >
              {FLAGS[lang]}
            </button>
          </React.Fragment>
        );
      })}
    </div>
  );
}
