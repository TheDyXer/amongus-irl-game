/** True when `text` needs a glyph beyond Latin-1 (U+00FF), such as Hungarian ő and ű. */
export function hasGlyphsOutsideLatin1(text: string): boolean {
  return /[^\u0000-ÿ]/.test(text);
}
