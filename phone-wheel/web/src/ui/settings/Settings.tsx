// Settings over the driving screen: tabs on the left, the open tab on the right. While open, pedals and buttons are
// let go (App sets engine.state.paused); steering stays live so the Steering tab can show it.
import { useState } from 'react';
import type { Config, Store } from '../../settings/settings.ts';
import type { Update } from '../App.tsx';
import { SteeringTab } from './SteeringTab.tsx';
import { PedalsTab } from './PedalsTab.tsx';
import { ButtonsTab } from './ButtonsTab.tsx';
import { LayoutTab } from './LayoutTab.tsx';
import { FeedbackTab } from './FeedbackTab.tsx';
import { ProfilesTab } from './ProfilesTab.tsx';
import './Settings.css';

const TABS = ['Steering', 'Pedals', 'Buttons', 'Feedback', 'Layout', 'Profiles'] as const;
type Tab = (typeof TABS)[number];
export interface TabProps { cfg: Config; update: Update; editLayout?: () => void }

export function Settings({ store, setStore, cfg, update, close, editLayout }: { store: Store; setStore: React.Dispatch<React.SetStateAction<Store>>; cfg: Config; update: Update; close: () => void; editLayout: () => void }) {
  const [tab, setTab] = useState<Tab>(() => {
    try { const t = sessionStorage.getItem('pw-tab') as Tab; return TABS.includes(t) ? t : TABS[0]; } catch { return TABS[0]; }
  });
  const pick = (t: Tab) => { setTab(t); try { sessionStorage.setItem('pw-tab', t); } catch { /* storage blocked */ } };
  return (
    <div className="settings">
      <nav>
        {TABS.map((t) => <button key={t} className={t === tab ? 'on' : ''} onClick={() => pick(t)}>{t}</button>)}
        <div className="grow" />
        <div className="profile-name">{store.active}</div>
        <button className="primary" onClick={close}>Done</button>
      </nav>
      <section>
        {tab === 'Steering' && <SteeringTab cfg={cfg} update={update} />}
        {tab === 'Pedals' && <PedalsTab cfg={cfg} update={update} />}
        {tab === 'Buttons' && <ButtonsTab cfg={cfg} update={update} />}
        {tab === 'Feedback' && <FeedbackTab cfg={cfg} update={update} />}
        {tab === 'Layout' && <LayoutTab cfg={cfg} update={update} editLayout={editLayout} />}
        {tab === 'Profiles' && <ProfilesTab store={store} setStore={setStore} />}
      </section>
    </div>
  );
}
