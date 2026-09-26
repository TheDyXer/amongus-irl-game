import { cx } from './cx';

export interface TvStaticProps {
  /** Slower noise for weak TV GPUs (`device.low_motion`). */
  lowMotion?: boolean;
  className?: string;
}

/** Decorative TV noise from /static.png filling its positioned parent; jumps by transform only. */
export function TvStatic({ lowMotion = false, className }: TvStaticProps) {
  return (
    <div className={cx('tv-static', lowMotion && 'tv-static--slow', className)} aria-hidden="true">
      <div className="tv-static__noise" />
    </div>
  );
}
