import { useEffect, useState } from 'react'
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import api from './services/api'
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

const CITY = 'Zamboanga City'
const nowLocal = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)

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
            <small>{dark ? 'Light' : 'Dark'}</small>
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
  return (
    <footer className="ftr">
      <div className="ftr-inner">
        <div className="ftr-contact">
          <strong>Contact the mechanic</strong>
          <div className="ftr-contact-grid">
            <a className="ftr-highlight" href={`mailto:${contact.email}`}><span>Email</span><strong>{contact.email}</strong></a>
            <a className="ftr-highlight" href={`tel:${contact.phone.replace(/[^+\d]/g, '')}`}><span>Phone</span><strong>{contact.phone}</strong></a>
            {contact.instagram && <a className="ftr-highlight" href={contact.instagram} target="_blank" rel="noreferrer"><span>Social</span><strong>Instagram &#8599;</strong></a>}
            <a className="ftr-highlight" href={contact.facebook} target="_blank" rel="noreferrer"><span>Social</span><strong>Facebook &#8599;</strong></a>
          </div>
        </div>
        <div className="ftr-right">
          <span>Service by appointment only</span>
          <span>Thoughtful repairs. More miles together.</span>
        </div>
      </div>
    </footer>
  )
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

/* ── Mechanic data ────────────────────────────────────────── */
const MECHANIC = {
  name: 'Palluh, Abdallah J.',
  role: 'Head Mechanic & Student',
  photo: new URL('./assets/palluh.png', import.meta.url).href,
  bio: `For more than four years, I've worked on road bikes, mountain bikes, fixed-gear builds, and everyday commuters. That hands-on experience covers routine tune-ups, drivetrain troubleshooting, wheel and tyre work, brake adjustments, and practical upgrades for different riding styles.

I started Spoke & Wrench because every rider deserves careful attention, not just the ones with expensive bikes. I'll explain what I find, talk through repair options, and recommend work that fits the bike and the way you ride.`,
  highlights: [
    { icon: '🔧', val: '4+ years',    sub: 'Professional experience' },
    { icon: '🚴', val: '200+',       sub: 'Bicycles serviced'       },
    { icon: '🔩', val: '6',           sub: 'Service specialties'     },
    { icon: '📍', val: CITY, sub: 'Based locally'           },
  ],
  expertise: [
    { area: 'Road & gravel',      detail: 'Race-ready tune-ups, fit adjustments, shifting checks, and reliable long-distance setups.' },
    { area: 'Mountain bike',      detail: 'Suspension checks, dropper posts, tubeless conversions, and trail-focused tuning.' },
    { area: 'Drivetrain & gears', detail: 'Accurate indexing, cable tension, derailleur alignment, and Di2 or AXS setup checks.' },
    { area: 'Wheels & tyres',     detail: 'Wheel truing, spoke replacement, hub bearings, punctures, and tubeless setup.' },
    { area: 'Brakes',             detail: 'Hydraulic bleeding, rotor alignment, pad replacement, and rim-brake adjustment.' },
    { area: 'City & commuter',    detail: 'Practical lighting, racks, fenders, drivetrain care, and dependable daily-bike setup.' },
  ],
  licences: [
    `DTI-Registered Business — ${CITY}`,
    'BIR Certificate of Registration',
    'Barangay Business Permit — current year',
  ],
}
const BIKE_CATEGORIES = ['Road bike', 'Mountain bike', 'Gravel bike', 'City / commuter bike']

/* Hero preview services */
const HERO_SVCS = [
  { name: 'Full tune-up',      price: '₱850' },
  { name: 'Brake adjustment',  price: '₱350' },
  { name: 'Drivetrain clean',  price: '₱600' },
  { name: 'Flat tyre repair',  price: '₱200' },
]

/* ── Mechanic section ─────────────────────────────────────── */
function CertificateCard({ certificate }) {
  const image = mediaUrl(certificate.image_url)
  return <a className='cert-row' href={image} target='_blank' rel='noreferrer' aria-label={'Open ' + certificate.title + ' certificate image'}>
    <img className='cert-image' src={image} alt={certificate.title + ' certificate'} loading='lazy' />
    <span className='cert-copy'><span className='cert-badge'>{certificate.body}</span><span className='cert-name'>{certificate.title}</span><span className='cert-open'>Click to view certificate</span></span>
    <span className='cert-year'>{certificate.year}</span>
  </a>
}

function MechanicSection() {
  const [builds, setBuilds] = useState([])
  const [certifications, setCertifications] = useState([])
  const [bookingEnabled, setBookingEnabled] = useState(null)
  useEffect(() => {
    api.get('/builds').then(({ data }) => setBuilds(data.builds)).catch(() => {})
    api.get('/certifications').then(({ data }) => setCertifications(data.certifications)).catch(() => {})
    const checkBookingStatus = () => api.get('/booking-status').then(({ data }) => setBookingEnabled(data.enabled)).catch(() => setBookingEnabled(null))
    checkBookingStatus()
    const timer = window.setInterval(checkBookingStatus, 30000)
    return () => window.clearInterval(timer)
  }, [])
  return (
    <section className='mech-section' id='mechanic'>
      <div className='mech-col'>
        <span className='eyebrow'>The person behind the wrench</span>
        <h2 className='section-h2'>Your mechanic.</h2>
        <div className='mech-bio-grid'>
          <div className='mech-photo-stack'>
            <img src={MECHANIC.photo} alt={MECHANIC.name + ', mechanic at Spoke & Wrench'} className='mech-portrait' onError={e => { e.currentTarget.style.display = 'none'; e.currentTarget.nextSibling.style.display = 'grid' }} />
            <div className='mech-portrait-fallback'>AP</div>
          </div>
          <div className='mech-info'>
            <div className='mech-name-row'><div><div className='mech-name'>{MECHANIC.name}</div><div className='mech-role'>{MECHANIC.role}</div></div><div className={'mech-avail ' + (bookingEnabled === true ? 'is-open' : bookingEnabled === false ? 'is-paused' : 'is-checking')}><span className='mech-avail-dot' aria-hidden='true' /><span><strong>{bookingEnabled === true ? 'Accepting bookings' : bookingEnabled === false ? 'Bookings paused' : 'Checking availability'}</strong><small>{bookingEnabled === true ? 'New service requests are welcome' : bookingEnabled === false ? 'Please check back soon' : 'Availability updates automatically'}</small></span></div></div>
            <p className='mech-bio-text'>{MECHANIC.bio}</p>
            <div className='mech-highlights'>{MECHANIC.highlights.map(h => <div className='mech-hl' key={h.val}><div className='mech-hl-icon'>{h.icon}</div><strong className='mech-hl-val'>{h.val}</strong><span className='mech-hl-sub'>{h.sub}</span></div>)}</div>
          </div>
        </div>
        <section className='mech-builds'>
          <div className='mech-builds-head'><div><h3 className='mech-block-h'>Featured bike builds</h3><p className='mech-builds-note'>Workshop builds published by the mechanic.</p></div><span className='mech-build-count'>{builds.length} {builds.length === 1 ? 'build' : 'builds'}</span></div>
          <div className='mech-bike-wrap'>{builds.map(build => <article className='mech-build-card' key={build.id}><div className='mech-build-image'><img className='mech-bike-img' src={mediaUrl(build.image_url)} alt={build.title} loading='lazy' /></div><div className='mech-bike-details'><h4>{build.title}</h4><p>Owner: <strong>{build.owner_name}</strong></p>{build.social_url && <a className='mech-owner-link' href={build.social_url} target='_blank' rel='noreferrer'>View owner socials</a>}</div></article>)}{!builds.length && <p className='muted'>Featured builds will appear here when the mechanic publishes them.</p>}</div>
        </section>
        <section className='mech-skills'><div className='mech-skills-heading'><div><div className='mech-block-h'>Skills &amp; specialties</div><p>Focused repairs and setup for the bikes and components riders use every day.</p></div><span>{MECHANIC.expertise.length} specialties</span></div><div className='mech-expertise-grid'>{MECHANIC.expertise.map((e, index) => <article className='mech-exp-card' key={e.area}><span className='mech-exp-index'>0{index + 1}</span><span className='mech-exp-area'>{e.area}</span><p className='mech-exp-detail'>{e.detail}</p></article>)}</div></section>
        <div className='mech-creds'>
          <section><div className='mech-block-h'>Certifications</div><div className='cert-list'>{certifications.map(c => <CertificateCard key={c.id} certificate={c} />)}{!certifications.length && <p className='muted'>Certifications will appear here when published.</p>}</div></section>
          <section><div className='mech-block-h'>Licences &amp; registrations</div><ul className='lic-list'>{MECHANIC.licences.map(l => <li className='lic-item' key={l}><span className='lic-dot' aria-hidden='true' />{l}</li>)}</ul><p className='lic-note'>Physical copies available on request at the workshop.</p></section>
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
                One mechanic, your bike, the full story — before we turn a single bolt.
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
                {HERO_SVCS.map(s => (
                  <div className="hero-svc-row" key={s.name}>
                    <span className="hero-svc-name">{s.name}</span>
                    <span className="hero-svc-price">{s.price}</span>
                  </div>
                ))}
              </div>
              <div className="hero-stats-card">
                {[
                  { num: '4+',  lbl: 'Years experience' },
                  { num: '200+', lbl: 'Bikes serviced' },
                  { num: String(MECHANIC.expertise.length), lbl: 'Service specialties' },
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
            </p>
          </div>
        </div>
      </main>
      <Footer />
    </>
  )
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
    setBikes(current => current.map(bike => bike.key === key ? { ...bike, ...changes } : bike))
  }

  async function submit(e) {
    e.preventDefault(); setError(''); setBusy(true)
    let createdGroupRef = ''
    try {
      for (const bike of bikes) {
        if (!bike.serviceIds.length) throw new Error('Choose at least one service for every bicycle.')
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
                <div className="field"><label className="field-label">Preferred drop-off time<input type="datetime-local" min={nowLocal()} value={bike.preferredAt} onChange={event => updateBike(bike.key, { preferredAt: event.target.value })} required /></label></div>
                <div className="field"><label className="field-label">Bicycle photos <span className="field-opt">Optional · up to 3 photos, 10 MB each</span><input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={event => updateBike(bike.key, { photos: Array.from(event.target.files || []) })} /></label>{bike.photos.length > 0 && <span className="field-hint">{bike.photos.length} photo(s) selected{bike.photos.length > 3 ? ' — choose no more than three' : ''}</span>}</div>
              </section>
            })}
            <button className="btn btn-outline btn-sm" type="button" onClick={() => setBikes(current => [...current, newBookingBike()])} disabled={bikes.length >= 10}>Add another bicycle</button>
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
  return { key: `${Date.now()}-${Math.random()}`, bicycleId: '', bicycleType: '', brand: '', model: '', serviceIds: [], problem: '', preferredAt: '', photos: [] }
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
  const [error, setError]       = useState('')

  async function loadBookings() {
    try {
      const { data } = await api.get('/bookings/mine')
      setBookings(data.bookings)
      setError('')
    } catch (err) {
      setError(err.response?.data?.error || 'Could not load bookings.')
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
            {bookings.map((item, index) => (
              <article className="booking-card" key={item.id}>
                <div>
                  <div className="booking-ref">{item.booking_ref} · {item.service_name}</div>
                  {item.group_ref && <div className="booking-ref">Request group {item.group_ref} · {item.payment_choice === 'together' ? 'pay together' : 'pay separately'}</div>}
                  <h3>{item.bicycle_type}{item.bicycle_brand ? ` · ${item.bicycle_brand}` : ''}</h3>
                  <p>{item.problem_description}</p>
                </div>
                <div className="booking-meta">
                  <span className={`status status-${item.status}`}>{item.status.replaceAll('_', ' ')}</span>
                  <span className="booking-time">{dt(item.scheduled_at || item.preferred_at)}</span>
                </div>
                {(item.status === 'pending_review' || Number(item.photo_count) > 0) && <BookingPhotos booking={item} allowUpload={item.status === 'pending_review'} />}
                {item.booking_group_id && item.payment_choice === 'together'
                  && bookings.findIndex(booking => booking.booking_group_id === item.booking_group_id) === index
                  && <GroupBookingPayment bookings={bookings.filter(booking => booking.booking_group_id === item.booking_group_id)} onUpdated={loadBookings} />}
                {(!item.booking_group_id || item.payment_choice !== 'together')
                  && ['awaiting_payment', 'payment_submitted', 'confirmed', 'in_progress', 'completed'].includes(item.status) && (
                  <BookingPayment booking={item} onUpdated={loadBookings} />
                )}
                {item.status === 'completed' && (item.review_id ? <div className="review-complete"><strong>Review submitted</strong><span>{'★'.repeat(Number(item.review_rating || 0))} · {item.review_is_anonymous ? 'Posted anonymously' : 'Posted by you'}</span><p>{item.review_comment}</p></div> : <ReviewForm booking={item} onSubmitted={({ rating, comment, anonymous }) => setBookings(current => current.map(booking => booking.id === item.id ? { ...booking, review_id: `local-${item.id}`, review_rating: rating, review_comment: comment, review_is_anonymous: anonymous } : booking))} />)}
              </article>
            ))}
          </div>
        )}
      </main>
      <Footer />
    </>
  )
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
    {photos.length > 0 && <div className="booking-photo-list" aria-label="Bicycle photos">{photos.map((photo, index) => <a key={photo.id} href={photo.url} target="_blank" rel="noreferrer"><img src={photo.url} alt={`Bicycle photo ${index + 1}`} /></a>)}</div>}
    {allowUpload && photos.length < 3 && <form className="booking-photo-upload" onSubmit={upload}>
      <label className="field-label">Add bicycle photos (up to {3 - photos.length} more, 10 MB each)<input name="photos" type="file" accept="image/jpeg,image/png,image/webp" multiple required /></label>
      <button className="btn btn-outline btn-sm" type="submit" disabled={busy}>{busy ? 'Uploading…' : 'Upload photos'}</button>
    </form>}
    {error && <p className="field-hint" role="alert">{error}</p>}
  </>
}

function GroupBookingPayment({ bookings, onUpdated }) {
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
    {error && <div className="msg msg-error" role="alert">{error}</div>}
    {notice && <div className="msg msg-success" role="status">{notice}</div>}
  </section>
}

function BookingPayment({ booking, onUpdated }) {
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
        {amountDue != null && <> · Amount: <strong>{money(amountDue)}</strong></>}
      </p>
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
      <td><img className="thumb" src={mediaUrl(b.image_url)} alt="" /></td>
      <td><strong>{b.title}</strong></td>
      <td>{b.owner_name}</td>
      <td>{b.social_url ? <a className="text-link" href={b.social_url} target="_blank" rel="noreferrer">Open link</a> : '—'}</td>
      {actions(b)}
    </tr>))
  if (section === 'certifications') rows = items.map(c => (
    <tr key={c.id}>
      <td><img className="thumb" src={mediaUrl(c.image_url)} alt="" /></td>
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
const BOOKING_STATUSES = ['pending_review', 'awaiting_customer_response', 'awaiting_payment', 'payment_submitted', 'payment_rejected', 'confirmed', 'in_progress', 'completed', 'rejected', 'cancelled', 'no_show']

function BookingModal({ item, error, onClose, onUpdate }) {
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
      </dl>
      {Number(item.photo_count) > 0 && <BookingPhotos booking={item} />}
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
      {selected && <BookingModal item={selected} error={error} onClose={() => { setSelectedId(null); setError('') }} onUpdate={update} />}
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
        breakStartsAt: values.breakStartsAt || null,
        breakEndsAt: values.breakEndsAt || null,
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
            <div className="field-row">
              <label className="field-label">Break starts<input type="time" name="breakStartsAt" defaultValue={time(schedule.break_starts_at)} /></label>
              <label className="field-label">Break ends<input type="time" name="breakEndsAt" defaultValue={time(schedule.break_ends_at)} /></label>
            </div>
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

/* ── Admin page ───────────────────────────────────────────── */
function AdminPage({ user }) {
  const [tab, setTab] = useState('bookings')
  const tabs = [['bookings', 'Bookings'], ['payments', 'Payments'], ['availability', 'Availability'], ['services', 'Services'], ['builds', 'Builds'], ['certifications', 'Certifications']]
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
      <Header user={user} onLogout={logout} dark={dark} onToggleTheme={() => setDark(current => !current)} />
      <ScrollManager />
      <Routes>
        <Route path="/"         element={<Home />} />
        <Route path="/services" element={<ServicesPage />} />
        <Route path="/login"    element={user ? <Navigate to={user.role === 'admin' ? '/admin' : '/account'} /> : <AuthPage mode="login"    onSignedIn={setUser} />} />
        <Route path="/register" element={user ? <Navigate to={user.role === 'admin' ? '/admin' : '/account'} /> : <AuthPage mode="register" onSignedIn={setUser} />} />
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
