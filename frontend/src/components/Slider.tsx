import { useEffect, useId, useRef, useState } from 'react';
import { cx } from './cx';

const COMMIT_DELAY_MS = 200;

export interface SliderProps {
  label: string;
  value: number;
  /** Called once the thumb has rested for 200 ms, so a drag or a held arrow key never floods the socket. */
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Visible and spoken value text, e.g. (v) => `${v}%`. */
  format?: (value: number) => string;
  disabled?: boolean;
  className?: string;
}

export function Slider({ label, value, onChange, min = 0, max = 100, step = 1, format = String, disabled, className }: SliderProps) {
  const id = useId();
  // The thumb follows the pointer until `value` changes (the server's answer replaces the draft).
  const [draft, setDraft] = useState<{ base: number; value: number } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const shown = draft && draft.base === value ? draft.value : value;
  const text = format(shown);

  return (
    <div className={cx('slider', className)}>
      <div className="slider__head">
        <label htmlFor={id} className="slider__label">
          {label}
        </label>
        <span className="slider__value" aria-hidden="true">
          {text}
        </span>
      </div>
      <input
        id={id}
        type="range"
        className="slider__input"
        min={min}
        max={max}
        step={step}
        value={shown}
        aria-valuetext={text}
        disabled={disabled}
        onChange={(event) => {
          const next = Number(event.currentTarget.value);
          setDraft({ base: value, value: next });
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => onChange(next), COMMIT_DELAY_MS);
        }}
      />
    </div>
  );
}
