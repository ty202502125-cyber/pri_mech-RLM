import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import api from '../services/api'
import { Footer } from '../components/SiteChrome'
import { dt } from '../utils/formatters'

export default function MyBookingsPage({ user }) {
  const [bookings, setBookings] = useState([])
  const [repairs, setRepairs] = useState([])
  const [payments, setPayments] = useState([])
  const [notifications, setNotifications] = useState([])
  const [bicycles, setBicycles] = useState([])
  const [editingBikeId, setEditingBikeId] = useState(null)
  const [bikeForm, setBikeForm] = useState({ brand: '', model: '', category: 'Road bike', frameDetails: '', description: '' })
  const [bikeMessage, setBikeMessage] = useState('')
  const [bikeError, setBikeError] = useState('')
  const [error, setError]       = useState('')

  useEffect(() => {
    api.get('/bookings/mine')
      .then(({ data }) => setBookings(data.bookings))
      .catch(err => setError(err.response?.data?.error || 'Could not load bookings.'))
    api.get('/bicycles')
      .then(({ data }) => setBicycles(data.bicycles))
      .catch(() => setBikeError('Could not load your bicycles.'))
    api.get('/customers/me/repairs').then(({ data }) => setRepairs(data.repairs)).catch(() => {})
    api.get('/customers/me/payments').then(({ data }) => setPayments(data.payments)).catch(() => {})
    api.get('/notifications').then(({ data }) => setNotifications(data.notifications)).catch(() => {})
  }, [])

  async function refreshRepairAndPaymentData() {
    const [repairResult, paymentResult] = await Promise.allSettled([
      api.get('/customers/me/repairs'), api.get('/customers/me/payments'),
    ])
    if (repairResult.status === 'fulfilled') setRepairs(repairResult.value.data.repairs)
    if (paymentResult.status === 'fulfilled') setPayments(paymentResult.value.data.payments)
  }

  async function decideEstimate(repairId, decision) {
    try {
      await api.patch(`/repairs/${repairId}/estimate`, { decision })
      await refreshRepairAndPaymentData()
    } catch (err) { setError(err.response?.data?.error || 'Could not send your estimate response.') }
  }

  async function submitPayment(event, bookingId) {
    event.preventDefault(); setError('')
    const form = event.currentTarget
    const values = Object.fromEntries(new FormData(form))
    const file = form.elements.proof.files[0]
    if (!file) { setError('Choose a payment proof file.'); return }
    try {
      const proofData = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result)
        reader.onerror = () => reject(new Error('Could not read the selected file.'))
        reader.readAsDataURL(file)
      })
      await api.post('/payments', { bookingId, amount: Number(values.amount), method: values.method, transactionRef: values.transactionRef, proofData })
      form.reset()
      await refreshRepairAndPaymentData()
    } catch (err) { setError(err.response?.data?.error || err.message || 'Could not submit payment.') }
  }

  async function markNotificationRead(id) {
    try {
      await api.patch(`/notifications/${id}/read`)
      setNotifications(current => current.map(item => item.id === id ? { ...item, read_at: new Date().toISOString() } : item))
    } catch { /* The notice remains visible so the customer can retry later. */ }
  }

  async function saveBicycle(event) {
    event.preventDefault(); setBikeError(''); setBikeMessage('')
    try {
      if (editingBikeId) await api.put(`/bicycles/${editingBikeId}`, bikeForm)
      else await api.post('/bicycles', bikeForm)
      const { data } = await api.get('/bicycles')
      setBicycles(data.bicycles); setEditingBikeId(null)
      setBikeForm({ brand: '', model: '', category: 'Road bike', frameDetails: '', description: '' })
      setBikeMessage('Bicycle saved.')
    } catch (err) { setBikeError(err.response?.data?.error || 'Could not save this bicycle.') }
  }

  async function removeBicycle(id) {
    setBikeError(''); setBikeMessage('')
    try {
      await api.delete(`/bicycles/${id}`)
      setBicycles(current => current.filter(bicycle => bicycle.id !== id))
      if (editingBikeId === id) setEditingBikeId(null)
      setBikeMessage('Bicycle removed from your active list.')
    } catch (err) { setBikeError(err.response?.data?.error || 'Could not remove this bicycle.') }
  }

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
        <section className="account-bicycles" aria-labelledby="bicycles-heading">
          <div className="dash-hd"><div><span className="eyebrow">Your garage</span><h2 id="bicycles-heading" className="section-h2">My bicycles.</h2></div></div>
          {bikeError && <div className="msg msg-error" role="alert">{bikeError}</div>}
          {bikeMessage && <div className="msg msg-success" role="status">{bikeMessage}</div>}
          <div className="bike-card-list">
            {bicycles.map(bicycle => <article className="booking-card" key={bicycle.id}>
              <div><div className="booking-ref">{bicycle.category}</div><h3>{[bicycle.brand, bicycle.model].filter(Boolean).join(' ') || 'Bicycle'}</h3>
                {bicycle.frame_details && <p>Frame: {bicycle.frame_details}</p>}{bicycle.description && <p>{bicycle.description}</p>}</div>
              <div className="bike-card-actions">
                <button className="btn btn-outline btn-sm" type="button" onClick={() => {
                  setEditingBikeId(bicycle.id)
                  setBikeForm({ brand: bicycle.brand || '', model: bicycle.model || '', category: bicycle.category, frameDetails: bicycle.frame_details || '', description: bicycle.description || '' })
                }}>Edit</button>
                <button className="btn btn-danger btn-sm" type="button" onClick={() => removeBicycle(bicycle.id)}>Remove</button>
              </div>
            </article>)}
            {!bicycles.length && <p className="muted">Add your bicycles once, then choose one when you request a repair.</p>}
          </div>
          <form className="form-card bike-form" onSubmit={saveBicycle}>
            <h3>{editingBikeId ? 'Edit bicycle' : 'Add a bicycle'}</h3>
            <div className="field-row">
              <div className="field"><label className="field-label" htmlFor="bike-brand">Brand</label><input id="bike-brand" maxLength={100} value={bikeForm.brand} onChange={e => setBikeForm({ ...bikeForm, brand: e.target.value })} /></div>
              <div className="field"><label className="field-label" htmlFor="bike-model">Model</label><input id="bike-model" maxLength={100} value={bikeForm.model} onChange={e => setBikeForm({ ...bikeForm, model: e.target.value })} /></div>
            </div>
            <div className="field-row">
              <div className="field"><label className="field-label" htmlFor="bike-category">Category</label><select id="bike-category" value={bikeForm.category} onChange={e => setBikeForm({ ...bikeForm, category: e.target.value })}><option>Road bike</option><option>Mountain bike</option><option>Gravel bike</option><option>City / commuter bike</option></select></div>
              <div className="field"><label className="field-label" htmlFor="bike-frame">Frame details</label><input id="bike-frame" maxLength={160} value={bikeForm.frameDetails} onChange={e => setBikeForm({ ...bikeForm, frameDetails: e.target.value })} /></div>
            </div>
            <div className="field"><label className="field-label" htmlFor="bike-description">Additional details</label><textarea id="bike-description" rows={2} maxLength={1000} value={bikeForm.description} onChange={e => setBikeForm({ ...bikeForm, description: e.target.value })} /></div>
            <div className="form-footer"><button className="btn btn-primary btn-sm" type="submit">{editingBikeId ? 'Save changes' : 'Add bicycle'}</button>{editingBikeId && <button className="btn btn-outline btn-sm" type="button" onClick={() => { setEditingBikeId(null); setBikeForm({ brand: '', model: '', category: 'Road bike', frameDetails: '', description: '' }) }}>Stop editing</button>}</div>
          </form>
        </section>
        <section className="account-repairs" aria-labelledby="repairs-heading">
          <div className="dash-hd"><div><span className="eyebrow">Service updates</span><h2 id="repairs-heading" className="section-h2">Repairs &amp; payments.</h2></div></div>
          {repairs.map(repair => {
            const payment = payments.find(item => item.booking_id === repair.booking_id)
            return <article className="booking-card" key={repair.id}>
              <div className="repair-card-main">
                <div className="booking-ref">{repair.booking_ref} · {[repair.bicycle_brand, repair.bicycle_model].filter(Boolean).join(' ') || repair.bicycle_type}</div>
                <h3>{repair.status.replaceAll('_', ' ')}</h3>
                {repair.inspection_notes && <p>{repair.inspection_notes}</p>}
                {repair.estimate_amount !== null && <p>Estimate: {money(repair.estimate_amount)} · {repair.estimate_status.replaceAll('_', ' ')}</p>}
                {repair.final_amount !== null && <p>Final cost: {money(repair.final_amount)}</p>}
                {repair.completion_notes && <p>{repair.completion_notes}</p>}
                {repair.warranty_until && <p>Warranty until {new Date(`${repair.warranty_until}T00:00:00`).toLocaleDateString()}</p>}
                {repair.estimate_status === 'pending' && <div className="bike-card-actions"><button className="btn btn-primary btn-sm" type="button" onClick={() => decideEstimate(repair.id, 'approved')}>Approve estimate</button><button className="btn btn-outline btn-sm" type="button" onClick={() => decideEstimate(repair.id, 'declined')}>Decline</button></div>}
              </div>
              {repair.estimate_status === 'approved' && payment?.status !== 'paid' && payment?.status !== 'refunded' && <form className="payment-submit-form" onSubmit={event => submitPayment(event, repair.booking_id)}>
                <h4>Submit a transfer</h4>
                <div className="field-row">
                  <div className="field"><label className="field-label" htmlFor={`amount-${repair.id}`}>Amount (PHP)</label><input id={`amount-${repair.id}`} name="amount" type="number" min="0.01" step="0.01" required /></div>
                  <div className="field"><label className="field-label" htmlFor={`method-${repair.id}`}>Method</label><select id={`method-${repair.id}`} name="method"><option value="gcash">GCash</option><option value="bank_transfer">Bank transfer</option></select></div>
                </div>
                <div className="field"><label className="field-label" htmlFor={`reference-${repair.id}`}>Transaction reference</label><input id={`reference-${repair.id}`} name="transactionRef" maxLength={160} minLength={3} required /></div>
                <div className="field"><label className="field-label" htmlFor={`proof-${repair.id}`}>Payment proof (JPEG, PNG, PDF · up to 5 MB)</label><input id={`proof-${repair.id}`} name="proof" type="file" accept="image/jpeg,image/png,application/pdf" required /></div>
                <button className="btn btn-primary btn-sm" type="submit">Submit payment proof</button>
              </form>}
              {payment && <div className="payment-history"><strong>Payment status: {payment.status.replaceAll('_', ' ')}</strong>{payment.transactions.map(transaction => <p key={transaction.id}>{money(transaction.amount)} · {transaction.method.replaceAll('_', ' ')} · {transaction.status.replaceAll('_', ' ')}{transaction.admin_note ? ` · ${transaction.admin_note}` : ''}</p>)}</div>}
            </article>
          })}
          {!repairs.length && <p className="muted">Repair progress and payment options will appear after the mechanic opens a repair record.</p>}
        </section>
        {notifications.length > 0 && <section className="account-notifications" aria-labelledby="notifications-heading">
          <div className="dash-hd"><div><span className="eyebrow">Workshop messages</span><h2 id="notifications-heading" className="section-h2">Notifications.</h2></div></div>
          <div className="booking-list">{notifications.slice(0, 10).map(item => <article className="booking-card" key={item.id}><div><h3>{item.title}</h3><p>{item.body}</p><small>{dt(item.created_at)}</small></div>{!item.read_at && <button className="btn btn-outline btn-sm" type="button" onClick={() => markNotificationRead(item.id)}>Mark read</button>}</article>)}</div>
        </section>}
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
            {bookings.map(item => (
              <article className="booking-card" key={item.id}>
                <div>
                  <div className="booking-ref">{item.booking_ref} · {item.service_name}</div>
                  <h3>{item.bicycle_type}{item.bicycle_brand ? ` · ${item.bicycle_brand}` : ''}</h3>
                  <p>{item.problem_description}</p>
                </div>
                <div className="booking-meta">
                  <span className={`status status-${item.status}`}>{item.status.replaceAll('_', ' ')}</span>
                  <span className="booking-time">{dt(item.scheduled_at || item.preferred_at)}</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </main>
      <Footer />
    </>
  )
}

/* ── Admin page ───────────────────────────────────────────── */
