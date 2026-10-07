import { Link, NavLink, Outlet, useNavigate } from 'react-router';
import { useSession } from '../useSession';
import { useSettings } from '../useSettings';

export function Layout() {
  const { user, signOut } = useSession();
  const { settings, change } = useSettings();
  const navigate = useNavigate();

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <Link to="/" className="brand">
          Card Table
        </Link>
        <nav aria-label="Main">
          <NavLink to="/">Home</NavLink>
          <NavLink to="/games">Games</NavLink>
          <NavLink to="/about">About</NavLink>
        </nav>
        <div className="header-end">
          <label className="toggle" title="Spades black, hearts red, diamonds blue, clubs green">
            <input
              type="checkbox"
              checked={settings.fourColor}
              onChange={(e) => change({ fourColor: e.target.checked })}
            />
            Four-colour suits
          </label>
          {user && (
            <span className="who">
              {user.displayName}
              {!user.signedIn && <span className="muted"> (guest)</span>}
            </span>
          )}
          {user ? (
            <button
              type="button"
              className="link-button"
              onClick={() => void signOut().then(() => navigate('/'))}
            >
              Sign out
            </button>
          ) : (
            user === null && <Link to="/sign-in">Sign in</Link>
          )}
        </div>
      </header>
      <main id="main" tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  );
}
