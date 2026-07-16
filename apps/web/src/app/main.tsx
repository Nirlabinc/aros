import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './aros.css';
import './aros-design.css';
import './aros-shell.css';
import './setup-flow.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
