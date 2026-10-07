import { type FormEvent, type ReactNode, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { api, ApiError } from '../api';
import { useSession } from '../useSession';

function message(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Something went wrong. Please try again.';
}

/** Pick a name and play straight away, without an account. */
export function GuestForm({ onDone }: { onDone?: () => void }) {
  const { setUser } = useSession();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    api
      .playAsGuest(name)
      .then((user) => {
        setUser(user);
        onDone?.();
      })
      .catch((e: unknown) => setError(message(e)))
      .finally(() => setBusy(false));
  };

  return (
    <form onSubmit={submit} className="stack">
      <label className="field">
        Your name at the table
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={30}
          required
          autoComplete="nickname"
        />
      </label>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <button type="submit" className="primary" disabled={busy || name.trim() === ''}>
        Play as guest
      </button>
    </form>
  );
}

/** Email a sign-in link. */
function EmailForm() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    api
      .emailLink(email)
      .then(() => setSent(true))
      .catch((e: unknown) => setError(message(e)))
      .finally(() => setBusy(false));
  };

  if (sent) {
    return (
      <p role="status">
        Check your email: we sent a sign-in link to <strong>{email}</strong>. It works once, for 15
        minutes. Open it in this browser to keep any tables you joined as a guest.
      </p>
    );
  }
  return (
    <form onSubmit={submit} className="stack">
      <label className="field">
        Email
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
        />
      </label>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <button type="submit" disabled={busy}>
        Email me a sign-in link
      </button>
    </form>
  );
}

function SignInOptions({ onDone }: { onDone?: () => void }) {
  return (
    <div className="sign-in-options">
      <section className="panel">
        <h2>Play now</h2>
        <p className="muted">No account needed for the built-in games.</p>
        <GuestForm onDone={onDone} />
      </section>
      <section className="panel">
        <h2>Sign in with email</h2>
        <p className="muted">Keeps your seats on every device. No password.</p>
        <EmailForm />
      </section>
    </div>
  );
}

export function SignIn() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  return (
    <div className="page narrow">
      <h1>Sign in</h1>
      {params.get('signin') === 'expired' && (
        <p role="alert" className="error">
          That sign-in link has expired or was already used. Ask for a new one below.
        </p>
      )}
      <SignInOptions onDone={() => void navigate('/')} />
    </div>
  );
}

/** Shows its children once someone is signed in (as a guest or an account), or the sign-in options. */
export function RequireUser({ children, why }: { children: ReactNode; why: string }) {
  const { user } = useSession();
  if (user === undefined) return <p className="page muted">Loading…</p>;
  if (user === null) {
    return (
      <div className="page narrow">
        <h1>{why}</h1>
        <SignInOptions />
      </div>
    );
  }
  return children;
}
