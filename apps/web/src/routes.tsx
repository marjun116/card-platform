import type { RouteObject } from 'react-router';
import { Layout } from './components/Layout';
import { About } from './pages/About';
import { CreateTable } from './pages/CreateTable';
import { Home } from './pages/Home';
import { Library } from './pages/Library';
import { NotFound } from './pages/NotFound';
import { RulesPage } from './pages/RulesPage';
import { SignIn } from './pages/SignIn';
import { TablePage } from './pages/TablePage';

export const routes: RouteObject[] = [
  {
    element: <Layout />,
    children: [
      { path: '/', element: <Home /> },
      { path: '/sign-in', element: <SignIn /> },
      { path: '/games', element: <Library /> },
      { path: '/games/:slug/new', element: <CreateTable /> },
      { path: '/games/:slug/rules', element: <RulesPage /> },
      // Invite links: having the code is what lets you join.
      { path: '/t/:code', element: <TablePage /> },
      { path: '/about', element: <About /> },
      { path: '*', element: <NotFound /> },
    ],
  },
];
