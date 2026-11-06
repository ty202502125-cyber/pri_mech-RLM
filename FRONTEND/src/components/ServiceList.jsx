import { useEffect, useState } from 'react'
import api from '../services/api'
import { money } from '../utils/formatters'

export default function ServiceList() {
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
