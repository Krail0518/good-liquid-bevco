import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Good Liquid Bev Co | Beverage Copacker | Palmetto, FL',
}

export default function HomePage() {
  return (
    <main className="bg-ink text-white overflow-x-hidden">

      {/* NAV */}
      <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-14 h-24 bg-ink/90 backdrop-blur-md border-b border-white/5">
        <a href="#hero" className="flex items-center">
          <span className="font-display text-2xl tracking-widest text-white">GOOD LIQUID</span>
          <span className="font-mono text-xs tracking-widest text-teal ml-2">BEV CO</span>
        </a>
        <div className="flex items-center gap-8">
          {['About', 'Services', 'Pricing', 'Certifications', 'Team'].map(l => (
            <a key={l} href={`#${l.toLowerCase()}`}
              className="text-sm font-medium text-muted hover:text-white transition-colors tracking-wide">{l}</a>
          ))}
          <a href="#contact"
            className="px-5 py-2 border-2 border-teal text-teal text-sm font-bold rounded-lg hover:bg-teal hover:text-ink transition-all tracking-wide">
            Get a Quote
          </a>
        </div>
      </nav>

      {/* HERO */}
      <section id="hero" className="min-h-screen flex flex-col justify-end px-14 pb-20 pt-32 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-ink/20 via-ink/50 to-ink z-0"></div>
        <div className="absolute inset-0 opacity-30" style={{
          backgroundImage: 'radial-gradient(ellipse 80% 60% at 60% 40%, rgba(26,111,255,0.18) 0%, transparent 60%), radial-gradient(ellipse 50% 40% at 20% 80%, rgba(0,229,192,0.12) 0%, transparent 55%)'
        }}></div>
        <div className="relative z-10">
          <div className="inline-flex items-center gap-3 mb-6 font-mono text-xs tracking-widest text-teal uppercase">
            <span className="w-1.5 h-1.5 rounded-full bg-teal animate-blink"></span>
            Family-run beverage copacker · Palmetto, FL · Est. 2017
          </div>
          <h1 className="font-display leading-none tracking-widest text-white mb-8" style={{ fontSize: 'clamp(80px, 10vw, 148px)' }}>
            WE TURN<br />
            BEVERAGE<br />
            <span className="text-teal">IDEAS TO<br />REALITY.</span>
          </h1>
          <div className="flex items-end justify-between gap-10">
            <p className="text-lg font-light text-white/65 max-w-md leading-relaxed">
              Good Liquid Bev Co turns your beverage concept into a finished, palletized product — from formulation to first shipment.
            </p>
            <div className="flex gap-4 flex-shrink-0">
              <a href="#contact" className="px-9 py-4 bg-teal text-ink font-bold text-sm rounded-lg hover:bg-teal-2 transition-all tracking-wide hover:-translate-y-1">
                Get a quote →
              </a>
              <a href="#services" className="px-9 py-4 border-2 border-white/20 text-white font-medium text-sm rounded-lg hover:border-white transition-all hover:-translate-y-1">
                See capabilities
              </a>
            </div>
          </div>
          <div className="flex mt-16 pt-8 border-t border-white/8">
            {[
              { n: '150+', l: 'Min cases / run' }, { n: '$1K', l: 'R&D starting fee' },
              { n: '3', l: 'Can formats' }, { n: '8wk', l: 'Typical timeline' }
            ].map(s => (
              <div key={s.l} className="flex-1 border-r border-white/8 last:border-none px-8 first:pl-0">
                <div className="font-display text-5xl tracking-widest gradient-text leading-none">{s.n}</div>
                <div className="text-xs tracking-widest uppercase text-muted mt-1.5">{s.l}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* TICKER */}
      <div className="bg-teal py-3.5 overflow-hidden whitespace-nowrap">
        <div className="inline-flex animate-tick">
          {Array(2).fill(['SMALL BATCH CANNING','BEVERAGE FORMULATION','BOTTLE FILLING','THC / CBD COMPLIANT','MATERIALS SOURCING','FLASH PASTEURIZATION','NITROGEN DOSING','BRAND CONSULTING']).flat().map((t, i) => (
            <span key={i} className="font-display text-sm tracking-widest text-ink px-8">
              {i % 8 !== 7 ? t : <>{t}<span className="mx-8 opacity-30">✦</span></>}
            </span>
          ))}
        </div>
      </div>

      {/* SERVICES */}
      <section id="services" className="px-14 py-24 bg-ink-2">
        <div className="text-center mb-14">
          <div className="font-mono text-xs tracking-widest text-teal uppercase mb-3">What we do</div>
          <h2 className="font-display leading-none tracking-widest text-white" style={{ fontSize: 'clamp(42px,5.5vw,70px)' }}>
            FULL-SERVICE <span className="gradient-text">CO-PACKING.</span>
          </h2>
        </div>
        <div className="grid grid-cols-2 gap-4">
          {[
            { icon: '🧪', n: '01', title: 'BEVERAGE FORMULATION', desc: 'Full lifecycle R&D from early-stage recipe to full-scale formula. Ingredient selection, flavor profiling, shelf stability, and labeling guidance.', price: '$1,000', unit: 'starting / 3 iterations', bullets: ['Functional beverages, seltzers, wellness drinks','Alcohol-free, infused & THC/CBD compliant','Shelf stability & nutritional planning','Full IP ownership options available'] },
            { icon: '🥫', n: '02', title: 'SMALL BATCH CANNING', desc: 'High-efficiency cold-fill canning. Three formats, PakTech handles, custom lid colors, optional flash pasteurization and nitrogen dosing.', price: '$0.28', unit: '/ can at volume', bullets: [] },
            { icon: '🍾', n: '03', title: 'BOTTLE FILLING', desc: '750ml bottle services — filling, corking, shrink sleeving, labeling, case building, and palletizing. Flash pasteurization available.', price: '$1.12', unit: '/ bottle at volume', bullets: [] },
            { icon: '🤝', n: '04', title: 'CONSULTING & SOURCING', desc: 'Materials sourcing, packaging coordination, brand strategy. CO₂, gases, filtered water, carbonated water, preservatives. Cost + 10%.', price: 'Cost +10%', unit: 'procurement fee', bullets: [] },
          ].map(s => (
            <div key={s.n} className="bg-white/2 border border-white/6 rounded-2xl p-9 relative overflow-hidden hover:border-teal/25 hover:-translate-y-1.5 transition-all group">
              <div className="text-3xl mb-5">{s.icon}</div>
              <h3 className="font-display text-3xl tracking-wide text-white mb-3">{s.title}</h3>
              <p className="text-sm text-muted leading-relaxed mb-5">{s.desc}</p>
              {s.bullets.length > 0 && (
                <ul className="space-y-2 mb-5">
                  {s.bullets.map(b => <li key={b} className="flex items-center gap-2 text-xs text-white/75"><span className="w-1 h-1 rounded-full bg-teal flex-shrink-0"></span>{b}</li>)}
                </ul>
              )}
              <div className="inline-flex items-baseline gap-1.5 px-4 py-2 bg-teal/10 border border-teal/20 rounded-lg">
                <span className="font-display text-2xl text-teal">{s.price}</span>
                <span className="text-xs text-teal/70">{s.unit}</span>
              </div>
              <div className="absolute bottom-4 right-5 font-display text-8xl text-white/3">{s.n}</div>
            </div>
          ))}
        </div>
      </section>

      {/* CERTIFICATIONS */}
      <section id="certifications" className="px-14 py-24">
        <div className="text-center mb-14">
          <div className="font-mono text-xs tracking-widest text-teal uppercase mb-3">Food safety credentials</div>
          <h2 className="font-display leading-none tracking-widest text-white" style={{ fontSize: 'clamp(42px,5.5vw,70px)' }}>
            CERTIFIED & <span className="gradient-text">COMPLIANT.</span>
          </h2>
        </div>
        <div className="flex justify-center gap-10">
          {[
            { acro: 'GMP', name: 'Good Manufacturing Practices', desc: 'Consistent, controlled production meeting quality and regulatory standards.' },
            { acro: 'PCQI', name: 'Preventive Controls Qualified Individual', desc: 'FDA FSMA compliance for identifying and controlling food safety hazards.' },
            { acro: 'HACCP', name: 'Hazard Analysis Critical Control Points', desc: 'Systematic approach to eliminating biological, chemical, and physical hazards.' },
          ].map(c => (
            <div key={c.acro} className="flex flex-col items-center gap-4 max-w-52 text-center">
              <div className="w-44 h-44 rounded-full border-2 border-dashed border-teal/40 flex flex-col items-center justify-center bg-ink-2 relative">
                <div className="w-36 h-36 rounded-full border border-teal/20 flex flex-col items-center justify-center bg-ink-3">
                  <div className="w-9 h-9 rounded-full bg-teal flex items-center justify-center mb-2">
                    <span className="text-ink text-sm">✓</span>
                  </div>
                  <div className="font-display text-2xl tracking-widest text-white">{c.acro}</div>
                </div>
              </div>
              <div>
                <div className="font-display text-lg tracking-wide text-white mb-1">{c.acro}</div>
                <div className="text-xs text-muted leading-relaxed">{c.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* PROCESS */}
      <section id="process" className="px-14 py-24 bg-ink-2 relative overflow-hidden">
        <div className="absolute inset-0 opacity-100" style={{
          backgroundImage: 'repeating-linear-gradient(0deg,rgba(255,255,255,.018) 0,rgba(255,255,255,.018) 1px,transparent 1px,transparent 60px),repeating-linear-gradient(90deg,rgba(255,255,255,.018) 0,rgba(255,255,255,.018) 1px,transparent 1px,transparent 60px)'
        }}></div>
        <div className="relative z-10">
          <div className="text-center mb-14">
            <div className="font-mono text-xs tracking-widest text-teal uppercase mb-3">How it works</div>
            <h2 className="font-display leading-none tracking-widest text-white" style={{ fontSize: 'clamp(42px,5.5vw,70px)' }}>
              WE TURN BEVERAGE <span className="gradient-text">IDEAS TO REALITY.</span>
            </h2>
          </div>
          <div className="grid grid-cols-3 gap-5">
            {[
              { n: '01', title: 'FORMULATION', time: '2–4 weeks', desc: 'Expert R&D facility develops and refines your formula — ingredients, flavors, shelf stability, nutritional planning, labeling. 3 iterations included.' },
              { n: '02', title: 'SOURCING', time: '2–4 weeks', desc: 'We coordinate your entire supply chain — cans, ingredients, packaging — leveraging our vendor network for competitive pricing and fast delivery to Palmetto.' },
              { n: '03', title: 'PRODUCTION', time: '4 weeks', desc: 'Materials in-house, slot secured. We run your batch on our high-efficiency cold-fill line and deliver finished, palletized product.' },
            ].map(p => (
              <div key={p.n} className="bg-white/2 border border-white/7 rounded-2xl p-9 relative overflow-hidden hover:border-teal/20 hover:-translate-y-2 transition-all group">
                <div className="w-12 h-12 rounded-full border-2 border-teal flex items-center justify-center mb-6">
                  <span className="font-display text-lg text-teal">{p.n}</span>
                </div>
                <h3 className="font-display text-3xl tracking-wide text-white mb-2">{p.title}</h3>
                <div className="inline-flex px-3 py-1 bg-blue-500/12 border border-blue-500/22 rounded-full font-mono text-xs text-blue-400 mb-4">{p.time}</div>
                <p className="text-sm text-muted leading-relaxed">{p.desc}</p>
                <div className="absolute top-4 right-4 font-display text-8xl text-teal/6">{p.n}</div>
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-teal to-blue-500 scale-x-0 group-hover:scale-x-100 transition-transform origin-left"></div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* TEAM */}
      <section id="team" className="px-14 py-24">
        <div className="text-center mb-14">
          <div className="font-mono text-xs tracking-widest text-teal uppercase mb-3">The team</div>
          <h2 className="font-display leading-none tracking-widest text-white" style={{ fontSize: 'clamp(42px,5.5vw,70px)' }}>
            REAL PEOPLE. <span className="gradient-text">REAL ANSWERS.</span>
          </h2>
        </div>
        <div className="grid grid-cols-2 gap-5 max-w-3xl mx-auto">
          {[
            { init: 'MK', color: '#0F6E56', tc: '#E1F5EE', name: 'Mike Krail', role: 'Sales & Strategy', email: 'Mike@GoodLiquid.com', bio: 'Your first call for new projects, pricing, and getting on the schedule. Mike will tell you straight whether we\'re the right fit.' },
            { init: 'SK', color: '#1a3a6e', tc: '#9FE1CB', name: 'Sandra Krail', role: 'Operations & Logistics', email: 'Sandra@GoodLiquid.com', bio: 'Sandra owns production scheduling, supply chain, and QC. She makes sure what you ordered is exactly what ships, on time.' },
          ].map(t => (
            <div key={t.init} className="bg-white/2 border border-white/7 rounded-2xl p-10 hover:border-teal/20 hover:-translate-y-1 transition-all">
              <div className="w-20 h-20 rounded-full flex items-center justify-center font-display text-3xl mb-5 border-2" style={{ background: t.color, color: t.tc, borderColor: t.tc + '80' }}>{t.init}</div>
              <h3 className="font-display text-3xl tracking-wide text-white mb-1">{t.name}</h3>
              <div className="font-mono text-xs tracking-widest text-teal uppercase mb-4">{t.role}</div>
              <p className="text-sm text-muted leading-relaxed mb-6">{t.bio}</p>
              <a href={`mailto:${t.email}`} className="inline-flex items-center gap-2 px-5 py-2.5 border-2 border-white/12 rounded-lg text-sm font-semibold text-white hover:border-teal hover:text-teal transition-all">
                ✉ {t.email}
              </a>
            </div>
          ))}
        </div>
        <div className="mt-5 max-w-3xl mx-auto bg-gradient-to-br from-teal/6 to-blue-500/6 border border-white/7 rounded-2xl p-8 flex items-center justify-between">
          <div>
            <div className="font-mono text-xs text-teal tracking-widest uppercase mb-2">📍 Visit the facility</div>
            <div className="font-display text-2xl tracking-wide text-white mb-1">PALMETTO, FL</div>
            <div className="font-mono text-sm text-white/80">2011 51st Ave E, Unit 100<br/>Palmetto, FL 34221</div>
          </div>
          <a href="#contact" className="px-7 py-3.5 bg-teal text-ink font-bold rounded-lg hover:bg-teal-2 transition-all hover:-translate-y-1">
            Schedule a tour →
          </a>
        </div>
      </section>

      {/* CONTACT */}
      <section id="contact" className="px-14 py-24 bg-ink-2 relative overflow-hidden">
        <div className="absolute bottom-0 left-0 font-display text-9xl text-white/[0.014] tracking-widest whitespace-nowrap pointer-events-none leading-none">GOOD LIQUID</div>
        <div className="relative z-10 grid grid-cols-2 gap-20 items-start">
          <div>
            <div className="font-mono text-xs tracking-widest text-teal uppercase mb-4">Get started</div>
            <h2 className="font-display leading-none tracking-widest text-white mb-6" style={{ fontSize: 'clamp(42px,5vw,66px)' }}>
              LET'S MAKE SOMETHING <span className="text-teal">GOOD.</span>
            </h2>
            <p className="text-base text-muted leading-relaxed mb-10">Whether you have a polished brief or a rough idea, we'll give you an honest read on fit and timeline.</p>
            <div className="space-y-3">
              {[
                { icon: '📍', label: 'Address', val: '2011 51st Ave E, Unit 100 · Palmetto, FL 34221' },
                { icon: '📞', label: 'Phone', val: '(803) 493-5065' },
                { icon: '✉️', label: 'Sales & Strategy', val: 'Mike@GoodLiquid.com' },
                { icon: '⚙️', label: 'Operations', val: 'Sandra@GoodLiquid.com' },
                { icon: '⏱️', label: 'Response time', val: 'Within 1 business day — from a real person.' },
              ].map(c => (
                <div key={c.label} className="flex items-start gap-4 p-4 bg-white/2 border border-white/6 rounded-xl hover:border-teal/18 hover:bg-teal/3 transition-all">
                  <span className="text-lg mt-0.5">{c.icon}</span>
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-widest text-muted mb-0.5">{c.label}</div>
                    <div className="text-sm text-white">{c.val}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <ContactForm />
        </div>
      </section>

      {/* FOOTER */}
      <footer className="bg-ink border-t border-white/6 px-14 py-9 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="font-display text-xl tracking-widest text-white">GOOD LIQUID</span>
          <span className="font-mono text-xs tracking-widest text-teal">BEV CO</span>
        </div>
        <div className="flex gap-6">
          {['About','Services','Pricing','Certifications','Team','Contact'].map(l => (
            <a key={l} href={`#${l.toLowerCase()}`} className="text-xs text-muted hover:text-teal transition-colors">{l}</a>
          ))}
          <a href="mailto:Mike@GoodLiquid.com" className="text-xs text-muted hover:text-teal transition-colors">Mike@GoodLiquid.com</a>
        </div>
        <div className="text-xs text-muted">© 2026 Good Liquid Bev Co · goodliquidbevco.com</div>
      </footer>

    </main>
  )
}

function ContactForm() {
  return (
    <div className="bg-white/[0.024] border border-white/8 rounded-2xl p-10 relative overflow-hidden">
      <div className="absolute -top-20 -right-20 w-64 h-64 rounded-full bg-teal/7 blur-3xl pointer-events-none"></div>
      <h3 className="font-display text-2xl tracking-wide text-white mb-7">REQUEST A QUOTE</h3>
      <form action="/api/contact" method="POST" className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-muted uppercase tracking-wide mb-1.5">Brand name</label>
            <input name="brand_name" type="text" placeholder="Your Beverage Co." className="form-input" />
          </div>
          <div>
            <label className="block text-xs text-muted uppercase tracking-wide mb-1.5">Your name *</label>
            <input name="contact_name" type="text" placeholder="First & last" required className="form-input" />
          </div>
        </div>
        <div>
          <label className="block text-xs text-muted uppercase tracking-wide mb-1.5">Email *</label>
          <input name="email" type="email" placeholder="you@brand.com" required className="form-input" />
        </div>
        <div>
          <label className="block text-xs text-muted uppercase tracking-wide mb-1.5">Phone</label>
          <input name="phone" type="tel" placeholder="(555) 000-0000" className="form-input" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-muted uppercase tracking-wide mb-1.5">Service needed</label>
            <select name="service" className="form-input">
              <option>Beverage R&D</option>
              <option>Small batch canning</option>
              <option>Bottle filling</option>
              <option>Co-packing</option>
              <option>Consulting</option>
              <option>Not sure yet</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-muted uppercase tracking-wide mb-1.5">Volume estimate</label>
            <select name="volume" className="form-input">
              <option>150–339 cases (pilot)</option>
              <option>340–500 cases</option>
              <option>501–999 cases</option>
              <option>1,000–2,499</option>
              <option>2,500+ cases</option>
            </select>
          </div>
        </div>
        <div>
          <label className="block text-xs text-muted uppercase tracking-wide mb-1.5">Project details</label>
          <textarea name="message" rows={3} placeholder="Product concept, flavor, timeline, questions…" className="form-input resize-none" />
        </div>
        <button type="submit"
          className="w-full py-3.5 bg-teal text-ink font-bold text-sm rounded-lg hover:bg-teal-2 transition-all hover:-translate-y-0.5 tracking-wide">
          Send inquiry →
        </button>
      </form>
    </div>
  )
}
