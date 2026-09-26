import type { ReactNode } from 'react';
import { cx } from './cx';

export interface ToggleProps {
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}

/** An on/off switch: the knob slides right and the track turns green when on. */
export function Toggle({ label, checked, onChange, disabled, className }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className={cx('toggle', className)}
      onClick={() => onChange(!checked)}
    >
      <span className="toggle__label">{label}</span>
      <span className="toggle__track" aria-hidden="true">
        <span className="toggle__knob" />
      </span>
    </button>
  );
}
