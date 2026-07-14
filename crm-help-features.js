/* ============================================================
   IN-APP HELP — NEW FEATURES ADDON
   Adds 7 sections covering everything built in the last 24 hours:
   Operations Pro, Quality & Supply, Marketing Engine, Growth Tools,
   Revenue Ops, Customer Relations, and the upgraded Public Website.
   Wraps window.glOpenHelp without touching the original module —
   sections + TOC entries inject after the modal mounts.
   ============================================================ */
(function(){
  function wf(w, h, content){
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" width="100%" style="background:#0a1628;border-radius:10px;border:1px solid rgba(255,255,255,.08);margin:12px 0 4px;display:block;max-height:340px">' + content + '</svg>';
  }
  function box(x,y,w,h,fill,stroke){ return '<rect x="'+x+'" y="'+y+'" width="'+w+'" height="'+h+'" rx="6" fill="'+(fill||'#243a56')+'" stroke="'+(stroke||'rgba(255,255,255,.06)')+'"/>'; }
  function txt(x,y,t,size,color,anchor){ return '<text x="'+x+'" y="'+y+'" fill="'+(color||'#cfd9e6')+'" font-size="'+(size||11)+'" text-anchor="'+(anchor||'start')+'" font-family="Arial">'+t+'</text>'; }
  function tag(x,y,n){ return '<circle cx="'+x+'" cy="'+y+'" r="11" fill="#00e5c0"/><text x="'+x+'" y="'+(y+4)+'" fill="#0a1628" font-size="11" text-anchor="middle" font-weight="bold" font-family="Arial">'+n+'</text>'; }
  function bullets(items){
    return '<ul style="margin:10px 0 4px;padding-left:20px;color:#cfd9e6;font-size:13px;line-height:1.75">' +
      items.map(function(t){ return '<li style="margin-bottom:6px">' + t + '</li>'; }).join('') + '</ul>';
  }
  function subhead(emoji, name){
    return '<div style="margin:18px 0 4px;padding:8px 12px;background:rgba(0,229,192,.06);border-left:3px solid var(--teal);border-radius:0 6px 6px 0"><b style="color:var(--teal);font-size:13px;letter-spacing:1px">' + emoji + ' ' + name + '</b></div>';
  }
  function intro(text){
    return '<p style="color:#cfd9e6;font-size:13px;line-height:1.7;margin:0 0 12px">' + text + '</p>';
  }
  function steps(items){
    return '<ol style="margin:6px 0 10px;padding-left:22px;color:#cfd9e6;font-size:12.5px;line-height:1.7">' +
      items.map(function(t){ return '<li style="margin-bottom:4px">' + t + '</li>'; }).join('') + '</ol>';
  }
  function whereToFind(text){
    return '<div style="font-size:11px;color:#9aa7bd;margin:4px 0 12px;padding:6px 10px;background:rgba(255,255,255,.03);border-radius:6px"><b style="color:#f5c842">Where to find it:</b> ' + text + '</div>';
  }
  // Big locator banner at the top of each section so it is obvious where each tool lives
  function locator(html){
    return '<div style="margin:8px 0 14px;padding:12px 14px;background:rgba(245,200,66,.08);border:1px solid rgba(245,200,66,.25);border-left:3px solid #f5c842;border-radius:0 8px 8px 0;font-size:12.5px;line-height:1.7;color:#cfd9e6">' +
      '<div style="font-size:10px;letter-spacing:2px;color:#f5c842;font-weight:700;margin-bottom:6px">📍 LOCATOR — WHERE THESE LIVE IN THE CRM</div>' +
      html + '</div>';
  }

  /* SECTION 1 — OPERATIONS PRO */
  var MOCK_OPS_PRO = wf(620, 280,
    box(0,0,140,280,'#142238','rgba(255,255,255,.05)') +
    txt(15,28,'OPERATIONS PRO',9,'#9aa7bd') +
    txt(15,52,'• Formula Vault',11,'#00e5c0') +
    txt(15,72,'• Yield Tracker',11,'#9aa7bd') +
    txt(15,98,'OPERATIONS',9,'#9aa7bd') +
    txt(15,118,'• Production Runs',11,'#9aa7bd') +
    txt(15,138,'• Sample Shipments',11,'#9aa7bd') +
    txt(15,164,'COMPLIANCE',9,'#9aa7bd') +
    txt(15,184,'• CIP / Sanitation Log',11,'#9aa7bd') +
    txt(160,28,'FORMULA VAULT',13,'#fff') +
    txt(160,46,'Versioned recipes per client',10,'#9aa7bd') +
    box(160,60,440,30) + txt(170,79,'+ New Formula',11,'#00e5c0') + tag(580,75,1) +
    box(160,100,440,160,'#1c2e48') +
    txt(170,124,'Name',9,'#9aa7bd') + txt(260,124,'Client',9,'#9aa7bd') + txt(370,124,'Version',9,'#9aa7bd') + txt(460,124,'Allergens',9,'#9aa7bd') + txt(550,124,'Status',9,'#9aa7bd') +
    txt(170,150,'SunBurst v3',11,'#fff') + txt(260,150,'SunBurst',11,'#cfd9e6') + txt(370,150,'v3',11,'#00e5c0') + txt(460,150,'none',10,'rgba(255,255,255,.3)') + txt(550,150,'Approved',10,'#5fcf9e') +
    txt(170,175,'Wildkind Mango',11,'#fff') + txt(260,175,'Wildkind',11,'#cfd9e6') + txt(370,175,'v2',11,'#00e5c0') + txt(460,175,'sulfites',10,'#ff8579') + txt(550,175,'Benchtop',10,'#f5c842') +
    txt(170,200,'Bayline Nitro',11,'#fff') + txt(260,200,'Bayline',11,'#cfd9e6') + txt(370,200,'v1',11,'#00e5c0') + txt(460,200,'dairy',10,'#ff8579') + txt(550,200,'Draft',10,'#9aa7bd') + tag(580,200,2)
  );

  var SEC_OPS_PRO = MOCK_OPS_PRO +
    locator(
      '<b>Formula Vault, Yield Tracker</b> &rarr; sidebar &rarr; <b>Operations Pro</b> section.<br>' +
      '<b>Production Runs, Sample Shipments</b> &rarr; sidebar &rarr; <b>Operations</b> section.<br>' +
      '<b>CIP / Sanitation Log, Hold Tags, Audit Log, Compliance Tasks</b> &rarr; sidebar &rarr; <b>Compliance</b> section.'
    ) +
    intro('Your production-line + compliance tooling. Spread across three sidebar sections (Operations, Operations Pro, Compliance) because they map to different parts of your day. Everything here writes to Supabase (with localStorage fallback) and creates an audit log entry on every action.') +
    subhead('🧪', 'FORMULA VAULT') +
    intro('Single source of truth for client recipes. Each formula is versioned (v1, v2, ...) so you can iterate without losing history.') +
    bullets([
      '<b>Captures:</b> name, version, ingredients (multi-line), allergen profile (multi-select from 10 standard allergens), target yield per case, batch size, pH/brix targets, notes, approval status.',
      '<b>Approval flow:</b> Draft → Benchtop verified → Production approved → Archived. Status colour-codes the row.',
      '<b>Allergens</b> render as red pills so an off-spec ingredient is impossible to miss on the line.'
    ]) +
    steps([
      'Open CRM → sidebar → <b>Operations Pro → Formula Vault</b>.',
      'Click <b>+ New Formula</b> (callout 1). Pick a client from the dropdown.',
      'Fill name, version, ingredients (one per line). Tick any allergens present.',
      'Set status. Save. The row appears in the table (callout 2).',
      'Click any row to edit. Bump the version when reformulating — old versions stay searchable.'
    ]) +
    whereToFind('Sidebar → Operations Pro → Formula Vault') +
    subhead('📈', 'YIELD TRACKER') +
    intro('Log actual cases produced vs. forecast for every run. Tracks yield % over time so you can spot a line drifting before it bites a client.') +
    bullets([
      '<b>Captures:</b> run date, client, format, forecast cases, actual cases, downtime minutes, scrap reason, notes.',
      '<b>Auto-calculates yield %</b> (actual / forecast). Colours green ≥95%, amber 85–94%, red &lt;85%.',
      '<b>Rolling 30-day average</b> shown at the top so trends jump out.'
    ]) +
    steps([
      'Sidebar → <b>Operations Pro → Yield Tracker</b>.',
      'Click <b>+ Log Yield</b> after a run wraps.',
      'Pick the client, set the format, enter forecast + actual cases.',
      'Add scrap reason if yield was below target — this feeds the audit trail.',
      'Save. The row colour-codes itself; trend updates live.'
    ]) +
    whereToFind('Sidebar → Operations Pro → Yield Tracker') +
    subhead('🏭', 'PRODUCTION RUNS') +
    intro('Operations kanban for every run in flight. Six columns map your real-world stages.') +
    bullets([
      '<b>Columns:</b> Discovery → Formulation → Sample → COA → Production → Ship.',
      '<b>Each card:</b> client, run name, format, cases, scheduled date.',
      '<b>Move between stages</b> via the stage dropdown on the card (no drag-and-drop yet — keeps it shippable).',
      'Backed by Supabase <code>production_runs</code> table; falls back to localStorage if the table is missing.'
    ]) +
    steps([
      'Sidebar → <b>Operations → Production Runs</b>.',
      'Click <b>+ Add Run</b>. Pick client, name the run (e.g. "SunBurst Mar batch"), set format + cases + scheduled date.',
      'As work progresses, click the stage dropdown on the card to advance it.',
      'When it hits Ship, file it off — appears in the activity feed as "shipped".'
    ]) +
    whereToFind('Sidebar → Operations → Production Runs') +
    subhead('📬', 'SAMPLE SHIPMENTS') +
    intro('Track every sample that leaves the facility so nothing falls into the prospect-followup void.') +
    bullets([
      '<b>Captures:</b> recipient name + address, what you shipped, carrier, tracking number, ship date, status (prepping / shipped / delivered / followup-sent / dead).',
      '<b>Followup nudge:</b> any sample marked "delivered" more than 7 days ago surfaces a yellow "send followup?" badge.'
    ]) +
    steps([
      'Sidebar → <b>Operations → Sample Shipments</b>.',
      '<b>+ New Sample</b> when you pack one out. Paste tracking when you have it.',
      'Update status as it moves. Mark "followup-sent" once you reach out — the nudge clears.'
    ]) +
    whereToFind('Sidebar → Operations → Sample Shipments') +
    subhead('🧽', 'CIP / SANITATION LOG (compliance)') +
    intro('FDA-defensible record of every cleaning cycle between runs. If an auditor walks in, this is the page you open first.') +
    bullets([
      '<b>Captures:</b> date/time, line, cleaning method (CIP / manual / both), chemicals used + concentration, water temp, contact time, operator, ATP swab result, pass/fail, notes.',
      '<b>Linked to the run that ran before and after</b> if known — full traceability per audit lot.',
      'Every entry hits the <b>Audit Log</b> automatically so changes are tracked too.'
    ]) +
    steps([
      'Sidebar → <b>Compliance → CIP / Sanitation Log</b>.',
      '<b>+ Log Cleaning</b> immediately after a CIP cycle. Pick method, chemicals, concentration.',
      'Enter ATP swab result (the number from your luminometer).',
      'Pass/fail auto-flags red if the ATP exceeds your threshold.'
    ]) +
    whereToFind('Sidebar → Compliance → CIP / Sanitation Log');

  /* SECTION 2 — QUALITY & SUPPLY */
  var MOCK_QS = wf(620, 250,
    box(0,0,620,40,'#142238') +
    txt(15,26,'QUALITY & SUPPLY',12,'#fff') +
    box(15,55,290,180,'#1c2e48') + txt(25,78,'DEFECT TRACKER',11,'#ff8579') +
    txt(25,98,'Carb off-spec · Wildkind',10,'#cfd9e6') + txt(25,114,'High · Open',9,'#f5c842') +
    txt(25,134,'Can dent · SunBurst',10,'#cfd9e6') + txt(25,150,'Low · Contained',9,'#5fcf9e') +
    txt(25,170,'Allergen exposure · ECCM',10,'#cfd9e6') + txt(25,186,'Critical · Investigating',9,'#e74c3c') +
    tag(295,80,1) +
    box(315,55,290,180,'#1c2e48') + txt(325,78,'AUDIT LOG',11,'#00e5c0') +
    txt(325,98,'mike · client_created',10,'#cfd9e6') + txt(325,114,'2m ago',9,'#9aa7bd') +
    txt(325,134,'system · formula_edited',10,'#cfd9e6') + txt(325,150,'18m ago',9,'#9aa7bd') +
    txt(325,170,'mike · invoice_sent',10,'#cfd9e6') + txt(325,186,'1h ago',9,'#9aa7bd') +
    tag(595,80,2)
  );

  var SEC_QS = MOCK_QS +
    locator(
      '<b>Defects / NCRs, Vendors</b> &rarr; sidebar &rarr; <b>Quality & Supply</b> section.<br>' +
      '<b>Audit Log</b> &rarr; sidebar &rarr; <b>Compliance</b> section.<br>' +
      '<b>Recipe Cost Calculator</b> &rarr; floating <b>🤖 AI toolbar</b> (bottom-right of any CRM page, admin only).'
    ) +
    intro('Your compliance + supplier toolkit. Everything here is written for an FDA audit.') +
    subhead('🚨', 'DEFECT / NCR TRACKER') +
    intro('Non-conformance report (NCR) log. Every quality issue gets a paper trail with category, severity, root cause, corrective action, and status.') +
    bullets([
      '<b>Categories:</b> Fill weight, Carbonation, pH/brix off-spec, Foam-over, Can dent, Label misregister, Coding error, Contamination suspected, Allergen exposure, Other.',
      '<b>Severity:</b> Low (cosmetic) → Medium (recoverable) → High (hold + investigate) → Critical (recall risk).',
      '<b>Status:</b> Open → Investigating → Contained → Closed. Linked to a production run if known.'
    ]) +
    steps([
      'Sidebar → <b>Quality & Supply → Defect Tracker</b>.',
      '<b>+ Log Defect</b> as soon as a quality issue surfaces (callout 1).',
      'Pick category + severity. Link to the run if you know which one.',
      'Fill root cause + corrective action as you investigate. Status updates as you go.',
      'Closed defects archive but stay searchable for the audit binder.'
    ]) +
    whereToFind('Sidebar → Quality & Supply → Defect Tracker') +
    subhead('📋', 'AUDIT LOG VIEWER') +
    intro('Append-only system log: every CRUD action across the CRM writes a row. Filter by actor, action, or target.') +
    bullets([
      '<b>Captures:</b> timestamp, actor (user email or "system"), action verb (e.g. <code>client_created</code>), target (the client name or invoice number), JSON details payload.',
      '<b>Read-only.</b> No edit, no delete. That is the point.',
      '<b>Filter bar</b> at the top lets you scope to one user or action type — useful for auditing.'
    ]) +
    steps([
      'Sidebar → <b>Compliance → Audit Log</b> (admin only; the link is hidden for non-admins).',
      'Filter by actor to see what one user did this week.',
      'Filter by action to find e.g. every <code>invoice_deleted</code> event.',
      'Click any row to expand the JSON details payload.'
    ]) +
    whereToFind('Sidebar → Compliance → Audit Log (admin only)') +
    subhead('🏢', 'VENDOR DIRECTORY') +
    intro('Searchable directory of every ingredient/can/label/equipment supplier you work with. Like a Rolodex with COIs.') +
    bullets([
      '<b>Captures:</b> vendor name, category (ingredient / can / label / co-packing equipment / freight / chemical / other), contact (name + email + phone), payment terms, notes, COI on file?, last-ordered date.',
      '<b>Search</b> filters across name + category + notes in one box.'
    ]) +
    steps([
      'Sidebar → <b>Quality & Supply → Vendor Directory</b>.',
      '<b>+ New Vendor</b>. Categorise it for filtering later.',
      'Save COI on file flag + COI expiry — appears as a badge if expired.',
      'When you place an order, click the row and bump "last ordered" date.'
    ]) +
    whereToFind('Sidebar → Quality & Supply → Vendor Directory') +
    subhead('🧮', 'RECIPE COST CALCULATOR (admin)') +
    intro('Quick COGS math per case. Type in ingredients with quantity/unit/$, plus can cost + packaging + labor, and it spits out cost per case and per can.') +
    bullets([
      '<b>Breakdown shown:</b> Ingredients / Cans / Packaging / Labor → Total COGS per case and per can.',
      '<b>"Copy summary"</b> button writes the breakdown to clipboard so you can paste into a quote or email.',
      'Per-batch — does not persist. Use it to model pricing before drafting an invoice.'
    ]) +
    steps([
      'Click the floating AI button (bottom-right) → <b>Recipe cost calc</b>.',
      'Set batch yield (cases), can cost ($/case), packaging ($/case), labor ($/case).',
      'Add ingredients: name, qty per gallon, unit (oz/g/ml), cost per unit.',
      'Total updates live as you type. Click <b>Copy summary</b> to paste into a quote.'
    ]) +
    whereToFind('AI toolbar → Recipe cost calc (admin only)') +
    subhead('📸', 'LOT SCANNER (QR / BARCODE TRACE)') +
    intro('Scan a QR code or barcode on an ingredient lot tag directly from the phone camera. Looks up the lot in your compliance records and opens the trace page.') +
    bullets([
      'Uses the native BarcodeDetector API (Chrome on Android + desktop). Falls back to a text field on unsupported browsers.',
      'Opens the Trace Lot record for the scanned lot number so you can see every run it was used in.'
    ]) +
    whereToFind('Compliance → Trace Lot page → "📸 Scan QR" button') +
    subhead('🔬', 'OCR — RECEIVING CERTIFICATE OF ANALYSIS') +
    intro('Photograph a paper Certificate of Analysis (COA) with your phone. Claude Vision reads it and auto-fills the COA fields (lot number, test date, analyte values) into the Trace Lot form — no manual typing.') +
    steps([
      'Compliance → Trace Lot → "📄 Read COA photo".',
      'Take or upload a photo of the paper COA.',
      'Claude Vision extracts the data. Review and confirm.',
      'Save — fields are pre-filled in the COA record.'
    ]) +
    whereToFind('Compliance → Trace Lot → "📄 Read COA photo" button') +
    subhead('🧠', 'AI ROOT-CAUSE SUGGESTER') +
    intro('When you log a Defect or Non-Conformance Report (NCR), Claude reviews the defect description + recent CIP logs and suggests likely root causes with corrective action language you can paste directly into the FDA form.') +
    bullets([
      'Shows ranked root-cause hypotheses based on your defect category (micro, physical, chemical).',
      'Includes suggested corrective action text for the NCR narrative.'
    ]) +
    whereToFind('Quality & Supply → Defect Tracker → open any defect → "🧠 AI root cause" button') +
    subhead('📊', 'MONTHLY COMPLIANCE TREND REPORT') +
    intro('One-page printable PDF of your compliance KPIs for the month: CIP cycles logged, defects opened vs. closed, COA receipt rate, hold tags issued, audit log activity. Share it at monthly reviews.') +
    steps([
      'Compliance sidebar → "📊 Monthly report" button (or via Admin Quick Actions → Monthly Report).',
      'Pick the month (defaults to last complete month).',
      'PDF opens in a new tab. Print or save.'
    ]) +
    whereToFind('Compliance sidebar → "📊 Monthly report" button') +
    subhead('🔒', 'INSPECTOR ACCESS LINK GENERATOR') +
    intro('Generate a time-limited, read-only access link for an FDA or third-party inspector so they can view your compliance records without a CRM login. The link expires at the time you set (1–72 hours).') +
    bullets([
      'Enter inspector name, agency, purpose, and expiry window. A unique token URL is created and shown for copying.',
      'Inspector sees Trace Lot, CIP logs, Defects, and COAs — nothing else.',
      'Revoke early from the same modal if the inspection ends ahead of schedule.',
      '<b>Access URL pattern:</b> <code>goodliquidbevco.com?inspector=&lt;token&gt;</code>'
    ]) +
    whereToFind('Compliance sidebar → "🔒 Inspector link" button');

  /* SECTION 3 — MARKETING ENGINE */
  var MOCK_MARKETING = wf(620, 240,
    box(0,0,620,40,'#142238') + txt(15,26,'MARKETING ENGINE',12,'#fff') +
    box(15,55,190,170,'#1c2e48') + txt(25,78,'CONTENT CALENDAR',10,'#00e5c0') +
    txt(25,100,'Mon · IG · Reel',9,'#cfd9e6') + txt(25,116,'Tue · LinkedIn',9,'#cfd9e6') +
    txt(25,132,'Wed · Blog post',9,'#cfd9e6') + txt(25,148,'Thu · Email blast',9,'#cfd9e6') + tag(195,80,1) +
    box(215,55,190,170,'#1c2e48') + txt(225,78,'SOCIAL DRAFTER',10,'#00e5c0') +
    txt(225,100,'> Tone: friendly',9,'#9aa7bd') + txt(225,116,'> Platform: IG',9,'#9aa7bd') +
    txt(225,140,'AI draft →',10,'#f5c842') + tag(395,80,2) +
    box(415,55,190,170,'#1c2e48') + txt(425,78,'EMAIL DRIPS',10,'#00e5c0') +
    txt(425,100,'5-touch sequences',9,'#cfd9e6') + txt(425,116,'AI-generated bodies',9,'#cfd9e6') + tag(595,80,3)
  );

  var SEC_MARKETING = MOCK_MARKETING +
    locator(
      '<b>Content Calendar</b> &rarr; sidebar &rarr; <b>Marketing</b> section.<br>' +
      '<b>Everything else</b> (Social Drafter, Auto Case Study, Post Ideas, AI Image Prompts, Email Drip Generator, LinkedIn Outreach) &rarr; floating <b>🤖 AI toolbar</b> &mdash; the small robot button bottom-right of any CRM page. Click it to expand the menu of all 22+ AI tools.'
    ) +
    intro('A content factory built on top of the CRM. The Content Calendar is a sidebar page; the AI drafting tools all live in the floating bot button menu. Every AI tool uses your saved Anthropic key (🤖 AI toolbar &rarr; AI Settings).') +
    subhead('📅', 'CONTENT CALENDAR') +
    intro('Schedule posts across IG, LinkedIn, X, blog, and email blasts. Calendar grid view.') +
    bullets([
      '<b>Captures:</b> date, platform, post type (reel / static / story / blog / email), title, AI-drafted body, status (draft / scheduled / published).',
      '<b>Auto-suggests dates</b> for empty slots based on platform best-practice cadence.'
    ]) +
    steps([
      'Sidebar → <b>Marketing → Content Calendar</b> (callout 1).',
      'Click an empty date cell. Pick platform + post type. AI drafts the body — edit before saving.',
      'Mark scheduled when posted. Mark published when live.'
    ]) +
    whereToFind('Sidebar → Marketing → Content Calendar') +
    subhead('📣', 'SOCIAL POST DRAFTER (AI)') +
    intro('Generates a ready-to-post caption with hashtags. Pick platform + tone, give it a topic, get 3 variants.') +
    steps([
      'AI toolbar → <b>Social post drafter</b> (callout 2).',
      'Choose platform (IG / LinkedIn / X / Facebook) + tone (friendly / professional / playful / authoritative).',
      'Type a topic ("new mango kombucha for SunBurst"). Click Generate.',
      'Pick a variant. <b>Copy</b> drops it into your clipboard for posting.'
    ]) +
    whereToFind('AI toolbar → Social post drafter') +
    subhead('📰', 'AUTO CASE STUDY BUILDER (AI)') +
    intro('Picks a closed-won client, generates a 3-paragraph case study (challenge → solution → result), plus a 1-line headline + a metric pull-quote.') +
    steps([
      'AI toolbar → <b>Auto case study</b>.',
      'Pick a client from the dropdown (only "closed-won" or "active" clients appear).',
      'Click Generate. Edit any of the 3 paragraphs.',
      'Click <b>Save to Public Case Studies</b> — appears on the homepage Case Studies grid within minutes.'
    ]) +
    whereToFind('AI toolbar → Auto case study') +
    subhead('💡', 'POST IDEAS THIS WEEK (AI)') +
    intro('Suggests 5 post ideas based on what is going on in your CRM right now — new clients, recent runs, sample shipments, upcoming COAs.') +
    steps([
      'AI toolbar → <b>Post ideas this week</b>.',
      'Click Generate. Reads recent activity to surface 5 timely ideas.',
      '<b>"Send to Content Calendar"</b> on any idea drops it onto today\'s date as a draft.'
    ]) +
    whereToFind('AI toolbar → Post ideas this week') +
    subhead('🎨', 'AI IMAGE PROMPTS') +
    intro('Generates rich image prompts for Midjourney/DALL-E/Sora based on a brief. Useful when you need product or lifestyle imagery for a post.') +
    steps([
      'AI toolbar → <b>AI Image Prompts</b>.',
      'Describe what you want ("can of mango kombucha on a beach at golden hour, cinematic").',
      'Pick style (photoreal / illustration / cinematic / minimalist). Generates 3 prompts.',
      'Copy whichever fits → paste into your image tool.'
    ]) +
    whereToFind('AI toolbar → AI Image Prompts') +
    subhead('✉️', 'EMAIL DRIP GENERATOR (AI)') +
    intro('Generates a 5-touch email sequence (intro → educate → social proof → offer → last-call) for a target persona.') +
    steps([
      'AI toolbar → <b>Email drip generator</b> (callout 3).',
      'Describe the audience ("functional beverage founders pre-launch") + offer ("free pilot canning run").',
      'Click Generate. Five email drafts appear, ready to load into Mailgun or HubSpot.',
      '<b>Copy all</b> to grab the whole sequence at once.'
    ]) +
    whereToFind('AI toolbar → Email drip generator') +
    subhead('💼', 'LINKEDIN OUTREACH HELPER (AI)') +
    intro('Generates a connection request + first DM tailored to a LinkedIn profile you paste in.') +
    steps([
      'AI toolbar → <b>LinkedIn outreach</b>.',
      'Paste the prospect\'s headline / company / a line about their post you want to reference.',
      'Pick angle (referral / cold / event-followup). Generate.',
      'Get a 300-char connect note + a 600-char first DM. Copy + paste.'
    ]) +
    whereToFind('AI toolbar → LinkedIn outreach');

  /* SECTION 4 — GROWTH TOOLS */
  var MOCK_GROWTH = wf(620, 220,
    box(0,0,620,40,'#142238') + txt(15,26,'GROWTH TOOLS',12,'#fff') +
    box(15,55,190,150,'#1c2e48') + txt(25,78,'TRADE SHOW ROI',10,'#00e5c0') +
    txt(25,100,'Expo West 2026',10,'#cfd9e6') + txt(25,116,'Spend: $12,400',9,'#9aa7bd') +
    txt(25,132,'Pipeline: $84K',9,'#5fcf9e') + txt(25,148,'ROI: 6.8x',11,'#00e5c0') +
    box(215,55,190,150,'#1c2e48') + txt(225,78,'CHURN RISK',10,'#ff8579') +
    txt(225,100,'3 clients flagged',10,'#cfd9e6') + txt(225,120,'• Bayline · 92d quiet',9,'#f5c842') +
    txt(225,136,'• ECCM · 78d quiet',9,'#f5c842') + txt(225,152,'• Vinland · 65d',9,'#cfd9e6') +
    box(415,55,190,150,'#1c2e48') + txt(425,78,'CROSS-SELL',10,'#00e5c0') +
    txt(425,100,'SunBurst → add Nitro?',9,'#cfd9e6') + txt(425,120,'Wildkind → add Cold-brew?',9,'#cfd9e6')
  );

  var SEC_GROWTH = MOCK_GROWTH +
    locator(
      '<b>All Growth Tools live in the floating 🤖 AI toolbar</b> (bottom-right of any CRM page). Click the bot button to expand the menu, then pick the tool. Admin-only items show a 🔒 hint.'
    ) +
    intro('A grab bag of revenue-side tools: prioritise hot leads, model trade-show spend, see who is about to churn, suggest upsells. None of these are sidebar pages &mdash; they all open as modal overlays from the AI toolbar.') +
    subhead('🌪️', 'TRADE SHOW ROI TRACKER (admin)') +
    intro('Log every show you spend money on. Track booth + travel + samples + collateral spend vs. the pipeline value of leads it generated.') +
    bullets([
      '<b>Captures:</b> show name, dates, booth cost, travel, samples cost, collateral, leads generated count, pipeline value of those leads.',
      '<b>ROI calculation:</b> pipeline / total spend, shown live.',
      '<b>Comparison view</b> ranks all your shows by ROI — kill the dogs, double down on winners.'
    ]) +
    steps([
      'AI toolbar → <b>Trade Show ROI</b>.',
      '<b>+ New Show</b>. Enter spend buckets + pipeline you attribute to it.',
      'Add leads as they come in by linking client records (auto-pulls their deal value).',
      'ROI ratio updates live. Use to justify (or kill) next year\'s booth budget.'
    ]) +
    whereToFind('AI toolbar → Trade Show ROI (admin)') +
    subhead('📦', 'SERVICE PACKAGES CATALOG (admin)') +
    intro('Bundled service offerings (e.g. "Pilot Pack" / "Launch Pack" / "Scale Pack") with fixed pricing — pulls into invoices in one click.') +
    bullets([
      '<b>Each package:</b> name, what is included (line items), bundled price, who it is for.',
      '<b>Used from New Invoice builder</b> — pick a package, line items auto-fill.'
    ]) +
    steps([
      'AI toolbar → <b>Service Packages</b>.',
      '<b>+ New Package</b>. Name it. Add line items + prices. Save.',
      'When drafting an invoice, click the package picker → all lines populate.'
    ]) +
    whereToFind('AI toolbar → Service Packages (admin)') +
    subhead('🔮', 'CHURN RISK PREDICTOR (admin)') +
    intro('Rules-based score: flags any active client who has not had a run, invoice, or note in the last 60+ days. Sorted by risk.') +
    bullets([
      '<b>Risk signals:</b> days since last invoice, days since last note, days since last production run, deal pipeline trajectory.',
      '<b>Score:</b> Low / Watch / High / Critical. High and Critical get a flag on the Dashboard System Health widget.',
      '<b>"Save as task"</b> on any flagged client creates a Tasks entry to reach out.'
    ]) +
    steps([
      'AI toolbar → <b>Churn Risk</b>.',
      'Review the list — sorted by score, highest risk first.',
      'Click a client to see why they were flagged (signal breakdown).',
      'Click <b>"Reach out"</b> to log a task auto-titled "Re-engage &lt;client&gt;".'
    ]) +
    whereToFind('AI toolbar → Churn Risk (admin)') +
    subhead('🎯', 'CROSS-SELL SUGGESTER') +
    intro('Looks at what each client buys today vs. what similar clients buy, and suggests upsells you haven\'t pitched yet.') +
    steps([
      'AI toolbar → <b>Cross-sell ideas</b>.',
      'Pick a client (or "all" to see the whole book).',
      'Suggestions appear with reasoning ("SunBurst buys canning + carbonation; similar clients also buy nitro infusion").',
      'Click <b>"Draft outreach"</b> to spin up an email with the suggestion pre-written.'
    ]) +
    whereToFind('AI toolbar → Cross-sell ideas') +
    subhead('📊', 'WIN-LOSS ANALYTICS') +
    intro('Reports on closed-won vs. closed-lost deals. Captures loss reasons so you can spot patterns (priced too high? wrong stage to engage?).') +
    bullets([
      '<b>Loss reasons</b> tracked per deal: price / timing / fit / competitor / no-decision / other.',
      '<b>Charts:</b> win rate trend, average days in pipeline by stage, top loss reasons by quarter.'
    ]) +
    steps([
      'AI toolbar → <b>Win-loss analytics</b>.',
      'When marking a deal lost in the Pipeline page, pick a reason — feeds this report.',
      'Open the report monthly to look for patterns.'
    ]) +
    whereToFind('AI toolbar → Win-loss analytics');

  /* SECTION 5 — REVENUE OPS */
  var MOCK_REVOPS = wf(620, 250,
    box(0,0,620,40,'#142238') + txt(15,26,'REVENUE OPS',12,'#fff') +
    box(15,55,290,180,'#1c2e48') + txt(25,78,'AR AGING (dashboard)',10,'#00e5c0') +
    txt(25,102,'0-30d',10,'#9aa7bd') + txt(170,102,'$24,500',10,'#5fcf9e') +
    txt(25,124,'31-60d',10,'#9aa7bd') + txt(170,124,'$11,200',10,'#f5c842') +
    txt(25,146,'61-90d',10,'#9aa7bd') + txt(170,146,'$4,800',10,'#ff8579') +
    txt(25,168,'90d+',10,'#9aa7bd') + txt(170,168,'$1,791',10,'#e74c3c') +
    txt(25,200,'Total overdue: $17,791',11,'#fff') + tag(295,80,1) +
    box(315,55,290,180,'#1c2e48') + txt(325,78,'PIPELINE FORECAST',10,'#00e5c0') +
    txt(325,102,'Weighted pipeline:',10,'#9aa7bd') + txt(325,124,'$248K · Q2 2026',12,'#fff') +
    txt(325,158,'• Prospecting: $42K x 20%',9,'#cfd9e6') +
    txt(325,176,'• Proposal: $86K x 50%',9,'#cfd9e6') +
    txt(325,194,'• Closing: $120K x 80%',9,'#cfd9e6') + tag(595,80,2)
  );

  var SEC_REVOPS = MOCK_REVOPS +
    locator(
      '<b>AR Aging, Weighted Pipeline Forecast, KPI Scorecard</b> &rarr; widgets on the <b>Dashboard</b> page (no clicking required &mdash; they render alongside the existing dashboard cards).<br>' +
      '<b>AR Collection emails, Revenue Forecast (12-month), Capacity Heatmap</b> &rarr; floating <b>🤖 AI toolbar</b> (admin).<br>' +
      '<b>Run &rarr; Invoice</b> &rarr; action button on cards in the <b>Ship</b> column of the Production Runs kanban (sidebar &rarr; Operations &rarr; Production Runs).'
    ) +
    intro('A handful of widgets and AI tools that keep cash moving and pipeline visible.') +
    subhead('💰', 'AR AGING DASHBOARD WIDGET') +
    intro('Auto-buckets every unpaid invoice into 0-30 / 31-60 / 61-90 / 90+ day buckets. Sits on the Dashboard so you see it every morning.') +
    bullets([
      'Bucket colour-codes: green / yellow / orange / red.',
      'Click any bucket to filter the Invoices list to that bucket.',
      'Updates live when you mark an invoice paid.'
    ]) +
    whereToFind('Dashboard page → right column (callout 1)') +
    subhead('✉️', 'AR COLLECTION EMAILS (AI, admin)') +
    intro('Drafts a tone-appropriate dunning email for every overdue invoice. Picks tone based on days overdue (friendly nudge → firm → final).') +
    steps([
      'AI toolbar → <b>AR Collection</b>.',
      'See every overdue invoice with suggested tone + a one-click "Draft email" button.',
      'Click Draft. The email body is pre-written referencing invoice number + amount + days overdue.',
      'Edit, then send via Mailgun.'
    ]) +
    whereToFind('AI toolbar → AR Collection (admin)') +
    subhead('🔄', 'RUN → INVOICE') +
    intro('Convert a completed Production Run into a draft invoice in one click. Pulls client, formula, cases, and pricing.') +
    steps([
      'Sidebar → Operations → Production Runs.',
      'Find the run in the <b>Ship</b> column. Click the <b>"→ Invoice"</b> button on the card.',
      'A pre-filled invoice opens in the New Invoice builder. Tweak line items if needed and send.'
    ]) +
    whereToFind('Sidebar → Operations → Production Runs → "Ship" column → card action button') +
    subhead('📈', 'WEIGHTED PIPELINE FORECAST') +
    intro('Shows total deal value weighted by stage probability (Prospecting 20% / Proposal 50% / Negotiation 75% / Closed Won 100%). Updates when you move deals between stages.') +
    bullets([
      'Sits on the Dashboard, right next to AR Aging (callout 2).',
      'Click through to the Pipeline page from the widget.'
    ]) +
    whereToFind('Dashboard page → right column') +
    subhead('📊', 'REVENUE FORECAST DASHBOARD (12-month)') +
    intro('Stacked bar chart of past 6 months collected + next 6 months forecasted. Forecast comes from invoiced-but-unpaid + weighted pipeline.') +
    bullets([
      'Click any month bar to drill into that month\'s invoices.',
      '"Run new forecast" button regenerates with current pipeline data.'
    ]) +
    steps([
      'AI toolbar → <b>Revenue Forecast</b>.',
      'Review the 12-month bar. Past = collected (solid). Next 6 = forecast (dashed).',
      'Hover any month for breakdown of collected / invoiced-open / weighted-pipeline contribution.'
    ]) +
    whereToFind('AI toolbar → Revenue Forecast (admin)') +
    subhead('📊', 'CAPACITY HEATMAP') +
    intro('Calendar grid showing how booked each day is. Green = open / yellow = busy / red = overbooked. Built from Production Schedule.') +
    steps([
      'AI toolbar → <b>Capacity heatmap</b>.',
      'Pick a month. Each day shows booked-run count + capacity %.',
      'Click a day to see what is scheduled.'
    ]) +
    whereToFind('AI toolbar → Capacity heatmap (admin)') +
    subhead('🎯', 'KPI SCORECARD') +
    intro('North-star metrics on one card: this-month revenue, MoM growth, deals closed, average deal size, days-to-paid, NPS. Colour-codes good/bad.') +
    whereToFind('Dashboard page (auto-renders alongside Revenue Forecast)');

  /* SECTION 6 — CUSTOMER RELATIONS */
  var MOCK_CR = wf(620, 220,
    box(0,0,620,40,'#142238') + txt(15,26,'CUSTOMER RELATIONS',12,'#fff') +
    box(15,55,190,150,'#1c2e48') + txt(25,78,'CUSTOMER PORTAL',10,'#00e5c0') +
    txt(25,102,'Per-client URL',9,'#cfd9e6') + txt(25,118,'• See invoices',9,'#9aa7bd') +
    txt(25,134,'• Pay Now',9,'#9aa7bd') + txt(25,150,'• Accept quote',9,'#9aa7bd') +
    txt(25,166,'• Contact you',9,'#9aa7bd') +
    box(215,55,190,150,'#1c2e48') + txt(225,78,'NPS SURVEYS',10,'#00e5c0') +
    txt(225,102,'Sent: 24',9,'#cfd9e6') + txt(225,120,'Score: 67',11,'#5fcf9e') +
    txt(225,140,'• Promoters: 14',9,'#5fcf9e') + txt(225,158,'• Passives: 8',9,'#f5c842') +
    txt(225,176,'• Detractors: 2',9,'#ff8579') +
    box(415,55,190,150,'#1c2e48') + txt(425,78,'ONBOARDING WIZARD',10,'#00e5c0') +
    txt(425,102,'Step 1 of 6:',9,'#cfd9e6') + txt(425,120,'Brand intake',10,'#fff')
  );

  var SEC_CR = MOCK_CR +
    locator(
      '<b>Customer Logins</b> (admin page to send portal invites + reset / remove portal accounts) &rarr; sidebar &rarr; <b>Tools</b> section (near the bottom).<br>' +
      '<b>Customer Portal itself</b> &rarr; this is what your <i>customer</i> sees, not you. They get a magic-link email when you click Send Onboarding Email. Their URL is <code>goodliquidbevco.com#portal/&lt;client-uuid&gt;</code>.<br>' +
      '<b>Onboarding Wizard, NPS responses</b> &rarr; floating <b>🤖 AI toolbar</b> (admin).<br>' +
      '<b>NPS survey link to send to a customer</b> &rarr; client record &rarr; "Send NPS survey" button.<br>' +
      '<b>Anniversary widget</b> &rarr; auto-renders on the <b>Dashboard</b> when any client hits a milestone this week.<br>' +
      '<b>Run Sheet PDF</b> &rarr; "📄 Print sheet" button on cards in the Production Runs kanban.'
    ) +
    intro('Tools that touch the customer directly &mdash; portal, surveys, onboarding flow, anniversaries. <b>There is no single "Customer Relations" sidebar section</b> &mdash; these are scattered across the sidebar Tools area, the AI toolbar, the Dashboard, and inline on client / production-run records.') +
    subhead('🌐', 'CUSTOMER PORTAL') +
    intro('Each client gets a private URL where they can see their invoices, pay (Stripe), accept quotes, and message you. No login = a magic-link in their email.') +
    bullets([
      '<b>What they see:</b> only invoices addressed to them, with Pay Now buttons (Stripe links you saved per-invoice), Accept Quote buttons (emails you on click), and a contact form.',
      '<b>How they get in:</b> the Send Onboarding Email button on the Customer Logins page emails them a magic link to set their own password.',
      '<b>Route:</b> <code>#portal/&lt;client-uuid&gt;</code> — bookmarkable.'
    ]) +
    steps([
      'Sidebar → <b>Customer Logins (admin)</b>.',
      'Find the client. Click <b>Send Onboarding Email</b>. They get a magic link to set their own password.',
      'They log in, see their stuff, and can pay or message — no setup on their side.'
    ]) +
    whereToFind('Sidebar → Customer Logins → Onboarding column') +
    subhead('🚀', 'ONBOARDING WIZARD (admin)') +
    intro('A 6-step intake flow you walk a brand-new client through on their first call. Captures everything: legal name, EIN, COI, billing address, product types, payment terms, primary POC.') +
    bullets([
      '<b>Steps:</b> Brand intake → Legal & banking → Logistics → Product types → Compliance docs → Confirm.',
      'Auto-creates the client record with everything filled in.'
    ]) +
    steps([
      'AI toolbar → <b>Onboarding wizard</b>.',
      'Walk through each step while on the call with the new client.',
      'Skip optional fields if not known yet. Step 6 confirms + saves.',
      'New client appears in the Clients list, fully populated.'
    ]) +
    whereToFind('AI toolbar → Onboarding wizard (admin)') +
    subhead('⭐', 'NPS SURVEYS') +
    intro('Send a one-question Net Promoter Score survey to a client. They click a 0-10 score on a public URL; their score lands in the CRM.') +
    bullets([
      '<b>Public route:</b> <code>#nps/&lt;client-uuid&gt;</code> — no login required.',
      '<b>Responses modal</b> in the CRM shows aggregate score, promoter/passive/detractor breakdown, and verbatim follow-up comments.'
    ]) +
    steps([
      'Open a Client record → click <b>"Send NPS survey"</b>. (Or run a bulk-send via the Bulk Actions menu.)',
      'Client receives an email with a one-click link to the public NPS page.',
      'They pick 0-10 + optional comment. Submits to Supabase.',
      'In the CRM: AI toolbar → <b>NPS responses</b> to see all results + aggregate score.'
    ]) +
    whereToFind('AI toolbar → NPS responses (admin)') +
    subhead('🎂', 'ANNIVERSARY TRACKER') +
    intro('Surfaces clients hitting their 1-year (or 2/5/10-year) anniversary as a customer. Auto-drafts a "thanks for X years!" email.') +
    bullets([
      'Appears on the Dashboard as an "Anniversaries this week" widget when any client is hitting a milestone.',
      'One-click "Draft email" pre-writes a thank-you note referencing the milestone.'
    ]) +
    whereToFind('Dashboard widget (shown only when at least 1 anniversary this week)') +
    subhead('📄', 'RUN SHEET PDF') +
    intro('Generates a printable production run sheet for the floor. One page per run with formula, allergens, target yield, batch size, operator sign-off lines.') +
    steps([
      'Sidebar → Operations → Production Runs.',
      'Find the run. Click the <b>"Print sheet"</b> button on the card.',
      'PDF opens in a new tab. Print it for the floor. Operator signs at bottom.'
    ]) +
    whereToFind('Sidebar → Operations → Production Runs → any card → "Print sheet" button') +
    subhead('📧', 'CLIENT EMAIL THREAD') +
    intro('Compose and track emails to a client without leaving the CRM. The email panel lives at the bottom of the Edit Client modal — one thread per client, with scrollable history.') +
    bullets([
      '<b>Compose:</b> type subject + body → Send. Sent via Mailgun server-side. Replies from the client arrive at mike@goodliquid.com (reply-to header).',
      '<b>History:</b> shows the last 30 emails sent to that client\'s address with status (sent / delivered / opened / clicked).',
      'History is pulled live from the email_log table, so Email Activity and Client Email Thread always show the same data.'
    ]) +
    steps([
      'Clients page → click any client row → "Edit" button (or edit icon).',
      'Scroll to the bottom of the edit modal — the EMAIL THREAD section appears automatically.',
      'Type subject + body → "📤 Send".'
    ]) +
    whereToFind('Clients → Edit Client modal → bottom section (EMAIL THREAD)') +
    subhead('📅', 'BOOKING CANCELLATION') +
    intro('Cancel a visitor\'s tour/tasting booking from inside the CRM. A Cancel button appears on each booking row in the Scheduling panel.') +
    bullets([
      'Cancelling updates the booking status to "cancelled" in Supabase.',
      'The visitor\'s confirmation email is not automatically rescinded — email them separately if needed (the modal prompts you to do so).',
      'Cancelled bookings drop off the upcoming list immediately.'
    ]) +
    whereToFind('AI toolbar → Scheduling → Upcoming bookings tab → Cancel button on any row');

  /* SECTION 7 — PUBLIC WEBSITE */
  var MOCK_PUBLIC = wf(620, 220,
    box(0,0,620,40,'#142238') + txt(15,26,'PUBLIC SITE — NEW SECTIONS',12,'#fff') +
    box(15,55,190,150,'#1c2e48') + txt(25,78,'SUSTAINABILITY',10,'#5fcf9e') +
    txt(25,100,'75% recycle rate',9,'#cfd9e6') + txt(25,116,'2.1L water/can',9,'#cfd9e6') +
    txt(25,132,'0.18 kWh/case',9,'#cfd9e6') + txt(25,148,'100% recyclable',9,'#cfd9e6') +
    box(215,55,190,150,'#1c2e48') + txt(225,78,'CASE STUDIES',10,'#f5c842') +
    txt(225,102,'SunBurst Seltzers',10,'#fff') + txt(225,116,'12K cases / yr',9,'#9aa7bd') +
    txt(225,140,'Wildkind Kombucha',10,'#fff') + txt(225,154,'Shelf-stable cracked',9,'#9aa7bd') +
    box(415,55,190,150,'#1c2e48') + txt(425,78,'QUOTE CALC',10,'#7fc6f5') +
    txt(425,102,'Format: 12oz std',9,'#cfd9e6') + txt(425,118,'Cases: 1,000',9,'#cfd9e6') +
    txt(425,138,'Total: $8,400',11,'#00e5c0')
  );

  var SEC_PUBLIC = MOCK_PUBLIC +
    locator(
      'All sections in this group are on the <b>public marketing website</b> at <code>goodliquidbevco.com</code> &mdash; no CRM login required. Scroll through the homepage to find them; the nav bar links to most.'
    ) +
    intro('The public marketing site (goodliquidbevco.com) got several new sections to help convert visitors. All are live now.') +
    subhead('🌱', 'SUSTAINABILITY SECTION') +
    intro('Honest data on what makes our line greener than the alternative: aluminum recycle rate, water per filled can, kWh per case, recyclable outbound packaging.') +
    bullets([
      '<b>Counter cards:</b> 75% aluminum recycle, 2.1L water/can, 0.18 kWh/case, 100% recyclable outbound.',
      '<b>"What we don\'t do"</b> block addresses common greenwashing claims so you can\'t be accused of them.',
      '<b>Per-axis explainers</b> for can vs. PET / small-batch waste / PakTech handles / local-first sourcing.'
    ]) +
    whereToFind('Public site → scroll past Facility → before Case Studies, or click "Sustainability" if in nav') +
    subhead('🏆', 'CASE STUDIES GRID') +
    intro('Public, scroll-stopping success stories from real clients. Pulls from the Supabase <code>case_studies</code> table (managed via the Auto Case Study Builder).') +
    bullets([
      '<b>Default content:</b> 3 hand-written stories (SunBurst Seltzers, Wildkind Kombucha, Bayline Cold Brew).',
      '<b>Falls back gracefully</b> if Supabase is down — uses the demo content rather than rendering empty.'
    ]) +
    steps([
      'In the CRM: AI toolbar → Auto case study → generate one for a real client → "Save to Public Case Studies".',
      'New case study appears in the grid on next page load.'
    ]) +
    whereToFind('Public site → "Success Stories" section') +
    subhead('📚', 'RESOURCE LIBRARY') +
    intro('Blog-grid for downloadable guides + posts. Same content model as case studies — admin-managed, public-rendered.') +
    bullets([
      'Pulls from Supabase <code>resources</code> table.',
      'Falls back to demo posts if empty.'
    ]) +
    whereToFind('Public site → "Resource Library" section') +
    subhead('💰', 'QUOTE CALCULATOR (public)') +
    intro('On the pricing page. Visitor picks format + cases tier + add-ons, gets an instant quote without filling out a form. Hugely converts.') +
    bullets([
      '<b>Formats:</b> 12oz std / 12oz sleek / 16oz std (matches your rate card).',
      '<b>Tiers:</b> 150 / 340 / 501 / 1,000 / 2,500 / 5,000 cases.',
      '<b>Add-ons:</b> nitro, labelling, palletisation — toggle on/off.',
      '<b>Updates total live</b> as they change inputs. CTA at the bottom: "Get formal quote" pushes them to the contact form, pre-filled.'
    ]) +
    whereToFind('Public site → Pricing section') +
    subhead('🏗️', 'CAPABILITIES MATRIX + FACILITY GALLERY + CAPACITY INDICATOR') +
    intro('Three credibility blocks added to give visitors confidence we are a real co-packer.') +
    bullets([
      '<b>Capabilities matrix:</b> table of what we run (formats, processes, certifications) so prospects can answer "can they make my thing?" in 10 seconds.',
      '<b>Facility gallery:</b> photos of the line (when uploaded to Supabase storage).',
      '<b>Capacity indicator:</b> live "this month\'s capacity: X% booked" pulled from the Production Schedule.'
    ]) +
    whereToFind('Public site → Capabilities, Facility, and Process sections');

  /* SECTION 8 — ADMIN TOOLS */
  var SEC_ADMIN =
    subhead('💾', 'EXPORT EVERYTHING (FULL BACKUP)') +
    intro('Download a ZIP of every CRM table as JSON — a complete point-in-time backup of all your Supabase data.') +
    bullets([
      'Exports 30 tables (clients, invoices, deals, compliance records, audit log, etc.). Each becomes its own .json file inside a date-stamped ZIP.',
      'A _manifest.json lists row counts per table. A README.txt explains how to restore.',
      'Admin-only. Button appears on the Users page toolbar.'
    ]) +
    whereToFind('Sidebar → Users (admin) → "💾 Backup all data" button in the page toolbar') +
    subhead('📅', 'BILLING SCHEDULE QUEUE') +
    intro('View and cancel pending scheduled email sends (follow-up emails queued by the AR Collection tool). A cron worker fires every 15 minutes to dispatch them.') +
    bullets([
      'Shows each scheduled send: recipient, subject, send-at time, and current status (pending / sent / failed / cancelled).',
      'Click Cancel on any pending row to prevent it from sending. Safe to do right up until the cron fires.'
    ]) +
    whereToFind('Sidebar → Invoices → "📅 Queue" button in the toolbar') +
    subhead('⏰', 'AR SNOOZE') +
    intro('Skip an overdue invoice in the AR Collection panel for 5 days without cancelling the scheduled follow-up. Useful when a client says "check back Friday."') +
    bullets([
      '"⏰ Snooze 5d" button appears next to every action button in the AR Collection panel.',
      'Snoozes are stored in localStorage per browser (not in the database). They reset if you clear browser data.'
    ]) +
    whereToFind('AI toolbar → AR Collection → "⏰ Snooze 5d" button on any invoice row') +
    subhead('📋', 'QUOTE AUTO-EXPIRY') +
    intro('Quotes more than 30 days old automatically flip to status=expired. No action needed — it runs on every CRM load and once per hour while you\'re logged in.') +
    bullets([
      'Affects invoices with status="quote" whose invoice_date is >30 days ago.',
      'Expired quotes drop out of the active Invoices view.'
    ]) +
    whereToFind('Automatic — no UI required') +
    subhead('📧', 'TEST MAILGUN SEND') +
    intro('Send a test email to yourself (mike@goodliquid.com) to verify Mailgun is configured correctly. Useful after changing API keys or the Edge Function.') +
    steps([
      'AI toolbar → Quick Actions → "📧 Mailgun Settings".',
      'In the settings modal, click "Test send".',
      'A confirmation email lands at mike@goodliquid.com if Mailgun is wired up correctly.'
    ]) +
    whereToFind('AI toolbar → Quick Actions → Mailgun Settings → "Test send" button') +
    subhead('📲', 'PWA INSTALLATION') +
    intro('Install the Good Liquid CRM as a progressive web app (PWA) on your device — adds an icon to your home screen or taskbar. Works on Chrome (Android + desktop), Safari (iOS), and Edge.') +
    bullets([
      'A "📲 Install Good Liquid CRM" banner appears at the top of the page when the browser decides the app is installable (requires HTTPS, a web manifest, and a service worker — all already in place).',
      'Click the banner to trigger the browser\'s native install prompt.',
      'Once installed, the CRM opens in its own window without browser chrome.'
    ]) +
    whereToFind('Top-of-page banner (appears automatically when Chrome / Edge signals the app can be installed)') +
    subhead('🔄', 'SOFT REFRESH / PAGE RESUME') +
    intro('If you refresh or navigate away while inside the CRM, the app remembers which page you were on and returns you there after re-login. No need to navigate back manually.') +
    bullets([
      'Saved in localStorage as gl_active_page. Cleared on intentional logout.',
      'Also fires 60ms after login on every session start — so deep-linking via ?page=invoices in the URL also restores correctly.'
    ]) +
    whereToFind('Automatic — no UI required') +
    subhead('📈', 'GOOGLE ANALYTICS (GA4)') +
    intro('Wire up a GA4 Measurement ID so page-view events from the CRM fire into your Google Analytics property. Useful if you want to see session activity in GA4 alongside your public site data.') +
    steps([
      'AI toolbar → Quick Actions → "📈 Google Analytics" (admin).',
      'Paste your Measurement ID (format: G-XXXXXXXXXX).',
      'Save. The gtag.js script loads on the next CRM page view.'
    ]) +
    whereToFind('AI toolbar → Quick Actions → Google Analytics (admin only)') +
    subhead('🛡️', 'SENTRY ERROR MONITORING') +
    intro('Forward unhandled JavaScript errors from the CRM to your Sentry project. Every crash that hits the built-in onerror boundary also writes to the Supabase error_log table — Sentry adds real-time alerts and stack traces.') +
    steps([
      'AI toolbar → Quick Actions → "🛡️ Sentry" (admin).',
      'Paste your Sentry Data Source Name (DSN). Found in Sentry → Settings → Projects → [project] → Client Keys.',
      'Save. Sentry initialises and begins capturing errors immediately.'
    ]) +
    whereToFind('AI toolbar → Quick Actions → Sentry (admin only)') +
    subhead('🔒', 'TWO-FACTOR AUTHENTICATION (2FA)') +
    intro('Add a Time-based One-Time Password (TOTP) second factor to your CRM login using any authenticator app (Google Authenticator, Authy, 1Password, etc.).') +
    steps([
      'AI toolbar → Quick Actions → "🔒 Two-Factor Auth".',
      'Click "Set up 2FA". A QR code + base32 secret are shown.',
      'Scan the QR code with your authenticator app.',
      'Enter the 6-digit code to confirm enrollment.',
      'From now on, every login prompts for your authenticator code after the password step.'
    ]) +
    bullets([
      'To remove 2FA: open the same menu → "Remove 2FA" → enter a code to confirm.',
      'Admin or personal — each user manages their own 2FA independently.'
    ]) +
    whereToFind('AI toolbar → Quick Actions → Two-Factor Auth');

  /* SECTION 9 — INTEGRATIONS */
  var SEC_INTEGRATIONS =
    subhead('💼', 'QUICKBOOKS ONLINE') +
    intro('Sync Good Liquid invoices to QuickBooks Online (QBO). Once connected, any invoice you push creates a matching QBO invoice in your books so AR lives in both systems.') +
    bullets([
      '<b>Connect:</b> OAuth flow — you log in to QuickBooks and grant access. Access + refresh tokens are stored in Supabase.',
      '<b>Push one invoice:</b> Invoices page → open an invoice → "Push to QBO" button.',
      '<b>Bulk push:</b> QuickBooks settings modal → "Push all unpushed" (all invoices not yet in QBO).',
      'Pushed invoices are tagged with a qbo_id so they are not double-pushed.',
      '<b>Disconnect:</b> settings modal → "Disconnect" (revokes the token, does not delete QBO data).'
    ]) +
    whereToFind('AI toolbar → Quick Actions → "💼 QuickBooks" (admin)') +
    subhead('📝', 'E-SIGNATURES (DROPBOX SIGN)') +
    intro('Send service agreements, NDAs, and custom contracts for e-signature via the Dropbox Sign (formerly HelloSign) API. Signed documents are stored as a URL reference on the client record.') +
    bullets([
      '<b>Templates:</b> upload your contract PDFs as Dropbox Sign templates, then paste the Template IDs into the E-Signatures settings.',
      '<b>Send for signature:</b> open a Client record → "Send for signature" → pick a template → recipient email is pre-filled from the client.',
      'Signed document URL is written back to the client record when Dropbox Sign fires the completion webhook.',
      'Requires a Dropbox Sign API key (saved in E-Signatures settings).'
    ]) +
    whereToFind('AI toolbar → Quick Actions → "📝 E-Signatures" (admin)') +
    subhead('📱', 'SMS NOTIFICATIONS (TWILIO)') +
    intro('Send yourself an SMS when key events happen in the CRM: a new invoice is paid, a deal is won, a customer accepts a quote, a tour request comes in via the public site, or an invoice goes overdue.') +
    bullets([
      '<b>Configure:</b> paste your Twilio serverless function URL + your mobile number into SMS Alerts settings. Enable the events you want.',
      '<b>Compliance alerts:</b> a separate "Alert phone" setting sends an SMS when a critical compliance failure is logged (held lot, failed CIP, etc.).',
      'SMS toggles are per-event — enable only the events that matter to you.'
    ]) +
    whereToFind('AI toolbar → Quick Actions → "📱 SMS Alerts"') +
    subhead('📧', 'MAILGUN — EMAIL SETUP') +
    intro('All outbound CRM emails (AR dunning drafts, onboarding invites, client email threads, compliance digests) go through the mailgun-send Supabase Edge Function. The API key and from-address live server-side — no browser exposure.') +
    bullets([
      '<b>From address:</b> <code>noreply@mail.goodliquidbevco.com</code> (the verified Mailgun domain).',
      '<b>Reply-To:</b> outbound emails set <code>Reply-To: mike@goodliquid.com</code> so client replies land in your inbox.',
      '<b>Change API key:</b> Supabase Dashboard → Edge Functions → Secrets → MAILGUN_API_KEY.',
      '<b>Test the connection:</b> AI toolbar → Quick Actions → Mailgun Settings → "Test send".'
    ]) +
    whereToFind('AI toolbar → Quick Actions → "📧 Mailgun Settings"');

  /* SECTION 10 — PRODUCTION QUOTE BUILDER */
  var MOCK_QUOTES = wf(620, 270,
    box(0,0,620,40,'#142238') +
    txt(15,26,'QUOTE BUILDER  ·  admin only',12,'#fff') +
    box(15,55,185,200,'#1c2e48') +
    txt(25,78,'Product Type',9,'#9aa7bd') +
    box(25,85,165,26,'#243a56') + txt(35,102,'Canning',11,'#fff') +
    txt(25,126,'Format',9,'#9aa7bd') +
    box(25,133,165,26,'#243a56') + txt(35,150,'12oz Sleek',11,'#fff') +
    txt(25,177,'Add-ons',9,'#9aa7bd') +
    txt(35,195,'✓ Nitrogen dosing',10,'#cfd9e6') +
    txt(35,211,'✓ Case tray',10,'#cfd9e6') +
    txt(35,227,'✓ Palletizing',10,'#cfd9e6') +
    box(210,55,395,200,'#1c2e48') +
    txt(220,78,'TIERS',9,'#9aa7bd') + txt(360,78,'Cases',9,'#9aa7bd') + txt(430,78,'$/can',9,'#9aa7bd') + txt(500,78,'Total',9,'#9aa7bd') + txt(570,78,'',9,'#9aa7bd') +
    box(210,88,395,30,'#0f1d2e') +
    txt(220,108,'Tier 1',11,'#cfd9e6') + txt(360,108,'500',11,'#fff') + txt(430,108,'$0.38',11,'#00e5c0') + txt(500,108,'$4,560',11,'#5fcf9e') + tag(595,103,1) +
    box(210,120,395,26) +
    txt(220,137,'Tier 2',11,'#cfd9e6') + txt(360,137,'1,000',11,'#fff') + txt(430,137,'$0.35',11,'#fff') + txt(500,137,'$8,400',11,'#5fcf9e') +
    box(210,148,395,26) +
    txt(220,165,'Tier 3',11,'#cfd9e6') + txt(360,165,'5,000',11,'#fff') + txt(430,165,'$0.28',11,'#fff') + txt(500,165,'$33,600',11,'#5fcf9e') +
    txt(220,198,'+ Add tier',10,'#00e5c0') + txt(395,198,'⚡ Load Standard Tiers',10,'#f5c842') + tag(595,200,2) +
    box(210,215,395,34,'#243a56') +
    txt(220,230,'GLQ-202507-001',10,'#9aa7bd') + txt(350,233,'SAVE',11,'#00e5c0') + txt(425,233,'PDF',11,'#9aa7bd') + txt(480,233,'SAVE + PDF',11,'#f5c842') + tag(595,231,3)
  );

  var SEC_QUOTES = MOCK_QUOTES +
    locator(
      '<b>New Quote button</b> &rarr; Pipeline page &rarr; click any deal &rarr; deal detail panel &rarr; <b>📋 New Quote</b> button.<br>' +
      '<b>Quote history</b> &rarr; Clients page &rarr; click a client &rarr; Edit &rarr; <b>📋 PRODUCTION QUOTES</b> section &rarr; <b>+ New Quote</b>.<br>' +
      '<b>Close Job button</b> &rarr; same deal detail panel &rarr; <b>✅ Close Job</b> button (right of "📋 New Quote").'
    ) +
    intro('Admin-only tool for generating professional production quotes and saving them under the client record. The quote uses the current price deck with editable tier overrides, generates a PDF in the Good Liquid format, and saves to Supabase so the history is always visible.') +
    subhead('📋', 'OPENING THE QUOTE BUILDER') +
    bullets([
      '<b>From a deal:</b> Pipeline → click the deal card → deal detail panel slides open → click <b>📋 New Quote</b>. The deal and client are pre-loaded.',
      '<b>From a client record:</b> Clients → find the client → Edit → scroll to <b>📋 PRODUCTION QUOTES</b> → click <b>+ New Quote</b>.',
      '<b>Admin gate:</b> both entry points are hidden for non-admin users.'
    ]) +
    subhead('⚙️', 'CONFIGURING THE QUOTE') +
    steps([
      'Choose <b>Product Type:</b> Canning, Bottling, or Keg. This sets the available formats and tier structure.',
      '<b>Canning formats:</b> 12oz Standard, 12oz Sleek, 16oz Standard. <b>Bottling:</b> 750ml. <b>Keg:</b> Half-barrel (15.5 gal).',
      'Set a <b>Quote Date</b> and <b>Valid for (days)</b> — defaults to today + 30 days.',
      'Add <b>Notes</b> (optional) — these appear on the PDF footer.'
    ]) +
    subhead('📊', 'BUILDING TIERS') +
    intro('Each quote has one or more quantity tiers so the client can see how price drops with volume.') +
    bullets([
      '<b>⚡ Load Standard Tiers</b> (callout 2) — one click to pre-fill the three standard canning tiers: 501, 1,000, 5,000 cases at deck rates. Start here for most quotes.',
      '<b>+ Add Tier</b> — add a custom tier manually. Set the case quantity and $/can rate.',
      '<b>Rate override (amber border):</b> if you type directly into a tier\'s rate cell, the border turns amber to flag that pricing is custom, not from the standard deck. Useful for giving a client a special deal — overrides are visible at a glance.',
      '<b>Delete a tier</b> by clicking the × on the right of any tier row.',
      '<b>Canning rates include:</b> filling, seaming, CO₂, quality checks. Add-ons are billed on top.'
    ]) +
    whereToFind('Quote builder → Tiers table (callout 1 = first tier, callout 2 = Load Standard Tiers button)') +
    subhead('➕', 'ADD-ONS') +
    intro('Checked add-ons are automatically included in the per-can price. Each add-on appears as a separate line item on the PDF.') +
    bullets([
      '<b>Nitrogen dosing:</b> $0.03/can — checked by default.',
      '<b>Case tray (PakTech):</b> $0.03/can — checked by default.',
      '<b>Palletizing:</b> $20/pallet — checked by default.',
      '<b>Pasteurization:</b> $0.07/can — unchecked by default (add only if client requests it).',
      'Uncheck any add-on to remove it from the quote. The tier totals update live.'
    ]) +
    subhead('💾', 'SAVING AND GENERATING THE PDF') +
    steps([
      '<b>Save</b> (callout 3) — saves the quote to Supabase under the client record. Assigns a quote number (e.g., GLQ-202507-001).',
      '<b>Download PDF</b> — generates the PDF in a new window and opens the browser print dialog. Does not save to Supabase.',
      '<b>Save + Download PDF</b> — saves first, then immediately opens the PDF. Use this for your normal workflow.',
      'The generated PDF matches the Good Liquid quote format: company header, client info, tier pricing table, add-on line items, inclusions, and a signature block.'
    ]) +
    whereToFind('Quote builder modal → bottom action bar (Save / Download PDF / Save + Download PDF)') +
    subhead('📁', 'VIEWING SAVED QUOTES') +
    bullets([
      'All saved quotes for a client appear in the <b>📋 PRODUCTION QUOTES</b> panel inside the Edit Client modal.',
      'Each row shows: quote number, format, date, status badge (Draft / Sent / Accepted / Declined).',
      '<b>Re-download PDF:</b> click the PDF button on any saved quote row to regenerate and open it. The stored HTML is used — no internet required.',
      '<b>Status:</b> you can update the quote status (e.g., to Accepted) directly from the list row.'
    ]) +
    whereToFind('Clients → Edit Client → 📋 PRODUCTION QUOTES section') +
    subhead('✅', 'CLOSING A JOB') +
    intro('When a deal converts, mark it Closed Won in one click from the deal detail panel.') +
    steps([
      'Pipeline → click the deal card → deal detail panel opens.',
      'Click <b>✅ Close Job</b> (next to the 📋 New Quote button).',
      'Confirm the prompt: "Mark this deal as Closed Won?"',
      'The deal stage moves to Closed Won and saves automatically. The win-loss tracker fires and records the outcome.'
    ]) +
    whereToFind('Pipeline → deal detail panel → ✅ Close Job button (admin only)');

  /* ──────────────────────────────────────────────────────────
     PATCH: wrap glOpenHelp to inject new sections + TOC entries
     ────────────────────────────────────────────────────────── */
  var NEW_SECTIONS = [
    // Label spans three sidebar sections (Operations, Operations Pro, Compliance)
    // because production workflow crosses them — see the locator block at the top
    // of SEC_OPS_PRO for the exact mapping.
    { id:'help-ops-pro',      icon:'🏭', label:'Production & Operations', html:SEC_OPS_PRO },
    { id:'help-qs',           icon:'✅', label:'Quality & Supply',        html:SEC_QS },
    { id:'help-marketing',    icon:'📣', label:'Marketing & Content',     html:SEC_MARKETING },
    { id:'help-growth',       icon:'🚀', label:'Growth Tools',            html:SEC_GROWTH },
    { id:'help-revops',       icon:'💰', label:'Revenue Ops',             html:SEC_REVOPS },
    { id:'help-cr',           icon:'🌐', label:'Customer-Facing Tools',   html:SEC_CR },
    { id:'help-public',       icon:'🏠', label:'Public Website',          html:SEC_PUBLIC },
    { id:'help-admin',        icon:'⚙️', label:'Admin Tools',             html:SEC_ADMIN },
    { id:'help-integrations', icon:'🔗', label:'Integrations',            html:SEC_INTEGRATIONS },
    { id:'help-quotes',       icon:'📋', label:'Production Quotes',       html:SEC_QUOTES }
  ];

  // Map new CRM pages to the right new help section so context-aware open works
  var PAGE_TO_NEW_SECTION = {
    'cpg-formulas':'help-ops-pro', 'cpg-yield':'help-ops-pro',
    'cpg-production-runs':'help-ops-pro', 'cpg-samples':'help-ops-pro',
    'cpg-cip':'help-ops-pro',
    'cpg-audit':'help-qs', 'cpg-defects':'help-qs', 'cpg-vendors':'help-qs',
    'cpg-content':'help-marketing'
  };

  function injectIntoModal(){
    var body = document.getElementById('gl-help-body');
    var toc  = document.getElementById('gl-help-toc');
    if(!body || !toc) return false;
    if(body.dataset.glAddonApplied === '1') return true;

    var addonHtml = NEW_SECTIONS.map(function(s){
      return '<section id="' + s.id + '" style="padding:22px 4px 26px;border-bottom:1px solid rgba(255,255,255,.06);scroll-margin-top:20px">' +
        '<h3 style="margin:0 0 14px;font-family:var(--ff-disp);font-size:15px;letter-spacing:2px;color:var(--teal)">' + s.icon + ' ' + s.label.toUpperCase() + '</h3>' +
        s.html +
      '</section>';
    }).join('');
    body.insertAdjacentHTML('beforeend', addonHtml);

    var dividerHtml = '<div style="margin:14px 8px 8px;padding-top:14px;border-top:1px dashed rgba(0,229,192,.2);font-size:10px;letter-spacing:2px;color:var(--teal);font-weight:600">✨ NEW FEATURES</div>';
    var tocHtml = NEW_SECTIONS.map(function(s){
      return '<a href="#' + s.id + '" data-anchor="' + s.id + '" ' +
        'style="display:block;padding:8px 12px;margin:2px 0;border-radius:6px;font-size:12px;color:#9aa7bd;text-decoration:none;line-height:1.4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transition:background .12s,color .12s">' +
        s.icon + ' ' + s.label + '</a>';
    }).join('');
    toc.insertAdjacentHTML('beforeend', dividerHtml + tocHtml);

    toc.querySelectorAll('a[data-anchor]').forEach(function(a){
      if(a.dataset.glWired === '1') return;
      a.dataset.glWired = '1';
      a.addEventListener('click', function(ev){
        ev.preventDefault();
        var t = document.getElementById(a.getAttribute('data-anchor'));
        if(t) t.scrollIntoView({ behavior:'smooth', block:'start' });
      });
    });

    body.dataset.glAddonApplied = '1';
    return true;
  }

  function wrapHelp(){
    var orig = window.glOpenHelp;
    if(typeof orig !== 'function'){ setTimeout(wrapHelp, 500); return; }
    window.glOpenHelp = function(scrollTo){
      if(!scrollTo){
        var activePg = document.querySelector('#crm-panel .cpg.act');
        if(activePg && PAGE_TO_NEW_SECTION[activePg.id]){
          scrollTo = PAGE_TO_NEW_SECTION[activePg.id];
        }
      }
      orig(scrollTo);
      var tries = 0;
      var iv = setInterval(function(){
        if(injectIntoModal() || ++tries > 8) clearInterval(iv);
      }, 60);
      if(scrollTo && /^help-(ops-pro|qs|marketing|growth|revops|cr|public|admin|integrations|quotes)$/.test(scrollTo)){
        setTimeout(function(){
          var t = document.getElementById(scrollTo);
          if(t) t.scrollIntoView({ behavior:'smooth', block:'start' });
        }, 250);
      }
    };
  }
  wrapHelp();

  console.log('[GL] help — new-features addon loaded (10 sections)');
}());


/* ============================================================
   AI TOOLBAR REDESIGN
   Replaces the 39-item vertical pill stack (which scrolled off
   the top/bottom of the viewport) with a categorised popup panel:
   - 380px wide, max-height 75vh, anchored bottom-right
   - Search input at the top — filters items across all categories
   - 6 collapsible category sections, 2-col grid of compact buttons
   - First category ("AI tools") expanded by default
   - Esc or click-outside to close

   Wraps window.addAIToolbar so the original flat list still mounts
   (for backward compat / event handlers), then removes the old
   #ai-tools popout and overrides the FAB click to open the new panel.
   ============================================================ */
(function(){
  var CATEGORIES = [
    {
      title:'AI tools', icon:'🤖', expanded:true,
      items:[
        { label:'Estimate Quote',    icon:'💰', fn:'aiEstimateQuote' },
        { label:'Draft Invoice',     icon:'🧾', fn:'aiDraftInvoice' },
        { label:'Meeting Notes',     icon:'📝', fn:'openMeetingNotesModal' },
        { label:'Draft Email',       icon:'✉️', fn:'openAICommModal' },
        { label:'Revenue Forecast',  icon:'📈', fn:'aiGenerateForecast' }
      ]
    },
    {
      title:'Marketing & Content', icon:'📣',
      items:[
        { label:'Social post drafter',    icon:'📣', fn:'openSocialDrafter' },
        { label:'Auto case study',        icon:'📰', fn:'openCaseStudyBuilder' },
        { label:'Post ideas this week',   icon:'💡', fn:'openPostSuggester' },
        { label:'AI Image Prompts',       icon:'🎨', fn:'openAIImagePrompts' },
        { label:'Email drip generator',   icon:'✉️', fn:'openEmailDripGenerator' },
        { label:'LinkedIn outreach',      icon:'💼', fn:'openLinkedInOutreach' }
      ]
    },
    {
      title:'Growth & Pipeline', icon:'🚀',
      items:[
        { label:'Cross-sell ideas',       icon:'🎯', fn:'openCrossSellSuggester' },
        { label:'Win-loss analytics',     icon:'📊', fn:'openWinLossAnalytics' },
        { label:'Trade Show ROI',         icon:'🎪', fn:'openTradeShowROI', admin:true },
        { label:'Service Packages',       icon:'📦', fn:'openServicePackages', admin:true },
        { label:'Churn Risk',             icon:'🔮', fn:'openChurnPredictor', admin:true }
      ]
    },
    {
      title:'Revenue & Customer', icon:'💰',
      items:[
        { label:'AR Collection',          icon:'💰', fn:'openARCollection', admin:true },
        { label:'Onboarding wizard',      icon:'🚀', fn:'openOnboardingWizard', admin:true },
        { label:'NPS responses',          icon:'⭐', fn:'openNpsResults', admin:true },
        { label:'Capacity heatmap',       icon:'📊', fn:'openCapacityHeatmap', admin:true },
        { label:'Recipe cost calc',       icon:'🧮', fn:'openRecipeCostCalc', admin:true }
      ]
    },
    {
      title:'Reports & Time', icon:'📊',
      items:[
        { label:'Reports',                icon:'📊', fn:'openReports' },
        { label:'Time Tracker',           icon:'⏱️', fn:'openTimeTracker' },
        { label:'Time Report',            icon:'📊', fn:'openTimeTrackingReport' },
        { label:'Email Templates',        icon:'📧', fn:'openEmailTemplates' }
      ]
    },
    {
      title:'Settings & Integrations', icon:'⚙️',
      items:[
        { label:'AI Settings',            icon:'🤖', fn:'openAISettings' },
        { label:'Mailgun',                icon:'📧', fn:'openMailgunSettings' },
        { label:'Email Signature',        icon:'✍️', fn:'openEmailSignatureSettings' },
        { label:'SMS Alerts',             icon:'📱', fn:'openSmsSettings' },
        { label:'Stripe Checkout',        icon:'💳', fn:'openStripeSettings', admin:true },
        { label:'QuickBooks',             icon:'💼', fn:'openQBOSettings', admin:true },
        { label:'E-Signatures',           icon:'📝', fn:'openSignSettings', admin:true },
        { label:'Two-Factor Auth',        icon:'🔒', fn:'openMFASettings' },
        { label:'Google Analytics',       icon:'📈', fn:'openGA4Settings', admin:true },
        { label:'Sentry',                 icon:'🛡️', fn:'openSentrySettings', admin:true },
        { label:'Capacity badge',         icon:'📅', fn:'openCapacitySettings', admin:true },
        { label:'Setup Wizard',           icon:'🚀', fn:'openSetupWizard', admin:true },
        { label:'Error Log',              icon:'🐛', fn:'glOpenErrorLog', admin:true },
        { label:'Clear local cache',      icon:'🗑️', fn:'glClearLocalCache', admin:true, danger:true }
      ]
    }
  ];

  function isAdmin(){ return window.currentUser && window.currentUser.role === 'admin'; }

  function makeItemButton(it){
    var b = document.createElement('button');
    b.type = 'button';
    b.dataset.fn = it.fn;
    b.dataset.label = (it.icon + ' ' + it.label).toLowerCase();
    var base = 'display:flex;align-items:center;gap:7px;padding:8px 10px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:8px;color:#cfd9e6;cursor:pointer;font-size:12px;font-weight:500;text-align:left;line-height:1.2;transition:all .12s;min-height:34px;width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    if(it.danger){
      base = base
        .replace('rgba(255,255,255,.04)','rgba(231,76,60,.08)')
        .replace('rgba(255,255,255,.08)','rgba(231,76,60,.25)')
        .replace('#cfd9e6','#ff8579');
    }
    b.setAttribute('style', base);
    b.innerHTML = '<span style="font-size:14px;flex-shrink:0">' + it.icon + '</span><span style="overflow:hidden;text-overflow:ellipsis">' + it.label + '</span>';
    b.addEventListener('mouseenter', function(){
      if(it.danger) b.style.background = 'rgba(231,76,60,.18)';
      else { b.style.background = 'rgba(0,229,192,.08)'; b.style.borderColor = 'rgba(0,229,192,.3)'; b.style.color = '#fff'; }
    });
    b.addEventListener('mouseleave', function(){
      if(it.danger) b.style.background = 'rgba(231,76,60,.08)';
      else { b.style.background = 'rgba(255,255,255,.04)'; b.style.borderColor = 'rgba(255,255,255,.08)'; b.style.color = '#cfd9e6'; }
    });
    b.addEventListener('click', function(ev){
      ev.stopPropagation();
      try {
        if(typeof window[it.fn] === 'function') window[it.fn]();
        else { console.warn('[AI toolbar] missing function:', it.fn); alert(it.icon + ' ' + it.label + ' is not available yet.'); }
      } catch(e){
        console.error('[AI toolbar] ' + it.fn + ' threw', e);
        alert(it.label + ' failed: ' + (e.message || ''));
      }
      closePanel();
    });
    return b;
  }

  function makeSection(cat){
    var sec = document.createElement('div');
    sec.className = 'gl-tb-sec';
    sec.dataset.title = cat.title.toLowerCase();
    sec.setAttribute('style','margin:0 0 4px');

    var head = document.createElement('button');
    head.type = 'button';
    head.className = 'gl-tb-sec-head';
    head.setAttribute('style','display:flex;align-items:center;justify-content:space-between;width:100%;padding:8px 10px;background:rgba(255,255,255,.02);border:none;border-bottom:1px solid rgba(255,255,255,.05);color:#9aa7bd;font-size:11px;font-weight:600;letter-spacing:1.2px;text-transform:uppercase;cursor:pointer;text-align:left;transition:color .12s');

    var visibleItems = cat.items.filter(function(it){ return !it.admin || isAdmin(); });

    head.innerHTML =
      '<span style="display:flex;align-items:center;gap:7px">' +
        '<span style="font-size:13px">' + cat.icon + '</span>' +
        '<span>' + cat.title + '</span>' +
        '<span style="color:#5fcf9e;background:rgba(0,229,192,.08);border:1px solid rgba(0,229,192,.18);padding:1px 6px;border-radius:10px;font-size:9px;letter-spacing:.5px;text-transform:none">' + visibleItems.length + '</span>' +
      '</span>' +
      '<span class="gl-tb-chev" style="color:#5fcf9e;font-size:10px;transition:transform .15s;transform:rotate(' + (cat.expanded ? '90' : '0') + 'deg)">▸</span>';

    head.addEventListener('mouseenter', function(){ head.style.color = '#fff'; });
    head.addEventListener('mouseleave', function(){ head.style.color = '#9aa7bd'; });

    var grid = document.createElement('div');
    grid.className = 'gl-tb-grid';
    grid.setAttribute('style','display:' + (cat.expanded ? 'grid' : 'none') + ';grid-template-columns:1fr 1fr;gap:5px;padding:7px 8px 10px');

    visibleItems.forEach(function(it){ grid.appendChild(makeItemButton(it)); });

    head.addEventListener('click', function(){
      var open = grid.style.display !== 'none';
      grid.style.display = open ? 'none' : 'grid';
      head.querySelector('.gl-tb-chev').style.transform = 'rotate(' + (open ? '0' : '90') + 'deg)';
    });

    sec.appendChild(head);
    sec.appendChild(grid);
    if(!visibleItems.length){
      sec.style.display = 'none';
    }
    return sec;
  }

  function buildPanel(){
    var panel = document.createElement('div');
    panel.id = 'gl-ai-panel';
    panel.setAttribute('style','position:fixed;top:54px;right:12px;bottom:auto;z-index:601;width:380px;max-height:75vh;background:#142238;border:1px solid rgba(0,229,192,.25);border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,.6);display:none;flex-direction:column;overflow:hidden;color:#cfd9e6;font-family:var(--ff-body, system-ui)');

    // Header — title + search + close
    var head = document.createElement('div');
    head.setAttribute('style','padding:14px 14px 10px;border-bottom:1px solid rgba(255,255,255,.07);background:linear-gradient(180deg,rgba(0,229,192,.06),transparent);flex-shrink:0');
    head.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:9px">' +
        '<div style="font-family:var(--ff-disp,sans-serif);font-size:13px;letter-spacing:2px;color:var(--teal,#00e5c0);font-weight:700">🤖 TOOLS &amp; SETTINGS</div>' +
        '<button id="gl-ai-close" title="Close (Esc)" style="background:none;border:none;color:#9aa7bd;font-size:16px;cursor:pointer;padding:2px 6px;line-height:1">✕</button>' +
      '</div>';
    var searchWrap = document.createElement('div');
    searchWrap.setAttribute('style','position:relative');
    var search = document.createElement('input');
    search.id = 'gl-ai-search';
    search.type = 'text';
    search.placeholder = 'Search tools…';
    search.setAttribute('style','width:100%;padding:8px 12px 8px 32px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:8px;color:#fff;font-size:12px;outline:none;box-sizing:border-box;font-family:inherit');
    search.addEventListener('focus', function(){ search.style.borderColor = 'rgba(0,229,192,.4)'; });
    search.addEventListener('blur',  function(){ search.style.borderColor = 'rgba(255,255,255,.1)'; });
    searchWrap.appendChild(search);
    searchWrap.insertAdjacentHTML('beforeend','<span style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:#9aa7bd;font-size:13px;pointer-events:none">🔍</span>');
    head.appendChild(searchWrap);

    // Body — scrollable list of category sections
    var body = document.createElement('div');
    body.id = 'gl-ai-body';
    body.setAttribute('style','overflow-y:auto;flex:1;padding:6px 6px 8px');
    CATEGORIES.forEach(function(cat){ body.appendChild(makeSection(cat)); });

    // Footer
    var foot = document.createElement('div');
    foot.setAttribute('style','padding:7px 14px;border-top:1px solid rgba(255,255,255,.05);font-size:10px;color:#5b6a7f;text-align:center;flex-shrink:0');
    foot.innerHTML = '<kbd style="background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:3px;padding:1px 5px;font-size:9px;font-family:inherit">Esc</kbd> to close';

    panel.appendChild(head);
    panel.appendChild(body);
    panel.appendChild(foot);

    head.querySelector('#gl-ai-close').addEventListener('click', function(ev){ ev.stopPropagation(); closePanel(); });

    // Search filtering — show only items whose label includes the query;
    // auto-expand any section that has matches.
    search.addEventListener('input', function(){
      var q = search.value.trim().toLowerCase();
      Array.from(body.querySelectorAll('.gl-tb-sec')).forEach(function(sec){
        var grid = sec.querySelector('.gl-tb-grid');
        var btns = Array.from(grid.querySelectorAll('button'));
        var anyMatch = false;
        btns.forEach(function(b){
          var hit = !q || b.dataset.label.indexOf(q) !== -1;
          b.style.display = hit ? 'flex' : 'none';
          if(hit) anyMatch = true;
        });
        if(q){
          grid.style.display = anyMatch ? 'grid' : 'none';
          sec.style.display = anyMatch ? 'block' : 'none';
          var chev = sec.querySelector('.gl-tb-chev');
          if(chev) chev.style.transform = 'rotate(90deg)';
        } else {
          // Restore original expanded/collapsed state from data-title lookup
          var cat = CATEGORIES.find(function(c){ return c.title.toLowerCase() === sec.dataset.title; });
          var visibleCount = (cat ? cat.items : []).filter(function(it){ return !it.admin || isAdmin(); }).length;
          sec.style.display = visibleCount ? 'block' : 'none';
          grid.style.display = (cat && cat.expanded) ? 'grid' : 'none';
          var chev = sec.querySelector('.gl-tb-chev');
          if(chev) chev.style.transform = 'rotate(' + (cat && cat.expanded ? '90' : '0') + 'deg)';
        }
      });
    });

    return panel;
  }

  function openPanel(){
    var panel = document.getElementById('gl-ai-panel');
    if(!panel) return;
    panel.style.display = 'flex';
    setTimeout(function(){
      var s = document.getElementById('gl-ai-search');
      if(s) s.focus();
    }, 50);
  }
  function closePanel(){
    var panel = document.getElementById('gl-ai-panel');
    if(panel) panel.style.display = 'none';
  }
  function togglePanel(){
    var panel = document.getElementById('gl-ai-panel');
    if(panel && panel.style.display === 'flex') closePanel();
    else openPanel();
  }

  function applyRedesign(){
    var tb = document.getElementById('ai-toolbar');
    if(!tb){ setTimeout(applyRedesign, 400); return; }
    if(tb.dataset.glRedesigned === '1') return;

    // Hide the old #ai-tools popout (we replace it entirely)
    var oldTools = document.getElementById('ai-tools');
    if(oldTools) oldTools.remove();

    // Find the original FAB (the only <button> child of #ai-toolbar after we removed #ai-tools)
    var fab = tb.querySelector('button');
    if(fab){
      // Strip the original FAB's click listeners by cloning the node, then bind our toggle
      var fresh = fab.cloneNode(true);
      fab.parentNode.replaceChild(fresh, fab);
      fresh.addEventListener('click', function(ev){
        ev.stopPropagation();
        togglePanel();
      });
    }

    // Mount the panel into the CRM host (sibling of the toolbar)
    var host = document.getElementById('crm-panel') || document.body;
    var existing = document.getElementById('gl-ai-panel');
    if(existing) existing.remove();
    host.appendChild(buildPanel());

    tb.dataset.glRedesigned = '1';

    // Esc closes the panel; click outside closes too
    if(!window.__glAiPanelKeyBound){
      document.addEventListener('keydown', function(e){
        if(e.key === 'Escape'){
          var p = document.getElementById('gl-ai-panel');
          if(p && p.style.display === 'flex') closePanel();
        }
      });
      document.addEventListener('click', function(e){
        var p = document.getElementById('gl-ai-panel');
        if(!p || p.style.display !== 'flex') return;
        if(p.contains(e.target)) return;
        if(tb && tb.contains(e.target)) return;
        closePanel();
      });
      window.__glAiPanelKeyBound = true;
    }
  }

  function wrap(){
    var orig = window.addAIToolbar;
    if(typeof orig !== 'function'){ setTimeout(wrap, 400); return; }
    window.addAIToolbar = function(){
      orig.apply(this, arguments);
      setTimeout(applyRedesign, 30);
    };
    // Also run once now in case the toolbar was already mounted before this addon loaded.
    if(document.getElementById('ai-toolbar')) setTimeout(applyRedesign, 30);
  }
  wrap();

  console.log('[GL] AI toolbar redesign loaded — categorised panel + search');
}());


/* ============================================================
   STRIPE PAYMENT-METHOD PICKER + 3% CARD SURCHARGE
   ============================================================
   - 3% surcharge on credit-card payments (configurable per-call).
   - Customer portal: replaces the single "💳 Pay now" button
     with TWO buttons:
       🏦 Pay by ACH ($X.XX, no fee)
       💳 Pay by Card ($X.XX + 3% fee = $Y.YY)
   - Admin "Charge via Stripe" button: opens a method-picker modal
     with the same two options + a "waive surcharge this time" toggle.
   - Both routes call window.glCreateStripeCheckout with the right
     payment_method + surcharge_pct so the edge function builds a
     Stripe Checkout session with the correct line items.

   Surcharge legality:
   - Florida: legal as of 2022 (Dana's Railroad Supply v. AG ruling).
   - 3% complies with Visa/MC network rules (max 3% / cost-of-acceptance).
   - Stripe receipt shows the fee as a separate line item — fully transparent.
   ============================================================ */
(function(){
  // ── Config ──
  var DEFAULT_SURCHARGE_PCT = 3;

  // Per-invoice "waive surcharge" override, stored on the invoices row
  // (invoices.waive_card_surcharge boolean). Source of truth is the DB —
  // the in-memory invoices array mirrors it via the waiveCardSurcharge
  // field set by loadSupabaseData. Mutations write to both.
  function findInv(invId){
    return (window.invoices || []).find(function(x){ return x.id === invId; });
  }
  function isWaived(invId){
    var inv = findInv(invId);
    return !!(inv && inv.waiveCardSurcharge);
  }
  function setWaived(invId, on){
    var inv = findInv(invId);
    if(inv) inv.waiveCardSurcharge = !!on;
    if(!window.supa) return;
    // Update by invoice_number — works whether the row was loaded via UUID
    // (supaId) or by the human-readable number.
    var supaId = inv && inv.supaId;
    var q = supaId
      ? window.supa.from('invoices').update({ waive_card_surcharge: !!on }).eq('id', supaId)
      : window.supa.from('invoices').update({ waive_card_surcharge: !!on }).eq('invoice_number', invId);
    q.then(function(r){
      if(r.error) console.warn('[GL] waive_card_surcharge update', r.error);
    });
  }

  function fmt$(n){
    n = Number(n || 0);
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  var esc = window.glEsc;

  function computeSurcharge(amount, pct){
    var base = Number(amount || 0);
    var fee  = Math.round(base * pct) / 100;   // cents-precise
    return { base: base, fee: fee, total: base + fee };
  }

  // ── Method picker modal (used by admin AND customer portal) ──
  // opts: { invoice, adminMode, onPick(method) }
  function openMethodPicker(opts){
    var inv = opts.invoice;
    var pct = isWaived(inv.id) ? 0 : DEFAULT_SURCHARGE_PCT;
    var calc = computeSurcharge(inv.amount, DEFAULT_SURCHARGE_PCT);

    var existing = document.getElementById('gl-stripe-picker');
    if(existing) existing.remove();

    var ov = document.createElement('div');
    ov.id = 'gl-stripe-picker';
    ov.setAttribute('style','position:fixed;inset:0;z-index:9500;background:rgba(6,13,26,.85);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:20px');

    var card = document.createElement('div');
    card.setAttribute('style','background:#142238;border:1px solid rgba(0,229,192,.25);border-radius:14px;width:100%;max-width:440px;padding:24px;color:#cfd9e6;box-shadow:0 20px 60px rgba(0,0,0,.6)');

    card.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:14px">' +
        '<div>' +
          '<div style="font-family:var(--ff-disp,sans-serif);font-size:14px;letter-spacing:2px;color:var(--teal,#00e5c0);font-weight:700">💳 PAYMENT METHOD</div>' +
          '<div style="font-size:12px;color:#9aa7bd;margin-top:4px">Invoice ' + esc(inv.id) + ' · ' + fmt$(inv.amount) + '</div>' +
        '</div>' +
        '<button id="gl-pick-close" style="background:none;border:none;color:#9aa7bd;font-size:18px;cursor:pointer;padding:2px 6px;line-height:1">✕</button>' +
      '</div>' +
      // ACH option
      '<button id="gl-pick-ach" style="display:block;width:100%;text-align:left;padding:14px 16px;margin-bottom:8px;background:rgba(0,229,192,.06);border:2px solid rgba(0,229,192,.3);border-radius:10px;color:#fff;cursor:pointer;transition:all .12s">' +
        '<div style="display:flex;justify-content:space-between;align-items:center">' +
          '<div>' +
            '<div style="font-size:14px;font-weight:700;color:var(--teal,#00e5c0)">🏦 Pay by ACH bank transfer</div>' +
            '<div style="font-size:11px;color:#9aa7bd;margin-top:2px">No processing fee · 1–3 business days</div>' +
          '</div>' +
          '<div style="font-size:18px;font-weight:800;color:#fff">' + fmt$(calc.base) + '</div>' +
        '</div>' +
      '</button>' +
      // Card option
      '<button id="gl-pick-card" style="display:block;width:100%;text-align:left;padding:14px 16px;margin-bottom:14px;background:rgba(168,85,247,.06);border:2px solid rgba(168,85,247,.3);border-radius:10px;color:#fff;cursor:pointer;transition:all .12s">' +
        '<div style="display:flex;justify-content:space-between;align-items:center">' +
          '<div>' +
            '<div style="font-size:14px;font-weight:700;color:#c4a4f8">💳 Pay by credit card' + (pct > 0 ? ' (+' + pct + '% fee)' : '') + '</div>' +
            '<div style="font-size:11px;color:#9aa7bd;margin-top:2px">' +
              (pct > 0
                ? 'Base ' + fmt$(calc.base) + ' + fee ' + fmt$(calc.fee) + ' · instant'
                : 'No surcharge applied · instant') +
            '</div>' +
          '</div>' +
          '<div style="font-size:18px;font-weight:800;color:#fff">' + fmt$(pct > 0 ? calc.total : calc.base) + '</div>' +
        '</div>' +
      '</button>' +
      // Admin-only: waive surcharge toggle
      (opts.adminMode ?
        '<label style="display:flex;align-items:center;gap:9px;padding:10px 12px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:8px;cursor:pointer;font-size:12px;color:#9aa7bd">' +
          '<input type="checkbox" id="gl-pick-waive"' + (isWaived(inv.id) ? ' checked' : '') + ' style="width:14px;height:14px;accent-color:#f5c842;margin:0">' +
          '<span><b style="color:#f5c842">Waive 3% surcharge for this invoice</b> — customer pays the base amount even if they pick card.</span>' +
        '</label>'
      : '');

    ov.appendChild(card);
    document.body.appendChild(ov);

    function close(){ ov.remove(); }
    ov.addEventListener('click', function(e){ if(e.target === ov) close(); });
    card.querySelector('#gl-pick-close').addEventListener('click', close);

    if(opts.adminMode){
      card.querySelector('#gl-pick-waive').addEventListener('change', function(e){
        setWaived(inv.id, e.target.checked);
        // Re-render with new pct
        close();
        openMethodPicker(opts);
      });
    }

    card.querySelector('#gl-pick-ach').addEventListener('click', function(){
      close();
      opts.onPick && opts.onPick('ach', 0);
    });
    card.querySelector('#gl-pick-card').addEventListener('click', function(){
      close();
      opts.onPick && opts.onPick('card', pct);
    });
  }

  // Expose globally so the admin invoice-detail button + portal can both call it.
  window.glOpenStripeMethodPicker = function(invoice, opts){
    opts = opts || {};
    openMethodPicker({
      invoice: invoice,
      adminMode: !!opts.adminMode,
      onPick: function(method, pct){
        if(typeof window.glCreateStripeCheckout !== 'function'){
          alert('Stripe Checkout function not loaded.');
          return;
        }
        window.glCreateStripeCheckout(invoice, {
          payment_method: method,
          surcharge_pct:  pct,
          newTab:         opts.newTab !== false  // default newTab for admin
        });
      }
    });
  };

  // ── Customer portal: replace single Pay Now with two buttons ──
  // The portal table is rendered by an existing IIFE; we re-decorate
  // it on every MutationObserver tick to handle re-renders.
  function decoratePortalRows(){
    var portal = document.getElementById('customer-portal');
    if(!portal) return;
    var rows = portal.querySelectorAll('table tr[data-inv-id], table tr');
    Array.prototype.forEach.call(rows, function(tr){
      // Skip if we've already decorated this row
      if(tr.dataset.glSurchargeWired === '1') return;
      var oldBtn = tr.querySelector('.gl-portal-pay-btn');
      if(!oldBtn) return;
      var actionCell = oldBtn.parentNode;
      if(!actionCell) return;

      // Pull invoice ID and amount from the row
      var invId = tr.getAttribute('data-inv-id') || (oldBtn.getAttribute('data-inv-id'));
      // If no explicit attribute, try to grab from the row text or a hidden field — fallback to nearest invoice
      if(!invId){
        var idCell = tr.querySelector('td');
        if(idCell) invId = (idCell.textContent || '').trim();
      }
      var inv = (window.invoices || []).find(function(x){ return x.id === invId; });
      if(!inv){
        // Couldn't reconcile — leave the old button alone
        tr.dataset.glSurchargeWired = '1';
        return;
      }

      // Build the two replacement buttons
      var pct = isWaived(inv.id) ? 0 : DEFAULT_SURCHARGE_PCT;
      var calc = computeSurcharge(inv.amount, DEFAULT_SURCHARGE_PCT);

      var wrap = document.createElement('div');
      wrap.setAttribute('style','display:flex;flex-direction:column;gap:5px;align-items:flex-end');

      var ach = document.createElement('button');
      ach.setAttribute('style','padding:5px 12px;background:var(--teal,#00e5c0);color:#0a1628;border:none;border-radius:6px;font-size:11px;font-weight:800;cursor:pointer;white-space:nowrap');
      ach.textContent = '🏦 Pay by ACH ' + fmt$(calc.base);
      ach.addEventListener('click', function(ev){
        ev.preventDefault();
        window.glCreateStripeCheckout(inv, { payment_method: 'ach', surcharge_pct: 0, newTab: true });
      });

      var card = document.createElement('button');
      card.setAttribute('style','padding:5px 12px;background:rgba(168,85,247,.15);color:#c4a4f8;border:1px solid rgba(168,85,247,.35);border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap');
      card.textContent = pct > 0
        ? '💳 Card +' + pct + '% = ' + fmt$(calc.total)
        : '💳 Card ' + fmt$(calc.base);
      card.title = pct > 0
        ? 'Pay by credit card. A ' + pct + '% processing fee (' + fmt$(calc.fee) + ') applies.'
        : 'Pay by credit card.';
      card.addEventListener('click', function(ev){
        ev.preventDefault();
        window.glCreateStripeCheckout(inv, { payment_method: 'card', surcharge_pct: pct, newTab: true });
      });

      wrap.appendChild(ach);
      wrap.appendChild(card);

      // Replace the old single button with our two-button wrap
      oldBtn.style.display = 'none';
      actionCell.appendChild(wrap);
      tr.dataset.glSurchargeWired = '1';
    });
  }

  function startPortalObs(){
    var portal = document.getElementById('customer-portal');
    if(!portal){ setTimeout(startPortalObs, 700); return; }
    new MutationObserver(function(){ setTimeout(decoratePortalRows, 60); }).observe(portal, { childList:true, subtree:true });
    decoratePortalRows();
  }
  if(document.readyState !== 'loading') startPortalObs();
  else document.addEventListener('DOMContentLoaded', startPortalObs);

  console.log('[GL] Stripe payment-method picker + 3% card surcharge loaded');
}());


/* ============================================================
   AUTO-LOGIN DATA LOAD FIX
   ============================================================
   loadSupabaseData() in index.html only fires inside checkPw() —
   the password-typed login path. The "Stay signed in" auto-login
   skips it, so window.clients / invoices / deals / etc. stay at 0
   even though the data exists in Supabase.

   This wraps loginUser() AND watches the #crm-panel show class so
   we trigger loadSupabaseData() on every successful login path,
   plus a safety re-run if the panel opens with empty arrays.
   ============================================================ */
(function(){
  function isEmpty(){
    return (window.clients||[]).length === 0
        && (window.invoices||[]).length === 0
        && (window.deals||[]).length === 0;
  }

  function ensureDataLoaded(){
    if(!window.currentUser) return;
    if(typeof window.loadSupabaseData !== 'function') return;
    // Only run if data really is missing — don't clobber existing in-memory state
    if(!isEmpty() && window.__glDataLoaded) return;
    window.__glDataLoaded = true;
    window.loadSupabaseData().then(function(){
      try {
        if(typeof window.renderDash === 'function') window.renderDash();
        if(typeof window.renderClients === 'function') window.renderClients();
        if(typeof window.renderInvoices === 'function') window.renderInvoices();
      } catch(e){}
      console.log('[GL] post-login data load complete — clients=' + (window.clients||[]).length +
                  ' invoices=' + (window.invoices||[]).length +
                  ' deals=' + (window.deals||[]).length);
    }).catch(function(e){
      window.__glDataLoaded = false;
      console.warn('[GL] loadSupabaseData failed:', e);
    });
  }

  // Trigger a data refresh on every login
  window.GL_HOOKS.registerLoginHook(function(){ setTimeout(ensureDataLoaded, 60); });

  // Also watch for the CRM panel becoming visible — covers any other entry path
  function watchPanel(){
    var p = document.getElementById('crm-panel');
    if(!p){ setTimeout(watchPanel, 500); return; }
    new MutationObserver(function(){
      if(p.classList.contains('show')) setTimeout(ensureDataLoaded, 80);
    }).observe(p, { attributes: true, attributeFilter: ['class'] });
    if(p.classList.contains('show')) setTimeout(ensureDataLoaded, 80);
  }
  if(document.readyState !== 'loading') watchPanel();
  else document.addEventListener('DOMContentLoaded', watchPanel);

  console.log('[GL] auto-login data-load fix loaded');
}());


/* ============================================================
   STRIPE CHARGE BUTTON IN INVOICE TABLE ROW
   ============================================================
   The original injector looked for #cpg-invoice-detail / .inv-detail
   which don't exist in the current invoice list layout — clicking
   a row opens a print-preview-style popup, not a separate admin
   detail panel. So the button never appeared anywhere clickable.

   This addon adds a 💳 button directly into the Actions cell of
   every non-paid invoice row in the Invoices table, alongside the
   existing Paid / View / Delete buttons. Click opens the same
   method-picker modal (ACH / Card+3%).
   ============================================================ */
(function(){
  function injectChargeButtonsIntoTable(){
    var tbody = document.getElementById('inv-body');
    if(!tbody) return;
    var rows = tbody.querySelectorAll('tr');
    Array.prototype.forEach.call(rows, function(tr){
      // Find this row's invoice ID — first td shows GL-XXXX
      var idCell = tr.querySelector('td');
      if(!idCell) return;
      var invId = (idCell.textContent || '').trim();
      if(!invId) return;

      // Skip if already injected
      if(tr.querySelector('.gl-stripe-row-btn')) return;

      // Find the matching invoice from the in-memory list
      var inv = (window.invoices || []).find(function(x){ return x.id === invId; });
      if(!inv) return;

      // Skip paid + quote invoices
      if(inv.status === 'paid' || inv.status === 'quote') return;

      // Find the action button group (last td → first div)
      var actionCell = tr.children[tr.children.length - 1];
      if(!actionCell) return;
      var btnGroup = actionCell.querySelector('div');
      if(!btnGroup) return;

      // Build the Stripe button
      var btn = document.createElement('button');
      btn.className = 'cbtn gl-stripe-row-btn';
      btn.setAttribute('style','font-size:10px;padding:3px 7px;background:rgba(168,85,247,.12);border:1px solid rgba(168,85,247,.35);color:#c4a4f8;border-radius:6px;cursor:pointer');
      btn.setAttribute('title','Charge via Stripe (ACH or Card+3%)');
      btn.textContent = '💳';
      btn.addEventListener('click', function(ev){
        ev.preventDefault();
        ev.stopPropagation();
        if(typeof window.glOpenStripeMethodPicker !== 'function'){
          alert('Stripe method picker not loaded yet — try refreshing the page.');
          return;
        }
        window.glOpenStripeMethodPicker(inv, { adminMode: true });
      });
      // Insert before the View (👁) button so it sits between Paid and View
      var viewBtn = Array.prototype.find.call(btnGroup.children, function(b){
        return (b.textContent || '').trim() === '👁';
      });
      if(viewBtn) btnGroup.insertBefore(btn, viewBtn);
      else        btnGroup.appendChild(btn);
    });
  }

  // Watch the invoice table for renders (renderInvoices() rebuilds innerHTML each time)
  function start(){
    var tbody = document.getElementById('inv-body');
    if(!tbody){ setTimeout(start, 500); return; }
    new MutationObserver(function(){ setTimeout(injectChargeButtonsIntoTable, 50); }).observe(tbody, { childList:true, subtree:false });
    injectChargeButtonsIntoTable();
  }
  if(document.readyState !== 'loading') start();
  else document.addEventListener('DOMContentLoaded', start);

  console.log('[GL] Stripe 💳 button injected into invoice rows');
}());









/* ============================================================
   CRM: Realtime auto-update for the in-memory invoices array
   ============================================================
   Without this, the CRM's `window.invoices` array is populated
   once at page load. When the Stripe webhook flips an invoice
   to status='paid' (or any other DB change happens), the user
   sees nothing until they hard-refresh.

   Subscribes to Postgres changes on public.invoices. On INSERT /
   UPDATE / DELETE we patch the in-memory array, then re-render
   any visible invoice-aware UI (list, dashboard KPIs).
   ============================================================ */
(function(){
  var channel = null;
  function mapRow(i){
    return {
      id:           i.invoice_number || i.id,
      supaId:       i.id,
      client:       i.client_id || '',
      clientName:   i.client_name || '',
      svc:          i.service || '',
      amount:       i.amount || 0,
      date:         i.invoice_date || '',
      status:       i.status || 'draft',
      notes:        i.notes || '',
      paymentTerms: i.payment_terms || '',
      dueDate:      i.due_date || '',
      lines:        Array.isArray(i.line_items) ? i.line_items : []
    };
  }
  function reRender(){
    try { if(typeof window.renderInvoices === 'function') window.renderInvoices(); } catch(e){}
    try { if(typeof window.renderDash     === 'function') window.renderDash();     } catch(e){}
    try { if(typeof window.renderActivity === 'function') window.renderActivity(); } catch(e){}
  }
  function applyChange(eventType, row, oldRow){
    if(!Array.isArray(window.invoices)) return;
    if(eventType === 'DELETE'){
      var supaId = (oldRow && oldRow.id) || (row && row.id);
      if(!supaId) return;
      var idx = window.invoices.findIndex(function(x){ return x.supaId === supaId; });
      if(idx >= 0){ window.invoices.splice(idx, 1); reRender(); }
      return;
    }
    if(!row) return;
    var mapped = mapRow(row);
    var existing = window.invoices.findIndex(function(x){
      return x.supaId === mapped.supaId || (x.id && x.id === mapped.id);
    });
    if(existing >= 0){
      // Mutate in place so any references the UI holds stay live.
      Object.keys(mapped).forEach(function(k){ window.invoices[existing][k] = mapped[k]; });
    } else {
      window.invoices.push(mapped);
    }
    reRender();
    // Subtle notification when the Stripe webhook flips a row to paid.
    if(eventType === 'UPDATE' && row.status === 'paid' && (!oldRow || oldRow.status !== 'paid')){
      try {
        if(typeof window.addNotification === 'function'){
          window.addNotification('Payment received', 'Invoice ' + (row.invoice_number || row.id) + ' was paid' + (row.paid_amount ? ' (' + new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(row.paid_amount) + ')' : '') + '.', 'success');
        }
      } catch(e){}
    }
  }
  function subscribe(){
    var sb = window.supa;
    if(!sb || typeof sb.channel !== 'function'){ setTimeout(subscribe, 400); return; }
    if(channel) return; // already subscribed
    channel = sb.channel('gl-invoices-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'invoices' }, function(payload){
        try { applyChange(payload.eventType, payload.new, payload.old); }
        catch(e){ console.warn('[GL realtime] applyChange threw', e); }
      })
      .subscribe(function(status){
        if(status === 'SUBSCRIBED') console.log('[GL] realtime: subscribed to invoices');
        else if(status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED'){
          console.warn('[GL] realtime channel status:', status, '— will retry in 5s');
          try { sb.removeChannel(channel); } catch(e){}
          channel = null;
          setTimeout(subscribe, 5000);
        }
      });
  }
  if(document.readyState !== 'loading') subscribe();
  else document.addEventListener('DOMContentLoaded', subscribe);
}());
