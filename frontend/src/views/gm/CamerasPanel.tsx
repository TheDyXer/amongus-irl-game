import { useState } from 'react';
import { CamCanvas } from '../../api/cams';
import { send } from '../../api/state';
import type { CamSlot, GmView, KnownPhone } from '../../api/types';
import { Button } from '../../components/Button';
import { Panel } from '../../components/Panel';
import { Pill } from '../../components/Pill';
import { Plate } from '../../components/Plate';
import { TvStatic } from '../../components/TvStatic';
import { useT } from '../../i18n';
import { ICON, Icon } from './icons';
import { camStatus, codeKey, torchKey } from './logic';
import { CommitInput, useSince } from './parts';
import { AddPhone } from './PhonesPanel';

export default function CamerasPanel({ view }: { view: GmView }) {
  const t = useT();
  const free = view.phones
    .filter((p) => p.slot === null)
    .sort((a, b) => Number(b.online) - Number(a.online) || (a.name || a.host).localeCompare(b.name || b.host));
  return (
    <Panel title={t('gm.cameras')} note={t('gm.cameras_note')}>
      <div className="cam-grid">
        {view.cams.map((cam) => (
          <CamCard key={cam.slot} cam={cam} free={free} />
        ))}
      </div>
    </Panel>
  );
}

function CamCard({ cam, free }: { cam: CamSlot; free: KnownPhone[] }) {
  const t = useT();
  const status = camStatus(cam);
  const titleId = `cam-${cam.slot}-title`;
  return (
    <article className="cam" aria-labelledby={titleId}>
      <div className="cam-top">
        <Thumb cam={cam} />
        <div className="cam-info">
          <div className="cam-head">
            <h3 id={titleId} className="cam-title">
              {t('gm.cam_n', { n: cam.slot })}
            </h3>
            <Pill tone={status.tone}>{t(status.key)}</Pill>
          </div>
          {cam.phone ? (
            <>
              <span className="cam-device">{cam.phone.name || t('gm.phone_unnamed')}</span>
              <span className="cam-ip">
                {cam.phone.host}:{cam.phone.port}
              </span>
            </>
          ) : (
            <span className="cam-device is-muted">{t('gm.cam_no_phone')}</span>
          )}
        </div>
      </div>
      {cam.link === 'busy' && (
        <p className="cam-alert" role="alert">
          {t('gm.cam_busy_alert', { n: cam.slot })}
        </p>
      )}
      {cam.phone && <CamFacts cam={cam} />}
      <label className="gm-field-row">
        <span className="gm-label">{t('gm.room_plate')}</span>
        <CommitInput
          className="gm-field is-plate"
          value={cam.room}
          maxLength={16}
          placeholder={t('gm.room_placeholder')}
          normalize={(v) => v.trim().toUpperCase()}
          onCommit={(room) => send({ type: 'set_room', slot: cam.slot, room })}
        />
      </label>
      {cam.phone ? (
        <div className="gm-actions">
          <Button onClick={() => send({ type: 'unassign_cam', slot: cam.slot })}>{t('gm.unassign')}</Button>
        </div>
      ) : (
        <>
          {free.length > 0 && <AssignPhone slot={cam.slot} free={free} />}
          <AddPhone slot={cam.slot} />
        </>
      )}
    </article>
  );
}

function Thumb({ cam }: { cam: CamSlot }) {
  const t = useT();
  const feed = cam.phone !== null && (cam.signal === 'live' || cam.signal === 'lost');
  return (
    <div className={`cam-thumb${cam.phone ? '' : ' is-empty'}`}>
      {feed ? (
        <>
          <CamCanvas slot={cam.slot} gen={cam.gen} fps={5} as="gm" className="cam-canvas" />
          {cam.signal === 'lost' ? (
            <div className="cam-static">
              <TvStatic />
              <span className="cam-lost">{t('gm.signal_lost')}</span>
            </div>
          ) : (
            <span className="cam-rec">
              <span className="cam-rec-dot" />
              {t('gm.rec')}
            </span>
          )}
          {cam.room && (
            <div className="cam-plate">
              <Plate>{cam.room}</Plate>
            </div>
          )}
        </>
      ) : (
        <Icon d={ICON.camera} className="cam-thumb-icon" />
      )}
    </div>
  );
}

function CamFacts({ cam }: { cam: CamSlot }) {
  const t = useT();
  const since = useSince();
  const torch = torchKey(cam);
  const torchWorks = cam.torch !== 'pro_required' && cam.torch !== 'unsupported';
  const battery = cam.battery;
  return (
    <>
      <ul className="cam-facts">
        <li>{battery ? t(battery.charging ? 'gm.battery_charging' : 'gm.battery', { level: battery.level }) : t('gm.battery_unknown')}</li>
        <li>
          {cam.signal === 'live'
            ? t('gm.fps', { fps: cam.fps.toFixed(1) })
            : cam.last_frame_at !== null
              ? t('gm.last_frame', { ago: since(cam.last_frame_at) })
              : t('gm.no_frames')}
        </li>
        {cam.error_code && cam.link !== 'busy' && <li className="is-warn">{t(codeKey(cam.error_code))}</li>}
      </ul>
      <div className="cam-torch">
        <span className={`cam-torch-state is-${torch.tone}`}>{t(torch.key)}</span>
        {cam.torch === 'ready' && cam.torch_state !== 'unknown' && (
          <span className="cam-torch-light">{t(cam.torch_state === 'on' ? 'gm.torch_on' : 'gm.torch_off')}</span>
        )}
        <div className="gm-actions">
          <Button disabled={!torchWorks} onClick={() => send({ type: 'test_torch', slot: cam.slot })}>
            {t('gm.torch_test')}
          </Button>
          <Button disabled={!torchWorks} onClick={() => send({ type: 'torch_fix', slot: cam.slot })}>
            {t('gm.torch_fix')}
          </Button>
        </div>
      </div>
    </>
  );
}

function AssignPhone({ slot, free }: { slot: number; free: KnownPhone[] }) {
  const t = useT();
  const [picked, setPicked] = useState('');
  const phoneId = free.some((p) => p.id === picked) ? picked : free[0].id;
  return (
    <form
      className="gm-inline-form"
      onSubmit={(e) => {
        e.preventDefault();
        send({ type: 'assign_cam', slot, phone_id: phoneId });
      }}
    >
      <label className="gm-field-row">
        <span className="gm-label">{t('gm.assign_label')}</span>
        <select className="gm-field" value={phoneId} onChange={(e) => setPicked(e.target.value)}>
          {free.map((p) => (
            <option key={p.id} value={p.id}>
              {t(p.online ? 'gm.phone_option' : 'gm.phone_option_offline', { name: p.name || p.host, host: p.host })}
            </option>
          ))}
        </select>
      </label>
      <Button type="submit" variant="primary">
        {t('gm.assign')}
      </Button>
    </form>
  );
}
