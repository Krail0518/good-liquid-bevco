'use client'
import { useState, useEffect, useRef } from 'react'

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [formData, setFormData] = useState({ brandName: '', contactName: '', email: '', phone: '', message: '' })
  const [sent, setSent] = useState(false)
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 50)
    window.addEventListener('scroll', onScroll)
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    canvas.width = window.innerWidth
    canvas.height = window.innerHeight
    const particles: any[] = []
    for (let i = 0; i < 80; i++) {
      particles.push({ x: Math.random() * canvas.width, y: Math.random() * canvas.height, vx: (Math.random() - 0.5) * 0.5, vy: (Math.random() - 0.5) * 0.5, r: Math.random() * 3 + 1 })
    }
    let mouse = { x: -1000, y: -1000 }
    canvas.addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY })
    let animId: number
    function draw() {
      if (!ctx || !canvas) return
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      particles.forEach(p => {
        const dx = mouse.x - p.x, dy = mouse.y - p.y
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist < 100) { p.x -= dx * 0.02; p.y -= dy * 0.02 }
        p.x += p.vx; p.y += p.vy
        if (p.x < 0 || p.x > canvas.width) p.vx *= -1
        if (p.y < 0 || p.y > canvas.height) p.vy *= -1
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        ctx.fillStyle = 'rgba(79,209,176,0.6)'
        ctx.fill()
      })
      particles.forEach((a, i) => particles.slice(i + 1).forEach(b => {
        const d = Math.sqrt((a.x-b.x)**2+(a.y-b.y)**2)
        if (d < 120) { ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.strokeStyle=`rgba(79,209,176,${0.15*(1-d/120)})`; ctx.stroke() }
      }))
      animId = requestAnimationFrame(draw)
    }
    draw()
    const onResize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight }
    window.addEventListener('resize', onResize)
    return () => { cancelAnimationFrame(animId); window.removeEventListener('resize', onResize) }
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    await fetch('/api/contact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(formData) })
    setSent(true)
  }

  const navLinks = ['Services','Pricing','Certifications','Process','Team','Contact']

  return (
    <main style={{minHeight:'100vh', background:'#0a1628', color:'white', fontFamily:"'Segoe UI', system-ui, sans-serif", overflowX:'hidden'}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap');
        .bebas { font-family: 'Bebas Neue', sans-serif; letter-spacing: 2px; }
        .nav-link { color: #9FE1CB; text-decoration: none; font-weight: 500; transition: color 0.2s; }
        .nav-link:hover { color: #4fd1b0; }
        .card-hover { transition: transform 0.2s, box-shadow 0.2s; }
        .card-hover:hover { transform: translateY(-4px); box-shadow: 0 12px 40px rgba(79,209,176,0.15); }
        .ticker { display: flex; gap: 48px; animation: ticker 20s linear infinite; }
        @keyframes ticker { from { transform: translateX(0) } to { transform: translateX(-50%) } }
        .reveal { opacity: 0; transform: translateY(30px); transition: opacity 0.6s, transform 0.6s; }
        .reveal.visible { opacity: 1; transform: translateY(0); }
        .btn-primary { background: #0F6E56; color: white; padding: 16px 36px; border-radius: 12px; font-weight: 700; font-size: 18px; text-decoration: none; transition: background 0.2s, transform 0.2s; display: inline-block; }
        .btn-primary:hover { background: #0a5a45; transform: translateY(-2px); }
        .btn-outline { border: 2px solid #4fd1b0; color: #4fd1b0; padding: 16px 36px; border-radius: 12px; font-weight: 700; font-size: 18px; text-decoration: none; transition: all 0.2s; display: inline-block; }
        .btn-outline:hover { background: rgba(79,209,176,0.1); transform: translateY(-2px); }
        .badge-seal { width: 150px; height: 150px; border-radius: 50%; background: #0a1628; border: 4px solid #4fd1b0; display: flex; flex-direction: column; align-items: center; justify-content: center; position: relative; box-shadow: 0 0 30px rgba(79,209,176,0.3); }
        .badge-seal::before { content: ''; position: absolute; inset: 8px; border-radius: 50%; border: 1px dashed rgba(79,209,176,0.5); }
        .process-num { font-size: 120px; font-weight: 900; color: rgba(79,209,176,0.06); position: absolute; top: -20px; left: -10px; line-height: 1; font-family: 'Bebas Neue', sans-serif; }
        input, textarea { width: 100%; padding: 14px; border-radius: 10px; background: #1c2e48; border: 1px solid #2a4060; color: white; font-size: 16px; box-sizing: border-box; outline: none; transition: border-color 0.2s; font-family: inherit; }
        input:focus, textarea:focus { border-color: #4fd1b0; }
        textarea { resize: vertical; }
      `}</style>

      {/* NAV */}
      <nav style={{background: scrolled ? 'rgba(20,34,56,0.95)' : '#142238', backdropFilter: scrolled ? 'blur(10px)' : 'none', padding:'0 40px', height:'70px', display:'flex', justifyContent:'space-between', alignItems:'center', position:'sticky', top:0, zIndex:1000, transition:'all 0.3s', borderBottom:'1px solid rgba(79,209,176,0.1)'}}>
        <div className="bebas" style={{fontSize:'24px', color:'#4fd1b0'}}>GOOD LIQUID <span style={{color:'#9FE1CB', fontSize:'16px'}}>BEV CO</span></div>
        <div style={{display:'flex', gap:'28px', alignItems:'center'}}>
          {navLinks.map(l => <a key={l} href={`#${l.toLowerCase()}`} className="nav-link" style={{fontSize:'14px'}}>{l}</a>)}
          <a href="/admin/login" style={{background:'#0F6E56', color:'white', padding:'8px 20px', borderRadius:'8px', fontWeight:700, textDecoration:'none', fontSize:'14px', transition:'background 0.2s'}}>🔒 Admin</a>
        </div>
      </nav>

      {/* HERO */}
      <section style={{position:'relative', minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', textAlign:'center', overflow:'hidden'}}>
        <canvas ref={canvasRef} style={{position:'absolute', inset:0, zIndex:0}} />
        <div style={{position:'relative', zIndex:1, padding:'40px 20px', maxWidth:'900px', margin:'0 auto'}}>
          <div style={{fontSize:'13px', letterSpacing:'6px', color:'#4fd1b0', marginBottom:'20px', fontWeight:600}}>PALMETTO, FLORIDA • PREMIUM BEVERAGE CO-PACKING</div>
          <h1 className="bebas" style={{fontSize:'clamp(60px,10vw,120px)', lineHeight:0.95, marginBottom:'30px'}}>
            WE TURN<br/>
            <span style={{background:'linear-gradient(90deg,#4fd1b0,#38bdf8,#4fd1b0)', backgroundSize:'200%', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent'}}>
              BEVERAGE IDEAS
            </span><br/>
            TO REALITY
          </h1>
          <p style={{fontSize:'20px', color:'#9FE1CB', maxWidth:'580px', margin:'0 auto 40px', lineHeight:1.6}}>
            Full-service co-packing — formulation, canning, bottling, and consulting for emerging beverage brands across the Southeast.
          </p>
          <div style={{display:'flex', gap:'16px', justifyContent:'center', flexWrap:'wrap'}}>
            <a href="#contact" className="btn-primary">Get a Quote</a>
            <a href="#services" className="btn-outline">Our Services</a>
          </div>
          <div style={{display:'flex', gap:'40px', justifyContent:'center', marginTop:'80px', flexWrap:'wrap'}}>
            {[['150+','Min Cases'],['8–12 Wk','Timeline'],['3','Can Formats'],['GMP·HACCP·PCQI','Certified']].map(([n,l]) => (
              <div key={l}>
                <div className="bebas" style={{fontSize:'40px', color:'#4fd1b0'}}>{n}</div>
                <div style={{color:'#9FE1CB', fontSize:'13px', letterSpacing:'1px'}}>{l}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* TICKER */}
      <div style={{background:'#0F6E56', padding:'14px 0', overflow:'hidden', borderTop:'1px solid rgba(255,255,255,0.1)', borderBottom:'1px solid rgba(255,255,255,0.1)'}}>
        <div style={{display:'flex', whiteSpace:'nowrap'}}>
          <div className="ticker">
            {['CANNING','BOTTLING','FORMULATION','R&D','CONSULTING','GMP CERTIFIED','HACCP CERTIFIED','PCQI CERTIFIED','PALMETTO FL','150 CASE MOQ','8–12 WEEK TIMELINE','FLASH PASTEURIZATION','NITROGEN DOSING','12oz · 16oz · 19.2oz'].map(t => (
              <span key={t} className="bebas" style={{fontSize:'18px', letterSpacing:'3px', color:'white', paddingRight:'48px'}}>★ {t}</span>
            ))}
          </div>
          <div className="ticker" aria-hidden>
            {['CANNING','BOTTLING','FORMULATION','R&D','CONSULTING','GMP CERTIFIED','HACCP CERTIFIED','PCQI CERTIFIED','PALMETTO FL','150 CASE MOQ','8–12 WEEK TIMELINE','FLASH PASTEURIZATION','NITROGEN DOSING','12oz · 16oz · 19.2oz'].map(t => (
              <span key={t} className="bebas" style={{fontSize:'18px', letterSpacing:'3px', color:'white', paddingRight:'48px'}}>★ {t}</span>
            ))}
          </div>
        </div>
      </div>

      {/* ABOUT */}
      <section style={{padding:'100px 40px', maxWidth:'1100px', margin:'0 auto', display:'grid', gridTemplateColumns:'1fr 1fr', gap:'60px', alignItems:'center'}}>
        <div>
          <div style={{color:'#4fd1b0', fontSize:'13px', letterSpacing:'4px', marginBottom:'16px', fontWeight:600}}>ABOUT US</div>
          <h2 className="bebas" style={{fontSize:'56px', lineHeight:1, marginBottom:'24px'}}>FAMILY-RUN.<br/>CRAFT-FOCUSED.<br/>RESULTS-DRIVEN.</h2>
          <p style={{color:'#9FE1CB', lineHeight:1.8, fontSize:'16px', marginBottom:'20px'}}>Good Liquid Bev Co is a family-operated beverage co-packer based in Palmetto, Florida. We partner with emerging brands to bring their beverage concepts to life — from recipe development through production.</p>
          <p style={{color:'#9FE1CB', lineHeight:1.8, fontSize:'16px'}}>With certifications in GMP, HACCP, and PCQI, we maintain the highest standards of food safety while delivering the flexibility and personal attention that small and mid-size brands need.</p>
        </div>
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'16px'}}>
          {[['$1K','R&D Starting Price'],['150','Min Case MOQ'],['8–12','Week Timeline'],['3','Can Formats']].map(([n,l]) => (
            <div key={l} className="card-hover" style={{background:'#1c2e48', borderRadius:'16px', padding:'28px', border:'1px solid #2a4060', textAlign:'center'}}>
              <div className="bebas" style={{fontSize:'48px', color:'#4fd1b0', lineHeight:1}}>{n}</div>
              <div style={{color:'#9FE1CB', fontSize:'13px', marginTop:'8px'}}>{l}</div>
            </div>
          ))}
        </div>
      </section>

      {/* SERVICES */}
      <section id="services" style={{padding:'100px 40px', background:'#0d1f38'}}>
        <div style={{maxWidth:'1100px', margin:'0 auto'}}>
          <div style={{textAlign:'center', marginBottom:'60px'}}>
            <div style={{color:'#4fd1b0', fontSize:'13px', letterSpacing:'4px', marginBottom:'16px', fontWeight:600}}>WHAT WE DO</div>
            <h2 className="bebas" style={{fontSize:'72px', lineHeight:1}}>OUR SERVICES</h2>
          </div>
          <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(250px,1fr))', gap:'24px'}}>
            {[
              {icon:'🧪', title:'Formulation & R&D', price:'From $1,000', desc:'Recipe development, flavor optimization, stability testing, and nutritional panels. IP licensing available.'},
              {icon:'🥫', title:'Canning', price:'From $0.32/can', desc:'150 case MOQ. 12oz, 16oz, 19.2oz formats. Flash pasteurization and nitrogen dosing available.'},
              {icon:'🍾', title:'Bottling', price:'From $8.50/case', desc:'750ml glass bottles. 100 case MOQ. Perfect for spirits, wines, kombuchas, and premium beverages.'},
              {icon:'📋', title:'Consulting', price:'Custom Pricing', desc:'Brand strategy, regulatory compliance, distribution planning, and market entry support.'},
            ].map(s => (
              <div key={s.title} className="card-hover" style={{background:'#1c2e48', borderRadius:'20px', padding:'36px', border:'1px solid #2a4060', position:'relative', overflow:'hidden'}}>
                <div style={{fontSize:'40px', marginBottom:'16px'}}>{s.icon}</div>
                <div className="bebas" style={{fontSize:'26px', color:'#4fd1b0', marginBottom:'8px'}}>{s.title}</div>
                <div style={{color:'#38bdf8', fontWeight:'700', marginBottom:'16px', fontSize:'15px'}}>{s.price}</div>
                <div style={{color:'#9FE1CB', lineHeight:1.7, fontSize:'15px'}}>{s.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CERTIFICATIONS */}
      <section id="certifications" style={{padding:'100px 40px', textAlign:'center'}}>
        <div style={{maxWidth:'900px', margin:'0 auto'}}>
          <div style={{color:'#4fd1b0', fontSize:'13px', letterSpacing:'4px', marginBottom:'16px', fontWeight:600}}>COMPLIANCE & SAFETY</div>
          <h2 className="bebas" style={{fontSize:'72px', lineHeight:1, marginBottom:'60px'}}>CERTIFICATIONS</h2>
          <div style={{display:'flex', gap:'48px', justifyContent:'center', flexWrap:'wrap', marginBottom:'48px'}}>
            {[['GMP','Good Manufacturing Practice','Ensures consistent quality and safety in all production processes.'],
              ['PCQI','Preventive Controls Qualified','FDA FSMA compliance with trained preventive controls oversight.'],
              ['HACCP','Hazard Analysis & Critical Control','Systematic approach to identifying and controlling food safety hazards.']].map(([abbr,name,desc]) => (
              <div key={abbr} style={{maxWidth:'200px', textAlign:'center'}}>
                <div className="badge-seal" style={{margin:'0 auto 20px'}}>
                  <div className="bebas" style={{fontSize:'36px', color:'#4fd1b0', lineHeight:1}}>{abbr}</div>
                  <div style={{fontSize:'10px', color:'#9FE1CB', letterSpacing:'1px'}}>CERTIFIED</div>
                </div>
                <div style={{fontWeight:'700', color:'white', marginBottom:'8px', fontSize:'15px'}}>{name}</div>
                <div style={{color:'#9FE1CB', fontSize:'13px', lineHeight:1.6}}>{desc}</div>
              </div>
            ))}
          </div>
          <div style={{background:'#1c2e48', borderRadius:'12px', padding:'20px 32px', display:'inline-block', color:'#9FE1CB', fontSize:'14px', border:'1px solid #2a4060'}}>
            🛡️ FDA FSMA Compliant • All staff trained in food safety protocols
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section id="pricing" style={{padding:'100px 40px', background:'#0d1f38'}}>
        <div style={{maxWidth:'900px', margin:'0 auto'}}>
          <div style={{textAlign:'center', marginBottom:'60px'}}>
            <div style={{color:'#4fd1b0', fontSize:'13px', letterSpacing:'4px', marginBottom:'16px', fontWeight:600}}>TRANSPARENT PRICING</div>
            <h2 className="bebas" style={{fontSize:'72px', lineHeight:1}}>RATE CARD</h2>
          </div>
          <div style={{background:'#1c2e48', borderRadius:'20px', overflow:'hidden', border:'1px solid #2a4060', marginBottom:'32px'}}>
            <div style={{background:'#0F6E56', padding:'16px 24px'}}>
              <div className="bebas" style={{fontSize:'22px', letterSpacing:'2px'}}>CANNING RATES</div>
            </div>
            <table style={{width:'100%', borderCollapse:'collapse', color:'white'}}>
              <thead>
                <tr style={{borderBottom:'1px solid #2a4060'}}>
                  {['Volume (Cases)','Mfg Fee/Case','Can Cost','Packaging/Can'].map(h => (
                    <th key={h} style={{padding:'14px 20px', textAlign:'left', color:'#9FE1CB', fontSize:'13px', fontWeight:600}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[['150–299','$28.00','$0.32','$0.055'],['300–499','$24.00','$0.32','$0.055'],['500–999','$20.00','$0.30','$0.050'],['1,000+','$16.00','$0.28','$0.045']].map(([v,m,c,p],i) => (
                  <tr key={v} style={{background: i%2===0 ? 'transparent' : 'rgba(255,255,255,0.02)', borderBottom:'1px solid rgba(255,255,255,0.05)'}}>
                    <td style={{padding:'14px 20px', fontWeight:700, color:'#4fd1b0'}}>{v}</td>
                    <td style={{padding:'14px 20px'}}>{m}</td>
                    <td style={{padding:'14px 20px'}}>{c}</td>
                    <td style={{padding:'14px 20px'}}>{p}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'20px'}}>
            <div style={{background:'#1c2e48', borderRadius:'16px', padding:'24px', border:'1px solid #2a4060'}}>
              <div className="bebas" style={{fontSize:'20px', color:'#4fd1b0', marginBottom:'12px'}}>ADD-ONS</div>
              <div style={{color:'#9FE1CB', fontSize:'14px', lineHeight:2}}>
                ⚡ Flash Pasteurization — +$0.015/can<br/>
                💧 Nitrogen Dosing — +$0.008/can
              </div>
            </div>
            <div style={{background:'#1c2e48', borderRadius:'16px', padding:'24px', border:'1px solid #2a4060'}}>
              <div className="bebas" style={{fontSize:'20px', color:'#4fd1b0', marginBottom:'12px'}}>R&D / IP</div>
              <div style={{color:'#9FE1CB', fontSize:'14px', lineHeight:2}}>
                🧪 Recipe Dev — from $1,000<br/>
                📄 IP License — $6,000<br/>
                🏆 Full Outright — $15,000
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* PROCESS */}
      <section id="process" style={{padding:'100px 40px'}}>
        <div style={{maxWidth:'1000px', margin:'0 auto'}}>
          <div style={{textAlign:'center', marginBottom:'60px'}}>
            <div style={{color:'#4fd1b0', fontSize:'13px', letterSpacing:'4px', marginBottom:'16px', fontWeight:600}}>HOW IT WORKS</div>
            <h2 className="bebas" style={{fontSize:'72px', lineHeight:1}}>THE PROCESS</h2>
          </div>
          <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(280px,1fr))', gap:'32px'}}>
            {[['01','Discovery & Formulation','We start with your concept — flavor profile, target market, nutritional goals — and develop a recipe that works at scale.'],
              ['02','Sampling & Approval','We produce small-batch samples for your approval. Adjust until it\'s perfect. Stability testing included.'],
              ['03','Production & Delivery','Full production run with quality checks at every step. Packaged, labeled, and ready for distribution.']].map(([n,title,desc]) => (
              <div key={n} style={{background:'#1c2e48', borderRadius:'20px', padding:'36px', border:'1px solid #2a4060', position:'relative', overflow:'hidden'}}>
                <div className="process-num">{n}</div>
                <div className="bebas" style={{fontSize:'52px', color:'#4fd1b0', lineHeight:1, marginBottom:'16px', position:'relative'}}>{n}</div>
                <div className="bebas" style={{fontSize:'24px', marginBottom:'16px', position:'relative'}}>{title}</div>
                <div style={{color:'#9FE1CB', lineHeight:1.7, fontSize:'15px', position:'relative'}}>{desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CAN FORMATS */}
      <section style={{padding:'80px 40px', background:'#0d1f38', textAlign:'center'}}>
        <div style={{maxWidth:'800px', margin:'0 auto'}}>
          <h2 className="bebas" style={{fontSize:'56px', marginBottom:'48px'}}>CAN FORMATS</h2>
          <div style={{display:'flex', gap:'40px', justifyContent:'center', flexWrap:'wrap'}}>
            {[['12oz','Standard Slim','355ml'],['16oz','Tallboy','473ml'],['19.2oz','Stovepipe','568ml']].map(([size,name,ml]) => (
              <div key={size} style={{textAlign:'center'}}>
                <div style={{width:'80px', height:'140px', background:'linear-gradient(180deg, #4fd1b0 0%, #0F6E56 100%)', borderRadius:'12px 12px 8px 8px', margin:'0 auto 16px', boxShadow:'0 8px 30px rgba(79,209,176,0.3)'}} />
                <div className="bebas" style={{fontSize:'28px', color:'#4fd1b0'}}>{size}</div>
                <div style={{color:'white', fontWeight:600}}>{name}</div>
                <div style={{color:'#9FE1CB', fontSize:'14px'}}>{ml}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* TEAM */}
      <section id="team" style={{padding:'100px 40px', textAlign:'center'}}>
        <div style={{maxWidth:'800px', margin:'0 auto'}}>
          <div style={{color:'#4fd1b0', fontSize:'13px', letterSpacing:'4px', marginBottom:'16px', fontWeight:600}}>THE PEOPLE BEHIND THE PRODUCT</div>
          <h2 className="bebas" style={{fontSize:'72px', lineHeight:1, marginBottom:'60px'}}>OUR TEAM</h2>
          <div style={{display:'flex', gap:'32px', justifyContent:'center', flexWrap:'wrap'}}>
            {[{name:'Mike Krail', role:'Co-Founder & Operations', email:'mike@goodliquid.com', phone:'(803) 493-5065'},
              {name:'Sandra Krail', role:'Co-Founder & Client Relations', email:'sandra@goodliquid.com', phone:''}].map(p => (
              <div key={p.name} className="card-hover" style={{background:'#1c2e48', borderRadius:'20px', padding:'48px 40px', width:'280px', border:'1px solid #2a4060'}}>
                <div style={{width:'90px', height:'90px', borderRadius:'50%', background:'linear-gradient(135deg, #0F6E56, #4fd1b0)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'32px', fontWeight:'900', margin:'0 auto 24px', boxShadow:'0 8px 30px rgba(79,209,176,0.3)'}}>
                  {p.name.split(' ').map((n:string)=>n[0]).join('')}
                </div>
                <div className="bebas" style={{fontSize:'28px', marginBottom:'8px'}}>{p.name}</div>
                <div style={{color:'#4fd1b0', marginBottom:'16px', fontSize:'14px'}}>{p.role}</div>
                <a href={`mailto:${p.email}`} style={{color:'#9FE1CB', fontSize:'14px', display:'block', textDecoration:'none'}}>{p.email}</a>
                {p.phone && <div style={{color:'#9FE1CB', fontSize:'14px', marginTop:'4px'}}>{p.phone}</div>}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CONTACT */}
      <section id="contact" style={{padding:'100px 40px', background:'#0d1f38'}}>
        <div style={{maxWidth:'680px', margin:'0 auto'}}>
          <div style={{textAlign:'center', marginBottom:'48px'}}>
            <div style={{color:'#4fd1b0', fontSize:'13px', letterSpacing:'4px', marginBottom:'16px', fontWeight:600}}>LET'S WORK TOGETHER</div>
            <h2 className="bebas" style={{fontSize:'72px', lineHeight:1, marginBottom:'16px'}}>GET A QUOTE</h2>
            <p style={{color:'#9FE1CB'}}>(803) 493-5065 • mike@goodliquid.com</p>
          </div>
          {sent ? (
            <div style={{background:'#0F6E56', borderRadius:'20px', padding:'60px', textAlign:'center'}}>
              <div style={{fontSize:'48px', marginBottom:'16px'}}>✅</div>
              <div className="bebas" style={{fontSize:'32px', marginBottom:'8px'}}>MESSAGE SENT!</div>
              <div style={{color:'rgba(255,255,255,0.8)'}}>We'll be in touch within 24 hours.</div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} style={{display:'flex', flexDirection:'column', gap:'16px'}}>
              <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'16px'}}>
                <div>
                  <label style={{color:'#9FE1CB', fontSize:'13px', display:'block', marginBottom:'6px', letterSpacing:'1px'}}>BRAND NAME</label>
                  <input value={formData.brandName} onChange={e => setFormData({...formData, brandName: e.target.value})} />
                </div>
                <div>
                  <label style={{color:'#9FE1CB', fontSize:'13px', display:'block', marginBottom:'6px', letterSpacing:'1px'}}>CONTACT NAME</label>
                  <input value={formData.contactName} onChange={e => setFormData({...formData, contactName: e.target.value})} />
                </div>
              </div>
              <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'16px'}}>
                <div>
                  <label style={{color:'#9FE1CB', fontSize:'13px', display:'block', marginBottom:'6px', letterSpacing:'1px'}}>EMAIL</label>
                  <input type="email" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} />
                </div>
                <div>
                  <label style={{color:'#9FE1CB', fontSize:'13px', display:'block', marginBottom:'6px', letterSpacing:'1px'}}>PHONE</label>
                  <input type="tel" value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} />
                </div>
              </div>
              <div>
                <label style={{color:'#9FE1CB', fontSize:'13px', display:'block', marginBottom:'6px', letterSpacing:'1px'}}>MESSAGE</label>
                <textarea rows={5} value={formData.message} onChange={e => setFormData({...formData, message: e.target.value})} />
              </div>
              <button type="submit" style={{background:'#0F6E56', color:'white', padding:'18px', borderRadius:'12px', border:'none', fontSize:'18px', fontWeight:'700', cursor:'pointer', marginTop:'8px', transition:'background 0.2s'}}>
                Send Message →
              </button>
            </form>
          )}
        </div>
      </section>

      {/* FOOTER */}
      <footer style={{background:'#060f1e', padding:'60px 40px', borderTop:'1px solid #1c2e48'}}>
        <div style={{maxWidth:'1100px', margin:'0 auto', display:'flex', justifyContent:'space-between', flexWrap:'wrap', gap:'40px'}}>
          <div>
            <div className="bebas" style={{fontSize:'28px', color:'#4fd1b0', marginBottom:'8px'}}>GOOD LIQUID BEV CO</div>
            <div style={{color:'#9FE1CB', fontSize:'14px', lineHeight:1.8}}>
              Palmetto, Florida<br/>
              (803) 493-5065<br/>
              mike@goodliquid.com<br/>
              goodliquidbevco.com
            </div>
          </div>
          <div>
            <div style={{color:'#4fd1b0', fontWeight:700, marginBottom:'16px', fontSize:'13px', letterSpacing:'2px'}}>SERVICES</div>
            {['Formulation & R&D','Canning','Bottling','Consulting'].map(s => <div key={s} style={{color:'#9FE1CB', fontSize:'14px', lineHeight:2}}>{s}</div>)}
          </div>
          <div>
            <div style={{color:'#4fd1b0', fontWeight:700, marginBottom:'16px', fontSize:'13px', letterSpacing:'2px'}}>CERTIFICATIONS</div>
            {['GMP Certified','PCQI Certified','HACCP Certified','FDA FSMA Compliant'].map(s => <div key={s} style={{color:'#9FE1CB', fontSize:'14px', lineHeight:2}}>{s}</div>)}
          </div>
          <div>
            <div style={{color:'#4fd1b0', fontWeight:700, marginBottom:'16px', fontSize:'13px', letterSpacing:'2px'}}>ADMIN</div>
            <a href="/admin/login" style={{color:'#9FE1CB', fontSize:'14px', textDecoration:'none', display:'block', lineHeight:2}}>🔒 Admin Login</a>
            <a href="/admin/dashboard" style={{color:'#9FE1CB', fontSize:'14px', textDecoration:'none', display:'block', lineHeight:2}}>📊 Dashboard</a>
          </div>
        </div>
        <div style={{maxWidth:'1100px', margin:'40px auto 0', paddingTop:'24px', borderTop:'1px solid #1c2e48', textAlign:'center', color:'#4a6a8a', fontSize:'13px'}}>
          © 2026 Good Liquid Bev Co. All rights reserved.
        </div>
      </footer>
    </main>
  )
}
