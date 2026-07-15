import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './aros.css';
import './setup-flow.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
