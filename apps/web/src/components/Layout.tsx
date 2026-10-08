/**
 * The page frame. The header shows the site links on wide screens and a ☰
 * menu on phones. During a game the table screen fills the header's slot
 * with its own controls and the site links step aside (see headerSlot.ts).
 */
import { useMemo, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router';
import { HeaderSlotContext } from '../headerSlot';
import { useSession } from '../useSession';
import { Menu, type MenuItem } from './Menu';

export function Layout() {
  const { user, signOut } = useSession();
  const navigate = useNavigate();
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [inGame, setInGame] = useState(false);
  const header = useMemo(() => ({ slot, setInUse: setInGame }), [slot]);

  const doSignOut = () => void signOut().then(() => navigate('/'));
  const who = user && (
    <>
      {user.displayName}
      {!user.signedIn && <span className="muted"> (guest)</span>}
    </>
  );
  const menuItems: MenuItem[] = [
    { label: 'Home', onSelect: () => void navigate('/') },
    { label: 'Games', onSelect: () => void navigate('/games') },
    { label: 'About', onSelect: () => void navigate('/about') },
    user
      ? { label: 'Sign out', onSelect: doSignOut }
      : { label: 'Sign in', onSelect: () => void navigate('/sign-in') },
  ];

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className={`site-header${inGame ? ' in-game' : ''}`}>
        <Link to="/" className="brand">
          Card Table
        </Link>
        {!inGame && (
          <nav aria-label="Main" className="wide-only">
            <NavLink to="/">Home</NavLink>
            <NavLink to="/games">Games</NavLink>
            <NavLink to="/about">About</NavLink>
          </nav>
        )}
        <div className="header-slot" ref={setSlot} />
        <div className="header-end">
          {who && <span className="who wide-only">{who}</span>}
          {!inGame && (
            <span className="wide-only">
              {user ? (
                <button type="button" className="link-button" onClick={doSignOut}>
                  Sign out
                </button>
              ) : (
                user === null && <Link to="/sign-in">Sign in</Link>
              )}
            </span>
          )}
          {!inGame && (
            <Menu
              className="phone-only"
              label="Site menu"
              buttonText="☰ Menu"
              items={menuItems}
              note={who && <>Signed in as {who}</>}
            />
          )}
        </div>
      </header>
      <main id="main" tabIndex={-1}>
        <HeaderSlotContext.Provider value={header}>
          <Outlet />
        </HeaderSlotContext.Provider>
      </main>
    </div>
  );
}
