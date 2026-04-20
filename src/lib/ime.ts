/**
 * Returns true if the keyboard event is part of an ongoing IME composition
 * (e.g. Korean/Japanese/Chinese input). Shortcut handlers should bail out
 * when this is true — pressing Enter/ArrowDown during composition is the
 * user finalizing a character, not invoking a shortcut.
 *
 * `keyCode === 229` is the legacy fallback used by older browsers during
 * composition. `isComposing` is the modern standard property.
 */
export function isComposingKeyEvent(e: Pick<KeyboardEvent, 'isComposing' | 'keyCode'>): boolean {
  return e.isComposing === true || e.keyCode === 229;
}
