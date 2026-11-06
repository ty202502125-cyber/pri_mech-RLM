import { Link } from 'react-router-dom'

function WrenchIcon() {
  return (
    <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M13.4 2.6a4 4 0 0 0-5.3 5.3L2 14l1.4 1.4 6.1-6.1a4 4 0 0 0 5.3-5.3L12.5 6.3 9.7 3.5l2.2-1.4-.5.5ZM3 13 2 14l1-1Z" fillRule="evenodd"/>
    </svg>
  )
}

/* ── Header ───────────────────────────────────────────────── */
export function Header({ user, onLogout }) {
  return (
    <header className="hdr">
      <div className="hdr-inner">
        <Link className="brand" to="/">
          <span className="brand-icon"><WrenchIcon /></span>
          <span>
            <span className="brand-name">Spoke &amp; Wrench</span>
            <small className="brand-sub">Independent Bicycle Service</small>
          </span>
        </Link>
        <nav className="hdr-nav">
          <Link to="/services">Services</Link>
          <a href="/#mechanic">Mechanic</a>
          {user ? (
            <>
              <Link to={user.role === 'admin' ? '/admin' : '/account'}>
                {user.role === 'admin' ? 'Workshop' : 'My bookings'}
              </Link>
              <button className="hdr-nav-btn" onClick={onLogout}>Sign out</button>
            </>
          ) : (
            <>
              <Link to="/login">Sign in</Link>
              <Link className="btn btn-primary btn-sm" to="/register">Get started</Link>
            </>
          )}
        </nav>
      </div>
    </header>
  )
}

/* ── Footer ───────────────────────────────────────────────── */
export function Footer() {
  return (
    <footer className="ftr">
      <div className="ftr-inner">
        <Link className="brand ftr-brand" to="/">
          <span className="brand-icon"><WrenchIcon /></span>
          <span>
            <span className="brand-name">Spoke &amp; Wrench</span>
            <small className="brand-sub">Zamboanga City</small>
          </span>
        </Link>
        <div className="ftr-right">
          <span>Service by appointment only</span>
          <span>Thoughtful repairs. More miles together.</span>
        </div>
      </div>
    </footer>
  )
}

/* ── Service list ─────────────────────────────────────────── */
