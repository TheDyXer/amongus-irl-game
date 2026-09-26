import type { ViewName } from '../../api/types';

/** Stroke icons on a 24-unit grid, ported from design/mockups/GM.dc.html. */
export const ICON = {
  lock: 'M5 11 H19 V21 H5 Z M8 11 V7 a4 4 0 0 1 7.7 -1.5',
  setup: 'M4 6 H9 M13 6 H20 M11 3.5 V8.5 M4 12 H14 M18 12 H20 M16 9.5 V14.5 M4 18 H6 M10 18 H20 M8 15.5 V20.5',
  live: 'M12 12 h.01 M8.5 8.5 a5 5 0 0 0 0 7 M15.5 8.5 a5 5 0 0 1 0 7 M5.5 5.5 a9 9 0 0 0 0 13 M18.5 5.5 a9 9 0 0 1 0 13',
  print: 'M7 9 V3 H17 V9 M7 17 H4 V9 H20 V17 H17 M7 14 H17 V21 H7 Z',
  settings:
    'M9 12 a3 3 0 1 0 6 0 a3 3 0 1 0 -6 0 M12 2.5 V5.5 M12 18.5 V21.5 M2.5 12 H5.5 M18.5 12 H21.5 M5.3 5.3 L7.4 7.4 M16.6 16.6 L18.7 18.7 M5.3 18.7 L7.4 16.6 M16.6 7.4 L18.7 5.3',
  wifi: 'M3.5 9.5 a12 12 0 0 1 17 0 M6.8 13 a7.5 7.5 0 0 1 10.4 0 M12 17.5 h.01',
  camera: 'M4 8 H8 L10 5 H14 L16 8 H20 V18 H4 Z M9 13 a3 3 0 1 0 6 0 a3 3 0 1 0 -6 0',
  laptop: 'M5 6 H19 V15 H5 Z M3 18.5 H21',
  tv: 'M3 5 H21 V16 H3 Z M8 20 H16 M12 16 V20',
  tablet: 'M6 3 H18 V21 H6 Z M11 18 H13',
  close: 'M6 6 L18 18 M18 6 L6 18',
  backspace: 'M9 5 H20 V19 H9 L3 12 Z M12 9 L16 15 M16 9 L12 15',
  warn: 'M12 3.5 L21.5 20 H2.5 Z M12 10 V14 M12 17 h.01',
  info: 'M3 12 a9 9 0 1 0 18 0 a9 9 0 1 0 -18 0 M12 11 V16.5 M12 7.5 h.01',
} as const;

export const VIEW_ICON: Record<ViewName, string> = {
  security: ICON.laptop,
  spectator: ICON.tv,
  comms: ICON.tablet,
  emergency: ICON.tablet,
};

export function Icon({ d, className }: { d: string; className?: string }) {
  return (
    <svg className={className ? `gm-icon ${className}` : 'gm-icon'} viewBox="0 0 24 24" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}
