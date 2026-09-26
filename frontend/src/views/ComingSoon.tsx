import type { ReactNode } from 'react';
import { Crewmate } from '../components/Crewmate';
import { Plate } from '../components/Plate';
import { Starfield } from '../components/Starfield';
import { useT } from '../i18n';
import './pairing.css';

export type Soon = 'player' | 'badge' | 'task' | 'comms' | 'emergency' | 'missing';

/** A full-screen message on the starfield (reserved pages, "opened elsewhere", loading). */
export function Splash({ title, text, lowMotion = false, children }: { title: string; text?: string; lowMotion?: boolean; children?: ReactNode }) {
  return (
    <main className="splash">
      <Starfield lowMotion={lowMotion} />
      <div className="splash-body">
        <div className="splash-crew">
          <Crewmate color="#38FFDD" shadow="#24A9BF" size={160} />
        </div>
        <h1 className="splash-title outlined">{title}</h1>
        {text && <p className="splash-text">{text}</p>}
        {children}
      </div>
    </main>
  );
}

export default function ComingSoon({ what, name, lowMotion }: { what: Soon; name?: string; lowMotion?: boolean }) {
  const t = useT();
  return (
    <Splash title={t(what === 'missing' ? 'pairing.missing_title' : 'pairing.soon_title')} text={t(`pairing.soon_${what}`)} lowMotion={lowMotion}>
      {name && (
        <Plate>
          <span className="splash-name">{name}</span>
        </Plate>
      )}
    </Splash>
  );
}
