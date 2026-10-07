import { Link } from 'react-router';

export function NotFound() {
  return (
    <div className="page narrow">
      <h1>Page not found</h1>
      <p>
        <Link to="/">Go to the home page</Link>
      </p>
    </div>
  );
}
