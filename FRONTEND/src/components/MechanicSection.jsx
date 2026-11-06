import { useState } from 'react'
import { MECHANIC } from '../data/mechanic'

const CERTIFICATE_IMAGES = {
  Shimano: '/images/certificates/shimano.jpg',
  SRAM: '/images/certificates/sram.jpg',
  Campag: '/images/certificates/campagnolo.jpg',
  Trek: '/images/certificates/trek.jpg',
}

function CertificateCard({ certificate }) {
  const [available, setAvailable] = useState(true)
  const image = certificate.image || CERTIFICATE_IMAGES[certificate.body]

  return (
    <a
      className={`cert-row ${available ? '' : 'cert-missing'}`}
      href={available ? image : undefined}
      target="_blank"
      rel="noreferrer"
      aria-disabled={!available}
      onClick={event => { if (!available) event.preventDefault() }}
    >
      <span className="cert-thumb">
        <img src={image} alt={`${certificate.title} certificate`} onError={() => setAvailable(false)} />
        <span className="cert-placeholder">Add<br />image</span>
      </span>
      <span className="cert-copy">
        <span className="cert-badge">{certificate.body}</span>
        <span className="cert-name">{certificate.title}</span>
        <span className="cert-open">{available ? 'View certificate ↗' : 'Certificate image not added'}</span>
      </span>
      <span className="cert-year">{certificate.year}</span>
    </a>
  )
}

export default function MechanicSection() {
  return (
    <section className="mech-section" id="mechanic">
      <div className="mech-col">
        <span className="eyebrow">The person behind the wrench</span>
        <h2 className="section-h2">Your mechanic.</h2>

        <div className="mech-bio-grid">
          <div className="mech-photo-stack">
            <img
              src={MECHANIC.photo}
              alt={`${MECHANIC.name} — mechanic at Spoke & Wrench`}
              className="mech-portrait"
              onError={e => { e.currentTarget.parentElement.dataset.imageError = 'true' }}
            />
            <div className="mech-portrait-fallback">MR</div>
          </div>

          <div className="mech-info" id="mechanic-owner">
            <div className="mech-name-row">
              <div>
                <div className="mech-name">{MECHANIC.name}</div>
                <div className="mech-role">{MECHANIC.role}</div>
              </div>
              <span className="mech-avail">Available for bookings</span>
            </div>
            <p className="mech-bio-text">{MECHANIC.bio}</p>
            <div className="mech-highlights">
              {MECHANIC.highlights.map(h => (
                <div className="mech-hl" key={h.val}>
                  <div className="mech-hl-icon">{h.icon}</div>
                  <strong className="mech-hl-val">{h.val}</strong>
                  <span className="mech-hl-sub">{h.sub}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mech-builds">
          <div className="mech-builds-head">
            <div>
              <div className="mech-block-h">Bike builds</div>
              <p className="mech-builds-note">Selected work from the workshop.</p>
            </div>
            <span className="mech-build-count">{MECHANIC.bikeBuilds.length} PHOTOS</span>
          </div>
          <div className="mech-bike-wrap" aria-label="Mechanic's bicycle builds">
            {MECHANIC.bikeBuilds.map((build, index) => (
              <figure className="mech-build-card" key={`${build.src}-${index}`}>
                <div className="mech-build-image">
                  <img src={build.src} alt={build.alt} className="mech-bike-img" loading="lazy" />
                  {build.caption && <figcaption className="mech-bike-cap">{build.caption}</figcaption>}
                </div>
                <a className="mech-bike-owner" href="#mechanic-owner">
                  <span>Owner</span>
                  <strong>{MECHANIC.name}</strong>
                  <span className="mech-owner-link">View profile ↗</span>
                </a>
              </figure>
            ))}
          </div>
        </div>

        <div>
          <div className="mech-block-h">Areas of expertise</div>
          <div className="mech-expertise-grid">
            {MECHANIC.expertise.map(e => (
              <div className="mech-exp-card" key={e.area}>
                <span className="mech-exp-area">{e.area}</span>
                <p className="mech-exp-detail">{e.detail}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="mech-creds">
          <div>
            <div className="mech-block-h">Certifications</div>
            <div className="cert-list">
              {MECHANIC.certifications.map(c => <CertificateCard key={c.title} certificate={c} />)}
            </div>
          </div>
          <div>
            <div className="mech-block-h">Licences &amp; registrations</div>
            <ul className="lic-list">
              {MECHANIC.licences.map(l => (
                <li className="lic-item" key={l}>
                  <span className="lic-dot" aria-hidden="true" />
                  {l}
                </li>
              ))}
            </ul>
            <p className="lic-note">Physical copies available on request at the workshop.</p>
          </div>
        </div>
      </div>
    </section>
  )
}

/* ── Testimonials ─────────────────────────────────────────── */
