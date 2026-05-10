export default function Home() {
  return (
    <main style={{minHeight:'100vh', background:'#0a1628', color:'white', fontFamily:'system-ui'}}>
      {/* NAV */}
      <nav style={{background:'#142238', padding:'16px 40px', display:'flex', justifyContent:'space-between', alignItems:'center', position:'sticky', top:0, zIndex:100}}>
        <div style={{fontSize:'22px', fontWeight:'900', letterSpacing:'2px', color:'#4fd1b0'}}>GOOD LIQUID BEV CO</div>
        <div style={{display:'flex', gap:'24px', alignItems:'center'}}>
          {['Services','Pricing','Process','Team','Contact'].map(l => (
            <a key={l} href={`#${l.toLowerCase()}`} style={{color:'#9FE1CB', textDecoration:'none', fontWeight:500}}>{l}</a>
          ))}
          <a href="/admin/login" style={{background:'#0F6E56', color:'white', padding:'8px 18px', borderRadius:'8px', fontWeight:700, textDecoration:'none'}}>Admin Login</a>
        </div>
      </nav>

      {/* HERO */}
      <section style={{padding:'100px 40px', textAlign:'center', background:'linear-gradient(135deg, #0a1628 0%, #1c2e48 100%)'}}>
        <div style={{fontSize:'14px', letterSpacing:'4px', color:'#4fd1b0', marginBottom:'16px'}}>PALMETTO, FLORIDA • EST. 2017</div>
        <h1 style={{fontSize:'clamp(48px,8vw,96px)', fontWeight:'900', lineHeight:1.1, marginBottom:'24px'}}>
          WE TURN<br/>
          <span style={{background:'linear-gradient(90deg,#4fd1b0,#38bdf8)', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent'}}>BEVERAGE IDEAS</span><br/>
          TO REALITY
        </h1>
        <p style={{fontSize:'20px', color:'#9FE1CB', maxWidth:'600px', margin:'0 auto 40px'}}>
          Full-service co-packing: formulation, canning, bottling, and consulting for emerging beverage brands.
        </p>
        <div style={{display:'flex', gap:'16px', justifyContent:'center', flexWrap:'wrap'}}>
          <a href="#contact" style={{background:'#0F6E56', color:'white', padding:'16px 32px', borderRadius:'12px', fontWeight:'700', fontSize:'18px', textDecoration:'none'}}>Get a Quote</a>
          <a href="#services" style={{border:'2px solid #4fd1b0', color:'#4fd1b0', padding:'16px 32px', borderRadius:'12px', fontWeight:'700', fontSize:'18px', textDecoration:'none'}}>Our Services</a>
        </div>
        <div style={{display:'flex', gap:'48px', justifyContent:'center', marginTop:'64px', flexWrap:'wrap'}}>
          {[['150+','Min Cases'],['8-12 Wk','Timeline'],['3','Can Formats'],['GMP • HACCP • PCQI','Certified']].map(([n,l]) => (
            <div key={l} style={{textAlign:'center'}}>
              <div style={{fontSize:'32px', fontWeight:'900', color:'#4fd1b0'}}>{n}</div>
              <div style={{color:'#9FE1CB', fontSize:'14px'}}>{l}</div>
            </div>
          ))}
        </div>
      </section>

      {/* SERVICES */}
      <section id="services" style={{padding:'80px 40px', maxWidth:'1200px', margin:'0 auto'}}>
        <h2 style={{fontSize:'48px', fontWeight:'900', textAlign:'center', marginBottom:'48px'}}>OUR SERVICES</h2>
        <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(260px,1fr))', gap:'24px'}}>
          {[
            {title:'Formulation & R&D', price:'From $1,000', desc:'Recipe development, flavor optimization, stability testing, and nutritional panels.'},
            {title:'Canning', price:'From $0.32/can', desc:'150 case MOQ. 12oz, 16oz, 19.2oz formats. Flash pasteurization & nitrogen dosing available.'},
            {title:'Bottling', price:'From $8.50/case', desc:'750ml glass bottles. 100 case MOQ. Perfect for spirits, wines, and premium beverages.'},
            {title:'Consulting', price:'Custom', desc:'Brand strategy, compliance, distribution planning, and market entry support.'},
          ].map(s => (
            <div key={s.title} style={{background:'#1c2e48', borderRadius:'16px', padding:'32px', border:'1px solid #2a4060'}}>
              <div style={{color:'#4fd1b0', fontSize:'24px', fontWeight:'900', marginBottom:'8px'}}>{s.title}</div>
              <div style={{color:'#38bdf8', fontWeight:'700', marginBottom:'16px'}}>{s.price}</div>
              <div style={{color:'#9FE1CB', lineHeight:1.6}}>{s.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* CERTIFICATIONS */}
      <section style={{padding:'60px 40px', background:'#142238', textAlign:'center'}}>
        <h2 style={{fontSize:'36px', fontWeight:'900', marginBottom:'40px'}}>CERTIFICATIONS</h2>
        <div style={{display:'flex', gap:'40px', justifyContent:'center', flexWrap:'wrap'}}>
          {['GMP','PCQI','HACCP'].map(c => (
            <div key={c} style={{background:'#0a1628', border:'2px solid #4fd1b0', borderRadius:'50%', width:'140px', height:'140px', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center'}}>
              <div style={{fontSize:'32px', fontWeight:'900', color:'#4fd1b0'}}>{c}</div>
              <div style={{fontSize:'12px', color:'#9FE1CB', marginTop:'4px'}}>Certified</div>
            </div>
          ))}
        </div>
      </section>

      {/* PRICING */}
      <section id="pricing" style={{padding:'80px 40px', maxWidth:'900px', margin:'0 auto'}}>
        <h2 style={{fontSize:'48px', fontWeight:'900', textAlign:'center', marginBottom:'48px'}}>PRICING</h2>
        <div style={{background:'#1c2e48', borderRadius:'16px', overflow:'hidden'}}>
          <table style={{width:'100%', borderCollapse:'collapse', color:'white'}}>
            <thead>
              <tr style={{background:'#0F6E56'}}>
                <th style={{padding:'16px', textAlign:'left'}}>Volume (Cases)</th>
                <th style={{padding:'16px', textAlign:'right'}}>Mfg Fee/Case</th>
                <th style={{padding:'16px', textAlign:'right'}}>Can Cost</th>
                <th style={{padding:'16px', textAlign:'right'}}>Packaging</th>
              </tr>
            </thead>
            <tbody>
              {[['150–299','$28.00','$0.32/can','$0.055/can'],['300–499','$24.00','$0.32/can','$0.055/can'],['500–999','$20.00','$0.30/can','$0.050/can'],['1000+','$16.00','$0.28/can','$0.045/can']].map(([v,m,c,p],i) => (
                <tr key={v} style={{background: i%2===0 ? '#1c2e48' : '#243548'}}>
                  <td style={{padding:'14px 16px'}}>{v}</td>
                  <td style={{padding:'14px 16px', textAlign:'right', color:'#4fd1b0', fontWeight:'700'}}>{m}</td>
                  <td style={{padding:'14px 16px', textAlign:'right'}}>{c}</td>
                  <td style={{padding:'14px 16px', textAlign:'right'}}>{p}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* TEAM */}
      <section id="team" style={{padding:'80px 40px', background:'#142238', textAlign:'center'}}>
        <h2 style={{fontSize:'48px', fontWeight:'900', marginBottom:'48px'}}>OUR TEAM</h2>
        <div style={{display:'flex', gap:'40px', justifyContent:'center', flexWrap:'wrap'}}>
          {[{name:'Mike Krail', role:'Co-Founder & Operations', email:'mike@goodliquid.com'},
            {name:'Sandra Krail', role:'Co-Founder & Client Relations', email:'sandra@goodliquid.com'}].map(p => (
            <div key={p.name} style={{background:'#1c2e48', borderRadius:'16px', padding:'40px', width:'280px'}}>
              <div style={{width:'80px', height:'80px', borderRadius:'50%', background:'#0F6E56', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'28px', fontWeight:'900', margin:'0 auto 20px'}}>
                {p.name.split(' ').map(n=>n[0]).join('')}
              </div>
              <div style={{fontSize:'20px', fontWeight:'700'}}>{p.name}</div>
              <div style={{color:'#4fd1b0', margin:'8px 0'}}>{p.role}</div>
              <a href={`mailto:${p.email}`} style={{color:'#9FE1CB', fontSize:'14px'}}>{p.email}</a>
            </div>
          ))}
        </div>
      </section>

      {/* CONTACT */}
      <section id="contact" style={{padding:'80px 40px', maxWidth:'700px', margin:'0 auto'}}>
        <h2 style={{fontSize:'48px', fontWeight:'900', textAlign:'center', marginBottom:'16px'}}>GET A QUOTE</h2>
        <p style={{textAlign:'center', color:'#9FE1CB', marginBottom:'40px'}}>(803) 493-5065 • mike@goodliquid.com</p>
        <form onSubmit={async(e)=>{e.preventDefault()}} style={{display:'flex', flexDirection:'column', gap:'16px'}}>
          {[['Brand Name','text','brandName'],['Contact Name','text','contactName'],['Email','email','email'],['Phone','tel','phone']].map(([label,type,name]) => (
            <div key={name}>
              <label style={{color:'#9FE1CB', fontSize:'14px', display:'block', marginBottom:'6px'}}>{label}</label>
              <input name={name} type={type} style={{width:'100%', padding:'12px', borderRadius:'8px', background:'#1c2e48', border:'1px solid #2a4060', color:'white', fontSize:'16px', boxSizing:'border-box'}} />
            </div>
          ))}
          <div>
            <label style={{color:'#9FE1CB', fontSize:'14px', display:'block', marginBottom:'6px'}}>Message</label>
            <textarea name="message" rows={4} style={{width:'100%', padding:'12px', borderRadius:'8px', background:'#1c2e48', border:'1px solid #2a4060', color:'white', fontSize:'16px', boxSizing:'border-box'}} />
          </div>
          <button type="submit" style={{background:'#0F6E56', color:'white', padding:'16px', borderRadius:'12px', border:'none', fontSize:'18px', fontWeight:'700', cursor:'pointer'}}>Send Message</button>
        </form>
      </section>

      {/* FOOTER */}
      <footer style={{background:'#0a1628', padding:'40px', textAlign:'center', color:'#9FE1CB', borderTop:'1px solid #1c2e48'}}>
        <div style={{fontSize:'20px', fontWeight:'900', marginBottom:'8px', color:'#4fd1b0'}}>GOOD LIQUID BEV CO</div>
        <div>Palmetto, FL • (803) 493-5065 • mike@goodliquid.com</div>
        <div style={{marginTop:'16px', fontSize:'14px', color:'#4a6a8a'}}>© 2026 Good Liquid Bev Co. All rights reserved.</div>
      </footer>
    </main>
  )
}
