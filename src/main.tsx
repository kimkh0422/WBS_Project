import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider } from './context/AuthContext';
import { LevelColorsProvider } from './context/LevelColorsContext';
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <LevelColorsProvider>
        <App />
      </LevelColorsProvider>
    </AuthProvider>
  </StrictMode>,
);
