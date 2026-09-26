import type { ReactNode } from 'react';
import { cx } from './cx';

export interface SegmentedOption<T> {
  value: T;
  label: ReactNode;
}

export interface SegmentedProps<T extends string | number> {
  /** Accessible name of the group; a visible caption, if any, is up to the caller. */
  label: string;
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  className?: string;
}

/** Joined toggle buttons for one-of-a-few choices (EN/HU, max fps); the pressed one is cyan. */
export function Segmented<T extends string | number>({ label, options, value, onChange, disabled, className }: SegmentedProps<T>) {
  return (
    <div role="group" aria-label={label} className={cx('segmented', className)}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className="segmented__option"
          aria-pressed={option.value === value}
          disabled={disabled}
          onClick={() => {
            if (option.value !== value) onChange(option.value);
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
