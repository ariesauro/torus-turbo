export const UI_LANGUAGES = [
  { value: 'ru', label: 'Русский' },
  { value: 'en', label: 'English' },
]

export function normalizeUiLanguage(value) {
  return value === 'en' ? 'en' : 'ru'
}
