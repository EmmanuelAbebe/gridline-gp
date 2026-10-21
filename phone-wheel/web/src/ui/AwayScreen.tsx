// "Are you there?" (engine/presence.ts): the phone was put down flat or dropped, so it sends nothing but that until
// the driver taps the button; the game pauses meanwhile and counts down when it comes back.
import { useEffect, useState } from 'react';
import * as engine from '../engine/engine.ts';
import { buzz } from './screen.ts';

export function AwayScreen() {
  const [away, setAway] = useState(engine.state.away);
  useEffect(() => engine.onAway(setAway), []);
  if (!away) return null;
  return (
    <div className="overlay away" role="dialog" aria-modal="true">
      <h1>Are you there?</h1>
      <p>{away === 1 ? 'The phone was put down, so the game is paused.' : 'The phone was dropped or thrown, so the game is paused.'}
        {' '}Hold it the way you drive, then tap the button: that becomes straight ahead.</p>
      <button className="primary big" onClick={() => { buzz(30); engine.back(); }}>I'M HERE</button>
    </div>
  );
}
