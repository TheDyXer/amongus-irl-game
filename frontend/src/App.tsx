import { useEffect, useState } from 'react';
import { nextPairPoll, pairStart, publicInfo } from './api/http';
import { connect, useServer, useServerEvent, viewLang, viewVolume } from './api/state';
import type { PublicInfo } from './api/types';
import { Button } from './components/Button';
import { setLang, useT } from './i18n';
import { play, setVolume } from './sound';
import ComingSoon, { Splash, type Soon } from './views/ComingSoon';
import Kiosk from './views/Kiosk';
import Pairing from './views/Pairing';
import Security from './views/Security';
import Spectator from './views/Spectator';
import GmApp from './views/gm/GmApp';

type Route = { kind: 'device' } | { kind: 'gm' } | { kind: 'soon'; what: Soon };

function route(pathname: string): Route {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === '/') return { kind: 'device' };
  if (path === '/gm' || path.startsWith('/gm/')) return { kind: 'gm' };
  if (path === '/join' || path === '/play' || path.startsWith('/play/')) return { kind: 'soon', what: 'player' };
  if (path.startsWith('/b/')) return { kind: 'soon', what: 'badge' };
  if (path.startsWith('/t/')) return { kind: 'soon', what: 'task' };
  return { kind: 'soon', what: 'missing' };
}

/** "/": make sure the device cookie exists, then follow the server's view. */
function Device() {
  const t = useT();
  const { view, ended } = useServer();

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const start = () => {
      pairStart().then(
        () => {
          if (alive) connect({ as: 'device' });
        },
        () => {
          if (alive) timer = setTimeout(start, nextPairPoll());
        },
      );
    };
    start();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);

  // Lives here, not in Pairing: the new screen view arrives (and unmounts Pairing) before the event.
  useServerEvent((e) => {
    if (e.type === 'paired') play('paired');
  });

  if (ended === 'replaced') {
    return (
      <Splash title={t('pairing.elsewhere_title')} text={t('pairing.elsewhere_text')}>
        <Button onClick={() => connect({ as: 'device' })}>{t('pairing.use_here')}</Button>
      </Splash>
    );
  }
  if (view?.kind === 'screen') {
    const lowMotion = view.device.low_motion;
    switch (view.body.view) {
      case 'security':
        return (
          <Kiosk lowMotion={lowMotion}>
            <Security view={view} />
          </Kiosk>
        );
      case 'spectator':
        return (
          <Kiosk lowMotion={lowMotion}>
            <Spectator view={view} />
          </Kiosk>
        );
      default:
        return <ComingSoon what={view.body.view} name={view.device.name} lowMotion={lowMotion} />;
    }
  }
  return <Pairing view={view?.kind === 'pairing' || view?.kind === 'hello' ? view : null} />;
}

export default function App() {
  const { view } = useServer();
  const [info, setInfo] = useState<PublicInfo | null>(null);

  useEffect(() => {
    publicInfo().then(setInfo, () => undefined);
  }, []);

  const lang = view ? viewLang(view) : info?.lang;
  const volume = (view && viewVolume(view)) ?? info?.volume;
  useEffect(() => {
    if (lang) setLang(lang);
  }, [lang]);
  useEffect(() => {
    if (volume !== undefined) setVolume(volume);
  }, [volume]);

  const r = route(location.pathname);
  if (r.kind === 'gm') return <GmApp />;
  if (r.kind === 'device') return <Device />;
  return <ComingSoon what={r.what} />;
}
