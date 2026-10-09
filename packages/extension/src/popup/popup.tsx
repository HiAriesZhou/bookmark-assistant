import React from 'react';
import ReactDOM from 'react-dom/client';
import '../index.css';
import Popup from './PopupComponent';
import { AppProvider } from '../options/store';
import { ToastProvider } from '../options/hook/ToastProvider';

ReactDOM.createRoot(document.getElementById('popup-root') as HTMLElement).render(
  <React.StrictMode>
    <AppProvider>
      <ToastProvider density="compact">
        <Popup />
      </ToastProvider>
    </AppProvider>
  </React.StrictMode>
);
