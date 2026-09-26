import { useEffect, useState } from 'react';
import { gmLogout, gmStatus } from '../../api/http';
import { connect, disconnect, useServer } from '../../api/state';
import { Button } from '../../components/Button';
import { setLang, useT } from '../../i18n';
import { Splash } from '../ComingSoon';
import Console from './Console';
import GmLogin from './GmLogin';
import GmSetup from './GmSetup';

type Phase = 'setup' | 'login' | 'console';

/** /gm: first-run PIN setup or login, then the console on /ws?as=gm. A 4401 close or an anonymous
 * view (the session ended elsewhere) returns to the login. */
export default function GmApp() {
  const t = useT();
  const { ended, view } = useServer();
  const [phase, setPhase] = useState<Phase | null>(null);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () => {
      gmStatus().then(
        (s) => {
          if (!alive) return;
          setLang(s.lang);
          setPhase(!s.pin_set ? 'setup' : s.logged_in ? 'console' : 'login');
        },
        () => {
          if (!alive) return;
          setOffline(true);
          timer = setTimeout(load, 3000);
        },
      );
    };
    load();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);

  const signedOut = ended === 'auth' || view?.kind === 'hello';
  useEffect(() => {
    if (!signedOut) return;
    disconnect();
    setPhase('login');
  }, [signedOut]);

  const logout = () => {
    disconnect();
    gmLogout()
      .catch(() => undefined)
      .finally(() => setPhase('login'));
  };

  if (phase === null) return <Splash title={t('gm.title')} text={t(offline ? 'gm.offline' : 'gm.loading')} />;
  if (phase === 'setup') return <GmSetup onDone={() => setPhase('console')} onPinExists={() => setPhase('login')} />;
  if (phase === 'login') return <GmLogin onDone={() => setPhase('console')} />;
  if (ended === 'replaced') {
    return (
      <Splash title={t('pairing.elsewhere_title')} text={t('gm.elsewhere_text')}>
        <Button variant="primary" onClick={() => connect({ as: 'gm' })}>
          {t('pairing.use_here')}
        </Button>
      </Splash>
    );
  }
  return <Console onLogout={logout} />;
}
