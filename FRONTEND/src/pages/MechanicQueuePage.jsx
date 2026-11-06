import { useEffect, useState } from 'react'
import api from '../services/api'
import { Footer } from '../components/SiteChrome'
import { dt } from '../utils/formatters'

export default function MechanicQueuePage({ user }) {
  const [bookings, setBookings] = useState([])
  const [payments, setPayments] = useState([])
  const [error,  setError]      = useState('')
  const [notice, setNotice]     = useState('')
  const [loading, setLoading]   = useState(true)

  function load() {
    setLoading(true)
    api.get('/admin/bookings')
      .then(({ data }) => setBookings(data.bookings))
      .catch(err => setError(err.response?.data?.error || 'Could not load requests.'))
    api.get('/payments')
      .then(({ data }) => setPayments(data.payments))
      .catch(() => {})
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  async function update(id, status, form) {
    const vals = form ? Object.fromEntries(new FormData(form)) : {}
    if (vals.scheduledAt) vals.scheduledAt = new Date(vals.scheduledAt).toISOString()
    try {
      await api.patch(`/admin/bookings/${id}`, {
        status, scheduledAt: vals.scheduledAt, adminNote: vals.adminNote,
      })
      setNotice('Booking updated.'); setError(''); load()
    } catch (err) { setError(err.response?.data?.error || 'Could not update booking.') }
  }

  async function reviewPayment(id, action) {
    const note = action === 'reject' ? window.prompt('Why is this payment being rejected?') : ''
    if (action === 'reject' && !note) return
    try {
      if (action === 'refund') await api.post(`/payments/transactions/${id}/refund`, {})
      else await api.patch(`/payments/transactions/${id}/${action}`, action === 'reject' ? { note } : {})
      setNotice(action === 'verify' ? 'Payment verified.' : action === 'refund' ? 'Refund recorded.' : 'Payment rejected.')
      load()
    } catch (err) { setError(err.response?.data?.error || 'Could not update payment.') }
  }

  async function recordCash(event, payment) {
    event.preventDefault()
    const amount = Number(new FormData(event.currentTarget).get('amount'))
    try {
      await api.post('/admin/payments/cash', { bookingId: payment.booking_id, amount })
      setNotice('Cash payment recorded.')
      load()
    } catch (err) { setError(err.response?.data?.error || 'Could not record cash payment.') }
  }

  return (
    <>
      <div className="page-banner">
        <div className="page-banner-col">
          <span className="eyebrow">Mechanic workspace · {user.fullName}</span>
          <h1 className="page-h1">Booking requests.</h1>
          <p className="page-lead">Review new requests, propose an appointment, and keep customers updated.</p>
        </div>
      </div>
      <main className="page-body">
        <div className="dash-hd">
          <div />
          <button className="btn btn-outline btn-sm" onClick={load}>Refresh</button>
        </div>
        {error  && <div className="msg msg-error"  role="alert">{error}</div>}
        {notice && <div className="msg msg-success" role="status">{notice}</div>}
        {loading ? (
          <p className="muted">Loading requests…</p>
        ) : !bookings.length ? (
          <div className="empty">
            <div className="empty-icon">✓</div>
            <h2>All caught up.</h2>
            <p>New customer requests will appear here.</p>
          </div>
        ) : bookings.map(item => (
          <article className="admin-card" key={item.id}>
            <div className="admin-card-hd">
              <div>
                <div className="booking-ref">{item.booking_ref} · {item.service_name}</div>
                <h2>{item.customer_name}</h2>
                <a href={`mailto:${item.customer_email}`}>{item.customer_email}</a>
              </div>
              <span className={`status status-${item.status}`}>{item.status.replaceAll('_', ' ')}</span>
            </div>
            <div className="admin-body">
              <div className="admin-details">
                <div>
                  <div className="admin-dl">Bicycle</div>
                  <div className="admin-dv">
                    {[item.bicycle_type, item.bicycle_brand, item.bicycle_model].filter(Boolean).join(' / ')}
                  </div>
                </div>
                <div>
                  <div className="admin-dl">Preferred time</div>
                  <div className="admin-dv">{dt(item.preferred_at)}</div>
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <div className="admin-dl">Problem description</div>
                  <div className="admin-dv">{item.problem_description}</div>
                </div>
                {item.admin_note && (
                  <div style={{ gridColumn: '1 / -1' }}>
                    <div className="admin-dl">Your note</div>
                    <div className="admin-dv">{item.admin_note}</div>
                  </div>
                )}
              </div>
            </div>
            {['pending_review', 'awaiting_customer_response'].includes(item.status) && (
              <form className="admin-actions"
                onSubmit={e => { e.preventDefault(); update(item.id, 'confirmed', e.currentTarget) }}>
                <div className="field">
                  <label className="field-label" htmlFor={`t-${item.id}`}>Confirm appointment time</label>
                  <input id={`t-${item.id}`} name="scheduledAt" type="datetime-local" required />
                </div>
                <div className="field">
                  <label className="field-label" htmlFor={`n-${item.id}`}>Note to customer</label>
                  <input id={`n-${item.id}`} name="adminNote" maxLength={1000} placeholder="Optional" />
                </div>
                <button className="btn btn-primary btn-sm" type="submit">Confirm</button>
                <button className="btn btn-danger btn-sm" type="button"
                  onClick={() => update(item.id, 'rejected')}>Decline</button>
              </form>
            )}
            {item.status === 'confirmed' && (
              <div className="admin-actions">
                <button className="btn btn-primary btn-sm" type="button" onClick={() => update(item.id, 'in_progress')}>Start repair</button>
                <button className="btn btn-danger btn-sm" type="button" onClick={() => update(item.id, 'no_show')}>Mark no-show</button>
              </div>
            )}
            {item.status === 'in_progress' && (
              <div className="admin-actions">
                <button className="btn btn-primary btn-sm" type="button" onClick={() => update(item.id, 'completed')}>Complete repair</button>
              </div>
            )}
          </article>
        ))}
        <section className="admin-payments" aria-labelledby="payments-heading">
          <div className="dash-hd"><div><span className="eyebrow">Manual verification</span><h2 id="payments-heading" className="section-h2">Payments.</h2></div></div>
          {!payments.length && <p className="muted">Payment records will appear after the mechanic provides an estimate.</p>}
          {payments.map(payment => <article className="admin-card" key={payment.id}>
            <div className="admin-card-hd"><div><div className="booking-ref">{payment.booking_ref}</div><h3>{payment.customer_name}</h3><a href={`mailto:${payment.customer_email}`}>{payment.customer_email}</a></div><span className={`status status-${payment.status}`}>{payment.status.replaceAll('_', ' ')}</span></div>
            <div className="admin-body"><div className="admin-details">
              <div><div className="admin-dl">Estimate</div><div className="admin-dv">{payment.estimated_amount === null ? 'Not set' : `₱${Number(payment.estimated_amount).toFixed(2)}`}</div></div>
              <div><div className="admin-dl">Final cost</div><div className="admin-dv">{payment.final_amount === null ? 'Not set' : `₱${Number(payment.final_amount).toFixed(2)}`}</div></div>
            </div>
            {payment.transactions.map(transaction => <div className="payment-admin-row" key={transaction.id}>
              <div><strong>₱{Number(transaction.amount).toFixed(2)} · {transaction.method.replaceAll('_', ' ')}</strong><p>Reference: {transaction.transaction_ref || 'Cash'} · {transaction.status.replaceAll('_', ' ')}</p>{transaction.admin_note && <p>{transaction.admin_note}</p>}</div>
              <div className="bike-card-actions">
                {transaction.has_proof && <a className="btn btn-outline btn-sm" href={`/api/payments/transactions/${transaction.id}/proof`} target="_blank" rel="noreferrer">View proof</a>}
                {['pending', 'submitted'].includes(transaction.status) && <><button className="btn btn-primary btn-sm" type="button" onClick={() => reviewPayment(transaction.id, 'verify')}>Verify</button><button className="btn btn-danger btn-sm" type="button" onClick={() => reviewPayment(transaction.id, 'reject')}>Reject</button></>}
                {transaction.status === 'verified' && <button className="btn btn-outline btn-sm" type="button" onClick={() => reviewPayment(transaction.id, 'refund')}>Refund</button>}
              </div>
            </div>)}
            {payment.status !== 'paid' && payment.status !== 'refunded' && <form className="admin-actions" onSubmit={event => recordCash(event, payment)}>
              <div className="field"><label className="field-label" htmlFor={`cash-${payment.id}`}>Cash received (PHP)</label><input id={`cash-${payment.id}`} name="amount" type="number" min="0.01" step="0.01" required /></div>
              <button className="btn btn-outline btn-sm" type="submit">Record cash</button>
            </form>}
            </div>
          </article>)}
        </section>
      </main>
      <Footer />
    </>
  )
}

/* ── App shell ────────────────────────────────────────────── */
