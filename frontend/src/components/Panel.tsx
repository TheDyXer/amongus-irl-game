import { useId, type ReactNode } from 'react';
import { cx } from './cx';

export interface PanelProps {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Controls shown at the right of the header. */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** A console section: outlined dark card with an uppercase heading. */
export function Panel({ title, subtitle, actions, children, className }: PanelProps) {
  const id = useId();
  return (
    <section className={cx('panel', className)} aria-labelledby={id}>
      <header className="panel__head">
        <div className="panel__titles">
          <h2 id={id} className="panel__title">
            {title}
          </h2>
          {subtitle && <p className="panel__subtitle">{subtitle}</p>}
        </div>
        {actions && <div className="panel__actions">{actions}</div>}
      </header>
      {children}
    </section>
  );
}
