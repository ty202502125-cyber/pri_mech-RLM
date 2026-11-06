import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import api from '../services/api'
import { Footer } from '../components/SiteChrome'
import { money } from '../utils/formatters'

export default function BookingPage({ user }) {
  const [services, setServices] = useState([])
  const [bicycles, setBicycles] = useState([])
  const [savedBicycleId, setSavedBicycleId] = useState('')
  const [bikeDetails, setBikeDetails] = useState({ bicycleType: '', brand: '', model: '' })
  const [error, setError]   = useState('')
  const [success, setSuccess] = useState('')
  const [busy, setBusy]     = useState(false)

  useEffect(() => {
    api.get('/services')
      .then(({ data }) => setServices(data.services))
      .catch(() => setError('Could not load services. Check that the API and database are running.'))
    api.get('/bicycles')
      .then(({ data }) => setBicycles(data.bicycles))
      .catch(() => {})
  }, [])

  async function submit(e) {
    e.preventDefault(); setError(''); setBusy(true)
    const form = e.currentTarget
    try {
      const formValues = Object.fromEntries(new FormData(form))
      const serviceIds = Array.from(form.elements.serviceId.selectedOptions, option => option.value)
      delete formValues.serviceId
      if (formValues.preferredAt) formValues.preferredAt = new Date(formValues.preferredAt).toISOString()
      const { data } = await api.post('/bookings', { ...formValues, serviceIds })
      setSuccess(`Request ${data.booking.bookingRef} submitted — the mechanic will be in touch.`)
      form.reset()
      setSavedBicycleId('')
      setBikeDetails({ bicycleType: '', brand: '', model: '' })
    } catch (err) {
      setError(err.response?.data?.error || 'Could not submit booking. Please try again.')
    } finally { setBusy(false) }
  }

  return (
    <>
      <div className="page-banner">
        <div className="page-banner-col">
          <span className="eyebrow">Booking request · {user.fullName}</span>
          <h1 className="page-h1">Tell us about your bicycle.</h1>
          <p className="page-lead">
            This sends a request — not a confirmed appointment. The mechanic will
            review your preferred time and reply to confirm.
          </p>
        </div>
      </div>
      <main className="page-body col-narrow">
        <div className="form-card">
          <form onSubmit={submit}>
            <div className="field-row">
              <div className="field">
                <label className="field-label" htmlFor="bicycleId">Use a bicycle from your account <span className="field-opt">Optional</span></label>
                <select id="bicycleId" name="bicycleId" value={savedBicycleId} onChange={e => {
                  const value = e.target.value
                  setSavedBicycleId(value)
                  const selected = bicycles.find(bike => String(bike.id) === value)
                  setBikeDetails(selected ? { bicycleType: selected.category, brand: selected.brand || '', model: selected.model || '' } : { bicycleType: '', brand: '', model: '' })
                }}>
                  <option value="">Enter bicycle details below</option>
                  {bicycles.map(bicycle => <option key={bicycle.id} value={bicycle.id}>{[bicycle.brand, bicycle.model].filter(Boolean).join(' ') || bicycle.category}</option>)}
                </select>
              </div>
              <div className="field">
                <label className="field-label" htmlFor="serviceId">Services <span className="field-opt">Choose up to ten</span></label>
                <select id="serviceId" name="serviceId" required multiple size={Math.min(services.length || 3, 5)}>
                  {services.map(s => (
                    <option value={s.id} key={s.id}>{s.name} — from {money(s.starting_price)}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="field-row">
              <div className="field">
                <label className="field-label" htmlFor="bicycleType">Bicycle type</label>
                <input id="bicycleType" name="bicycleType" placeholder="Road, mountain, city…" maxLength={80} required disabled={Boolean(savedBicycleId)} value={bikeDetails.bicycleType} onChange={e => setBikeDetails({ ...bikeDetails, bicycleType: e.target.value })} />
              </div>
            </div>
            <div className="field-row">
              <div className="field">
                <label className="field-label" htmlFor="brand">
                  Brand <span className="field-opt">Optional</span>
                </label>
                <input id="brand" name="brand" maxLength={100} disabled={Boolean(savedBicycleId)} value={bikeDetails.brand} onChange={e => setBikeDetails({ ...bikeDetails, brand: e.target.value })} />
              </div>
              <div className="field">
                <label className="field-label" htmlFor="model">
                  Model <span className="field-opt">Optional</span>
                </label>
                <input id="model" name="model" maxLength={100} disabled={Boolean(savedBicycleId)} value={bikeDetails.model} onChange={e => setBikeDetails({ ...bikeDetails, model: e.target.value })} />
              </div>
            </div>
            <div className="field">
              <label className="field-label" htmlFor="problem">What's happening with your bike?</label>
              <textarea id="problem" name="problem" rows={4}
                minLength={8} maxLength={2000}
                placeholder="Describe what you've noticed — sounds, feel, anything unusual"
                required />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="preferredAt">Preferred appointment date and time</label>
              <input id="preferredAt" name="preferredAt" type="datetime-local" required />
            </div>
            {error   && <div className="msg msg-error"   role="alert">{error}</div>}
            {success && (
              <div className="msg msg-success" role="status">
                {success}{' '}
                <Link className="text-link" to="/account">View bookings →</Link>
              </div>
            )}
            <div className="form-footer">
              <button className="btn btn-primary btn-full" disabled={busy || !services.length}>
                {busy ? 'Sending request…' : 'Submit booking request'}
              </button>
            </div>
          </form>
        </div>
      </main>
      <Footer />
    </>
  )
}

/* ── Account page ─────────────────────────────────────────── */
