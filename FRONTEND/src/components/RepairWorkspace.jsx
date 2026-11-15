import { useEffect, useRef, useState } from 'react'
import api from '../services/api'

const money = value => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(value || 0))
const label = value => String(value || '').replaceAll('_', ' ')
const repairStages = ['bicycle_received', 'inspection', 'awaiting_customer_approval', 'in_progress', 'quality_check', 'ready_for_pickup', 'completed']
const createPartRow = id => ({ id, name: '', quantity: '1', unitCost: '', notes: '' })

export default function RepairWorkspace({ booking, onUpdated }) {
  const [repair, setRepair] = useState(null)
  const [parts, setParts] = useState([])
  const [partRows, setPartRows] = useState([createPartRow(0)])
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [refresh, setRefresh] = useState(0)
  const nextPartRowId = useRef(1)

  useEffect(() => {
    let active = true
    setLoading(true)
    api.get(`/repairs/${booking.id}`)
      .then(({ data }) => {
        if (!active) return
        setRepair(data.repair)
        setParts(data.parts || [])
        setHistory(data.history || [])
        setError('')
      })
      .catch(err => {
        if (!active) return
        if (err.response?.status === 404) {
          setRepair(null); setParts([]); setHistory([]); setError('')
        } else setError(err.response?.data?.error || 'Could not load repair details.')
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [booking.id, refresh])

  async function save(event, payload, create = false) {
    event?.preventDefault()
    setBusy(true); setError(''); setNotice('')
    try {
      if (create) await api.post(`/repairs/${booking.id}`, payload)
      else await api.put(`/repairs/${repair.id}`, payload)
      setNotice(create ? 'Repair intake recorded.' : 'Repair record updated.')
      setRefresh(value => value + 1)
      onUpdated?.()
      return true
    } catch (err) {
      setError(err.response?.data?.error || 'Could not update the repair record.')
      return false
    } finally { setBusy(false) }
  }

  function updatePartRow(id, field, value) {
    setPartRows(rows => rows.map(row => row.id === id ? { ...row, [field]: value } : row))
  }

  async function addParts(event) {
    event.preventDefault()
    const saved = await save(event, {
      parts: partRows.map(({ name, quantity, unitCost, notes }) => ({ name, quantity, unitCost, notes })),
    })
    if (saved) {
      const id = nextPartRowId.current++
      setPartRows([createPartRow(id)])
    }
  }

  async function recordPickup(event) {
    event.preventDefault()
    const note = new FormData(event.currentTarget).get('pickupNote')
    setBusy(true); setError(''); setNotice('')
    try {
      await api.post(`/repairs/${repair.id}/pickup`, { note })
      setNotice('Bicycle handover recorded and repair completed.')
      setRefresh(value => value + 1)
      onUpdated?.()
    } catch (err) {
      setError(err.response?.data?.error || 'Could not record bicycle pickup.')
    } finally { setBusy(false) }
  }

  if (booking.status !== 'in_progress' && booking.status !== 'completed') return null
  if (loading) return <section className="repair-workspace modal-section"><p className="muted">Loading repair record…</p></section>

  return <section className="repair-workspace modal-section" aria-labelledby={`repair-heading-${booking.id}`}>
    <div className="repair-workspace-heading">
      <div><span className="eyebrow">Workshop record</span><h4 id={`repair-heading-${booking.id}`}>Repair workflow</h4></div>
      {repair && <span className={`status status-${repair.status}`}>{label(repair.status)}</span>}
    </div>
    {error && <div className="msg msg-error" role="alert">{error}</div>}
    {notice && <div className="msg msg-success" role="status">{notice}</div>}
    {!repair ? (
      booking.status === 'completed'
        ? <p>This completed booking has no repair record to display.</p>
        : <form className="workspace-form" onSubmit={event => save(event, { inspectionNotes: new FormData(event.currentTarget).get('inspectionNotes') }, true)}>
          <p>Record the bicycle’s intake before beginning inspection.</p>
          <label className="field-label">Initial intake notes<textarea name="inspectionNotes" rows={3} maxLength={10000} placeholder="Condition, accessories, or concerns noted at handover" /></label>
          <button className="btn btn-primary btn-sm" disabled={busy}>{busy ? 'Recording…' : 'Create repair intake'}</button>
        </form>
    ) : <>
      <ol className="repair-stage-list" aria-label="Repair progress">
        {repairStages.map(stage => <li className={repairStages.indexOf(stage) <= repairStages.indexOf(repair.status) ? 'is-complete' : ''} key={stage}>{label(stage)}</li>)}
      </ol>
      <div className="repair-detail-grid">
        <div><strong>Inspection</strong><p>{repair.inspection_notes || 'Not recorded yet.'}</p></div>
        <div><strong>Estimate</strong><p>{repair.estimate_amount === null ? 'Not set' : money(repair.estimate_amount)} · {label(repair.estimate_status || 'not set')}</p></div>
        {repair.final_amount !== null && <div><strong>Final amount</strong><p>{money(repair.final_amount)}</p></div>}
        {repair.completion_notes && <div><strong>Completion notes</strong><p>{repair.completion_notes}</p></div>}
        {repair.warranty_until && <div><strong>Warranty until</strong><p>{new Date(`${repair.warranty_until}T00:00:00`).toLocaleDateString()}</p></div>}
      </div>

      {repair.status === 'bicycle_received' && <form className="workspace-form repair-action" onSubmit={event => {
        const values = Object.fromEntries(new FormData(event.currentTarget))
        return save(event, { status: 'inspection', inspectionNotes: values.inspectionNotes, note: 'Inspection started.' })
      }}>
        <label className="field-label">Inspection findings<textarea name="inspectionNotes" rows={3} maxLength={10000} required defaultValue={repair.inspection_notes || ''} /></label>
        <button className="btn btn-primary btn-sm" disabled={busy}>Start inspection</button>
      </form>}

      {repair.status === 'inspection' && <div className="repair-action-grid">
        <form className="workspace-form" onSubmit={event => {
          const values = Object.fromEntries(new FormData(event.currentTarget))
          return save(event, {
            estimateAmount: values.estimateAmount,
            inspectionNotes: values.inspectionNotes,
            note: values.note || 'Estimate sent for customer approval.',
          })
        }}>
          <strong>{repair.estimate_status === 'declined' ? 'Revise estimate for customer re-approval' : 'Send estimate for customer approval'}</strong>
          <label className="field-label">Estimate amount (PHP)<input name="estimateAmount" type="number" min="0" step="0.01" required defaultValue={repair.estimate_amount ?? ''} /></label>
          <label className="field-label">Inspection notes<textarea name="inspectionNotes" rows={3} maxLength={10000} defaultValue={repair.inspection_notes || ''} /></label>
          <label className="field-label">Note to customer <span className="field-opt">Optional</span><input name="note" maxLength={1000} /></label>
          <button className="btn btn-primary btn-sm" disabled={busy}>Send estimate</button>
        </form>
        <div className="workspace-form repair-no-estimate">
          <strong>Continue without an estimate</strong>
          <p>Use this only when no extra customer-approved work is required.</p>
          <button className="btn btn-outline btn-sm" type="button" disabled={busy} onClick={() => save(null, { status: 'in_progress', note: 'Repair work started.' })}>Start repair</button>
        </div>
      </div>}

      {repair.status === 'awaiting_customer_approval' && <div className="msg msg-info" role="status">
        Estimate of <strong>{money(repair.estimate_amount)}</strong> sent. Work stays on hold until the customer responds. They must approve any revised estimate.
      </div>}
      {repair.status === 'in_progress' && <div className="repair-action">
        <p>Repair work is in progress. Move the job into quality check when work is complete.</p>
        <button className="btn btn-primary btn-sm" type="button" disabled={busy} onClick={() => save(null, { status: 'quality_check', note: 'Repair moved to quality check.' })}>Begin quality check</button>
      </div>}
      {repair.status === 'quality_check' && <div className="repair-action-grid">
        <form className="workspace-form repair-action" onSubmit={event => {
          const values = Object.fromEntries(new FormData(event.currentTarget))
          return save(event, {
            status: 'ready_for_pickup',
            finalAmount: values.finalAmount,
            completionNotes: values.completionNotes,
            warrantyUntil: values.warrantyUntil || null,
            note: 'Quality check passed; final cost recorded and ready for pickup.',
          })
        }}>
          <strong>Complete final checks and record the final cost before marking ready.</strong>
          <div className="field-row">
            <label className="field-label">Final amount (PHP)<input name="finalAmount" type="number" min="0" step="0.01" required defaultValue={repair.final_amount ?? repair.estimate_amount ?? ''} /></label>
            <label className="field-label">Warranty until <span className="field-opt">Optional</span><input name="warrantyUntil" type="date" defaultValue={repair.warranty_until ? String(repair.warranty_until).slice(0, 10) : ''} /></label>
          </div>
          <label className="field-label">Completion notes<textarea name="completionNotes" rows={3} maxLength={10000} required defaultValue={repair.completion_notes || ''} /></label>
          <div className="modal-actions">
            <button className="btn btn-outline btn-sm" type="button" disabled={busy} onClick={() => save(null, { status: 'in_progress', note: 'Returned to repair work after quality check.' })}>Return to repair</button>
            <button className="btn btn-primary btn-sm" disabled={busy}>Save details &amp; mark ready</button>
          </div>
        </form>
      </div>}
      {repair.status === 'ready_for_pickup' && <>
        <form className="workspace-form repair-action" onSubmit={event => {
        const values = Object.fromEntries(new FormData(event.currentTarget))
        return save(event, {
          finalAmount: values.finalAmount,
          completionNotes: values.completionNotes,
          warrantyUntil: values.warrantyUntil || null,
          note: 'Final cost and completion details recorded.',
        })
      }}>
        <p>Review or update the final amount and completion summary before handing the bicycle back.</p>
        <div className="field-row">
          <label className="field-label">Final amount (PHP)<input name="finalAmount" type="number" min="0" step="0.01" required defaultValue={repair.final_amount ?? repair.estimate_amount ?? ''} /></label>
          <label className="field-label">Warranty until <span className="field-opt">Optional</span><input name="warrantyUntil" type="date" defaultValue={repair.warranty_until ? String(repair.warranty_until).slice(0, 10) : ''} /></label>
        </div>
        <label className="field-label">Completion notes<textarea name="completionNotes" rows={3} maxLength={10000} required defaultValue={repair.completion_notes || ''} /></label>
        <button className="btn btn-outline btn-sm" disabled={busy}>Save completion details</button>
        </form>
        <form className="workspace-form repair-action repair-pickup-action" onSubmit={recordPickup}>
          <strong>Pickup &amp; handover</strong>
          <p>Record the handover after the bicycle is ready. The system will complete the booking only after verified full payment.</p>
          <label className="field-label">Handover note <span className="field-opt">Optional</span><textarea name="pickupNote" maxLength={1000} rows={2} placeholder="Recipient or handover details" /></label>
          <button className="btn btn-primary btn-sm" disabled={busy}>Record pickup &amp; complete job</button>
        </form>
      </>}
      {repair.status === 'completed' && <p className="repair-completed-note">Bicycle handover recorded{repair.picked_up_at ? ` on ${new Date(repair.picked_up_at).toLocaleString()}` : ''}.</p>}

      {repair.status !== 'completed' && <form className="workspace-form repair-parts-form" onSubmit={addParts}>
        <strong>Add parts used</strong>
        {partRows.map((part, index) => <div className="repair-part-entry" key={part.id}>
          <div className="repair-part-heading">
            <strong>Part {index + 1}</strong>
            {partRows.length > 1 && <button className="btn btn-outline btn-sm" type="button" disabled={busy} onClick={() => setPartRows(rows => rows.filter(row => row.id !== part.id))}>Remove</button>}
          </div>
          <div className="field-row">
            <label className="field-label">Part<input value={part.name} maxLength={160} required onChange={event => updatePartRow(part.id, 'name', event.target.value)} /></label>
            <label className="field-label">Quantity<input type="number" min="0.01" step="any" required value={part.quantity} onChange={event => updatePartRow(part.id, 'quantity', event.target.value)} /></label>
            <label className="field-label">Exact unit price (PHP)<input type="number" min="0" step="0.01" required value={part.unitCost} onChange={event => updatePartRow(part.id, 'unitCost', event.target.value)} /></label>
          </div>
          <label className="field-label">Notes <span className="field-opt">Optional</span><input maxLength={500} value={part.notes} onChange={event => updatePartRow(part.id, 'notes', event.target.value)} /></label>
        </div>)}
        <div className="modal-actions">
          <button className="btn btn-outline btn-sm" type="button" disabled={busy || partRows.length >= 50} onClick={() => {
            const id = nextPartRowId.current++
            setPartRows(rows => [...rows, createPartRow(id)])
          }}>+ Add another part</button>
          <button className="btn btn-primary btn-sm" disabled={busy}>{busy ? 'Saving…' : 'Save parts'}</button>
        </div>
      </form>}
      {parts.length > 0 && <div className="repair-parts-list">
        <strong>Parts used</strong>
        {parts.map(part => <div key={part.id}><span>{part.part_name} × {part.quantity} · {money(part.unit_cost)} each</span><span>{money(Number(part.unit_cost) * Number(part.quantity))}</span>{part.notes && <small>{part.notes}</small>}</div>)}
      </div>}
      {history.length > 0 && <details className="repair-history">
        <summary>Progress history</summary>
        <ul>{history.map((entry, index) => <li key={`${entry.created_at}-${index}`}><strong>{label(entry.new_status)}</strong> · {new Date(entry.created_at).toLocaleString()}{entry.note && <span>{entry.note}</span>}</li>)}</ul>
      </details>}
    </>}
  </section>
}
