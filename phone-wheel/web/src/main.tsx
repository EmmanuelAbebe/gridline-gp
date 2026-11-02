import { createRoot } from 'react-dom/client';
// the race wheel's screen font (bundled: the phone may have no internet)
import '@fontsource/dm-sans/latin-400.css';
import '@fontsource/dm-sans/latin-600.css';
import '@fontsource/dm-sans/latin-800.css';
import './theme.css';
import './base.css';
import { App } from './ui/App.tsx';
import { Designer } from './ui/Designer.tsx';

// ?designer = inside the game's phone designer (edit mode only, ui/Designer.tsx)
const designer = new URLSearchParams(location.search).has('designer');
createRoot(document.getElementById('root')!).render(designer ? <Designer /> : <App />);
