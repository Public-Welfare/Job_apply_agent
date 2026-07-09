import React from 'react';
import { createRoot } from 'react-dom/client';
import App, { requireAuthOrRedirect } from './App';
import { ToastProvider } from './ui';
import './styles.css';

if (requireAuthOrRedirect()) {
  createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <ToastProvider>
        <App />
      </ToastProvider>
    </React.StrictMode>
  );
}
