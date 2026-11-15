import { useEffect, useRef, useState } from 'react'
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import api from './services/api'
import RepairWorkspace from './components/RepairWorkspace'
import mechanicPortrait from './assets/palluh.png'
import mechanicHoverPortrait from './assets/palshy.png'
import './App.css'

/* ── Formatters ───────────────────────────────────────────── */
const money = (v) =>
  new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(v || 0))
const dt = (v) =>
  v ? new Date(v).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Awaiting confirmation'
const fileAsDataUrl = file => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(reader.result)
  reader.onerror = () => reject(new Error('Could not read the selected image.'))
  reader.readAsDataURL(file)
})
const mediaUrl = value => {
  if (!value || /^https?:\/\//i.test(value) || !value.startsWith('/uploads/')) return value
  const apiOrigin = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/api\/?$/, '')
  return `${apiOrigin}${value}`
}
const jsonArray = value => {
  if (Array.isArray(value)) return value
  if (typeof value !== 'string') return []
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : [] } catch { return [] }
}

const CITY = 'Zamboanga City'
const nowLocal = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)
const WORKSHOP_TIME_ZONE = 'Asia/Manila'
const workshopDateKey = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: WORKSHOP_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}
const workshopTimeLabel = value => new Intl.DateTimeFormat([], {
  timeZone: WORKSHOP_TIME_ZONE, hour: 'numeric', minute: '2-digit',
}).format(new Date(value))

/* ── Animation configuration (tune here) ───────────────────── */
const ANIMATION_CONFIG = {
  // Cursor / dotted background
  cursorPulseMs: 2200,
  dotDriftMs: 14000,
  // Mechanic portrait Ken-Burns
  portraitKenBurnsMs: 20000,
  // Shuffle interval for featured builds & certificates
  shuffleEnabled: true,
  shuffleIntervalMs: 2000,
}

/* ── Wrench icon ──────────────────────────────────────────── */
function WrenchIcon() {
  return (
    <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M13.4 2.6a4 4 0 0 0-5.3 5.3L2 14l1.4 1.4 6.1-6.1a4 4 0 0 0 5.3-5.3L12.5 6.3 9.7 3.5l2.2-1.4-.5.5ZM3 13 2 14l1-1Z" fillRule="evenodd"/>
    </svg>
  )
}

/* ── Header ───────────────────────────────────────────────── */
function Header({ user, onLogout, dark, onToggleTheme }) {
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
          <Link to={{ pathname: '/', hash: '#mechanic' }}>Mechanic</Link>
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
          <button className="dark-toggle theme-nav-toggle" type="button" onClick={onToggleTheme}
            aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
            title={dark ? 'Switch to light mode' : 'Switch to dark mode'}>
            <span aria-hidden="true">{dark ? '☀' : '☾'}</span>
          </button>
        </nav>
      </div>
    </header>
  )
}

/* ── Footer ───────────────────────────────────────────────── */
function Footer() {
  const contact = {
    email: 'abdallahpalluh@gmail.com',
    phone: '+63 953 045 0592',
    instagram: '', // paste your Instagram URL here to show the link
    facebook: 'https://www.facebook.com/legends.hub.7/',
  }
  const year = new Date().getFullYear()
  return (
    <footer className="ftr">
      <div className="ftr-inner">
        <div className="ftr-brand">
          <span className="ftr-brand-name">Spoke &amp; Wrench</span>
          <span className="ftr-brand-sub">Independent Bicycle Service · {CITY}</span>
        </div>
        <div className="ftr-contact">
          <strong>Get in touch</strong>
          <div className="ftr-contact-grid">
            <a className="ftr-highlight" href={`mailto:${contact.email}`}><span>Email</span><strong>{contact.email}</strong></a>
            <a className="ftr-highlight" href={`tel:${contact.phone.replace(/[^+\d]/g, '')}`}><span>Phone</span><strong>{contact.phone}</strong></a>
            {contact.instagram && <a className="ftr-highlight" href={contact.instagram} target="_blank" rel="noreferrer"><span>Instagram</span><strong>View profile &#8599;</strong></a>}
            <a className="ftr-highlight" href={contact.facebook} target="_blank" rel="noreferrer"><span>Facebook</span><strong>View page &#8599;</strong></a>
          </div>
        </div>
        <div className="ftr-bottom">
          <span>© {year} Spoke &amp; Wrench · All rights reserved</span>
          <span>By appointment only · Zamboanga City, PH</span>
        </div>
      </div>
    </footer>
  )
}

function CursorEffects() {
  const cursorRef = useRef(null)
  const ringRef = useRef(null)

  useEffect(() => {
    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)')
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    if (!finePointer.matches || reducedMotion.matches) return undefined

    const cursor = cursorRef.current
    const ring = ringRef.current
    document.body.classList.add('cursor-effects-enabled')
    const move = event => {
      document.body.style.setProperty('--cursor-x', `${event.clientX}px`)
      document.body.style.setProperty('--cursor-y', `${event.clientY}px`)
      cursor.style.transform = `translate3d(${event.clientX}px, ${event.clientY}px, 0)`
      ring.style.transform = `translate3d(${event.clientX}px, ${event.clientY}px, 0)`
    }
    const updateTarget = event => {
      const target = event.target instanceof Element
        ? event.target.closest('a, button, input, select, textarea, label, [role="button"]')
        : null
      document.body.classList.toggle('cursor-over-target', Boolean(target))
      document.body.classList.toggle('cursor-native', Boolean(target?.matches('input:not([type="checkbox"]):not([type="radio"]):not([type="file"]), textarea, [contenteditable="true"]')))
    }
    const hide = () => document.body.classList.add('cursor-hidden')
    const show = () => document.body.classList.remove('cursor-hidden')

    window.addEventListener('pointermove', move, { passive: true })
    window.addEventListener('pointerover', updateTarget, { passive: true })
    window.addEventListener('pointerout', updateTarget, { passive: true })
    document.documentElement.addEventListener('pointerleave', hide)
    document.documentElement.addEventListener('pointerenter', show)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerover', updateTarget)
      window.removeEventListener('pointerout', updateTarget)
      document.documentElement.removeEventListener('pointerleave', hide)
      document.documentElement.removeEventListener('pointerenter', show)
      document.body.classList.remove('cursor-effects-enabled', 'cursor-over-target', 'cursor-native', 'cursor-hidden')
      document.body.style.removeProperty('--cursor-x')
      document.body.style.removeProperty('--cursor-y')
    }
  }, [])

  return <div className="cursor-effects" aria-hidden="true">
    <span ref={ringRef} className="cursor-effects-ring" />
    <span ref={cursorRef} className="cursor-effects-dot" />
  </div>
}

/* ── Service list ─────────────────────────────────────────── */
function ServiceList() {
  const [services, setServices] = useState([])
  const [error, setError]       = useState('')
  useEffect(() => {
    api.get('/services')
      .then(({ data }) => setServices(data.services))
      .catch(() => setError('Could not load services. Check that the API and database are running.'))
  }, [])
  return (
    <div className="svc-grid">
      {services.map(s => (
        <article className="svc-card" key={s.id}>
          <span className="svc-name">{s.name}</span>
          <p className="svc-desc">{s.description}</p>
          <div className="svc-foot">
            <span className="svc-price">From {money(s.starting_price)}</span>
            <span className="svc-dur">{s.estimated_minutes} min</span>
          </div>
        </article>
      ))}
      {error && <p className="inline-err">{error}</p>}
      {!error && !services.length && <p className="muted">Loading services…</p>}
    </div>
  )
}

const BIKE_CATEGORIES = ['Road bike', 'Mountain bike', 'Gravel bike', 'City / commuter bike','Fixed gear', 'Folding bike', 'Other']

/* ── Mechanic section ─────────────────────────────────────── */
function CertificateCard({ certificate }) {
  const image = mediaUrl(certificate.image_url)
  return <div className='cert-row'>
    <PortfolioImage className='cert-image' src={image} alt={certificate.title + ' certificate'} />
    <span className='cert-copy'><span className='cert-badge'>{certificate.body}</span><span className='cert-name'>{certificate.title}</span><span className='cert-open'>Click to view certificate</span></span>
    <span className='cert-year'>{certificate.year}</span>
  </div>
}

function PortfolioImage({ src, alt, className = '', loading = 'lazy', fallbackLabel = '' }) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const [open, setOpen] = useState(false)
  return (
    <><button type="button" className={`portfolio-image-frame ${className} ${loaded ? 'is-loaded' : ''}`} aria-label={`View ${alt}`} onClick={() => loaded && setOpen(true)} aria-busy={!loaded && !failed}>
      {!loaded && !failed && <span className='portfolio-image-skeleton' aria-hidden='true' />}
      {failed
        ? <span className='portfolio-image-fallback'>{fallbackLabel || 'Image unavailable'}</span>
        : <img className='portfolio-image-element' src={src} alt={alt} loading={loading} fetchPriority={loading === 'eager' ? 'high' : undefined} onLoad={() => setLoaded(true)} onError={() => setFailed(true)} />}
    </button>{open && <ImageLightbox src={src} alt={alt} onClose={() => setOpen(false)} />}</>
  )
}

function ImageLightbox({ src, alt, onClose }) {
  useEffect(() => { const close = e => e.key === 'Escape' && onClose(); window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close) }, [onClose])
  return <div className="image-lightbox" role="dialog" aria-modal="true" aria-label={alt} onClick={onClose}><button type="button" className="image-lightbox-close" onClick={onClose} aria-label="Close image">×</button><img src={src} alt={alt} onClick={e => e.stopPropagation()} /></div>
}

function MechanicSection() {
  const [profile, setProfile] = useState(null)
  const [builds, setBuilds] = useState([])
  const [displayBuilds, setDisplayBuilds] = useState([])
  const [displayCerts, setDisplayCerts] = useState([])
  const [shuffleTick, setShuffleTick] = useState(0)
  const [bookingEnabled, setBookingEnabled] = useState(null)
  useEffect(() => {
    api.get('/mechanic-profile').then(({ data }) => setProfile(data.profile)).catch(() => setProfile(null))
    api.get('/builds').then(({ data }) => { setBuilds(data.builds); setDisplayBuilds(data.builds) }).catch(() => {})
    api.get('/certifications').then(({ data }) => setDisplayCerts(data.certifications)).catch(() => {})
    const checkBookingStatus = () => api.get('/booking-status').then(({ data }) => setBookingEnabled(data.enabled)).catch(() => setBookingEnabled(null))
    checkBookingStatus()
    const timer = window.setInterval(checkBookingStatus, 30000)
    return () => window.clearInterval(timer)
  }, [])
  // Shuffle featured builds & certificates on an interval (configurable).
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced || !ANIMATION_CONFIG.shuffleEnabled) return undefined
    const shuffle = (list) => {
      const next = [...list]
      for (let i = next.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[next[i], next[j]] = [next[j], next[i]]
      }
      return next
    }
    const id = window.setInterval(() => {
      setDisplayBuilds(prev => (prev.length > 1 ? shuffle(prev) : prev))
      setDisplayCerts(prev => (prev.length > 1 ? shuffle(prev) : prev))
      setShuffleTick(tick => tick + 1)
    }, ANIMATION_CONFIG.shuffleIntervalMs)
    return () => window.clearInterval(id)
  }, [])
  return (
    <section className='mech-section' id='mechanic'>
      <div className='mech-col'>
        <span className='eyebrow'>Workshop profile</span>
        <h2 className='section-h2'>Meet the mechanic.</h2>
        {profile ? <>
          <div className='mech-bio-grid'>
            <div className='mech-photo-stack'>
              <img
                className='mech-portrait-image mech-portrait-primary'
                src={mechanicPortrait}
                alt={`${profile.full_name} — mechanic at Spoke & Wrench`}
                fetchPriority='high'
              />
              <img
                className='mech-portrait-image mech-portrait-hover'
                src={mechanicHoverPortrait}
                alt=''
                aria-hidden='true'
              />
            </div>
            <div className='mech-info'>
              <div className='mech-name-row'>
                <div><div className='mech-name'>{profile.full_name}</div><div className='mech-role'>{profile.role}</div></div>
                <div className={'mech-avail ' + (bookingEnabled === true ? 'is-open' : bookingEnabled === false ? 'is-paused' : 'is-checking')}><span className='mech-avail-dot' aria-hidden='true' /><span><strong>{bookingEnabled === true ? 'Accepting bookings' : bookingEnabled === false ? 'Bookings paused' : 'Checking availability'}</strong><small>{bookingEnabled === true ? 'New service requests are welcome' : bookingEnabled === false ? 'Please check back soon' : 'Availability updates automatically'}</small></span></div>
              </div>
              <p className='mech-bio-text'>{profile.bio}</p>
              {jsonArray(profile.highlights).length > 0 && <div className='mech-highlights'>{jsonArray(profile.highlights).map((highlight, index) => <div className='mech-hl' key={`${highlight.val}-${index}`}><div className='mech-hl-icon'>{highlight.iconImage ? <PortfolioImage src={mediaUrl(highlight.iconImage)} alt={`${highlight.val} icon`} /> : '⚙'}</div><strong className='mech-hl-val'>{highlight.val}</strong><span className='mech-hl-sub'>{highlight.sub}</span></div>)}</div>}
            </div>
          </div>
          {jsonArray(profile.expertise).length > 0 && <section className='mech-skills'><div className='mech-skills-heading'><div><div className='mech-block-h'>Skills &amp; specialties</div><p>Workshop expertise and services.</p></div><span>{jsonArray(profile.expertise).length} specialties</span></div><div className='mech-expertise-grid'>{jsonArray(profile.expertise).map((expertise, index) => <article className='mech-exp-card' key={`${expertise.area}-${index}`}>{expertise.image && <PortfolioImage className='expertise-photo' src={mediaUrl(expertise.image)} alt={expertise.area} />}<span className='mech-exp-index'>0{index + 1}</span><span className='mech-exp-area'>{expertise.area}</span><p className='mech-exp-detail'>{expertise.detail}</p></article>)}</div></section>}
        </> : <div className='mech-profile-notice'>
          <div className={'mech-avail ' + (bookingEnabled === true ? 'is-open' : bookingEnabled === false ? 'is-paused' : 'is-checking')}><span className='mech-avail-dot' aria-hidden='true' /><span><strong>{bookingEnabled === true ? 'Accepting bookings' : bookingEnabled === false ? 'Bookings paused' : 'Checking availability'}</strong><small>{bookingEnabled === true ? 'New service requests are welcome' : bookingEnabled === false ? 'Please check back soon' : 'Availability updates automatically'}</small></span></div>
          <p>Mechanic profile details are not configured yet.</p>
        </div>}
        <section className='mech-builds'>
          <div className='mech-builds-head'><div><h3 className='mech-block-h'>Featured bike builds</h3><p className='mech-builds-note'>Workshop builds published by the mechanic.</p></div><span className='mech-build-count'>{builds.length} {builds.length === 1 ? 'build' : 'builds'}</span></div>
          <div className='mech-bike-wrap' key={`builds-${shuffleTick}`}>{displayBuilds.map(build => <article className='mech-build-card' key={build.id}><div className='mech-build-image'><PortfolioImage className='mech-bike-img' src={mediaUrl(build.image_url)} alt={build.title} /></div><div className='mech-bike-details'><h4>{build.title}</h4><p>Owner: <strong>{build.owner_name}</strong></p>{build.social_url && <a className='mech-owner-link' href={build.social_url} target='_blank' rel='noreferrer'>View owner socials</a>}</div></article>)}{!displayBuilds.length && <p className='muted'>Featured builds will appear here when the mechanic publishes them.</p>}</div>
        </section>
        <div className='mech-creds'>
          {profile && <section><div className='mech-block-h'>Certifications</div><div className='cert-list' key={`certs-${shuffleTick}`}>{displayCerts.map(c => <CertificateCard key={c.id} certificate={c} />)}{!displayCerts.length && <p className='muted'>Certifications will appear here when published.</p>}</div></section>}
          {profile && <section><div className='mech-block-h'>Licences, registrations &amp; agreements</div><ul className='lic-list'>{[...jsonArray(profile.licences), ...jsonArray(profile.agreements)].map((licence, index) => <li className='lic-item' key={`${licence.title || licence}-${index}`}><span className='lic-dot' aria-hidden='true' />{typeof licence === 'string' ? licence : <>{licence.title}{licence.image && <PortfolioImage className='credential-photo' src={mediaUrl(licence.image)} alt={licence.title} />}</>}</li>)}</ul>{!jsonArray(profile.licences).length && !jsonArray(profile.agreements).length && <p className='muted'>No licences or agreements are listed.</p>}</section>}
        </div>
      </div>
    </section>
  )
}
function Testimonials() {
  const [reviews, setReviews] = useState([])
  const [summary, setSummary] = useState({ count: 0, average: 0 })
  const [error, setError] = useState('')
  useEffect(() => {
    api.get('/reviews').then(({ data }) => { setReviews(data.reviews); setSummary(data.summary) }).catch(err => setError(err.response?.data?.error || 'Customer reviews are temporarily unavailable.'))
  }, [])
  const average = Number(summary.average || 0)
  return (
    <section className="testi-section">
      <div className="testi-col">
        <div className="testi-hd"><div><span className="eyebrow">Feedback from completed repairs</span><h2 className="section-h2">Rider <mark>reviews.</mark></h2></div>
          <div className="rating-block"><span className="rating-num">{Number(summary.count) ? average.toFixed(1) : "--"}</span><span className="rating-stars" aria-label={Number(summary.count) ? average.toFixed(1) + " out of 5 stars" : "No ratings yet"}>{Number(summary.count) ? String.fromCharCode(9733).repeat(Math.round(average)) : String.fromCharCode(9734).repeat(5)}</span><p className="rating-label">{Number(summary.count) ? summary.count + " verified reviews" : "No customer ratings yet"}</p></div>
        </div>
        {error && <p className="reviews-empty">{error}</p>}
        {!error && !reviews.length ? <p className="reviews-empty">Customer comments and ratings will appear here after completed repairs.</p> : <div className="testi-grid">{reviews.map(review => <article className="testi-card" key={review.id}><div className="testi-stars" aria-label={review.rating + " stars"}>{String.fromCharCode(9733).repeat(Number(review.rating))}{String.fromCharCode(9734).repeat(5 - Number(review.rating))}</div><blockquote className="testi-quote">{review.comment}</blockquote><footer className="testi-footer"><div className="testi-av" aria-hidden="true">{review.is_anonymous ? "A" : (review.display_name || "R").slice(0, 1).toUpperCase()}</div><div><strong className="testi-name">{review.display_name}</strong><span className="testi-ride">{review.service_name}</span><span className="testi-svc">Completed {new Date(review.created_at).toLocaleDateString()}</span></div></footer></article>)}</div>}
      </div>
    </section>
  )
}

function HeroServicePreview() {
  const [services, setServices] = useState([])
  useEffect(() => {
    api.get('/services')
      .then(({ data }) => setServices((data.services || []).slice(0, 4)))
      .catch(() => setServices([]))
  }, [])
  if (!services.length) return <p className="hero-service-empty">Explore workshop services for current options and pricing.</p>
  return services.map(service => (
    <div className="hero-svc-row" key={service.id}>
      <span className="hero-svc-name">{service.name}</span>
      <span className="hero-svc-price">From {money(service.starting_price)}</span>
    </div>
  ))
}

function Home() {
  return (
    <>
      <main>
        {/* Hero */}
        <section className="hero">
          <div className="hero-inner">
            <div className="hero-copy">
              <div className="hero-pill">
                <span className="hero-pill-dot" aria-hidden="true" />
                Independent bicycle workshop · {CITY}
              </div>
              <h1 className="hero-h1">
                Ride more.<br /><mark>Worry less.</mark>
              </h1>
              <p className="hero-sub">
                Careful, honest bicycle service for {CITY} riders.
                Thoughtful repairs, clear estimates, and updates at every step.
              </p>
              <div className="hero-actions">
                <Link className="btn btn-primary btn-lg" to="/book">Book a service</Link>
                <Link className="btn btn-outline btn-lg" to="/services">See what we do</Link>
              </div>
              <div className="hero-proof">
                <span className="hero-proof-mark" aria-hidden="true">✓</span>
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
                  <span className="hero-card-badge">Workshop services</span>
                </div>
                <HeroServicePreview />
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
function ServicesPage() {
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
function AuthPage({ mode, onSignedIn }) {
  const navigate  = useNavigate()
  const location  = useLocation()
  const isReg     = mode === 'register'
  const [error, setError] = useState('')
  const [busy, setBusy]   = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  async function submit(e) {
    e.preventDefault(); setError(''); setBusy(true)
    const f = new FormData(e.currentTarget)
    try {
      if (isReg) await api.post('/auth/register', {
        fullName: f.get('fullName'), email: f.get('email'), password: f.get('password'),
      })
      const { data } = await api.post('/auth/login', { email: f.get('email'), password: f.get('password') })
      onSignedIn(data.user)
      navigate(location.state?.from || (data.user.role === 'admin' ? '/admin' : '/account'))
    } catch (err) {
      setError(err.response?.data?.error || 'Could not connect. Check that the API and database are running.')
    } finally { setBusy(false) }
  }

  return (
    <>
      <main>
        <div className="auth-layout">
          <aside className="auth-side">
            <span className="eyebrow">{isReg ? 'New to the workshop' : 'Welcome back'}</span>
            <h2>Every repair starts with a good conversation.</h2>
            <p>{isReg
              ? 'Create an account to request a service and keep all your booking updates in one place.'
              : 'Sign in to review your bookings, see repair updates, and stay in touch with the workshop.'}</p>
            <div className="auth-side-note">
              {isReg ? <>Your account is private.<br />Only you and the mechanic see your booking details.</>
                : <>Need a new account?<br />You can create one with your email address.</>}
            </div>
          </aside>

          <div className="auth-form-side">
            <span className="eyebrow">{isReg ? 'Create account' : 'Sign in'}</span>
            <h1>{isReg ? 'Join the workshop.' : 'Sign in to continue.'}</h1>
            <p>{isReg ? 'A few details, then tell us about your bike.' : 'Access your bookings and repair updates.'}</p>
            <div className="stage"><div className="form-card" aria-busy={busy}>
              <form onSubmit={submit}>
                {isReg && (
                  <div className="field">
                    <label className="field-label" htmlFor="fullName">Your name</label>
                    <input id="fullName" name="fullName" autoComplete="name" minLength={2} maxLength={120} required />
                  </div>
                )}
                <div className="field">
                  <label className="field-label" htmlFor="email">Email address</label>
                  <input id="email" name="email" type="email" autoComplete="email" maxLength={254} required />
                </div>
                <div className="field">
                  <label className="field-label" htmlFor="password">Password</label>
                  <div className="password-control">
                    <input className="auth-password-input" id="password" name="password" type={showPassword ? 'text' : 'password'}
                      autoComplete={isReg ? 'new-password' : 'current-password'}
                      minLength={isReg ? 10 : undefined} maxLength={72} required />
                    <button className="password-eye auth-password-toggle" type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} onClick={() => setShowPassword(value => !value)}>{showPassword ? 'Hide' : 'Show'}</button>
                  </div>
                  {isReg && <span className="field-hint">Use 10 to 72 characters. You can show the password to check what you typed.</span>}
                </div>
                {error && <div className="msg msg-error" role="alert">{error}</div>}
                <div className="form-footer">
                  <button className="btn btn-primary btn-full" disabled={busy}>
                    {busy ? 'Please wait…' : isReg ? 'Create account' : 'Sign in'}
                  </button>
                </div>
              </form>
            </div></div>
            <p className="auth-switch">
              {isReg ? 'Already have an account? ' : 'New to the workshop? '}
              <Link to={isReg ? '/login' : '/register'}>{isReg ? 'Sign in' : 'Create an account'}</Link>
              {!isReg && <> · <Link to="/forgot-password">Forgot password?</Link></>}
            </p>
          </div>
        </div>
      </main>
      <Footer />
    </>
  )
}

function ForgotPasswordPage() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)

  async function submit(event) {
    event.preventDefault()
    const form = event.currentTarget
    setBusy(true); setError(''); setResult(null)
    const email = new FormData(form).get('email')
    try {
      const { data } = await api.post('/auth/forgot-password', { email })
      setResult(data)
      form.reset()
    } catch (err) {
      setError(err.response?.data?.error || 'Could not request a password reset.')
    } finally { setBusy(false) }
  }

  return <RecoveryPage title="Reset your password" eyebrow="Account recovery" intro="Enter the email address on your account. We’ll show a generic confirmation so account details stay private." sideNote="Password reset links expire after 30 minutes. Email delivery can be configured by the workshop later.">
    <span className="eyebrow">Forgot password</span>
    <h1>Get a reset link.</h1>
    <p>Use the email address associated with your account.</p>
    <div className="stage"><div className="form-card" aria-busy={busy}>
      <form onSubmit={submit}>
        <label className="field-label" htmlFor="reset-email">Email address<input id="reset-email" name="email" type="email" autoComplete="email" maxLength={254} required /></label>
        {error && <div className="msg msg-error" role="alert">{error}</div>}
        {result && <div className="msg msg-success" role="status">{result.message} {!result.resetUrl && 'Email delivery is not configured yet; ask the workshop to provide the reset link.'}</div>}
        {result?.resetUrl && <p className="field-hint">Development reset link: <a className="text-link" href={result.resetUrl}>Open password reset</a></p>}
        <div className="form-footer"><button className="btn btn-primary btn-full" disabled={busy}>{busy ? 'Please wait…' : 'Request reset link'}</button></div>
      </form>
    </div></div>
    <p className="auth-switch"><Link to="/login">Back to sign in</Link></p>
  </RecoveryPage>
}

function ResetPasswordPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const token = searchParams.get('token') || ''
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  async function submit(event) {
    event.preventDefault()
    const form = event.currentTarget
    setError(''); setSuccess(false)
    const values = Object.fromEntries(new FormData(form))
    if (values.password !== values.confirmPassword) return setError('Passwords do not match.')
    if (new TextEncoder().encode(values.password).length > 72) return setError('Password must be no more than 72 UTF-8 bytes.')
    setBusy(true)
    try {
      await api.post('/auth/reset-password', { token, password: values.password })
      setSuccess(true)
      form.reset()
      window.setTimeout(() => navigate('/login', { replace: true }), 1800)
    } catch (err) {
      setError(err.response?.data?.error || 'Could not reset your password. Request a new link and try again.')
    } finally { setBusy(false) }
  }

  return <RecoveryPage title="Choose a new password" eyebrow="Account recovery" intro="Set a new password for your workshop account." sideNote="Choose at least 10 characters. Reset links can only be used once.">
    <span className="eyebrow">Choose a new password</span>
    <h1>Make it a strong one.</h1>
    <p>This reset link is valid for one use and expires after 30 minutes.</p>
    <div className="stage"><div className="form-card" aria-busy={busy}>
      <form onSubmit={submit}>
        <label className="field-label" htmlFor="new-password">New password<input id="new-password" name="password" type="password" autoComplete="new-password" minLength={10} maxLength={72} required /></label>
        <label className="field-label" htmlFor="confirm-password">Confirm password<input id="confirm-password" name="confirmPassword" type="password" autoComplete="new-password" minLength={10} maxLength={72} required /></label>
        {error && <div className="msg msg-error" role="alert">{error}</div>}
        {success && <div className="msg msg-success" role="status">Password updated. Redirecting to sign in…</div>}
        {!token && <div className="msg msg-error" role="alert">This reset link is missing its token. Request a new one.</div>}
        <div className="form-footer"><button className="btn btn-primary btn-full" disabled={busy || !token || success}>{busy ? 'Updating…' : 'Update password'}</button></div>
      </form>
    </div></div>
    <p className="auth-switch"><Link to="/forgot-password">Request another reset link</Link></p>
  </RecoveryPage>
}

function RecoveryPage({ title, eyebrow, intro, sideNote, children }) {
  return <>
    <main><div className="auth-layout">
      <aside className="auth-side"><span className="eyebrow">{eyebrow}</span><h2>{title}.</h2><p>{intro}</p><div className="auth-side-note">{sideNote}</div></aside>
      <div className="auth-form-side">{children}</div>
    </div></main>
    <Footer />
  </>
}

/* ── Route guard ──────────────────────────────────────────── */
function Guard({ user, role, children }) {
  const loc = useLocation()
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />
  if (role && user.role !== role) return <Navigate to={user.role === 'admin' ? '/admin' : '/account'} replace />
  return children
}

/* ── Booking page ─────────────────────────────────────────── */
function BookingPage({ user }) {
  const [services, setServices] = useState([])
  const [bicycles, setBicycles] = useState([])
  const [bikes, setBikes] = useState([newBookingBike()])
  const [paymentChoice, setPaymentChoice] = useState('together')
  const [error, setError]   = useState('')
  const [success, setSuccess] = useState('')
  const [busy, setBusy]     = useState(false)

  useEffect(() => {
    Promise.all([api.get('/services'), api.get('/bicycles')])
      .then(([serviceResult, bicycleResult]) => {
        setServices(serviceResult.data.services)
        setBicycles(bicycleResult.data.bicycles)
      })
      .catch(() => setError('Could not load services or your bicycles. Check that the API and database are running.'))
  }, [])

  function updateBike(key, changes) {
    setBikes(current => current.map(bike => bike.key === key ? {
      ...bike,
      ...changes,
      ...(changes.serviceIds ? { preferredAt: '' } : {}),
    } : bike))
  }

  async function submit(e) {
    e.preventDefault(); setError(''); setBusy(true)
    let createdGroupRef = ''
    try {
      for (const bike of bikes) {
        if (!bike.serviceIds.length) throw new Error('Choose at least one service for every bicycle.')
        if (!bike.preferredAt) throw new Error('Choose an available drop-off time for every bicycle.')
        if (bike.photos.length > 3) throw new Error('Choose no more than three photos for each bicycle.')
        if (bike.photos.some(photo => photo.size > 10 * 1024 * 1024)) throw new Error('Each bicycle photo must be 10 MB or smaller.')
      }
      const { data } = await api.post('/booking-groups', {
        paymentChoice,
        bikes: bikes.map(bike => ({
          bicycleId: bike.bicycleId || null,
          bicycleType: bike.bicycleType,
          brand: bike.brand,
          model: bike.model,
          serviceIds: bike.serviceIds.map(Number),
          problem: bike.problem,
          preferredAt: bike.preferredAt,
        })),
      })
      createdGroupRef = data.group.groupRef
      for (let index = 0; index < bikes.length; index += 1) {
        const booking = data.bookings[index]
        for (const photo of bikes[index].photos) {
          await api.post(`/bookings/${booking.id}/photos`, { photoData: await fileAsDataUrl(photo) })
        }
      }
      setSuccess(`Request group ${data.group.groupRef} for ${data.bookings.length} bicycle${data.bookings.length === 1 ? '' : 's'} submitted — the mechanic will be in touch.`)
      setBikes([newBookingBike()])
    } catch (err) {
      const message = err.response?.data?.error || err.message || 'Could not submit booking. Please try again.'
      setError(createdGroupRef
        ? `Request group ${createdGroupRef} was created, but an upload did not finish. You can add missing photos from your bookings page. ${message}`
        : message)
    } finally { setBusy(false) }
  }

  return (
    <>
      <div className="page-banner">
        <div className="page-banner-col">
          <span className="eyebrow">Booking request · {user.fullName}</span>
          <h1 className="page-h1">Book service for your bicycles.</h1>
          <p className="page-lead">
            Add one or more bicycles. Each bicycle has its own services, drop-off time, and photos.
          </p>
        </div>
      </div>
      <main className="page-body col-narrow">
        <div className="stage"><div className="form-card">
          <form onSubmit={submit}>
            {bikes.map((bike, index) => {
              const estimate = services.filter(service => bike.serviceIds.includes(String(service.id)))
                .reduce((sum, service) => sum + Number(service.starting_price || 0), 0)
              const registeredBike = bicycles.find(item => String(item.id) === bike.bicycleId)
              return <section className="booking-bike-form" key={bike.key} aria-labelledby={`bike-heading-${bike.key}`}>
                <div className="service-picker-heading">
                  <h2 id={`bike-heading-${bike.key}`} className="field-label">Bicycle {index + 1}</h2>
                  {bikes.length > 1 && <button className="btn btn-danger btn-sm" type="button" onClick={() => setBikes(current => current.filter(item => item.key !== bike.key))}>Remove</button>}
                </div>
                <div className="field">
                  <label className="field-label" htmlFor={`saved-bike-${bike.key}`}>Choose a saved bicycle <span className="field-opt">Optional</span></label>
                  <select id={`saved-bike-${bike.key}`} value={bike.bicycleId} onChange={event => {
                    const selected = bicycles.find(item => String(item.id) === event.target.value)
                    updateBike(bike.key, selected
                      ? { bicycleId: String(selected.id), bicycleType: selected.category, brand: selected.brand || '', model: selected.model || '' }
                      : { bicycleId: '', bicycleType: '', brand: '', model: '' })
                  }}>
                    <option value="">Enter bicycle details</option>
                    {bicycles.map(item => <option value={item.id} key={item.id}>{[item.category, item.brand, item.model].filter(Boolean).join(' · ')}</option>)}
                  </select>
                </div>
                <div className="field-row">
                  <div className="field"><label className="field-label">Bicycle type<select value={bike.bicycleType} onChange={event => updateBike(bike.key, { bicycleType: event.target.value })} required disabled={Boolean(registeredBike)}><option value="" disabled>Choose a category</option>{BIKE_CATEGORIES.map(category => <option value={category} key={category}>{category}</option>)}</select></label></div>
                  <div className="field"><label className="field-label">Brand<input value={bike.brand} onChange={event => updateBike(bike.key, { brand: event.target.value })} maxLength={100} disabled={Boolean(registeredBike)} /></label></div>
                  <div className="field"><label className="field-label">Model<input value={bike.model} onChange={event => updateBike(bike.key, { model: event.target.value })} maxLength={100} disabled={Boolean(registeredBike)} /></label></div>
                </div>
                <div className="field">
                  <span className="field-label">Services for this bicycle</span>
                  <div className="service-choice-grid">
                    {services.map(service => {
                      const selected = bike.serviceIds.includes(String(service.id))
                      return <label className={"service-choice " + (selected ? "is-selected" : "")} key={service.id}>
                        <input type="checkbox" checked={selected} onChange={event => updateBike(bike.key, { serviceIds: event.target.checked ? [...bike.serviceIds, String(service.id)] : bike.serviceIds.filter(id => id !== String(service.id)) })} />
                        <span className="service-choice-copy"><strong>{service.name}</strong><small>{service.description}</small></span>
                        <span className="service-choice-price">From {money(service.starting_price)}</span>
                      </label>
                    })}
                  </div>
                  {estimate > 0 && <p className="service-selection-total">Starting estimate: <strong>{money(estimate)}</strong></p>}
                </div>
                <div className="field"><label className="field-label">What's happening with this bike?<textarea value={bike.problem} onChange={event => updateBike(bike.key, { problem: event.target.value })} rows={3} minLength={8} maxLength={2000} required placeholder="Describe the issue, sounds, or anything unusual" /></label></div>
                <BookingTimePicker bike={bike} updateBike={updateBike} />
                <div className="field"><label className="field-label">Bicycle photos <span className="field-opt">Optional · up to 3 photos, 10 MB each</span><input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={event => updateBike(bike.key, { photos: Array.from(event.target.files || []) })} /></label>{bike.photos.length > 0 && <span className="field-hint">{bike.photos.length} photo(s) selected{bike.photos.length > 3 ? ' — choose no more than three' : ''}</span>}</div>
              </section>
            })}
            <button className="btn btn-outline btn-sm booking-add-bike" type="button" onClick={() => setBikes(current => [...current, newBookingBike()])} disabled={bikes.length >= 10}>Add another bicycle</button>
            <section className="field service-picker" aria-labelledby="payment-choice-heading">
              <h2 id="payment-choice-heading" className="field-label">How would you like to pay?</h2>
              <label className="service-choice"><input type="radio" name="paymentChoice" value="together" checked={paymentChoice === 'together'} onChange={() => setPaymentChoice('together')} /><span className="service-choice-copy"><strong>Pay for all bicycles together</strong><small>One payment submission is available once every bicycle is approved.</small></span></label>
              <label className="service-choice"><input type="radio" name="paymentChoice" value="separate" checked={paymentChoice === 'separate'} onChange={() => setPaymentChoice('separate')} /><span className="service-choice-copy"><strong>Pay separately</strong><small>Submit a payment for each bicycle independently.</small></span></label>
            </section>
            {error   && <div className="msg msg-error"   role="alert">{error}</div>}
            {success && (
              <div className="msg msg-success" role="status">
                {success}{' '}
                <Link className="text-link" to="/account">View bookings →</Link>
              </div>
            )}
            <div className="form-footer">
              <button className="btn btn-primary btn-full" disabled={busy || !services.length || bikes.some(bike => !bike.serviceIds.length)}>
                {busy ? 'Sending requests…' : 'Submit booking group'}
              </button>
              <p className="form-reassure">Each bicycle is reviewed and scheduled separately. No payment is needed to submit the request.</p>
            </div>
          </form>
        </div></div>
      </main>
      <Footer />
    </>
  )
}

function newBookingBike() {
  return { key: `${Date.now()}-${Math.random()}`, bicycleId: '', bicycleType: '', brand: '', model: '', serviceIds: [], problem: '', preferredDate: workshopDateKey(), preferredAt: '', photos: [] }
}

function BookingTimePicker({ bike, updateBike }) {
  const [slots, setSlots] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const date = bike.preferredDate || workshopDateKey()
  const serviceIds = bike.serviceIds.join(',')

  useEffect(() => {
    let active = true
    setSlots([])
    setError('')
    if (!date || !serviceIds) {
      setLoading(false)
      return () => { active = false }
    }

    setLoading(true)
    const params = { date }
    const ids = serviceIds.split(',')
    if (ids.length === 1) params.serviceId = ids[0]
    else params.serviceIds = serviceIds
    api.get('/availability', { params })
      .then(({ data }) => {
        if (!active) return
        setSlots(data.slots || [])
        if (!data.slots?.length) setError(data.reason || 'No available drop-off times for this date and service selection.')
      })
      .catch(err => {
        if (active) setError(err.response?.data?.error || 'Could not load available drop-off times.')
      })
      .finally(() => { if (active) setLoading(false) })

    return () => { active = false }
  }, [date, serviceIds])

  return <div className="field availability-picker">
    <span className="field-label">Preferred drop-off</span>
    <div className="field-row">
      <label className="field-label">
        Date
        <input
          type="date"
          min={workshopDateKey()}
          value={date}
          required
          onChange={event => updateBike(bike.key, { preferredDate: event.target.value, preferredAt: '' })}
        />
      </label>
      <label className="field-label">
        Available time
        <select
          value={bike.preferredAt}
          required
          disabled={loading || !serviceIds || !slots.length}
          onChange={event => updateBike(bike.key, { preferredAt: event.target.value })}
        >
          <option value="">{loading ? 'Checking availability…' : serviceIds ? 'Choose an available time' : 'Choose services first'}</option>
          {slots.map(slot => <option key={slot.startsAt} value={slot.startsAt}>{workshopTimeLabel(slot.startsAt)}</option>)}
        </select>
      </label>
    </div>
    <span className="field-hint" aria-live="polite">
      Times are shown in the workshop’s Asia/Manila time zone.
      {error ? ` ${error}` : loading ? ' Checking slots…' : slots.length ? ` ${slots.length} time${slots.length === 1 ? '' : 's'} available.` : ''}
    </span>
  </div>
}

/* ── Account page ─────────────────────────────────────────── */
function ReviewForm({ booking, onSubmitted }) {
  const [rating, setRating] = useState(0)
  const [comment, setComment] = useState('')
  const [anonymous, setAnonymous] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(event) {
    event.preventDefault(); setError(''); setBusy(true)
    try {
      await api.post(`/bookings/${booking.id}/review`, { rating, comment, anonymous })
      onSubmitted({ rating, comment, anonymous })
    } catch (err) { setError(err.response?.data?.error || 'Could not submit your review.') }
    finally { setBusy(false) }
  }
  return <form className="customer-review-form" onSubmit={submit}>
    <div><strong>How was this repair?</strong><span className="review-eligibility">Share a rating and comment for this completed booking.</span></div>
    <div className="review-rating" role="group" aria-label="Choose a star rating">{[1, 2, 3, 4, 5].map(star => <button key={star} type="button" className={star <= rating ? 'selected' : ''} aria-label={`${star} star${star === 1 ? '' : 's'}`} aria-pressed={rating === star} onClick={() => setRating(star)}>{String.fromCharCode(9733)}</button>)}</div>
    <label className="field-label" htmlFor={`review-${booking.id}`}>Your comment<textarea id={`review-${booking.id}`} value={comment} onChange={event => setComment(event.target.value)} minLength={3} maxLength={1500} rows={3} required placeholder="Tell other riders about the repair you received." /></label>
    <label className="review-anonymous"><input type="checkbox" checked={anonymous} onChange={event => setAnonymous(event.target.checked)} /> Post this review anonymously</label>
    {error && <div className="msg msg-error" role="alert">{error}</div>}
    <button className="btn btn-primary btn-sm" disabled={busy || rating < 1}>{busy ? 'Posting review...' : 'Post review'}</button>
  </form>
}

function AccountPage({ user }) {
  const [bookings, setBookings] = useState([])
  const [payments, setPayments] = useState([])
  const [paymentError, setPaymentError] = useState('')
  const [error, setError]       = useState('')

  async function loadBookings() {
    const [bookingResult, paymentResult] = await Promise.allSettled([
      api.get('/bookings/mine'),
      api.get('/customers/me/payments'),
    ])
    if (bookingResult.status === 'fulfilled') {
      setBookings(bookingResult.value.data.bookings)
      setError('')
    } else {
      setError(bookingResult.reason.response?.data?.error || 'Could not load bookings.')
    }
    if (paymentResult.status === 'fulfilled') {
      setPayments(paymentResult.value.data.payments)
      setPaymentError('')
    } else {
      setPaymentError(paymentResult.reason.response?.data?.error || 'Could not load payment history.')
    }
  }

  useEffect(() => {
    loadBookings()
  }, [])

  return (
    <>
      <div className="page-banner">
        <div className="page-banner-col">
          <span className="eyebrow">Customer account</span>
          <h1 className="page-h1">Your bookings.</h1>
          <p className="page-lead">Welcome back, {user.fullName}. Here are your requests and repair updates.</p>
        </div>
      </div>
      <main className="page-body">
        <div className="dash-hd">
          <div />
          <Link className="btn btn-primary" to="/book">New booking</Link>
        </div>
        {error && <div className="msg msg-error">{error}</div>}
        {!bookings.length && !error ? (
          <div className="empty">
            <div className="empty-icon">↗</div>
            <h2>Your next ride starts here.</h2>
            <p>You haven't sent a booking request yet.</p>
            <Link className="btn btn-primary" to="/book">Request a service</Link>
          </div>
        ) : (
          <div className="booking-list">
            {bookings.map((item, index) => {
              const payment = payments.find(record => String(record.booking_id) === String(item.id))
              return (
                <article className="booking-card" key={item.id}>
                <div>
                  <div className="booking-ref">{item.booking_ref} · {item.service_name}</div>
                  {item.group_ref && <div className="booking-ref">Request group {item.group_ref} · {item.payment_choice === 'together' ? 'pay together' : 'pay separately'}</div>}
                  <h3>{item.bicycle_type}{item.bicycle_brand ? ` · ${item.bicycle_brand}` : ''}</h3>
                  <p>{item.problem_description}</p>
                  {item.customer_response && <div className="booking-next-step"><strong>Your response</strong><p>{item.customer_response}</p></div>}
                </div>
                <div className="booking-meta">
                  <span className={`status status-${item.status}`}>{item.status.replaceAll('_', ' ')}</span>
                  <span className="booking-time">{dt(item.scheduled_at || item.preferred_at)}</span>
                </div>
                {(item.status === 'pending_review' || Number(item.photo_count) > 0) && <BookingPhotos booking={item} allowUpload={item.status === 'pending_review'} />}
                {item.booking_group_id && item.payment_choice === 'together'
                  && bookings.findIndex(booking => booking.booking_group_id === item.booking_group_id) === index
                  && <GroupBookingPayment bookings={bookings.filter(booking => booking.booking_group_id === item.booking_group_id)} paymentRecords={payments} onUpdated={loadBookings} />}
                {item.status === 'awaiting_customer_response' && <BookingQuestionReply booking={item} onUpdated={loadBookings} />}
                {item.status === 'awaiting_customer' && item.pending_reschedule_id && <BookingRescheduleResponse booking={item} onUpdated={loadBookings} />}
                {(!item.booking_group_id || item.payment_choice !== 'together')
                  && ['awaiting_payment', 'payment_submitted', 'payment_rejected', 'confirmed', 'in_progress', 'completed'].includes(item.status) && (
                  <BookingPayment booking={item} payment={payment} onUpdated={loadBookings} />
                )}
                <BookingCancellation booking={item} onUpdated={loadBookings} />
                <CustomerRepairPanel booking={item} />
                {item.status === 'completed' && (item.review_id ? <div className="review-complete"><strong>Review submitted</strong><span>{'★'.repeat(Number(item.review_rating || 0))} · {item.review_is_anonymous ? 'Posted anonymously' : 'Posted by you'}</span><p>{item.review_comment}</p></div> : <ReviewForm booking={item} onSubmitted={({ rating, comment, anonymous }) => setBookings(current => current.map(booking => booking.id === item.id ? { ...booking, review_id: `local-${item.id}`, review_rating: rating, review_comment: comment, review_is_anonymous: anonymous } : booking))} />)}
                </article>
              )
            })}
          </div>
        )}
        {paymentError && <div className="msg msg-error" role="alert">{paymentError}</div>}
      </main>
      <Footer />
    </>
  )
}

function BookingCancellation({ booking, onUpdated }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const proofPending = booking.status === 'payment_submitted' || booking.group_payment_status === 'submitted'
  const canCancel = ['pending_review', 'awaiting_customer_response', 'awaiting_customer', 'awaiting_payment', 'payment_rejected', 'confirmed'].includes(booking.status)

  if (proofPending) return <p className="cancellation-blocked" role="status">Cancellation is unavailable while payment proof is awaiting verification.</p>
  if (!canCancel) return null

  async function cancel() {
    if (!window.confirm('Cancel this bicycle booking?')) return
    setBusy(true); setError('')
    try {
      await api.patch(`/bookings/${booking.id}/cancel`)
      await onUpdated()
    } catch (err) {
      setError(err.response?.data?.error || 'Could not cancel this booking.')
    } finally { setBusy(false) }
  }

  return <div className="booking-cancel-action">
    <button className="btn btn-danger btn-sm" type="button" disabled={busy} onClick={cancel}>{busy ? 'Cancelling…' : 'Cancel booking'}</button>
    {error && <span className="field-hint" role="alert">{error}</span>}
  </div>
}

function BookingQuestionReply({ booking, onUpdated }) {
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function submit(event) {
    event.preventDefault()
    setBusy(true); setError(''); setNotice('')
    try {
      await api.patch(`/bookings/${booking.id}/respond`, { message })
      setNotice('Your response was sent to the mechanic.')
      setMessage('')
      await onUpdated()
    } catch (err) {
      setError(err.response?.data?.error || 'Could not send your response.')
    } finally { setBusy(false) }
  }

  return <form className="booking-next-step booking-response-form" onSubmit={submit}>
    <strong>Question from the mechanic</strong>
    <p>{booking.admin_note || 'The mechanic has a question about this booking.'}</p>
    <label className="field-label">Your reply<textarea value={message} onChange={event => setMessage(event.target.value)} minLength={3} maxLength={1000} rows={3} required /></label>
    {error && <span className="field-hint" role="alert">{error}</span>}
    {notice && <span className="field-hint" role="status">{notice}</span>}
    <button className="btn btn-primary btn-sm" disabled={busy}>{busy ? 'Sending…' : 'Send reply'}</button>
  </form>
}

function BookingRescheduleResponse({ booking, onUpdated }) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function respond(decision) {
    setBusy(true); setError(''); setNotice('')
    try {
      await api.patch(`/bookings/${booking.id}/reschedules/${booking.pending_reschedule_id}`, { decision, note })
      setNotice(`Proposed appointment ${decision}.`)
      await onUpdated()
    } catch (err) {
      setError(err.response?.data?.error || 'Could not respond to the proposed appointment.')
    } finally { setBusy(false) }
  }

  return <section className="booking-next-step booking-response-form">
    <strong>Proposed appointment change</strong>
    <p>{dt(booking.proposed_reschedule_at)}</p>
    {booking.admin_note && <p>{booking.admin_note}</p>}
    <label className="field-label">Note to mechanic <span className="field-opt">Optional</span><textarea value={note} onChange={event => setNote(event.target.value)} maxLength={1000} rows={2} /></label>
    {error && <span className="field-hint" role="alert">{error}</span>}
    {notice && <span className="field-hint" role="status">{notice}</span>}
    <div className="modal-actions">
      <button className="btn btn-primary btn-sm" type="button" disabled={busy} onClick={() => respond('accepted')}>{busy ? 'Sending…' : 'Accept new time'}</button>
      <button className="btn btn-outline btn-sm" type="button" disabled={busy} onClick={() => respond('declined')}>Decline new time</button>
    </div>
  </section>
}

function CustomerRepairPanel({ booking }) {
  const [repair, setRepair] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [refresh, setRefresh] = useState(0)

  useEffect(() => {
    if (!['in_progress', 'completed'].includes(booking.status)) return undefined
    let active = true
    api.get(`/repairs/${booking.id}`)
      .then(({ data }) => { if (active) { setRepair(data.repair); setError('') } })
      .catch(err => {
        if (!active) return
        if (err.response?.status === 404) setRepair(null)
        else setError(err.response?.data?.error || 'Could not load repair progress.')
      })
    return () => { active = false }
  }, [booking.id, booking.status, refresh])

  async function decide(decision) {
    setBusy(true); setError(''); setNotice('')
    try {
      await api.patch(`/repairs/${repair.id}/estimate`, { decision })
      setNotice(decision === 'approved' ? 'Estimate approved. The mechanic can continue the repair.' : 'Estimate declined. The mechanic may send a revised estimate for your approval.')
      setRefresh(value => value + 1)
    } catch (err) {
      setError(err.response?.data?.error || 'Could not submit your estimate decision.')
    } finally { setBusy(false) }
  }

  if (!['in_progress', 'completed'].includes(booking.status) || (!repair && !error)) return null
  return <section className="customer-repair-panel">
    <h4>Repair progress</h4>
    {repair && <>
      <p>Status: <strong>{label(repair.status)}</strong></p>
      {repair.inspection_notes && <p><strong>Inspection:</strong> {repair.inspection_notes}</p>}
      {repair.estimate_amount !== null && <p><strong>Current estimate:</strong> {money(repair.estimate_amount)} · {label(repair.estimate_status)}</p>}
      {repair.estimate_status === 'pending' && repair.status === 'awaiting_customer_approval' && <div className="repair-customer-actions">
        <p>Work is on hold until you approve this estimate.</p>
        <button className="btn btn-primary btn-sm" type="button" disabled={busy} onClick={() => decide('approved')}>Approve estimate</button>
        <button className="btn btn-danger btn-sm" type="button" disabled={busy} onClick={() => decide('declined')}>Decline estimate</button>
      </div>}
      {repair.final_amount !== null && <p><strong>Final amount:</strong> {money(repair.final_amount)}</p>}
      {repair.completion_notes && <p><strong>Completion notes:</strong> {repair.completion_notes}</p>}
      {repair.warranty_until && <p><strong>Warranty until:</strong> {new Date(`${repair.warranty_until}T00:00:00`).toLocaleDateString()}</p>}
    </>}
    {error && <div className="msg msg-error" role="alert">{error}</div>}
    {notice && <div className="msg msg-success" role="status">{notice}</div>}
  </section>
}

function BookingPhotos({ booking, allowUpload = false }) {
  const [photos, setPhotos] = useState([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  useEffect(() => {
    let active = true
    const urls = []
    async function load() {
      try {
        const { data } = await api.get(`/bookings/${booking.id}/photos`)
        const loaded = await Promise.all(data.photos.map(async photo => {
          const result = await api.get(`/booking-photos/${photo.id}`, { responseType: 'blob' })
          const url = URL.createObjectURL(result.data)
          urls.push(url)
          return { id: photo.id, url }
        }))
        if (active) setPhotos(loaded)
        else urls.forEach(url => URL.revokeObjectURL(url))
      } catch {
        if (active) setError('Could not load bicycle photos.')
      }
    }
    load()
    return () => { active = false; urls.forEach(url => URL.revokeObjectURL(url)) }
  }, [booking.id, refreshKey])

  async function upload(event) {
    event.preventDefault()
    const form = event.currentTarget
    const files = Array.from(form.elements.photos.files || [])
    if (!files.length) return
    setBusy(true); setError('')
    let uploadedCount = 0
    try {
      if (files.length > 3 - photos.length) throw new Error(`You can add up to ${3 - photos.length} more photo(s).`)
      for (const file of files) {
        if (file.size > 10 * 1024 * 1024) throw new Error('Each bicycle photo must be 10 MB or smaller.')
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Choose JPEG, PNG, or WebP photos.')
        await api.post(`/bookings/${booking.id}/photos`, { photoData: await fileAsDataUrl(file) })
        uploadedCount += 1
      }
      form.reset()
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Could not upload bicycle photos.')
    } finally {
      if (uploadedCount > 0) setRefreshKey(value => value + 1)
      setBusy(false)
    }
  }

  if (!photos.length && !allowUpload && !error) return null
  return <>
    {photos.length > 0 && <div className="booking-photo-list" aria-label="Bicycle photos">{photos.map((photo, index) => <PortfolioImage key={photo.id} className="thumb" src={photo.url} alt={`Bicycle photo ${index + 1}`} />)}</div>}
    {allowUpload && photos.length < 3 && <form className="booking-photo-upload" onSubmit={upload}>
      <label className="field-label">Add bicycle photos (up to {3 - photos.length} more, 10 MB each)<input name="photos" type="file" accept="image/jpeg,image/png,image/webp" multiple required /></label>
      <button className="btn btn-outline btn-sm" type="submit" disabled={busy}>{busy ? 'Uploading…' : 'Upload photos'}</button>
    </form>}
    {error && <p className="field-hint" role="alert">{error}</p>}
  </>
}

function GroupBookingPayment({ bookings, paymentRecords, onUpdated }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const groupId = bookings[0].booking_group_id
  const groupStatus = bookings[0].group_payment_status
  const amountDue = bookings.reduce((total, booking) => {
    const target = Number(booking.final_amount ?? booking.estimated_amount ?? 0)
    return total + Math.max(0, target - Number(booking.verified_amount || 0))
  }, 0)
  const canSubmit = bookings.every(booking => ['awaiting_payment', 'payment_rejected'].includes(booking.status))
    && amountDue > 0 && groupStatus !== 'submitted'
  const allApproved = bookings.every(booking => ['awaiting_payment', 'payment_rejected'].includes(booking.status))
  const paymentTransactions = bookings.flatMap(booking => {
    const record = paymentRecords.find(payment => String(payment.booking_id) === String(booking.id))
    return (record?.transactions || [])
      .filter(transaction => transaction.group_payment_id)
      .map(transaction => ({ ...transaction, bookingRef: booking.booking_ref }))
  })

  async function submitPayment(event) {
    event.preventDefault()
    const form = event.currentTarget
    const values = Object.fromEntries(new FormData(form))
    const proofFile = form.elements.proof.files[0]
    if (!proofFile) return
    setBusy(true); setError(''); setNotice('')
    try {
      if (proofFile.size > MAX_IMAGE) throw new Error('Payment proof must be 5 MB or smaller.')
      await api.post(`/booking-groups/${groupId}/payments`, {
        amount: values.amount,
        method: values.method,
        transactionRef: values.transactionRef,
        proofData: await fileAsDataUrl(proofFile),
      })
      setNotice('Combined payment submitted for mechanic verification.')
      form.reset()
      await onUpdated()
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Could not submit combined payment.')
    } finally { setBusy(false) }
  }

  return <section className="booking-payment">
    <h4>Pay for all bicycles together</h4>
    <p>Combined amount due: <strong>{money(amountDue)}</strong></p>
    {!allApproved && !['submitted', 'verified'].includes(groupStatus) && <p>Combined payment is available after every bicycle has been approved.</p>}
    {groupStatus === 'submitted' && <p>Your combined payment is awaiting mechanic verification.</p>}
    {groupStatus === 'verified' && <p>Your combined payment was verified.</p>}
    {groupStatus === 'rejected' && <p>The previous combined payment was rejected. {bookings[0].group_payment_note || 'Please review your details and submit again.'}</p>}
    {canSubmit && <form className="workspace-form" onSubmit={submitPayment}>
      <div className="field-row">
        <label className="field-label">Amount due (PHP)<input name="amount" type="number" min="0.01" step="0.01" required defaultValue={amountDue.toFixed(2)} /></label>
        <label className="field-label">Method<select name="method" required><option value="gcash">E-wallet</option><option value="bank_transfer">Bank transfer</option></select></label>
      </div>
      <label className="field-label">Transaction reference<input name="transactionRef" minLength={3} maxLength={160} required /></label>
      <label className="field-label">Receipt (JPEG, PNG or PDF)<input name="proof" type="file" accept="image/jpeg,image/png,application/pdf" required /></label>
      <button className="btn btn-primary btn-sm" disabled={busy}>{busy ? 'Submitting…' : 'Submit combined payment'}</button>
    </form>}
    {bookings.some(booking => booking.payment_status === 'paid') && <p>Some bicycles are already paid in full.</p>}
    <PaymentHistory transactions={paymentTransactions} />
    {error && <div className="msg msg-error" role="alert">{error}</div>}
    {notice && <div className="msg msg-success" role="status">{notice}</div>}
  </section>
}

function PaymentHistory({ transactions }) {
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState('')

  async function openProof(transactionId) {
    setBusyId(transactionId)
    setError('')
    try {
      const { data } = await api.get(`/payments/transactions/${transactionId}/proof`, { responseType: 'blob' })
      const url = URL.createObjectURL(data)
      window.open(url, '_blank', 'noopener,noreferrer')
      window.setTimeout(() => URL.revokeObjectURL(url), 60000)
    } catch (err) {
      setError(err.response?.data?.error || 'Could not open payment receipt.')
    } finally {
      setBusyId(null)
    }
  }

  if (!transactions.length) return null
  return <div className="payment-history">
    <strong>Payment history</strong>
    {transactions.map(transaction => (
      <div className="payment-history-entry" key={transaction.id}>
        <p>
          {transaction.bookingRef && <><strong>{transaction.bookingRef}</strong> · </>}
          {money(transaction.amount)} · {label(transaction.method)} · {label(transaction.status)}
          {transaction.transaction_ref && <> · Ref: {transaction.transaction_ref}</>}
        </p>
        {transaction.verified_at && <small>Verified {dt(transaction.verified_at)}</small>}
        {transaction.admin_note && <p>{transaction.admin_note}</p>}
        {transaction.has_proof && <button className="btn btn-outline btn-sm" type="button" disabled={busyId === transaction.id} onClick={() => openProof(transaction.id)}>{busyId === transaction.id ? 'Opening receipt…' : 'View receipt'}</button>}
      </div>
    ))}
    {error && <div className="msg msg-error" role="alert">{error}</div>}
  </div>
}

function BookingPayment({ booking, payment, onUpdated }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [address, setAddress] = useState('')
  const [addressBusy, setAddressBusy] = useState(false)

  async function submitPayment(event) {
    event.preventDefault()
    const form = event.currentTarget
    const values = Object.fromEntries(new FormData(form))
    const proofFile = form.elements.proof.files[0]
    if (!proofFile) return
    setBusy(true); setError(''); setNotice('')
    try {
      if (proofFile.size > MAX_IMAGE) throw new Error('Payment proof must be 5 MB or smaller.')
      const proofData = await fileAsDataUrl(proofFile)
      await api.post('/payments', {
        bookingId: booking.id,
        amount: values.amount,
        method: values.method,
        transactionRef: values.transactionRef,
        proofData,
      })
      setNotice('Payment submitted. The mechanic must verify it before the booking is confirmed.')
      form.reset()
      await onUpdated()
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Could not submit payment.')
    } finally { setBusy(false) }
  }

  async function revealAddress() {
    setAddressBusy(true); setError('')
    try {
      const { data } = await api.get(`/bookings/${booking.id}/location`)
      setAddress(data.address)
    } catch (err) {
      setError(err.response?.data?.error || 'Could not load the workshop address.')
    } finally { setAddressBusy(false) }
  }

  const paymentTarget = Number(booking.final_amount ?? booking.estimated_amount ?? 0)
  const amountDue = Math.max(0, paymentTarget - Number(booking.verified_amount || 0))
  const canSubmit = ['awaiting_payment', 'payment_rejected', 'confirmed', 'in_progress', 'completed'].includes(booking.status)
  return (
    <section className="booking-payment">
      <h4>Payment</h4>
      <p>Status: <strong>{label(booking.payment_status || 'pending')}</strong>
        {' · Amount due: '}<strong>{money(amountDue)}</strong>
        {' · Verified paid: '}<strong>{money(booking.verified_amount)}</strong>
      </p>
      <PaymentHistory transactions={payment?.transactions || []} />
      {canSubmit && amountDue > 0 && (
        <>
          <p>{booking.status === 'awaiting_payment'
            ? 'Submit your e-wallet or bank-transfer receipt within two hours. Payment is not confirmed until the mechanic verifies it.'
            : booking.status === 'payment_rejected'
              ? 'Your previous payment was not verified. Correct the issue and submit new proof.'
            : 'Submit payment for the outstanding repair balance. Payment is not confirmed until the mechanic verifies it.'}</p>
          <form className="workspace-form" onSubmit={submitPayment}>
            <div className="field-row">
              <label className="field-label">Amount due (PHP)<input name="amount" type="number" min="0.01" step="0.01" max={amountDue || undefined} required defaultValue={amountDue || ''} /></label>
              <label className="field-label">Method<select name="method" required><option value="gcash">E-wallet</option><option value="bank_transfer">Bank transfer</option></select></label>
            </div>
            <label className="field-label">Transaction reference<input name="transactionRef" minLength={3} maxLength={160} required /></label>
            <label className="field-label">Receipt (JPEG, PNG or PDF)<input name="proof" type="file" accept="image/jpeg,image/png,application/pdf" required /></label>
            <button className="btn btn-primary btn-sm" disabled={busy}>{busy ? 'Submitting…' : 'Submit payment for review'}</button>
          </form>
        </>
      )}
      {booking.status === 'payment_submitted' && <p>Your payment proof is awaiting mechanic verification.</p>}
      {booking.payment_status === 'paid' && ['confirmed', 'in_progress', 'completed'].includes(booking.status) && (
        <div>
          {address
            ? <p><strong>Private workshop address:</strong> {address}</p>
            : <button className="btn btn-outline btn-sm" type="button" disabled={addressBusy} onClick={revealAddress}>{addressBusy ? 'Loading…' : 'View workshop address'}</button>}
        </div>
      )}
      {error && <div className="msg msg-error" role="alert">{error}</div>}
      {notice && <div className="msg msg-success" role="status">{notice}</div>}
    </section>
  )
}

/* ── Admin: shared UI ─────────────────────────────────────── */
const MAX_IMAGE = 5 * 1024 * 1024
const label = value => String(value || '').replaceAll('_', ' ')
const toLocalInput = value => {
  if (!value) return ''
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '' : new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

function Modal({ title, onClose, wide, children }) {
  useEffect(() => {
    const onKey = event => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <div className={'modal' + (wide ? ' modal-wide' : '')} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-hd">
          <h3>{title}</h3>
          <button type="button" className="btn btn-outline btn-sm" onClick={onClose}>Close</button>
        </div>
        {children}
      </div>
    </div>
  )
}

function DataTable({ columns, empty, children }) {
  const rows = Array.isArray(children) ? children.length : children ? 1 : 0
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>{columns.map(col => typeof col === 'string'
            ? <th key={col} scope="col">{col}</th>
            : <th key={col.label} scope="col" className={col.num ? 'num' : ''}>{col.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows ? children : <tr><td className="table-empty" colSpan={columns.length}>{empty}</td></tr>}
        </tbody>
      </table>
    </div>
  )
}

function DurationField({ label: fieldLabel, name, defaultMinutes, minMinutes = 1, maxMinutes = 1440 }) {
  const initialUnit = defaultMinutes >= 60 && defaultMinutes % 60 === 0 ? 'hours' : 'minutes'
  const [unit, setUnit] = useState(initialUnit)
  const [amount, setAmount] = useState(String(initialUnit === 'hours' ? defaultMinutes / 60 : defaultMinutes))
  const multiplier = unit === 'hours' ? 60 : 1
  const min = minMinutes / multiplier
  const max = maxMinutes / multiplier

  function changeUnit(nextUnit) {
    if (nextUnit === unit) return
    const currentMinutes = Number(amount) * multiplier
    setUnit(nextUnit)
    setAmount(String(currentMinutes / (nextUnit === 'hours' ? 60 : 1)))
  }

  return (
    <div className="field">
      <span className="field-label">{fieldLabel}</span>
      <div className="field-row">
        <label className="field-label">
          Value
          <input
            name={`${name}Value`}
            type="number"
            min={min}
            max={max}
            step={unit === 'hours' ? 'any' : 1}
            value={amount}
            onChange={event => setAmount(event.target.value)}
            required
          />
        </label>
        <label className="field-label">
          Unit
          <select name={`${name}Unit`} value={unit} onChange={event => changeUnit(event.target.value)}>
            <option value="minutes">Minutes</option>
            <option value="hours">Hours</option>
          </select>
        </label>
      </div>
    </div>
  )
}

function durationInMinutes(values, name) {
  const amount = Number(values[`${name}Value`])
  const multiplier = values[`${name}Unit`] === 'hours' ? 60 : 1
  return Math.round(amount * multiplier)
}

/* ── Admin: catalog forms ─────────────────────────────────── */
function ServiceForm({ item, busy, onSubmit }) {
  return (
    <form className="workspace-form" onSubmit={onSubmit}>
      <label className="field-label">Service name<input name="name" defaultValue={item?.name} required minLength={2} maxLength={120} /></label>
      <label className="field-label">Description<textarea name="description" defaultValue={item?.description} rows={3} required maxLength={2000} /></label>
      <div className="field-row">
        <label className="field-label">Starting price (PHP)<input name="startingPrice" type="number" min="0" step="0.01" defaultValue={item?.starting_price} required /></label>
      </div>
      <DurationField label="Estimated service duration" name="estimatedDuration" defaultMinutes={Number(item?.estimated_minutes ?? 60)} />
      <label className="workspace-check"><input name="requiresInspection" type="checkbox" defaultChecked={Boolean(item?.requires_inspection)} /> Requires inspection</label>
      {item && <label className="workspace-check"><input name="isActive" type="checkbox" defaultChecked={Boolean(item.is_active)} /> Visible to customers</label>}
      <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : item ? 'Save service' : 'Add service'}</button>
    </form>
  )
}

function BuildForm({ item, busy, onSubmit }) {
  return (
    <form className="workspace-form" onSubmit={onSubmit}>
      <label className="field-label">Build title<input name="title" defaultValue={item?.title} required minLength={2} maxLength={140} /></label>
      <label className="field-label">Owner name<input name="ownerName" defaultValue={item?.owner_name} required minLength={2} maxLength={120} /></label>
      <label className="field-label">Owner social link <span className="field-opt">Optional · HTTPS</span><input name="socialUrl" type="url" defaultValue={item?.social_url || ''} placeholder="https://instagram.com/..." /></label>
      <label className="field-label">{item ? 'Replace photo' : 'Bike photo'}{item && <span className="field-opt">Optional</span>}<input name="image" type="file" accept="image/jpeg,image/png,image/webp" required={!item} /><span className="file-input-note">{item ? 'Leave empty to keep the current photo. ' : ''}JPEG, PNG, or WebP · up to 5 MB</span></label>
      <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : item ? 'Save build' : 'Publish build'}</button>
    </form>
  )
}

function CertForm({ item, busy, onSubmit }) {
  return (
    <form className="workspace-form" onSubmit={onSubmit}>
      <label className="field-label">Provider<input name="body" defaultValue={item?.body} required minLength={2} maxLength={80} placeholder="Shimano, SRAM..." /></label>
      <label className="field-label">Certificate title<input name="title" defaultValue={item?.title} required minLength={2} maxLength={180} /></label>
      <label className="field-label">Year<input name="year" defaultValue={item?.year} required minLength={2} maxLength={20} placeholder="2025" /></label>
      <label className="field-label">{item ? 'Replace image' : 'Certificate image'}{item && <span className="field-opt">Optional</span>}<input name="image" type="file" accept="image/jpeg,image/png,image/webp" required={!item} /><span className="file-input-note">{item ? 'Leave empty to keep the current image. ' : ''}JPEG, PNG, or WebP · up to 5 MB</span></label>
      <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : item ? 'Save certification' : 'Publish certification'}</button>
    </form>
  )
}

const CATALOG = {
  services: {
    label: 'Services', one: 'Service', list: '/admin/services', admin: '/admin/services', key: 'services', Form: ServiceForm,
    blurb: 'Every service customers can request. Hidden services stay saved but do not appear on the site.',
    columns: ['Service', 'Description', { label: 'Price', num: true }, { label: 'Time', num: true }, 'Inspection', 'Status', { label: 'Actions', num: true }],
  },
  builds: {
    label: 'Featured builds', one: 'Build', list: '/builds', admin: '/admin/builds', key: 'builds', Form: BuildForm,
    blurb: 'Bike photos, owners and links shown in the public mechanic profile.',
    columns: ['Photo', 'Title', 'Owner', 'Social', { label: 'Actions', num: true }],
  },
  certifications: {
    label: 'Certifications', one: 'Certification', list: '/certifications', admin: '/admin/certifications', key: 'certifications', Form: CertForm,
    blurb: 'Certificates shown on the public mechanic profile.',
    columns: ['Image', 'Provider', 'Certificate', { label: 'Year', num: true }, { label: 'Actions', num: true }],
  },
}

function AdminCatalog({ section }) {
  const cfg = CATALOG[section]
  const [items, setItems] = useState([])
  const [modal, setModal] = useState(null)   // null = closed, { item: null } = add, { item } = edit
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    try {
      const { data } = await api.get(cfg.list)
      setItems(data[cfg.key] || []); setError('')
    } catch (err) { setError(err.response?.data?.error || 'Could not load ' + cfg.label.toLowerCase() + '.') }
    finally { setLoading(false) }
  }
  useEffect(() => { setItems([]); setModal(null); setNotice(''); load() }, [section]) // eslint-disable-line react-hooks/exhaustive-deps

  async function run(action, message) {
    setBusy(true); setError(''); setNotice('')
    try { await action(); setNotice(message); await load(); return true }
    catch (err) { setError(err.response?.data?.error || err.message || 'Could not save this item.'); return false }
    finally { setBusy(false) }
  }
  async function readImage(form) {
    const file = form.elements.image?.files[0]
    if (!file) return undefined
    if (file.size > MAX_IMAGE) throw new Error('That image is larger than 5 MB. Choose a smaller file.')
    return fileAsDataUrl(file)
  }
  async function submit(event, item) {
    event.preventDefault()
    const form = event.currentTarget
    const values = Object.fromEntries(new FormData(form))
    let ok = false
    if (section === 'services') {
      const body = {
        name: values.name,
        description: values.description,
        startingPrice: values.startingPrice,
        estimatedMinutes: durationInMinutes(values, 'estimatedDuration'),
        requiresInspection: values.requiresInspection === 'on',
      }
      ok = item
        ? await run(() => api.put(`${cfg.admin}/${item.id}`, { ...body, isActive: values.isActive === 'on' }), 'Service updated.')
        : await run(() => api.post(cfg.admin, body), 'Service added.')
    } else {
      const pick = imageData => section === 'builds'
        ? { title: values.title, ownerName: values.ownerName, socialUrl: values.socialUrl, imageData }
        : { body: values.body, title: values.title, year: values.year, imageData }
      ok = await run(async () => {
        const body = pick(await readImage(form))
        return item ? api.put(`${cfg.admin}/${item.id}`, body) : api.post(cfg.admin, body)
      }, cfg.one + (item ? ' updated.' : ' published.'))
    }
    if (ok) setModal(null)
  }
  function remove(item) {
    const name = item.name || item.title
    if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return
    run(() => api.delete(`${cfg.admin}/${item.id}`), cfg.one + ' removed.')
  }
  const actions = item => (
    <td className="row-actions">
      <button className="btn btn-outline btn-sm" type="button" onClick={() => { setError(''); setModal({ item }) }}>Edit</button>
      <button className="btn btn-danger btn-sm" type="button" disabled={busy} onClick={() => remove(item)}>Delete</button>
    </td>
  )

  let rows = []
  if (section === 'services') rows = items.map(s => (
    <tr key={s.id}>
      <td><strong>{s.name}</strong></td>
      <td><span className="cell-wrap">{s.description}</span></td>
      <td className="num">{money(s.starting_price)}</td>
      <td className="num">{s.estimated_minutes} min</td>
      <td>{s.requires_inspection ? 'Required' : '—'}</td>
      <td><span className={'pill ' + (s.is_active ? 'pill-on' : 'pill-off')}>{s.is_active ? 'Visible' : 'Hidden'}</span></td>
      {actions(s)}
    </tr>))
  if (section === 'builds') rows = items.map(b => (
    <tr key={b.id}>
      <td><PortfolioImage className="thumb" src={mediaUrl(b.image_url)} alt={b.title} /></td>
      <td><strong>{b.title}</strong></td>
      <td>{b.owner_name}</td>
      <td>{b.social_url ? <a className="text-link" href={b.social_url} target="_blank" rel="noreferrer">Open link</a> : '—'}</td>
      {actions(b)}
    </tr>))
  if (section === 'certifications') rows = items.map(c => (
    <tr key={c.id}>
      <td><PortfolioImage className="thumb" src={mediaUrl(c.image_url)} alt={c.title} /></td>
      <td>{c.body}</td>
      <td><strong>{c.title}</strong></td>
      <td className="num">{c.year}</td>
      {actions(c)}
    </tr>))

  const Form = cfg.Form
  const errorBox = error && <div className="msg msg-error" role="alert">{error}</div>
  return (
    <section>
      <div className="table-bar">
        <div><h2>{cfg.label}</h2><p>{cfg.blurb}</p></div>
        <div className="table-bar-actions">
          <span className="count-chip">{items.length} total</span>
          <button className="btn btn-outline btn-sm" type="button" onClick={load}>Refresh</button>
          <button className="btn btn-primary btn-sm" type="button" onClick={() => { setError(''); setModal({ item: null }) }}>+ Add {cfg.one.toLowerCase()}</button>
        </div>
      </div>
      {!modal && errorBox}
      {notice && <div className="msg msg-success" role="status">{notice}</div>}
      {loading ? <p className="muted">Loading…</p> : (
        <DataTable columns={cfg.columns} empty={'No ' + cfg.label.toLowerCase() + ' yet. Use the add button to create one.'}>{rows}</DataTable>
      )}
      {modal && (
        <Modal title={(modal.item ? 'Edit ' : 'Add ') + cfg.one.toLowerCase()} onClose={() => { setModal(null); setError('') }}>
          {errorBox}
          <Form item={modal.item} busy={busy} onSubmit={event => submit(event, modal.item)} />
        </Modal>
      )}
    </section>
  )
}

/* ── Admin: bookings ──────────────────────────────────────── */
const OPEN_STATUSES = ['pending_review', 'awaiting_customer_response', 'payment_rejected']
const BOOKING_STATUSES = ['pending_review', 'awaiting_customer_response', 'awaiting_customer', 'awaiting_payment', 'payment_submitted', 'payment_rejected', 'confirmed', 'in_progress', 'completed', 'rejected', 'cancelled', 'no_show']

function BookingModal({ item, error, onClose, onUpdate, onRefresh, onProposeReschedule }) {
  const actionable = OPEN_STATUSES.includes(item.status)
  const bike = [item.bicycle_type, item.bicycle_brand, item.bicycle_model].filter(Boolean).join(' · ')
  return (
    <Modal title={item.booking_ref} wide onClose={onClose}>
      {error && <div className="msg msg-error" role="alert">{error}</div>}
      <dl className="detail-grid">
        <div><dt>Customer</dt><dd>{item.customer_name}<br /><a className="text-link" href={`mailto:${item.customer_email}`}>{item.customer_email}</a></dd></div>
        {item.group_ref && <div><dt>Request group</dt><dd>{item.group_ref} · {item.payment_choice === 'together' ? 'pay together' : 'pay separately'}</dd></div>}
        <div><dt>Status</dt><dd><span className={`status status-${item.status}`}>{label(item.status)}</span></dd></div>
        <div><dt>Service</dt><dd>{item.service_name}</dd></div>
        <div><dt>Bicycle</dt><dd>{bike || '—'}</dd></div>
        <div><dt>Preferred time</dt><dd>{dt(item.preferred_at)}</dd></div>
        <div><dt>Scheduled</dt><dd>{item.scheduled_at ? dt(item.scheduled_at) : 'Not scheduled yet'}</dd></div>
        <div className="detail-wide"><dt>Problem description</dt><dd>{item.problem_description}</dd></div>
        {item.admin_note && <div className="detail-wide"><dt>Your note</dt><dd>{item.admin_note}</dd></div>}
        {item.customer_response && <div className="detail-wide"><dt>Customer response</dt><dd>{item.customer_response}</dd></div>}
        {item.pending_reschedule_id && <div className="detail-wide"><dt>Proposed time</dt><dd>{dt(item.proposed_reschedule_at)}</dd></div>}
      </dl>
      {Number(item.photo_count) > 0 && <BookingPhotos booking={item} />}
      {item.status === 'confirmed' && <section className="repair-checkin modal-section">
        <h4>Bicycle drop-off</h4>
        <p>Record that the bicycle has arrived before creating its repair intake.</p>
        <button className="btn btn-primary btn-sm" type="button" onClick={() => onUpdate(item.id, 'in_progress')}>Record bicycle received</button>
      </section>}
      <RepairWorkspace booking={item} onUpdated={onRefresh} />
      {actionable && (
        <form className="workspace-form modal-section" onSubmit={async event => { event.preventDefault(); if (await onUpdate(item.id, 'awaiting_payment', event.currentTarget)) onClose() }}>
          <div className="field-row">
            <label className="field-label">Proposed drop-off time<input name="scheduledAt" type="datetime-local" min={nowLocal()} defaultValue={toLocalInput(item.preferred_at)} required /></label>
            <label className="field-label">Note to customer <span className="field-opt">Optional</span><input name="adminNote" maxLength={1000} /></label>
          </div>
          <div className="modal-actions">
            <button className="btn btn-primary" type="submit">Approve &amp; reserve for 2 hours</button>
            <button className="btn btn-danger" type="button" onClick={async () => { if (window.confirm('Decline this booking request?') && await onUpdate(item.id, 'rejected')) onClose() }}>Decline</button>
          </div>
        </form>
      )}
      {item.status === 'pending_review' && <form className="workspace-form modal-section" onSubmit={async event => {
        event.preventDefault()
        if (await onUpdate(item.id, 'awaiting_customer_response', event.currentTarget)) onClose()
      }}>
        <h4>Ask the customer a question</h4>
        <label className="field-label">Question or information needed<textarea name="adminNote" rows={3} minLength={3} maxLength={1000} required placeholder="Ask for a detail needed to review this request." /></label>
        <button className="btn btn-outline btn-sm" type="submit">Send question</button>
      </form>}
      {['pending_review', 'awaiting_payment', 'confirmed'].includes(item.status) && <form className="workspace-form modal-section" onSubmit={async event => {
        event.preventDefault()
        if (await onProposeReschedule(item.id, event.currentTarget)) onClose()
      }}>
        <h4>Propose a new appointment time</h4>
        <label className="field-label">Proposed drop-off<input name="proposedAt" type="datetime-local" min={nowLocal()} required /></label>
        <label className="field-label">Note to customer <span className="field-opt">Optional</span><textarea name="note" rows={2} maxLength={1000} /></label>
        <button className="btn btn-outline btn-sm" type="submit">Send reschedule proposal</button>
      </form>}
    </Modal>
  )
}

function AdminBookings() {
  const [bookings, setBookings] = useState([])
  const [filter, setFilter] = useState('all')
  const [selectedId, setSelectedId] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    try { const { data } = await api.get('/admin/bookings'); setBookings(data.bookings); setError('') }
    catch (err) { setError(err.response?.data?.error || 'Could not load requests.') }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  async function update(id, status, form) {
    const vals = form ? Object.fromEntries(new FormData(form)) : {}
    try {
      await api.patch(`/admin/bookings/${id}`, { status, scheduledAt: vals.scheduledAt, adminNote: vals.adminNote })
      setNotice('Booking updated.'); setError(''); load(); return true
    } catch (err) { setError(err.response?.data?.error || 'Could not update booking.'); setNotice(''); return false }
  }

  async function proposeReschedule(id, form) {
    const values = Object.fromEntries(new FormData(form))
    try {
      await api.post(`/admin/bookings/${id}/reschedules`, {
        proposedAt: new Date(values.proposedAt).toISOString(),
        note: values.note,
      })
      setNotice('New appointment time proposed.'); setError('')
      await load()
      return true
    } catch (err) {
      setError(err.response?.data?.error || 'Could not propose a new appointment time.')
      setNotice('')
      return false
    }
  }

  const shown = filter === 'all' ? bookings : bookings.filter(b => b.status === filter)
  const selected = bookings.find(b => b.id === selectedId)
  const count = list => bookings.filter(b => list.includes(b.status)).length
  return (
    <section>
      <div className="stat-row">
        <div className="stat-box"><b>{bookings.length}</b><span>All requests</span></div>
        <div className="stat-box"><b>{count(OPEN_STATUSES)}</b><span>Need action</span></div>
        <div className="stat-box"><b>{count(['confirmed'])}</b><span>Confirmed</span></div>
        <div className="stat-box"><b>{count(['completed'])}</b><span>Completed</span></div>
      </div>
      <div className="table-bar">
        <div><h2>Booking requests</h2><p>Open a request to confirm a time, add a note or decline it.</p></div>
        <div className="table-bar-actions">
          <select aria-label="Filter by status" value={filter} onChange={event => setFilter(event.target.value)}>
            <option value="all">All statuses</option>
            {BOOKING_STATUSES.map(s => <option key={s} value={s}>{label(s)}</option>)}
          </select>
          <span className="count-chip">{shown.length} shown</span>
          <button className="btn btn-outline btn-sm" type="button" onClick={load}>Refresh</button>
        </div>
      </div>
      {!selected && error && <div className="msg msg-error" role="alert">{error}</div>}
      {notice && <div className="msg msg-success" role="status">{notice}</div>}
      {loading ? <p className="muted">Loading requests…</p> : (
        <DataTable columns={['Ref', 'Customer', 'Service', 'Bicycle', 'When', 'Status', { label: 'Action', num: true }]} empty={bookings.length ? 'No requests match this filter.' : 'All caught up. New requests will appear here.'}>
          {shown.map(item => (
            <tr key={item.id}>
              <td><strong>{item.booking_ref}</strong></td>
              <td>{item.customer_name}<span className="cell-sub">{item.customer_email}</span></td>
              <td>{item.service_name}</td>
              <td>{[item.bicycle_type, item.bicycle_brand].filter(Boolean).join(' · ') || '—'}</td>
              <td>{dt(item.scheduled_at || item.preferred_at)}<span className="cell-sub">{item.scheduled_at ? 'Scheduled' : 'Preferred'}</span></td>
              <td><span className={`status status-${item.status}`}>{label(item.status)}</span></td>
              <td className="row-actions">
                <button className={'btn btn-sm ' + (OPEN_STATUSES.includes(item.status) ? 'btn-primary' : 'btn-outline')} type="button" onClick={() => { setError(''); setSelectedId(item.id) }}>
                  {OPEN_STATUSES.includes(item.status) ? 'Review' : 'View'}
                </button>
              </td>
            </tr>
          ))}
        </DataTable>
      )}
      {selected && <BookingModal item={selected} error={error} onClose={() => { setSelectedId(null); setError('') }} onUpdate={update} onRefresh={load} onProposeReschedule={proposeReschedule} />}
    </section>
  )
}

function AdminPayments() {
  const [payments, setPayments] = useState([])
  const [groupPayments, setGroupPayments] = useState([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busyId, setBusyId] = useState(null)

  async function load() {
    try {
      const [paymentResult, groupResult] = await Promise.all([
        api.get('/payments'), api.get('/booking-group-payments'),
      ])
      setPayments(paymentResult.data.payments)
      setGroupPayments(groupResult.data.submissions)
      setError('')
    } catch (err) {
      setError(err.response?.data?.error || 'Could not load payments.')
    }
  }
  useEffect(() => { load() }, [])

  async function verify(id, isGroup = false) {
    setBusyId(id); setError(''); setNotice('')
    try {
      await api.patch(isGroup ? `/booking-group-payments/${id}/verify` : `/payments/transactions/${id}/verify`)
      setNotice(isGroup ? 'Combined payment verified. All appointments in the group are confirmed.' : 'Payment verified. A fully paid booking is now confirmed.')
      await load()
    } catch (err) { setError(err.response?.data?.error || 'Could not verify payment.') }
    finally { setBusyId(null) }
  }
  async function reject(id, isGroup = false) {
    const note = window.prompt('Reason for rejecting this payment?')
    if (!note) return
    setBusyId(id); setError(''); setNotice('')
    try {
      await api.patch(isGroup ? `/booking-group-payments/${id}/reject` : `/payments/transactions/${id}/reject`, { note })
      setNotice('Payment rejected and the customer was notified.')
      await load()
    } catch (err) { setError(err.response?.data?.error || 'Could not reject payment.') }
    finally { setBusyId(null) }
  }
  async function openProof(id, isGroup = false) {
    try {
      const { data } = await api.get(isGroup ? `/booking-group-payments/${id}/proof` : `/payments/transactions/${id}/proof`, { responseType: 'blob' })
      const url = URL.createObjectURL(data)
      window.open(url, '_blank', 'noopener,noreferrer')
      window.setTimeout(() => URL.revokeObjectURL(url), 60000)
    } catch (err) { setError(err.response?.data?.error || 'Could not open payment proof.') }
  }

  const transactions = [
    ...payments.flatMap(payment => payment.transactions.map(transaction => ({ ...transaction, bookingRef: payment.booking_ref, customer: payment.customer_name }))),
    ...groupPayments.map(payment => ({
      id: payment.id,
      isGroup: true,
      bookingRef: `${payment.group_ref} (${payment.booking_refs.join(', ')})`,
      customer: payment.customer_name,
      method: payment.method,
      amount: payment.amount,
      transaction_ref: payment.transaction_ref,
      status: payment.status,
      has_proof: payment.has_proof,
    })),
  ]
  return (
    <section>
      <div className="table-bar">
        <div><h2>Payment verification</h2><p>Payment proof is not treated as payment until you verify it. Full payment confirms the appointment.</p></div>
        <button className="btn btn-outline btn-sm" type="button" onClick={load}>Refresh</button>
      </div>
      {error && <div className="msg msg-error" role="alert">{error}</div>}
      {notice && <div className="msg msg-success" role="status">{notice}</div>}
      <DataTable columns={['Booking', 'Customer', 'Method', 'Amount', 'Reference', 'Status', { label: 'Actions', num: true }]} empty="No payment submissions yet.">
        {transactions.map(transaction => (
          <tr key={transaction.id}>
            <td><strong>{transaction.bookingRef}</strong></td>
            <td>{transaction.customer}</td>
            <td>{label(transaction.method)}</td>
            <td>{money(transaction.amount)}</td>
            <td>{transaction.transaction_ref || '—'}{transaction.has_proof && <button className="text-link" type="button" onClick={() => openProof(transaction.id, transaction.isGroup)}>View proof</button>}</td>
            <td><span className={`status status-${transaction.status}`}>{label(transaction.status)}</span></td>
            <td className="row-actions">
              {['pending', 'submitted'].includes(transaction.status) && <>
                <button className="btn btn-primary btn-sm" disabled={busyId === transaction.id} type="button" onClick={() => verify(transaction.id, transaction.isGroup)}>{transaction.isGroup ? 'Verify group' : 'Verify'}</button>
                <button className="btn btn-danger btn-sm" disabled={busyId === transaction.id} type="button" onClick={() => reject(transaction.id, transaction.isGroup)}>{transaction.isGroup ? 'Reject group' : 'Reject'}</button>
              </>}
            </td>
          </tr>
        ))}
      </DataTable>
    </section>
  )
}

function AdminAvailability() {
  const [schedules, setSchedules] = useState([])
  const [breakEnabledByDay, setBreakEnabledByDay] = useState({})
  const [address, setAddress] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

  async function load() {
    try {
      const [{ data: scheduleData }, { data: locationData }] = await Promise.all([
        api.get('/availability/schedules'),
        api.get('/admin/workshop-location'),
      ])
      setSchedules(scheduleData.schedules)
      setBreakEnabledByDay(Object.fromEntries(scheduleData.schedules.map(schedule => [
        schedule.day_of_week,
        Boolean(schedule.break_starts_at && schedule.break_ends_at),
      ])))
      setAddress(locationData.address)
      setError('')
    } catch (err) { setError(err.response?.data?.error || 'Could not load availability settings.') }
  }
  useEffect(() => { load() }, [])

  async function saveSchedule(event, schedule) {
    event.preventDefault()
    const values = Object.fromEntries(new FormData(event.currentTarget))
    setBusy(true); setError(''); setNotice('')
    try {
      await api.put(`/admin/availability/schedules/${schedule.day_of_week}`, {
        isWorkingDay: values.isWorkingDay === 'on',
        opensAt: values.opensAt || null,
        closesAt: values.closesAt || null,
        breakStartsAt: values.includeBreak === 'on' ? values.breakStartsAt || null : null,
        breakEndsAt: values.includeBreak === 'on' ? values.breakEndsAt || null : null,
        slotMinutes: durationInMinutes(values, 'slotInterval'),
        dailyCapacityMinutes: durationInMinutes(values, 'dailyCapacity'),
        maxDropoffsPerSlot: values.maxDropoffsPerSlot,
      })
      setNotice(`${days[schedule.day_of_week]} schedule saved.`)
      await load()
    } catch (err) { setError(err.response?.data?.error || 'Could not save schedule.') }
    finally { setBusy(false) }
  }
  async function saveAddress(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('')
    try {
      await api.put('/admin/workshop-location', { address })
      setNotice('Private workshop address saved.')
    } catch (err) { setError(err.response?.data?.error || 'Could not save the workshop address.') }
    finally { setBusy(false) }
  }
  const time = value => String(value || '').slice(0, 5)

  return (
    <section>
      <div className="table-bar"><div><h2>Availability and capacity</h2><p>Repair capacity and drop-off limits are enforced separately. Time zone: Asia/Manila.</p></div></div>
      {error && <div className="msg msg-error" role="alert">{error}</div>}
      {notice && <div className="msg msg-success" role="status">{notice}</div>}
      <div className="availability-day-list" aria-label="Weekly workshop hours">
        {schedules.map(schedule => (
          <form className="workspace-panel workspace-form availability-day-panel" key={schedule.day_of_week} onSubmit={event => saveSchedule(event, schedule)}>
            <h3 className="availability-day-heading">{days[schedule.day_of_week]}</h3>
            <label className="review-anonymous"><input type="checkbox" name="isWorkingDay" defaultChecked={Boolean(schedule.is_working_day)} /> Working day</label>
            <div className="field-row">
              <label className="field-label">Opens<input type="time" name="opensAt" defaultValue={time(schedule.opens_at)} /></label>
              <label className="field-label">Closes<input type="time" name="closesAt" defaultValue={time(schedule.closes_at)} /></label>
            </div>
            <label className="review-anonymous">
              <input
                type="checkbox"
                name="includeBreak"
                checked={breakEnabledByDay[schedule.day_of_week] ?? Boolean(schedule.break_starts_at && schedule.break_ends_at)}
                onChange={event => setBreakEnabledByDay(current => ({ ...current, [schedule.day_of_week]: event.target.checked }))}
              />
              Include a break
            </label>
            {breakEnabledByDay[schedule.day_of_week] && (
              <div className="field-row">
                <label className="field-label">Break starts<input type="time" name="breakStartsAt" defaultValue={time(schedule.break_starts_at)} /></label>
                <label className="field-label">Break ends<input type="time" name="breakEndsAt" defaultValue={time(schedule.break_ends_at)} /></label>
              </div>
            )}
            <DurationField label="Daily repair capacity" name="dailyCapacity" defaultMinutes={Number(schedule.daily_capacity_minutes || 600)} />
            <DurationField label="Drop-off interval" name="slotInterval" defaultMinutes={Number(schedule.slot_minutes || 60)} minMinutes={15} />
            <label className="field-label">Max bicycles per drop-off slot<input type="number" name="maxDropoffsPerSlot" min="1" max="100" defaultValue={schedule.max_dropoffs_per_slot || 1} required /></label>
            <button className="btn btn-primary btn-sm" disabled={busy}>Save {days[schedule.day_of_week]}</button>
          </form>
        ))}
      </div>
      <form className="workspace-panel workspace-form" onSubmit={saveAddress}>
        <h3>Private workshop address</h3>
        <p>Only shown to the customer who owns a booking after full payment is verified.</p>
        <label className="field-label">Exact address<textarea value={address} onChange={event => setAddress(event.target.value)} minLength={10} maxLength={1000} rows={3} required /></label>
        <button className="btn btn-primary btn-sm" disabled={busy}>Save private address</button>
      </form>
    </section>
  )
}

const EMPTY_MECHANIC_PROFILE = {
  full_name: '', role: '', bio: '',
  highlights: [{ icon: '', iconImage: '', val: '', sub: '' }],
  expertise: [{ area: '', detail: '', image: '' }],
  licences: [],
  agreements: [],
}

function profileForm(profile = {}) {
  const licences = jsonArray(profile.licences).map(item => typeof item === 'string'
    ? { title: item, image: '' }
    : { title: item.title || '', image: item.image || '' })
  return {
    full_name: profile.full_name || '',
    role: profile.role || '',
    bio: profile.bio || '',
    highlights: jsonArray(profile.highlights).length ? jsonArray(profile.highlights) : [{ icon: '', val: '', sub: '' }],
    expertise: jsonArray(profile.expertise).length ? jsonArray(profile.expertise) : [{ area: '', detail: '' }],
    licences,
    agreements: jsonArray(profile.agreements),
  }
}

function AdminMechanicProfile() {
  const [form, setForm] = useState(EMPTY_MECHANIC_PROFILE)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let active = true
    api.get('/mechanic-profile')
      .then(({ data }) => { if (active) setForm(profileForm(data.profile)) })
      .catch(err => {
        if (!active) return
        if (err.response?.status === 503) setNotice('No public mechanic profile is configured yet. Complete and save the fields below to publish one.')
        else setError(err.response?.data?.error || 'Could not load the mechanic profile.')
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  function setField(name, value) {
    setForm(current => ({ ...current, [name]: value }))
  }
  function setArrayField(name, index, key, value) {
    setForm(current => ({ ...current, [name]: current[name].map((item, position) => position === index
      ? (typeof item === 'string' ? value : { ...item, [key]: value })
      : item) }))
  }
  async function setProfileImage(name, index, key, file) {
    if (!file) return
    if (!file.type.startsWith('image/') || file.size > MAX_IMAGE) { setError('Choose an image no larger than 5 MB.'); return }
    try { setArrayField(name, index, key, await fileAsDataUrl(file)); setError('') }
    catch { setError('Could not read that image.') }
  }
  async function submit(event) {
    event.preventDefault()
    setBusy(true); setError(''); setNotice('')
    try {
      const { data } = await api.put('/admin/mechanic-profile', form)
      setForm(profileForm(data.profile))
      setNotice(data.message || 'Public mechanic profile saved.')
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save the mechanic profile.')
    } finally { setBusy(false) }
  }

  if (loading) return <p className="muted">Loading mechanic profile…</p>
  return <section className="mechanic-profile-editor">
    <div className="table-bar"><div><h2>Public mechanic profile</h2><p>Profile details are stored in the database and shown on the public homepage.</p></div></div>
    {error && <div className="msg msg-error" role="alert">{error}</div>}
    {notice && <div className="msg msg-success" role="status">{notice}</div>}
    <form className="workspace-form workspace-panel" onSubmit={submit}>
      <div className="field-row">
        <label className="field-label">Name<input value={form.full_name} onChange={event => setField('full_name', event.target.value)} maxLength={120} required /></label>
        <label className="field-label">Role<input value={form.role} onChange={event => setField('role', event.target.value)} maxLength={160} required /></label>
      </div>
      <label className="field-label">Biography<textarea value={form.bio} onChange={event => setField('bio', event.target.value)} minLength={20} maxLength={5000} rows={5} required /></label>
      <div className="profile-editor-list">
        <div className="profile-editor-heading"><strong>Highlights</strong><button className="btn btn-outline btn-sm" type="button" onClick={() => setField('highlights', [...form.highlights, { icon: '', iconImage: '', val: '', sub: '' }])} disabled={form.highlights.length >= 12}>Add highlight</button></div>
        {form.highlights.map((item, index) => <div className="profile-editor-row" key={`highlight-${index}`}>
          <label className="field-label">Icon picture<input type="file" accept="image/*" onChange={event => setProfileImage('highlights', index, 'iconImage', event.target.files[0])} /><span className="file-input-note">JPEG, PNG, or WebP · up to 5 MB</span>{item.iconImage && <img className="profile-image-preview" src={item.iconImage} alt="Highlight icon preview" />}</label>
          <label className="field-label">Value<input value={item.val} onChange={event => setArrayField('highlights', index, 'val', event.target.value)} maxLength={80} required /></label>
          <label className="field-label">Description<input value={item.sub} onChange={event => setArrayField('highlights', index, 'sub', event.target.value)} maxLength={160} required /></label>
          {form.highlights.length > 1 && <button className="btn btn-danger btn-sm" type="button" onClick={() => setField('highlights', form.highlights.filter((_, position) => position !== index))}>Remove</button>}
        </div>)}
      </div>
      <div className="profile-editor-list">
        <div className="profile-editor-heading"><strong>Expertise</strong><button className="btn btn-outline btn-sm" type="button" onClick={() => setField('expertise', [...form.expertise, { area: '', detail: '', image: '' }])} disabled={form.expertise.length >= 24}>Add specialty</button></div>
        {form.expertise.map((item, index) => <div className="profile-editor-row expertise-editor-row" key={`expertise-${index}`}>
          <label className="field-label">Specialty<input value={item.area} onChange={event => setArrayField('expertise', index, 'area', event.target.value)} maxLength={120} required /></label>
          <label className="field-label">Details<textarea value={item.detail} onChange={event => setArrayField('expertise', index, 'detail', event.target.value)} maxLength={500} rows={2} required /></label>
          <label className="field-label">Specialty picture<input type="file" accept="image/*" onChange={event => setProfileImage('expertise', index, 'image', event.target.files[0])} /><span className="file-input-note">Optional · up to 5 MB</span>{item.image && <img className="profile-image-preview" src={item.image} alt="Specialty preview" />}</label>
          {form.expertise.length > 1 && <button className="btn btn-danger btn-sm" type="button" onClick={() => setField('expertise', form.expertise.filter((_, position) => position !== index))}>Remove</button>}
        </div>)}
      </div>
      <div className="profile-editor-list">
        <div className="profile-editor-heading"><strong>Licences &amp; registrations</strong><button className="btn btn-outline btn-sm" type="button" onClick={() => setField('licences', [...form.licences, { title: '', image: '' }])} disabled={form.licences.length >= 24}>Add licence</button></div>
        {form.licences.map((item, index) => <div className="profile-editor-row licence-editor-row" key={`licence-${index}`}>
          <label className="field-label">Licence or registration<input value={item.title} onChange={event => setArrayField('licences', index, 'title', event.target.value)} maxLength={250} required /><input type="file" accept="image/jpeg,image/png,image/webp" onChange={event => setProfileImage('licences', index, 'image', event.target.files[0])} /><span className="file-input-note">Optional proof image · JPEG, PNG, or WebP · up to 5 MB</span>{item.image && <img className="profile-image-preview" src={item.image} alt="Licence preview" />}</label>
          <button className="btn btn-danger btn-sm" type="button" onClick={() => setField('licences', form.licences.filter((_, position) => position !== index))}>Remove</button>
        </div>)}
      </div>
      <div className="profile-editor-list">
        <div className="profile-editor-heading"><strong>Agreements</strong><button className="btn btn-outline btn-sm" type="button" onClick={() => setField('agreements', [...form.agreements, { title: '', image: '' }])} disabled={form.agreements.length >= 24}>Add agreement</button></div>
        {form.agreements.map((item, index) => <div className="profile-editor-row licence-editor-row" key={`agreement-${index}`}><label className="field-label">Agreement title<input value={item.title} onChange={event => setArrayField('agreements', index, 'title', event.target.value)} maxLength={250} required /><input type="file" accept="image/*" onChange={event => setProfileImage('agreements', index, 'image', event.target.files[0])} /><span className="file-input-note">Agreement image · up to 5 MB</span>{item.image && <img className="profile-image-preview" src={item.image} alt="Agreement preview" />}</label><button className="btn btn-danger btn-sm" type="button" onClick={() => setField('agreements', form.agreements.filter((_, position) => position !== index))}>Remove</button></div>)}
      </div>
      <button className="btn btn-primary btn-sm" disabled={busy}>{busy ? 'Saving…' : 'Save public profile'}</button>
    </form>
  </section>
}

/* ── Admin page ───────────────────────────────────────────── */
function AdminPage({ user }) {
  const [tab, setTab] = useState('bookings')
  const tabs = [['bookings', 'Bookings'], ['payments', 'Payments'], ['availability', 'Availability'], ['services', 'Services'], ['builds', 'Builds'], ['certifications', 'Certifications'], ['profile', 'Mechanic profile']]
  return (
    <>
      <div className="page-banner">
        <div className="page-banner-col">
          <span className="eyebrow">Mechanic workspace · {user.fullName}</span>
          <h1 className="page-h1">Workshop.</h1>
          <p className="page-lead">Manage booking requests and everything shown on the public site, all in one place.</p>
        </div>
      </div>
      <main className="page-body">
        <div className="tabs" role="tablist" aria-label="Workshop sections">
          {tabs.map(([id, text]) => (
            <button key={id} type="button" role="tab" className="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{text}</button>
          ))}
        </div>
        {tab === 'bookings' ? <AdminBookings />
          : tab === 'payments' ? <AdminPayments />
            : tab === 'availability' ? <AdminAvailability />
              : tab === 'profile' ? <AdminMechanicProfile />
                : <AdminCatalog section={tab} />}
      </main>
      <Footer />
    </>
  )
}

function ScrollManager() {
  const { pathname, hash } = useLocation()
  useEffect(() => {
    if (hash) {
      const timer = setTimeout(() => document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: 'smooth' }), 60)
      return () => clearTimeout(timer)
    }
    window.scrollTo(0, 0)
  }, [pathname, hash])
  return null
}

/* ── App shell ────────────────────────────────────────────── */
function AppShell() {
  const [user, setUser]       = useState(null)
  const [checking, setChecking] = useState(true)
  const [dark, setDark] = useState(() => {
    try { return localStorage.getItem('sw-theme') === 'dark' } catch { return false }
  })

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
    try { localStorage.setItem('sw-theme', dark ? 'dark' : 'light') } catch {}
  }, [dark])

  useEffect(() => {
    api.get('/auth/me')
      .then(({ data }) => setUser(data.user))
      .catch(() => setUser(null))
      .finally(() => setChecking(false))
  }, [])

  async function logout() {
    await api.post('/auth/logout').catch(() => {})
    setUser(null)
    window.location.assign('/')
  }

  if (checking) return <div className="loading-screen">Loading…</div>

  return (
    <>
      <CursorEffects />
      <Header user={user} onLogout={logout} dark={dark} onToggleTheme={() => setDark(current => !current)} />
      <ScrollManager />
      <Routes>
        <Route path="/"         element={<Home />} />
        <Route path="/services" element={<ServicesPage />} />
        <Route path="/login"    element={user ? <Navigate to={user.role === 'admin' ? '/admin' : '/account'} /> : <AuthPage mode="login"    onSignedIn={setUser} />} />
        <Route path="/register" element={user ? <Navigate to={user.role === 'admin' ? '/admin' : '/account'} /> : <AuthPage mode="register" onSignedIn={setUser} />} />
        <Route path="/forgot-password" element={user ? <Navigate to={user.role === 'admin' ? '/admin' : '/account'} /> : <ForgotPasswordPage />} />
        <Route path="/reset-password" element={user ? <Navigate to={user.role === 'admin' ? '/admin' : '/account'} /> : <ResetPasswordPage />} />
        <Route path="/book"     element={<Guard user={user} role="customer"><BookingPage  user={user} /></Guard>} />
        <Route path="/account"  element={<Guard user={user} role="customer"><AccountPage  user={user} /></Guard>} />
        <Route path="/admin"    element={<Guard user={user} role="admin">   <AdminPage    user={user} /></Guard>} />
        <Route path="*"         element={<Navigate to="/" replace />} />
      </Routes>
    </>
  )
}

export default function App() {
  return <BrowserRouter><AppShell /></BrowserRouter>
}
