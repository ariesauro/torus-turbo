/**
 * Detect platform and set CSS class on <html> for theme switching.
 *
 * - macOS → "platform-macos" (neutral dark + system accent)
 * - Linux → default (dark indigo)
 * - Windows → default (dark indigo)
 */

const isMacOS =
  typeof navigator !== 'undefined' &&
  /Mac|Macintosh/.test(navigator.userAgent) &&
  !/iPhone|iPad/.test(navigator.userAgent)

if (isMacOS && typeof document !== 'undefined') {
  document.documentElement.classList.add('platform-macos')
}

export function getPlatform() {
  if (isMacOS) return 'macos'
  if (typeof navigator !== 'undefined' && /Linux/.test(navigator.userAgent)) return 'linux'
  if (typeof navigator !== 'undefined' && /Win/.test(navigator.userAgent)) return 'windows'
  return 'unknown'
}

export { isMacOS }
