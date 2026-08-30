/**
 * Editor typography tokens — defined once here and mirrored as CSS custom
 * properties in index.css (--editor-font-size / --editor-line-height), which
 * is what the rest of the UI reads. Change both together.
 */
export function editorTokens(): { fontSize: number; lineHeight: number } {
  const s = getComputedStyle(document.documentElement);
  const size = parseFloat(s.getPropertyValue('--editor-font-size')) || 14;
  const lh = parseFloat(s.getPropertyValue('--editor-line-height')) || Math.round(size * 1.5);
  return { fontSize: size, lineHeight: lh };
}
