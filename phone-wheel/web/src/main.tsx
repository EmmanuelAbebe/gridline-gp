import { createRoot } from 'react-dom/client';
// the race wheel's screen font (bundled: the phone may have no internet)
import '@fontsource/dm-sans/latin-400.css';
import '@fontsource/dm-sans/latin-600.css';
import '@fontsource/dm-sans/latin-800.css';
import './theme.css';
import './base.css';
import { App } from './ui/App.tsx';

createRoot(document.getElementById('root')!).render(<App />);
