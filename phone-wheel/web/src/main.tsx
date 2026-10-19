import { createRoot } from 'react-dom/client';
import './theme.css';
import './base.css';
import { App } from './ui/App.tsx';

createRoot(document.getElementById('root')!).render(<App />);
