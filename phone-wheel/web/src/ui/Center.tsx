// The middle column of the standard layout (2026-10-26, user: no status line; gear and speed as high as possible, the
// important buttons under them): gear + speed, the extra on-screen buttons (BOX, REAR, ...), then a row of small
// round buttons (Parts.tsx). Every part carries data-slot, so Layout → Move and resize can start from where it is.
import type { Config } from '../settings/settings.ts';
import { AuxButton } from './AuxButton.tsx';
import { DashReadout, FullButton, ReconnectButton, SettingsButton, WheelButton } from './Parts.tsx';

export function Center({ cfg, openSettings, preview }: { cfg: Config; openSettings: () => void; preview: boolean }) {
  const L = cfg.layout;
  return (
    <div className={`center ${cfg.buttons.length > 2 ? 'crowded' : ''}`}>
      <div data-slot="dash"><DashReadout cfg={cfg} preview={preview} /></div>
      {cfg.buttons.length > 0 && (
        <div className={`aux size-${L.buttonSize}`}>
          {cfg.buttons.map((b, i) => <div key={`${i}-${b.bind}-${b.toggle}`} data-slot={`btn${i}`}><AuxButton index={i} btn={b} /></div>)}
        </div>
      )}
      <div className="rounds">
        <div data-slot="wheel"><WheelButton cfg={cfg} /></div>
        <div data-slot="settings"><SettingsButton open={openSettings} /></div>
        <div data-slot="reconnect"><ReconnectButton /></div>
        <div data-slot="full"><FullButton /></div>
      </div>
    </div>
  );
}
