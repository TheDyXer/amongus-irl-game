import { useId, useState, type FormEvent } from 'react';
import { send } from '../../api/state';
import type { GmView } from '../../api/types';
import { Button } from '../../components/Button';
import { Panel } from '../../components/Panel';
import { Pill } from '../../components/Pill';
import { useT } from '../../i18n';
import { parseHostPort } from './logic';
import { ConfirmButton, useSince } from './parts';

export default function PhonesPanel({ view }: { view: GmView }) {
  const t = useT();
  const since = useSince();
  const emptySlots = view.cams.filter((c) => c.phone === null).map((c) => c.slot);
  return (
    <Panel title={t('gm.phones')} note={t('gm.phones_note')}>
      {view.phones.length === 0 ? (
        <p className="gm-empty">{t('gm.phones_empty')}</p>
      ) : (
        <ul className="gm-list">
          {view.phones.map((p) => (
            <li key={p.id} className="phone">
              <span className={`gm-dot is-${p.online ? 'live' : 'off'}`} />
              <div className="phone-main">
                <span className="phone-name">{p.name || p.host}</span>
                <span className="phone-meta">
                  {p.host}:{p.port} · {t(p.manual ? 'gm.phone_manual' : 'gm.phone_found')}
                </span>
                <span className="phone-meta">
                  {p.online ? t('gm.online') : p.last_seen_at !== null ? t('gm.seen', { ago: since(p.last_seen_at) }) : t('gm.offline')}
                </span>
              </div>
              <Pill tone={p.slot ? 'info' : 'neutral'}>{p.slot ? t('gm.cam_n', { n: p.slot }) : t('gm.phone_spare')}</Pill>
              <ConfirmButton label={t('gm.forget')} confirm={t('gm.forget_confirm')} onConfirm={() => send({ type: 'forget_phone', phone_id: p.id })} />
            </li>
          ))}
        </ul>
      )}
      <AddPhone slot={null} slots={emptySlots} />
    </Panel>
  );
}

/** Adds a phone by IP. In a camera card `slot` is fixed; in the phone list the GM may pick one of
 * the empty `slots` or none. */
export function AddPhone({ slot, slots = [] }: { slot: number | null; slots?: number[] }) {
  const t = useT();
  const errorId = useId();
  const [text, setText] = useState('');
  const [target, setTarget] = useState<number | null>(null);
  const [invalid, setInvalid] = useState(false);
  const chosen = slot ?? (target !== null && slots.includes(target) ? target : null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const endpoint = parseHostPort(text);
    setInvalid(endpoint === null);
    if (endpoint && send({ type: 'add_manual_phone', host: endpoint.host, port: endpoint.port, slot: chosen }) !== null) setText('');
  };

  return (
    <form className="gm-inline-form" onSubmit={submit} noValidate>
      <label className="gm-field-row">
        <span className="gm-label">{t('gm.add_by_ip')}</span>
        <input
          className="gm-field is-mono"
          autoComplete="off"
          spellCheck={false}
          maxLength={21}
          placeholder={t('gm.ip_placeholder')}
          value={text}
          aria-invalid={invalid}
          aria-describedby={invalid ? errorId : undefined}
          onChange={(e) => {
            setText(e.target.value);
            setInvalid(false);
          }}
        />
      </label>
      {slot === null && slots.length > 0 && (
        <label className="gm-field-row is-narrow">
          <span className="gm-label">{t('gm.slot')}</span>
          <select className="gm-field" value={chosen ?? ''} onChange={(e) => setTarget(e.target.value ? Number(e.target.value) : null)}>
            <option value="">{t('gm.slot_none')}</option>
            {slots.map((n) => (
              <option key={n} value={n}>
                {t('gm.cam_n', { n })}
              </option>
            ))}
          </select>
        </label>
      )}
      <Button type="submit">{t('gm.add')}</Button>
      {invalid && (
        <p id={errorId} className="gm-field-error">
          {t('gm.ip_invalid')}
        </p>
      )}
    </form>
  );
}
