import type { ReactNode } from 'react';
import { cx } from './cx';

/** ok: green; warn: amber; danger: red; neutral: steel; cyan: dark teal with a cyan label. */
export type PillTone = 'ok' | 'warn' | 'danger' | 'neutral' | 'cyan';

export interface PillProps {
  tone: PillTone;
  children: ReactNode;
  className?: string;
}

/** Short uppercase status label. */
export function Pill({ tone, children, className }: PillProps) {
  return <span className={cx('pill', `pill--${tone}`, className)}>{children}</span>;
}
