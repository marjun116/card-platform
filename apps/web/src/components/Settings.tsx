/** The ⚙ button in the header and its pop-up: settings kept in this browser. */
import { useState } from 'react';
import {
  MOTION_SETTINGS,
  type MotionSetting,
  setMotionSetting,
  useMotionSetting,
} from '../settings';
import { Dialog } from '../table/Scores';

const MOTION_TEXT: Record<MotionSetting, { label: string; note: string }> = {
  normal: { label: 'Normal', note: 'Cards slide and flip; scores count up.' },
  fast: { label: 'Fast', note: 'The same, twice as quick.' },
  off: { label: 'Off', note: 'Nothing moves: cards and effects just appear.' },
};

export function SettingsButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="link-button settings-button"
        aria-label="Settings"
        onClick={() => setOpen(true)}
      >
        <span aria-hidden="true">⚙</span>
      </button>
      {open && <SettingsDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function SettingsDialog({ onClose }: { onClose: () => void }) {
  const motion = useMotionSetting();
  return (
    <Dialog title="Settings" onClose={onClose} closeLabel="Done" closeOnOutsideClick>
      <fieldset className="setting">
        <legend>Animation speed</legend>
        {MOTION_SETTINGS.map((setting) => (
          <label key={setting} className="setting-choice">
            <input
              type="radio"
              name="motion"
              value={setting}
              checked={motion === setting}
              onChange={() => setMotionSetting(setting)}
            />
            <span>
              <strong>{MOTION_TEXT[setting].label}</strong>
              <span className="muted"> {MOTION_TEXT[setting].note}</span>
            </span>
          </label>
        ))}
        <p className="muted">
          Saved in this browser. With “reduce motion” switched on in your device’s settings, things
          fade instead of moving, whatever you choose here.
        </p>
      </fieldset>
    </Dialog>
  );
}
