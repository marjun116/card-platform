import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { routes } from './routes';
import { SessionProvider } from './session';
import { applyMotionSetting } from './settings';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');
applyMotionSetting();

createRoot(root).render(
  <StrictMode>
    <SessionProvider>
      <RouterProvider router={createBrowserRouter(routes)} />
    </SessionProvider>
  </StrictMode>,
);
