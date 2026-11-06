import mechanicPortrait from '../assets/palluh.png'
import featuredBikeBuild from '../assets/bike-photo.jpg'
import shimanoCertificate from '../assets/shimano.jpg'
import sramCertificate from '../assets/sramcert.jpg'

export const MECHANIC = {
  name: 'Palluh, Abdallah J.',
  role: 'Head Mechanic & Student',
  photo: mechanicPortrait,
  // Add a new entry here for each build photo. Public-folder files can use
  // paths like '/images/build-02.jpg' and will fit the same grid tile.
  bikeBuilds: [
    { src: featuredBikeBuild, alt: 'Mechanic’s featured bicycle build', caption: 'Featured build' },
    { src: featuredBikeBuild, alt: 'Mechanic’s featured bicycle build', caption: 'Build photo 2' },
    { src: featuredBikeBuild, alt: 'Mechanic’s featured bicycle build', caption: 'Build photo 3' },
    { src: featuredBikeBuild, alt: 'Mechanic’s featured bicycle build', caption: 'Build photo 4' },
  ],
  bio: `I've been wrenching on bicycles for over twelve years — road bikes, mountain bikes, city commuters, and everything in between. I started Spoke & Wrench because riders deserved a shop where every bike gets the same careful attention, not just the expensive ones.

I'll never recommend a repair you don't need, and I'll always explain what I'm doing before I do it.`,
  highlights: [
    { icon: '🔧', val: '12+ years',    sub: 'Professional experience' },
    { icon: '🚴', val: '1,200+',       sub: 'Bicycles serviced'       },
    { icon: '⭐', val: '4.9 / 5',      sub: 'Customer rating'         },
    { icon: '📍', val: 'Metro Manila', sub: 'Based locally'           },
  ],
  expertise: [
    { area: 'Road & gravel',      detail: 'Race builds, fit adjustments, long-haul touring set-ups.' },
    { area: 'Mountain bike',      detail: 'Suspension service, dropper posts, tubeless conversion, trail tuning.' },
    { area: 'Drivetrain & gears', detail: 'Indexing, cable tension, derailleur alignment, Di2 & AXS groupsets.' },
    { area: 'Wheels & tyres',     detail: 'Truing, spoke replacement, bearing overhaul, tubeless setup.' },
    { area: 'Brakes',             detail: 'Hydraulic bleed, rotor alignment, rim brake setup and pad replacement.' },
    { area: 'City & commuter',    detail: 'Lighting, racks, fenders, internal hub servicing, reliability builds.' },
  ],
  certifications: [
    { body: 'Shimano', title: 'Shimano Certified Dealer Technician',        year: '2019', image: shimanoCertificate },
    { body: 'SRAM',    title: 'SRAM Technical Service Course — Level II',   year: '2021', image: sramCertificate },
    { body: 'Campag',  title: 'Campagnolo Technical Training Certificate',  year: '2022' },
    { body: 'Trek',    title: 'Trek University — Advanced Service Program', year: '2020' },
  ],
  licences: [
    'DTI-Registered Business — Metro Manila',
    'BIR Certificate of Registration',
    'Barangay Business Permit — current year',
  ],
}

export const TESTIMONIALS = [
  {
    id: 1, name: 'Rachel Santos', ride: 'Road cyclist, Makati', rating: 5,
    text: 'Marco rebuilt my entire drivetrain and re-cabled the bike. The shifting is cleaner than when it was new. He explained every step — I actually understand my bike now.',
    service: 'Full tune-up & drivetrain overhaul',
  },
  {
    id: 2, name: 'Miguel Cruz', ride: 'Mountain biker, QC', rating: 5,
    text: "Brought in a creaking bottom bracket two other shops couldn't fix. Marco identified it in ten minutes, had the right parts, and sorted it same day.",
    service: 'Bottom bracket replacement',
  },
  {
    id: 3, name: 'Jana Villanueva', ride: 'Daily commuter, BGC', rating: 5,
    text: "I know nothing about bikes and I never felt talked down to. Marco set up my city bike, recommended a good lock, and followed up a week later to check how it was going.",
    service: 'Commuter setup & accessories',
  },
  {
    id: 4, name: 'Rodel Aquino', ride: 'Triathlete, Pasig', rating: 5,
    text: 'Pre-race tune and fit session before my A-race. Everything felt dialled in on the day. Fast turnaround, fair price, and zero drama.',
    service: 'Pre-race tune-up & fit check',
  },
]

/* Hero preview services */
export const HERO_SVCS = [
  { name: 'Full tune-up',      price: '₱850' },
  { name: 'Brake adjustment',  price: '₱350' },
  { name: 'Drivetrain clean',  price: '₱600' },
  { name: 'Flat tyre repair',  price: '₱200' },
]

/* ── Mechanic section ─────────────────────────────────────── */
