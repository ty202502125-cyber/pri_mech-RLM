import { useEffect, useRef, useState } from 'react'

const STEP_MS = 6500

const STEPS = [
  {
    title: "Tell us what's up",
    body: "Choose a service, describe what you've noticed, and suggest a time.",
    points: ['Pick one or more services', 'Describe the problem in your own words', 'Attach photos if it helps'],
  },
  {
    title: 'Get a clear repair plan',
    body: 'The mechanic reviews your request, confirms a slot, and answers any questions.',
    points: ['A confirmed drop-off time', 'An estimate before any work starts', 'Questions answered inside your booking'],
  },
  {
    title: 'Ride with confidence',
    body: 'Approve the work, follow progress, and collect your bicycle.',
    points: ['Approve parts and extra work first', 'Follow every repair stage', 'Pick up and ride'],
  },
]

function RequestPreview() {
  const noticed = 'Brakes squeal when I stop hard'
  return (
    <div className="panel-card">
      <div className="panel-card-hd"><strong>New service request</strong><span className="panel-chip">Draft</span></div>
      <dl className="panel-rows">
        <div><dt>Bike</dt><dd>Mountain bike</dd></div>
        <div><dt>What you noticed</dt><dd><span className="typing" style={{ '--chars': noticed.length }}>{noticed}</span></dd></div>
        <div><dt>Preferred time</dt><dd>Saturday · 9:00 AM</dd></div>
      </dl>
    </div>
  )
}

function PlanPreview() {
  const rows = ['Request reviewed by the mechanic', 'Estimate shared before work starts', 'Drop-off slot confirmed']
  return (
    <div className="panel-card">
      <div className="panel-card-hd"><strong>Repair plan</strong><span className="panel-chip is-ok">Confirmed</span></div>
      <ul className="panel-checks">
        {rows.map((row, index) => (
          <li key={row} style={{ '--i': index }}><span className="panel-check" aria-hidden="true" />{row}</li>
        ))}
      </ul>
    </div>
  )
}

function ProgressPreview() {
  const stages = ['Checked in', 'In repair', 'Final check', 'Ready']
  return (
    <div className="panel-card">
      <div className="panel-card-hd"><strong>Repair progress</strong><span className="panel-chip is-live">Live</span></div>
      <ol className="panel-track">
        {stages.map((stage, index) => (
          <li key={stage} style={{ '--i': index }}><span className="panel-node" aria-hidden="true" />{stage}</li>
        ))}
      </ol>
    </div>
  )
}

const PREVIEWS = [RequestPreview, PlanPreview, ProgressPreview]

export default function ProcessStepper() {
  const [active, setActive] = useState(0)
  const [live, setLive] = useState(false)
  const rootRef = useRef(null)
  const tabRefs = useRef([])

  useEffect(() => {
    const el = rootRef.current
    if (!el) return undefined
    const observer = new IntersectionObserver(([entry]) => setLive(entry.isIntersecting), { threshold: 0.35 })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const select = (index, focus = false) => {
    const next = (index + STEPS.length) % STEPS.length
    setActive(next)
    if (focus) tabRefs.current[next]?.focus()
  }

  const onKeyDown = event => {
    const keys = { ArrowDown: active + 1, ArrowRight: active + 1, ArrowUp: active - 1, ArrowLeft: active - 1, Home: 0, End: STEPS.length - 1 }
    if (!(event.key in keys)) return
    event.preventDefault()
    select(keys[event.key], true)
  }

  const step = STEPS[active]
  const Preview = PREVIEWS[active]

  return (
    <div ref={rootRef} className={`stepper${live ? ' is-live' : ''}`} style={{ '--step-ms': `${STEP_MS}ms` }}>
      <div className="stepper-tabs" role="tablist" aria-label="How booking works" aria-orientation="vertical">
        {STEPS.map((item, index) => {
          const selected = index === active
          return (
            <button
              key={item.title}
              ref={el => { tabRefs.current[index] = el }}
              type="button"
              role="tab"
              id={`process-tab-${index}`}
              aria-selected={selected}
              aria-controls="process-panel"
              tabIndex={selected ? 0 : -1}
              className="stepper-tab"
              onClick={() => select(index)}
              onKeyDown={onKeyDown}
            >
              <span className="stepper-num" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
              <span className="stepper-copy">
                <span className="stepper-label">Step {index + 1}</span>
                <strong>{item.title}</strong>
                <span className="stepper-body"><span>{item.body}</span></span>
              </span>
              <span className="stepper-bar" aria-hidden="true">
                <span className="stepper-bar-fill" onAnimationEnd={() => select(index + 1)} />
              </span>
            </button>
          )
        })}
      </div>

      <div className="process-panel" role="tabpanel" id="process-panel" aria-labelledby={`process-tab-${active}`}>
        <div className="process-panel-inner" key={active}>
          <div className="panel-kicker"><span>Step {active + 1} of {STEPS.length}</span><span>Example</span></div>
          <h3 className="panel-title">{step.title}</h3>
          <Preview />
          <ul className="panel-points">
            {step.points.map(point => <li key={point}>{point}</li>)}
          </ul>
        </div>
      </div>
    </div>
  )
}
