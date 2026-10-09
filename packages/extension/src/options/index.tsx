import React from 'react';
import ReactDOM from 'react-dom/client';
import { domAnimation, LazyMotion, MotionConfig } from 'motion/react';
import Options from './options';
import { AppProvider } from './store';
import { ToastProvider } from './hook/ToastProvider';

import '../index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MotionConfig reducedMotion="user">
      <LazyMotion features={domAnimation} strict>
        <AppProvider>
          <ToastProvider>
            <Options />
          </ToastProvider>
        </AppProvider>
      </LazyMotion>
    </MotionConfig>
  </React.StrictMode>
);
