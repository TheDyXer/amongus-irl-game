import type { ReactNode } from 'react';
import { cx } from './cx';

/** The uppercase room plate from the monitor mock-ups; long names are cut with an ellipsis. */
export function Plate({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx('plate', className)}>{children}</span>;
}
