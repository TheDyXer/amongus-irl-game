import { useEffect, useState, type InputHTMLAttributes } from 'react';
import { useNow } from '../../api/state';
import { Button } from '../../components/Button';
import { useT } from '../../i18n';
import { ago } from './logic';

/** Formats a server epoch-ms timestamp as "12 s ago"; the caller re-renders every second. */
export function useSince(): (at: number) => string {
  const t = useT();
  const now = useNow();
  return (at) => {
    const a = ago(now - at);
    return t(a.key, { n: a.n });
  };
}

type CommitInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'onBlur' | 'onKeyDown'> & {
  value: string;
  onCommit: (value: string) => void;
  normalize?: (value: string) => string;
};

/** A text field that saves on blur or Enter (Escape reverts) and shows the saved text until the
 * server echoes it, so the field doesn't flash back to the old value. */
export function CommitInput({ value, onCommit, normalize = (v) => v.trim(), ...rest }: CommitInputProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const [sent, setSent] = useState<{ text: string; over: string } | null>(null);

  useEffect(() => {
    if (!sent) return;
    const id = setTimeout(() => setSent(null), 2000);
    return () => clearTimeout(id);
  }, [sent]);

  const commit = () => {
    if (draft === null) return;
    const next = normalize(draft);
    setDraft(null);
    if (next === value || (next === '' && rest.required)) return;
    setSent({ text: next, over: value });
    onCommit(next);
  };

  return (
    <input
      {...rest}
      value={draft ?? (sent && sent.over === value ? sent.text : value)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        else if (e.key === 'Escape') setDraft(null);
      }}
    />
  );
}

/** Asks once more before a destructive action; disarms after 4 s or when focus leaves. */
export function ConfirmButton({ label, confirm, onConfirm }: { label: string; confirm: string; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(id);
  }, [armed]);

  const click = () => {
    setArmed(!armed);
    if (armed) onConfirm();
  };

  return (
    <Button variant={armed ? 'danger' : 'neutral'} onClick={click} onBlur={() => setArmed(false)}>
      {armed ? confirm : label}
    </Button>
  );
}

const quietRefs = new Set<string>();

/** Keeps the error toast quiet for an action whose form shows its own error. */
export function quiet(ref: string): void {
  quietRefs.add(ref);
}

export function isQuiet(ref: string | null): boolean {
  return ref !== null && quietRefs.has(ref);
}
