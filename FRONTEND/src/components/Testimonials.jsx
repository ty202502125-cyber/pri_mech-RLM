import { TESTIMONIALS } from '../data/mechanic'

export default function Testimonials() {
  return (
    <section className="testi-section">
      <div className="testi-col">
        <div className="testi-hd">
          <div>
            <span className="eyebrow">What riders say</span>
            <h2 className="section-h2">Customers who <mark>came back.</mark></h2>
          </div>
          <div className="rating-block">
            <span className="rating-num">4.9</span>
            <span className="rating-stars">★★★★★</span>
            <p className="rating-label">from 60+ verified reviews</p>
          </div>
        </div>
        <div className="testi-grid">
          {TESTIMONIALS.map(t => (
            <article className="testi-card" key={t.id}>
              <div className="testi-stars" aria-label={`${t.rating} stars`}>{'★'.repeat(t.rating)}</div>
              <blockquote className="testi-quote">{t.text}</blockquote>
              <footer className="testi-footer">
                <div className="testi-av" aria-hidden="true">{t.name[0]}</div>
                <div>
                  <strong className="testi-name">{t.name}</strong>
                  <span className="testi-ride">{t.ride}</span>
                  <span className="testi-svc">{t.service}</span>
                </div>
              </footer>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ── Home ─────────────────────────────────────────────────── */
