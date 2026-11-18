import { Fragment, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'

const REVEAL_SELECTOR = [
  '[data-reveal]', '.section-h2', '.page-h1', '.page-lead', '.eyebrow', '.text-link',
  '.svc-card', '.inline-err', '.stepper',
  '.mech-info', '.mech-photo-stack', '.mech-profile-notice', '.mech-build-card', '.mech-exp-card', '.mech-creds > section', '.mech-block-h',
  '.testi-card', '.rating-block', '.reviews-empty', '.cta-col',
  '.booking-card', '.stat-box', '.table-wrap', '.notice', '.empty',
  '.auth-side', '.auth-form-side', '.ftr-highlight',
].join(',')

const REVEAL_EXCLUDE = '.hero, .modal, .modal-backdrop, [data-no-reveal]'
const SPOTLIGHT_SELECTOR = '.svc-card, .testi-card, .mech-build-card, .mech-exp-card, .booking-card, .stat-box, .process-panel, .ftr-highlight'

/* Global motion layer: scroll progress, header state, scroll reveals,
   card spotlight, magnetic buttons and tilt — all delegated, so pages
   only need class names or data attributes. */
export function useMotionSystem() {
  useEffect(() => {
    const root = document.documentElement
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches

    let scrollFrame = 0
    const syncScroll = () => {
      if (scrollFrame) return
      scrollFrame = requestAnimationFrame(() => {
        scrollFrame = 0
        const max = root.scrollHeight - window.innerHeight
        root.style.setProperty('--scroll', max > 0 ? (window.scrollY / max).toFixed(4) : '0')
        root.classList.toggle('is-scrolled', window.scrollY > 8)
      })
    }
    syncScroll()
    window.addEventListener('scroll', syncScroll, { passive: true })
    window.addEventListener('resize', syncScroll)

    let revealObserver
    let mutationObserver
    const cleanupTimers = new Set()
    if (!reducedMotion) {
      root.classList.add('motion-ready')
      const seen = new WeakSet()
      revealObserver = new IntersectionObserver(entries => {
        entries.filter(entry => entry.isIntersecting).forEach((entry, index) => {
          const el = entry.target
          revealObserver.unobserve(el)
          const delay = Math.min(index, 6) * 80
          el.style.setProperty('--rv-d', `${delay}ms`)
          el.classList.add('is-in')
          const timer = window.setTimeout(() => {
            cleanupTimers.delete(timer)
            el.classList.remove('rv', 'is-in')
            el.style.removeProperty('--rv-d')
          }, 1000 + delay)
          cleanupTimers.add(timer)
        })
      }, { rootMargin: '0px 0px -6% 0px', threshold: 0 })

      const scan = node => {
        if (!(node instanceof Element)) return
        const matches = node.matches(REVEAL_SELECTOR) ? [node, ...node.querySelectorAll(REVEAL_SELECTOR)] : node.querySelectorAll(REVEAL_SELECTOR)
        matches.forEach(el => {
          if (seen.has(el) || el.closest(REVEAL_EXCLUDE)) return
          seen.add(el)
          el.classList.add('rv')
          revealObserver.observe(el)
        })
      }
      scan(document.body)
      mutationObserver = new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(scan)))
      mutationObserver.observe(document.body, { childList: true, subtree: true })
    }

    let activeMagnet = null
    let activeTilt = null
    const releaseMagnet = () => { if (activeMagnet) activeMagnet.style.translate = ''; activeMagnet = null }
    const releaseTilt = () => {
      if (activeTilt) ['--rx', '--ry', '--gx', '--gy'].forEach(prop => activeTilt.style.removeProperty(prop))
      activeTilt = null
    }
    const onPointerMove = event => {
      const target = event.target instanceof Element ? event.target : null
      if (!target) return

      const spot = target.closest(SPOTLIGHT_SELECTOR)
      if (spot) {
        const rect = spot.getBoundingClientRect()
        spot.style.setProperty('--mx', `${event.clientX - rect.left}px`)
        spot.style.setProperty('--my', `${event.clientY - rect.top}px`)
      }

      const magnet = target.closest('[data-magnetic]')
      if (magnet !== activeMagnet) releaseMagnet()
      if (magnet) {
        activeMagnet = magnet
        const rect = magnet.getBoundingClientRect()
        const x = (event.clientX - rect.left - rect.width / 2) * 0.22
        const y = (event.clientY - rect.top - rect.height / 2) * 0.32
        magnet.style.translate = `${x.toFixed(1)}px ${y.toFixed(1)}px`
      }

      const tilt = target.closest('[data-tilt]')
      if (tilt !== activeTilt) releaseTilt()
      if (tilt) {
        activeTilt = tilt
        const rect = tilt.getBoundingClientRect()
        const px = (event.clientX - rect.left) / rect.width
        const py = (event.clientY - rect.top) / rect.height
        tilt.style.setProperty('--ry', `${((px - 0.5) * 8).toFixed(2)}deg`)
        tilt.style.setProperty('--rx', `${((0.5 - py) * 8).toFixed(2)}deg`)
        tilt.style.setProperty('--gx', `${(px * 100).toFixed(1)}%`)
        tilt.style.setProperty('--gy', `${(py * 100).toFixed(1)}%`)
      }
    }
    const onPointerLeaveWindow = event => { if (!event.relatedTarget) { releaseMagnet(); releaseTilt() } }
    if (finePointer && !reducedMotion) {
      document.addEventListener('pointermove', onPointerMove, { passive: true })
      document.addEventListener('pointerout', onPointerLeaveWindow)
    }

    return () => {
      cancelAnimationFrame(scrollFrame)
      window.removeEventListener('scroll', syncScroll)
      window.removeEventListener('resize', syncScroll)
      revealObserver?.disconnect()
      mutationObserver?.disconnect()
      cleanupTimers.forEach(timer => window.clearTimeout(timer))
      document.removeEventListener('pointermove', onPointerMove)
      document.removeEventListener('pointerout', onPointerLeaveWindow)
      root.classList.remove('motion-ready', 'is-scrolled')
    }
  }, [])
}

/* Re-mounts page content on navigation so every route enters with the same transition. */
export function RouteStage({ children }) {
  const { pathname } = useLocation()
  return <div className="route-stage" key={pathname}>{children}</div>
}

/* Masked word-by-word rise for display headlines. */
export function SplitWords({ text, start = 0, step = 75 }) {
  const words = text.split(' ')
  return words.map((word, index) => (
    <Fragment key={`${word}-${index}`}>
      <span className="sw"><span className="sw-in" style={{ '--d': `${start + index * step}ms` }}>{word}</span></span>
      {index < words.length - 1 ? ' ' : null}
    </Fragment>
  ))
}

/* Counts up to a real value once it scrolls into view. */
export function CountUp({ value, decimals = 0, duration = 1400 }) {
  const ref = useRef(null)
  const [shown, setShown] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(value)
      return undefined
    }
    let frame = 0
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return
      observer.disconnect()
      const startedAt = performance.now()
      const tick = now => {
        const progress = Math.min(1, (now - startedAt) / duration)
        setShown(value * (1 - Math.pow(1 - progress, 4)))
        if (progress < 1) frame = requestAnimationFrame(tick)
      }
      frame = requestAnimationFrame(tick)
    })
    observer.observe(el)
    return () => { observer.disconnect(); cancelAnimationFrame(frame) }
  }, [value, duration])
  return <span ref={ref}>{shown.toFixed(decimals)}</span>
}
