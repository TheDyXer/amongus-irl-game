import { useEffect, useState } from 'react';
import { ApiError, nextPairPoll, pairStart } from '../api/http';
import { reconnect, useNow, useServer } from '../api/state';
import type { HelloView, PairStatus, PairingView } from '../api/types';
import { Crewmate } from '../components/Crewmate';
import { Starfield } from '../components/Starfield';
import { useT } from '../i18n';
import './pairing.css';

function liveCode(code: string | null, expiresAt: number | null, at: number): string | null {
  return code && (expiresAt === null || expiresAt > at) ? code : null;
}

/** The unpaired screen: a huge code while a request is pending, otherwise "ask the GM". No inputs.
 * While it has no live code it re-POSTs /api/pair/start (paced by nextPairPoll). */
export default function Pairing({ view }: { view: PairingView | HelloView | null }) {
  const t = useT();
  const at = useNow();
  const { connected } = useServer();
  const [local, setLocal] = useState<PairStatus | null>(null);
  const [offline, setOffline] = useState(false);

  const code = connected
    ? view?.kind === 'pairing' && view.status === 'pending'
      ? liveCode(view.code, view.expires_at, at)
      : null
    : local?.status === 'pending'
      ? liveCode(local.code, local.expires_at, at)
      : null;
  const needCode = view !== null && code === null;
  const anonymous = connected && view?.kind === 'hello';

  useEffect(() => {
    if (!needCode) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = () => {
      pairStart()
        .then(
          (status) => {
            if (!alive) return;
            setLocal(status);
            setOffline(false);
            if (anonymous) reconnect();
          },
          (err: unknown) => {
            if (alive) setOffline(!(err instanceof ApiError));
          },
        )
        .finally(() => {
          if (alive) timer = setTimeout(poll, nextPairPoll());
        });
    };
    timer = setTimeout(poll, nextPairPoll());
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [needCode, anonymous]);

  return (
    <main className="pair">
      <Starfield lowMotion={false} />
      <div className="pair-body">
        {code ? (
          <>
            <h1 className="pair-title outlined">{t('pairing.title')}</h1>
            <p className="pair-code">
              {[...code].map((letter, i) => (
                <span key={i} className="pair-letter">
                  {letter}
                </span>
              ))}
            </p>
            <ol className="pair-steps">
              <li>{t('pairing.step_console')}</li>
              <li>{t('pairing.step_screens')}</li>
              <li>{t('pairing.step_approve')}</li>
            </ol>
          </>
        ) : view === null ? (
          <p className="pair-hint">{t('pairing.connecting')}</p>
        ) : (
          <>
            <div className="pair-crew">
              <Crewmate color="#F6F657" shadow="#C38822" size={160} />
            </div>
            <h1 className="pair-title outlined">{t('pairing.closed_title')}</h1>
            <p className="pair-text">{t('pairing.closed_text')}</p>
            <p className="pair-hint">{t(offline ? 'pairing.offline' : 'pairing.closed_hint')}</p>
          </>
        )}
      </div>
    </main>
  );
}
