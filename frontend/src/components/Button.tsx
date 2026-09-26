import type { ComponentProps } from 'react';
import { cx } from './cx';

/**
 * primary: solid cyan call to action; neutral: steel; danger: dark red with a red label
 * (reject, revoke, forget); ok: green; cyan: dark teal with a cyan label.
 */
export type ButtonTone = 'primary' | 'neutral' | 'danger' | 'ok' | 'cyan';

export interface ButtonProps extends ComponentProps<'button'> {
  tone: ButtonTone;
  size?: 'm' | 'l';
}

/** Chunky outlined button (at least 44px; `l` is 60px). Icon-only buttons need an aria-label. */
export function Button({ tone, size = 'm', type = 'button', className, ...rest }: ButtonProps) {
  return <button type={type} className={cx('btn', `btn--${tone}`, size === 'l' && 'btn--l', className)} {...rest} />;
}
