import { Link } from 'react-router-dom'
import { Footer } from '../components/SiteChrome'
import ServiceList from '../components/ServiceList'

export default function ServicesPage() {
  return (
    <>
      <div className="page-banner">
        <div className="page-banner-col">
          <span className="eyebrow">The service menu</span>
          <h1 className="page-h1">What we do.</h1>
          <p className="page-lead">
            Starting prices and time estimates are guides. We confirm the right service
            and any parts needed before work begins.
          </p>
        </div>
      </div>
      <main className="page-body">
        <ServiceList />
        <div className="notice" style={{ marginTop: 'var(--s6)' }}>
          Not sure which service you need? Submit a request describing what you've noticed —
          the mechanic will help you find the right next step.
        </div>
        <Link className="btn btn-primary" to="/book" style={{ marginTop: 'var(--s4)', display: 'inline-flex' }}>
          Book a service
        </Link>
      </main>
      <Footer />
    </>
  )
}

/* ── Auth page ────────────────────────────────────────────── */
