import { cleanup, render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import type { User } from '../api';
import { SessionContext } from '../useSession';
import { Layout } from './Layout';

afterEach(cleanup);

function showHeader(user: User | null) {
  const router = createMemoryRouter([
    { element: <Layout />, children: [{ path: '/', element: null }] },
  ]);
  render(
    <SessionContext.Provider
      value={{ user, setUser: () => undefined, signOut: () => Promise.resolve() }}
    >
      <RouterProvider router={router} />
    </SessionContext.Provider>,
  );
  return within(screen.getByRole('banner'));
}

describe('Layout header', () => {
  it("offers a guest Sign in, never Sign out (they'd lose their seats)", () => {
    const header = showHeader({ id: 'g', displayName: 'Arjun', signedIn: false });
    expect(header.getByText('Arjun')).toBeTruthy();
    expect(header.getByRole('link', { name: 'Sign in' })).toBeTruthy();
    expect(header.queryByRole('button', { name: 'Sign out' })).toBeNull();
  });

  it('offers a signed-in account Sign out', () => {
    const header = showHeader({ id: 'a', displayName: 'Arjun', signedIn: true });
    expect(header.getByRole('button', { name: 'Sign out' })).toBeTruthy();
    expect(header.queryByRole('link', { name: 'Sign in' })).toBeNull();
  });

  it('offers Sign in when nobody is signed in', () => {
    const header = showHeader(null);
    expect(header.getByRole('link', { name: 'Sign in' })).toBeTruthy();
  });

  it('links to past games once there is someone to have played', () => {
    const header = showHeader({ id: 'g', displayName: 'Arjun', signedIn: false });
    const nav = within(header.getByRole('navigation', { name: 'Main' }));
    expect(nav.getByRole('link', { name: 'Past games' }).getAttribute('href')).toBe('/history');
    cleanup();
    const nobody = within(showHeader(null).getByRole('navigation', { name: 'Main' }));
    expect(nobody.queryByRole('link', { name: 'Past games' })).toBeNull();
  });
});
