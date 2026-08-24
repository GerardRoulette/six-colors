'use client'

import React, { createContext, useState, useContext, useEffect } from 'react';
import en from '../locales/en';
import ru from '../locales/ru';

const translations = { en, ru };

const LanguageContext = createContext();

export function LanguageProvider({ children }) {
  const [locale, setLocale] = useState('en');

  // Load saved preference from localStorage (or cookie) on mount
  useEffect(() => {
    const saved = localStorage.getItem('language');
    if (saved && translations[saved]) setLocale(saved);
  }, []);

  const changeLanguage = (lang) => {
    if (translations[lang]) {
      setLocale(lang);
      localStorage.setItem('language', lang);
    }
  };

  const t = (key) => translations[locale]?.[key] || key;

  return (
    <LanguageContext.Provider value={{ locale, changeLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useTranslation() {
  return useContext(LanguageContext);
}