import type { ReactNode } from 'react';
import { hasGlyphsOutsideLatin1 } from '../theme/glyphs';
import { cx } from './cx';

export interface OutlinedTextProps {
  children: ReactNode;
  /** splash: Luckiest Guy; title: Lilita One. */
  font?: 'splash' | 'title';
  as?: 'span' | 'div' | 'p' | 'h1' | 'h2' | 'h3';
  className?: string;
}

/** Display text with the game's thick black outline; size and colour come from `className`. */
export function OutlinedText({ children, font = 'splash', as: Tag = 'span', className }: OutlinedTextProps) {
  // Lilita One cannot draw ő/ű; a title string that needs them is set whole in Luckiest Guy.
  const face = font === 'title' && typeof children === 'string' && hasGlyphsOutsideLatin1(children) ? 'splash' : font;
  return (
    <Tag className={cx('outlined-text', 'outlined', face === 'splash' ? 'font-splash' : 'outlined-text--title', className)}>
      {children}
    </Tag>
  );
}
