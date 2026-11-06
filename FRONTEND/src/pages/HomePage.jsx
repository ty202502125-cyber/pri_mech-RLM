import { Link } from 'react-router-dom'
import { Footer } from '../components/SiteChrome'
import ServiceList from '../components/ServiceList'
import MechanicSection from '../components/MechanicSection'
import Testimonials from '../components/Testimonials'
import { HERO_SVCS } from '../data/mechanic'

export default function HomePage() {
  return (
    <>
      <main>
        {/* Hero */}
        <section className="hero">
          <div className="hero-inner">
            <div className="hero-copy">
              <div className="hero-pill">
                <span className="hero-pill-dot" aria-hidden="true" />
                Independent bicycle workshop · Metro Manila
              </div>
              <h1 className="hero-h1">
                Ride more.<br /><mark>Worry less.</mark>
              </h1>
              <p className="hero-sub">
                Careful, honest bicycle service for Metro Manila riders.
                One mechanic, your bike, the full story — before we turn a single bolt.
              </p>
              <div className="hero-actions">
                <Link className="btn btn-primary btn-lg" to="/book">Book a service</Link>
                <Link className="btn btn-outline btn-lg" to="/services">See what we do</Link>
              </div>
              <div className="hero-proof">
                <span className="avatar-stack" aria-hidden="true">
                  <i>R</i><i>M</i><i>J</i>
                </span>
                <div className="hero-proof-text">
                  <b>Personal service, every time.</b>
                  <small>One mechanic. Your bike. Proper attention.</small>
                </div>
              </div>
            </div>

            {/* Right — card stack */}
            <div className="hero-art">
              <div className="hero-card">
                <div className="hero-card-top">
                  <span className="hero-card-title">Popular services</span>
                  <span className="hero-card-badge">Open for bookings</span>
                </div>
                {HERO_SVCS.map(s => (
                  <div className="hero-svc-row" key={s.name}>
                    <span className="hero-svc-name">{s.name}</span>
                    <span className="hero-svc-price">{s.price}</span>
                  </div>
                ))}
              </div>
              <div className="hero-stats-card">
                {[
                  { num: '12+',  lbl: 'Years experience' },
                  { num: '1.2k', lbl: 'Bikes serviced'   },
                  { num: '4.9★', lbl: 'Avg. rating'      },
                ].map(s => (
                  <div className="hero-stat-item" key={s.num}>
                    <span className="hero-stat-num">{s.num}</span>
                    <span className="hero-stat-lbl">{s.lbl}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Services */}
        <section className="section">
          <div className="col">
            <div className="section-hd">
              <div>
                <span className="eyebrow">What we can help with</span>
                <h2 className="section-h2">Services.</h2>
              </div>
              <Link className="text-link" to="/services">View all services →</Link>
            </div>
            <ServiceList />
          </div>
        </section>

        {/* Process */}
        <section className="section section-alt">
          <div className="col">
            <span className="eyebrow">A simple process</span>
            <h2 className="section-h2">From first message<br />to first ride back.</h2>
            <div className="process-grid">
              {[
                { step: 'Step one',   title: "Tell us what's up",      body: "Choose a service, describe what you've noticed, and suggest a time." },
                { step: 'Step two',   title: 'Get a clear repair plan', body: 'The mechanic reviews your request, confirms a slot, and answers any questions.' },
                { step: 'Step three', title: 'Ride with confidence',    body: 'Approve the work, follow progress, and collect your bicycle.' },
              ].map(c => (
                <article className="process-card" key={c.step}>
                  <span className="process-step-label">{c.step}</span>
                  <h3>{c.title}</h3>
                  <p>{c.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* Mechanic */}
        <MechanicSection />

        {/* Testimonials */}
        <Testimonials />

        {/* CTA */}
        <section className="cta-section">
          <div className="cta-col">
            <div>
              <span className="eyebrow">Ready when you are</span>
              <div className="cta-h2">Let's get your bike<br />feeling right.</div>
            </div>
            <Link className="btn btn-ghost btn-lg" to="/book">Book a service →</Link>
          </div>
        </section>
      </main>
      <Footer />
    </>
  )
}

/* ── Services page ────────────────────────────────────────── */
