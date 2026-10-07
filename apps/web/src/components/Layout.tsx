import { Link, NavLink, Outlet, useNavigate } from 'react-router';
import { useSession } from '../useSession';

export function Layout() {
  const { user, signOut } = useSession();
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
