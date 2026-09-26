import { useEffect, useRef, useState } from 'react';
import { connect, send, useServer, useServerEvent } from '../../api/state';
import type { GmView } from '../../api/types';
import { Segmented } from '../../components/Segmented';
import { Slider } from '../../components/Slider';
import { Toggle } from '../../components/Toggle';
import { useT } from '../../i18n';
import { Splash } from '../ComingSoon';
import CamerasPanel from './CamerasPanel';
import { ICON, Icon } from './icons';
import { codeKey } from './logic';
import NoticesPanel from './NoticesPanel';
import { isQuiet } from './parts';
import PhonesPanel from './PhonesPanel';
import ScreensPanel from './ScreensPanel';
import SecurityPanel from './SecurityPanel';
import './gm.css';

type Tab = 'setup' | 'settings';

/** The tab lives in the path (/gm, /gm/settings) so reloads and the back button keep it. */
function useTab(): [Tab, (tab: Tab) => void] {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const sync = () => setPath(location.pathname);
    addEventListener('popstate', sync);
    return () => removeEventListener('popstate', sync);
  }, []);
  const go = (tab: Tab) => {
    const next = tab === 'settings' ? '/gm/settings' : '/gm';
    if (next !== location.pathname) history.pushState(null, '', next);
    setPath(next);
  };
  return [path.replace(/\/+$/, '') === '/gm/settings' ? 'settings' : 'setup', go];
}

export default function Console({ onLogout }: { onLogout: () => void }) {
  const t = useT();
  const { view, connected } = useServer();
  const [tab, go] = useTab();

  useEffect(() => {
    connect({ as: 'gm' });
  }, []);

  if (view?.kind !== 'gm') return <Splash title={t('gm.title')} text={t('gm.connecting')} />;
  return (
    <div className="gm">
      <Sidebar view={view} tab={tab} go={go} />
      <main className="gm-main">
        <Header view={view} connected={connected} title={t(tab === 'setup' ? 'gm.nav_setup' : 'gm.nav_settings')} />
        {tab === 'setup' ? (
          <div className="gm-cols">
            <div className="gm-col">
              <CamerasPanel view={view} />
              <PhonesPanel view={view} />
            </div>
            <div className="gm-col">
              <ScreensPanel view={view} />
              <NoticesPanel notices={view.notices} />
            </div>
          </div>
        ) : (
          <SecurityPanel view={view} onLogout={onLogout} />
        )}
      </main>
      <Toasts />
    </div>
  );
}

function Sidebar({ view, tab, go }: { view: GmView; tab: Tab; go: (tab: Tab) => void }) {
  const t = useT();
  const s = view.settings;
  return (
    <aside className="gm-side">
      <div className="gm-brand">
        <span className="gm-brand-title">{t('gm.title')}</span>
        <span className="gm-brand-sub">
          <Icon d={ICON.lock} />
          {t('gm.unlocked')}
        </span>
      </div>
      <nav className="gm-nav" aria-label={t('gm.nav_label')}>
        <NavItem icon={ICON.setup} label={t('gm.nav_setup')} current={tab === 'setup'} onClick={() => go('setup')} />
        <NavItem icon={ICON.live} label={t('gm.nav_live')} hint={t('gm.phase_2')} />
        <NavItem icon={ICON.print} label={t('gm.nav_print')} hint={t('gm.phase_2')} />
        <NavItem icon={ICON.settings} label={t('gm.nav_settings')} current={tab === 'settings'} onClick={() => go('settings')} />
      </nav>
      <div className="gm-side-foot">
        <div className="gm-setting">
          <span className="gm-label">{t('gm.language')}</span>
          <Segmented
            label={t('gm.language')}
            value={s.lang}
            options={[
              { value: 'en', label: t('gm.lang_en') },
              { value: 'hu', label: t('gm.lang_hu') },
            ]}
            onChange={(lang) => send({ type: 'set_settings', lang })}
          />
        </div>
        <Volume value={s.volume} />
        <div className="gm-setting is-row">
          <span className="gm-label">{t('gm.cams')}</span>
          <Toggle label={t('gm.cams')} checked={s.cams_enabled} onChange={(on) => send({ type: 'set_settings', cams_enabled: on })} />
        </div>
        <div className="gm-setting is-row">
          <span className="gm-label">{t('gm.torch_blink')}</span>
          <Toggle label={t('gm.torch_blink')} checked={s.torch_blink} onChange={(on) => send({ type: 'set_settings', torch_blink: on })} />
        </div>
      </div>
    </aside>
  );
}

function NavItem({ icon, label, hint, current = false, onClick }: { icon: string; label: string; hint?: string; current?: boolean; onClick?: () => void }) {
  return (
    <button type="button" className="gm-nav-btn" aria-current={current ? 'page' : undefined} disabled={!onClick} onClick={onClick}>
      <Icon d={icon} />
      <span className="gm-nav-text">
        <span>{label}</span>
        {hint && <span className="gm-nav-hint">{hint}</span>}
      </span>
    </button>
  );
}

/** Follows the drag locally and sends the value once the slider rests for 150 ms. */
function Volume({ value }: { value: number }) {
  const t = useT();
  const [draft, setDraft] = useState<number | null>(null);

  useEffect(() => {
    if (draft === null) return;
    const push = setTimeout(() => send({ type: 'set_settings', volume: draft }), 150);
    const release = setTimeout(() => setDraft(null), 1500);
    return () => {
      clearTimeout(push);
      clearTimeout(release);
    };
  }, [draft]);

  const shown = draft ?? value;
  return (
    <div className="gm-setting">
      <div className="gm-setting-head">
        <span className="gm-label">{t('gm.volume')}</span>
        <span className="gm-setting-value">{t('gm.percent', { n: shown })}</span>
      </div>
      <Slider label={t('gm.volume')} min={0} max={100} value={shown} onChange={setDraft} />
    </div>
  );
}

function Header({ view, connected, title }: { view: GmView; connected: boolean; title: string }) {
  const t = useT();
  const online = view.devices.filter((d) => d.online).length;
  const assigned = view.cams.filter((c) => c.phone !== null);
  const live = assigned.filter((c) => c.signal === 'live').length;
  const camTone = assigned.length === 0 ? 'off' : live === assigned.length ? 'live' : live === 0 ? 'alert' : 'lost';
  return (
    <header className="gm-head">
      <h1 className="gm-head-title">{title}</h1>
      <span className="gm-chip is-mono">
        <Icon d={ICON.wifi} className="is-cyan" />
        {view.server.address}
      </span>
      <span className="gm-chip">
        <span className={`gm-dot is-${online ? 'live' : 'off'}`} />
        {t('gm.screens_online', { count: online })}
      </span>
      <span className="gm-chip">
        <span className={`gm-dot is-${camTone}`} />
        {assigned.length ? t('gm.cams_live', { live, count: assigned.length }) : t('gm.cams_none')}
      </span>
      {view.watching && (
        <span className="gm-chip">
          <span className="gm-lamp" />
          {t('gm.watching')}
        </span>
      )}
      <span className="gm-chip">{t(`gm.relay_${view.server.relay_mode}`)}</span>
      <span className="gm-chip is-mono">{t('gm.version', { version: view.server.version })}</span>
      {!connected && (
        <span className="gm-chip is-alert" role="status">
          {t('gm.reconnecting')}
        </span>
      )}
    </header>
  );
}

interface ToastItem {
  id: number;
  key: string;
  params?: Record<string, string>;
  alert: boolean;
}

let toastSeq = 0;

/** gm.toast.* events and rejected actions (err.*), newest last, each for 5 s. */
function Toasts() {
  const { lastError } = useServer();
  const [items, setItems] = useState<ToastItem[]>([]);
  const seen = useRef(lastError);

  const push = (key: string, alert: boolean, params?: Record<string, string>) =>
    setItems((list) => [...list.slice(-3), { id: ++toastSeq, key, params, alert }]);
  const remove = (id: number) => setItems((list) => list.filter((item) => item.id !== id));

  useServerEvent((e) => {
    if (e.type === 'toast') push(e.code, false, e.params);
  });

  useEffect(() => {
    if (lastError === seen.current) return;
    seen.current = lastError;
    if (lastError && !isQuiet(lastError.ref)) push(codeKey(lastError.code), true);
  }, [lastError]);

  return (
    <div className="gm-toasts" role="status">
      {items.map((item) => (
        <Toast key={item.id} item={item} onDone={() => remove(item.id)} />
      ))}
    </div>
  );
}

function Toast({ item, onDone }: { item: ToastItem; onDone: () => void }) {
  const t = useT();
  useEffect(() => {
    const id = setTimeout(onDone, 5000);
    return () => clearTimeout(id);
  }, []);
  return (
    <div className={`gm-toast${item.alert ? ' is-alert' : ''}`}>
      <Icon d={item.alert ? ICON.warn : ICON.info} />
      <p>{t(item.key, item.params)}</p>
      <button type="button" className="gm-icon-btn" aria-label={t('gm.dismiss')} onClick={onDone}>
        <Icon d={ICON.close} />
      </button>
    </div>
  );
}
