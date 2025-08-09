// src/main.tsx
import { createRoot } from 'react-dom/client';
import App from './App.tsx';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root が見つかりません');

createRoot(rootEl).render(<App />);
