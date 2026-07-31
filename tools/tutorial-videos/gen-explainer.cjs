/*
 * gen-explainer.cjs — narrated educational explainer videos (motion slides).
 *   node gen-explainer.cjs <deck>
 * decks: gmp-haccp-pcqi | lacf | sqf | allergen
 */
const http=require('http'),fs=require('fs'),path=require('path');
const {execSync}=require('child_process');
const {chromium}=require('playwright');
const SCRATCH='/tmp/claude-0/-home-user-good-liquid-bevco/a8dbf2c3-6093-5bf2-adf9-cca45eb015ed/scratchpad';
const MODEL='/opt/piper-voices/en-us-lessac-medium.onnx';
const W=1280,H=720, LEAD=0.2, TAILPAD=0.7;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const dur=f=>parseFloat(execSync(`ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "${f}"`).toString().trim());

const K='#00e5c0', AMBER='#f5c842', RED='#ff8579', BLUE='#6b9fff', PURP='#c4b5fd';
function chip(t,c){return '<span class="chip" style="border-color:'+c+'88;color:'+c+'">'+t+'</span>';}
function titleSlide(kicker,title,sub){
  return '<div class="slide center"><div class="kicker">'+kicker+'</div><div class="bigtitle">'+title+'</div>'+(sub?'<div class="subtitle">'+sub+'</div>':'')+'</div>';
}
function sectionCard(icon,label,tag,color){
  return '<div class="slide center"><div class="seccard" style="border-color:'+color+'55"><div class="secicon">'+icon+'</div><div class="seclabel" style="color:'+color+'">'+label+'</div><div class="sectag">'+tag+'</div></div></div>';
}
function bulletsSlide(heading,items,color){
  color=color||K;
  return '<div class="slide"><div class="sheading" style="color:'+color+'">'+heading+'</div><ul class="blist">'+items.map((t,i)=>'<li style="animation-delay:'+(0.15+i*0.12)+'s"><span class="bdot" style="background:'+color+'"></span><span>'+t+'</span></li>').join('')+'</ul></div>';
}
function pyramidSlide(){
  const row=(w,c,lab,sub)=>'<div class="pyrow" style="width:'+w+'%;background:linear-gradient(180deg,'+c+'33,'+c+'11);border-color:'+c+'66"><div class="pylab" style="color:'+c+'">'+lab+'</div><div class="pysub">'+sub+'</div></div>';
  return '<div class="slide"><div class="sheading" style="color:'+K+'">Three layers that stack up</div><div class="pyramid">'+
    row(52,BLUE,'🎓 PCQI','The qualified person who owns the plan')+row(74,AMBER,'📋 HACCP / Food Safety Plan','The system that controls the hazards')+row(96,K,'🏭 GMP','The clean, safe foundation')+'</div></div>';
}
function principlesSlide(heading,color,items){
  return '<div class="slide"><div class="sheading" style="color:'+color+'">'+heading+'</div><div class="pgrid pg'+items.length+'">'+items.map((p,i)=>'<div class="pcard" style="border-color:'+color+'44;animation-delay:'+(0.1+i*0.08)+'s"><div class="pnum" style="color:'+color+'">'+p[0]+'</div><div class="ptxt">'+p[1]+'</div></div>').join('')+'</div></div>';
}
function compareSlide(heading,cols){
  return '<div class="slide"><div class="sheading" style="color:'+K+'">'+heading+'</div><div class="cmp">'+cols.map((c,i)=>'<div class="cmpcol" style="border-color:'+c.color+'55;animation-delay:'+(0.1+i*0.12)+'s"><div class="cmplab" style="color:'+c.color+'">'+c.label+'</div>'+c.lines.map(l=>'<div class="cmpln">'+l+'</div>').join('')+'</div>').join('')+'</div></div>';
}
function flowSlide(heading,steps,note){
  const st=(icon,lab,sub,c)=>'<div class="fstep"><div class="ficon" style="color:'+c+'">'+icon+'</div><div class="flab">'+lab+'</div><div class="fsub">'+sub+'</div></div>';
  const arr='<div class="farrow">→</div>';
  return '<div class="slide"><div class="sheading" style="color:'+K+'">'+heading+'</div><div class="flow">'+steps.map(s=>st(s[0],s[1],s[2],s[3])).join(arr)+'</div>'+(note?'<div class="fnote">'+note+'</div>':'')+'</div>';
}
function closeSlide(kicker,title,chipsArr,disclaim){
  return '<div class="slide center"><div class="kicker">'+kicker+'</div><div class="bigtitle" style="font-size:44px">'+title+'</div>'+
    '<div class="chips">'+chipsArr.map(c=>chip(c[0],c[1])).join('')+'</div><div class="disclaim">'+disclaim+'</div></div>';
}

// ─────────────────────────── DECKS ───────────────────────────
const DECKS={
'gmp-haccp-pcqi':{ brand:'Food Safety Compliance 101', slides:[
  {say:"Welcome. In the next few minutes we'll demystify three terms you hear constantly in food and beverage manufacturing — G M P, HACCP, and PCQI. No jargon: just what each one means, and how they work together to keep your product safe.",html:titleSlide('FOOD SAFETY COMPLIANCE, MADE SIMPLE','GMP · HACCP · PCQI','What they are, and how they fit together')},
  {say:"First, why it matters. Under U.S. food-safety law, a manufacturer's job is to prevent problems before they happen, not just react to them. Regulators, retailers, and auditors all expect documented proof that you are doing exactly that. Get it right, and you protect your customers, your brand, and your place on the shelf.",html:bulletsSlide('Why any of this matters',['The law expects you to <b>prevent</b> hazards — not react to them','Retailers and auditors expect <b>documented proof</b>','One recall can end a brand','Do it well and it becomes a competitive advantage'],K)},
  {say:"Think of food-safety compliance as three layers that stack on each other. At the base, G M P — your everyday good practices. In the middle, HACCP — the written plan that controls hazards. And at the top, the PCQI — the qualified person who owns that plan. Let's take them one at a time, from the ground up.",html:pyramidSlide()},
  {say:"We start at the foundation: G M P, Good Manufacturing Practices.",html:sectionCard('🏭','GMP','Good Manufacturing Practices — the foundation',K)},
  {say:"G M P is the baseline set of rules for running a clean, safe, and orderly facility, written into F D A regulation 21 C F R 117. It covers personal hygiene, sanitation, pest control, equipment maintenance, and how the plant itself is designed. The goal is simple: stop contamination before it can ever reach your product.",html:bulletsSlide('What GMP covers',['Personal hygiene &amp; employee practices','Sanitation and cleaning','Pest control','Equipment &amp; facility maintenance','Preventing cross-contamination'],K)},
  {say:"Why is it the foundation? Because no clever plan can save an unsanitary plant. If the basics are not solid, everything built on top of them is at risk. G M P is what makes the rest possible.",html:titleSlide('Remember','GMP is the foundation','No plan can fix an unsanitary plant — the basics come first')},
  {say:"Next, the middle layer: HACCP — Hazard Analysis and Critical Control Points.",html:sectionCard('📋','HACCP','Hazard Analysis &amp; Critical Control Points — the system',AMBER)},
  {say:"HACCP is a systematic way to identify the hazards in your process — biological, chemical, and physical — and to put a specific control at each point where it truly matters. Instead of hoping the finished product is safe, you build safety into the process itself.",html:bulletsSlide('What HACCP does',['Finds <b>biological</b>, <b>chemical</b>, and <b>physical</b> hazards','Puts a control at each critical point','Builds safety <b>into the process</b> — not just final testing'],AMBER)},
  {say:"A HACCP plan is built on seven principles. One: analyze your hazards. Two: pinpoint the Critical Control Points, the make-or-break steps. Three: set a critical limit for each — like a minimum pasteurizer temperature. Four: monitor those points. Five: define the corrective action when something goes wrong. Six: verify the whole system is working. And seven: keep the records that prove it.",html:principlesSlide('HACCP — the 7 principles',AMBER,[['1','Analyze the hazards'],['2','Find the Critical Control Points'],['3','Set critical limits'],['4','Monitor each point'],['5','Define corrective actions'],['6','Verify it works'],['7','Keep the records']])},
  {say:"Here's a concrete example. For a pasteurized beverage, the pasteurizer hitting its target temperature is a Critical Control Point — miss it, and pathogens could survive. For an acidified drink, reaching a safe p H is the critical point. Each one is monitored, and every reading is recorded.",html:bulletsSlide('A Critical Control Point, in real life',['Pasteurizer must reach its target <b>temperature</b>','An acidified drink must reach a safe <b>pH ≤ 4.6</b>','Miss the limit → hold the product and correct it','Every reading is <b>recorded</b>'],AMBER)},
  {say:"One note. Under the modern F S M A Preventive Controls rule, this plan is now often called a Food Safety Plan. It is the same core idea as HACCP, just broadened to cover more preventive controls — like supply-chain and allergen controls.",html:titleSlide('A quick note','HACCP → “Food Safety Plan”','Modern FDA rules broaden it — same idea, more preventive controls')},
  {say:"That brings us to the top layer, and it is a person: the PCQI — the Preventive Controls Qualified Individual.",html:sectionCard('🎓','PCQI','Preventive Controls Qualified Individual — the person',BLUE)},
  {say:"F D A requires that your Food Safety Plan is prepared, or overseen, by a qualified person — the PCQI. They become qualified through standardized training, or equivalent experience. The PCQI owns the hazard analysis, validates that your controls actually work, reviews the records, and reanalyzes the plan when things change. Every compliant plan needs one.",html:bulletsSlide('What the PCQI does',['Prepares or <b>oversees</b> the Food Safety Plan','Qualified by <b>training</b> (FSPCA) or equivalent experience','<b>Validates</b> that controls actually work','Reviews records &amp; <b>reanalyzes</b> the plan when things change'],BLUE)},
  {say:"So here is the whole picture. G M P keeps the plant clean and safe. HACCP, or your Food Safety Plan, is the system that controls the specific hazards. The PCQI is the qualified person who builds and owns that plan. And the records tie it all together — the evidence an auditor asks to see.",html:flowSlide('How they fit together',[['🏭','GMP','clean foundation',K],['📋','Food Safety Plan','controls hazards',AMBER],['🎓','PCQI','owns &amp; signs it',BLUE],['🗂️','Records','the proof',RED]],'Each layer supports the next — and the records tie it all together.')},
  {say:"Get these three working together, and compliance stops being a burden. You get product you can trust, a plant that is always audit-ready, and the credibility retailers demand. That is food-safety compliance, made simple.",html:closeSlide('The payoff','Compliance, working <span style="color:'+K+'">for</span> you',[['✓ Safe product',K],['✓ Always audit-ready',AMBER],['✓ Retailer-ready',BLUE]],'Educational overview — not legal advice. Confirm your specific obligations with a Process Authority and your PCQI.')}
]},

'lacf':{ brand:'LACF & Acidified Foods', slides:[
  {say:"In this video we'll cover one of the strictest programs the F D A runs — the rules for low-acid and acidified foods in sealed containers. If you can or bottle a shelf-stable beverage, this almost certainly applies to you.",html:titleSlide('LACF & ACIDIFIED FOODS','The FDA rules for sealed, shelf-stable beverages','21 CFR Parts 108 · 113 · 114')},
  {say:"Why so strict? A sealed, low-acid product is the classic environment for Clostridium botulinum — the bacteria behind botulism. To manage that risk, the F D A backs these rules with an emergency-permit system. Produce without the required registrations and filings, and the agency can stop you from shipping at all.",html:bulletsSlide('Why these rules are so strict',['Sealed low-acid products can grow <b>C. botulinum</b>','Botulism is rare, but can be fatal','Enforced through an <b>emergency-permit</b> system (21 CFR 108)','Skip the steps and FDA can halt your shipping'],RED)},
  {say:"So which products are covered? It comes down to two things: the finished p H, and whether the container is hermetically sealed — an airtight can or bottle. Here's how the categories break down.",html:sectionCard('🥫','Which products?','It depends on finished pH + a hermetic seal',AMBER)},
  {say:"If your finished p H is above 4.6 in a sealed container, it's a low-acid canned food under Part 113 — it needs a thermal process. If you add acid to a low-acid base to bring it down to 4.6 or below, it's an acidified food under Part 114. And if the product is naturally at or below 4.6 — like most juices — it's simply an acid food, and these particular filings don't apply.",html:compareSlide('The three categories',[
    {label:'LACF (Part 113)',color:BLUE,lines:['Finished pH <b>above 4.6</b>','Sealed container','Needs a thermal process']},
    {label:'Acidified (Part 114)',color:AMBER,lines:['<b>Acid added</b> to a low-acid base','Finished pH <b>≤ 4.6</b>','e.g. lightly acidified tea']},
    {label:'Acid food',color:K,lines:['<b>Naturally</b> pH ≤ 4.6','e.g. most juices','Not a 113/114 filing']}
  ])},
  {say:"Watch out for the beverage trap. A seltzer, tea, or functional water that starts low-acid and is dosed with citric or malic acid to reach a p H of 4.6 or below is an acidified food — even though it tastes mild. Carbonation and flavor don't exempt it. When in doubt, have a Process Authority classify it in writing.",html:titleSlide('⚠ The beverage trap','A mild tea dosed with acid to pH ≤ 4.6 is <span style="color:'+AMBER+'">acidified</span>','Carbonation and flavor don’t exempt it — get it classified in writing')},
  {say:"If the rules apply, here are the five things you must have in place — in order — before commercial production.",html:sectionCard('📋','The mandatory steps','Five things, in order, before you produce',K)},
  {say:"Step one: a scheduled process from a Process Authority. That's an expert who studies your formulation and process and issues a signed letter defining the exact conditions — time, temperature, p H, fill — that make your product safe. Nothing else can start until you have this letter.",html:bulletsSlide('Step 1 — Process Authority',['An expert establishes your <b>scheduled process</b>','A signed letter with the critical factors &amp; limits','Required <b>before</b> anything else','Keep it in your food-safety records'],K)},
  {say:"Step two: register your establishment with the F D A to get a Food Canning Establishment number — your F C E. You file it once per facility through F D A's online system, F U R L S. This is separate from your general food-facility registration.",html:bulletsSlide('Step 2 — Register the establishment',['File FDA Form 2541 to get your <b>FCE number</b>','Filed once per physical facility','Submitted through FDA’s <b>FURLS</b> system','Separate from your FSMA facility registration'],K)},
  {say:"Step three: file the scheduled process itself. For every distinct product and container, you submit the process to F D A and receive a Submission Identifier — an S I D — for each filing.",html:bulletsSlide('Step 3 — File the scheduled process',['File the process for <b>each product + container</b>','FDA issues a <b>SID</b> (Submission Identifier) per filing','Use the form that matches your method','Do this before commercial production'],K)},
  {say:"Step four: training. At least one supervisor on every processing shift must have completed Better Process Control School — B P C S — which certifies they understand the thermal and acidification controls.",html:bulletsSlide('Step 4 — Better Process Control School',['A <b>BPCS-certified supervisor</b> on every shift','Covers thermal processing &amp; acidification','Offered by university food-science programs','Keep the certificates on file'],K)},
  {say:"And step five: records. You keep the process, container-closure, and deviation records that prove every batch met its scheduled process — held for at least two years and available to F D A on request.",html:bulletsSlide('Step 5 — Records',['<b>Process</b> records for every batch','<b>Container-closure</b> (seam) records','<b>Deviation</b> records &amp; corrective actions','Kept ≥ 2 years, available to FDA'],K)},
  {say:"Put together, the path is: get your Process Authority letter, register for your F C E, file each scheduled process for a S I D, train a B P C S supervisor, and keep your records. Miss any one, and you're not clear to ship.",html:flowSlide('The path, in order',[['📝','Process Authority','scheduled process',K],['🏭','FCE','register facility',BLUE],['📄','SID','file each process',AMBER],['🎓','BPCS','trained supervisor',PURP],['🗂️','Records','prove every batch',RED]],'All five must be in place before commercial production.')},
  {say:"This is one area where getting it right isn't optional — it's the law, and it protects lives. Use this as your roadmap, and confirm the specifics for your exact products with a Process Authority and the F D A.",html:closeSlide('The bottom line','Non-negotiable, and it protects lives',[['📝 Process Authority',K],['🏭 FCE + SID',AMBER],['🎓 BPCS + records',BLUE]],'Educational overview — not legal advice. Confirm applicability for your products with a Process Authority and FDA/FDACS.')}
]},

'sqf':{ brand:'SQF Certification', slides:[
  {say:"In this video we'll explain S Q F certification — what it is, why food brands pursue it, and the path to earning it. If a major retailer has ever asked whether you're G F S I certified, this is what they mean.",html:titleSlide('SQF CERTIFICATION','A globally-recognized food safety certificate','What it is, and how to get there')},
  {say:"Let's start with the alphabet soup. G F S I, the Global Food Safety Initiative, is a benchmark — a bar that food-safety standards can be measured against. S Q F, the Safe Quality Food program, is one of several standards recognized against that benchmark. So earning S Q F means you meet a G F S I-recognized standard.",html:bulletsSlide('GFSI and SQF — what they are',['<b>GFSI</b> — a global benchmark for food-safety standards','<b>SQF</b> — one recognized standard measured against it','Others include BRCGS, FSSC 22000','SQF certified = you meet a GFSI-recognized bar'],K)},
  {say:"Why go through it? Because more and more major retailers and distributors simply require a G F S I certificate to put you on the shelf. Beyond opening doors, it proves your food-safety system works, and it can replace a stack of individual customer audits with one trusted certificate.",html:bulletsSlide('Why brands get certified',['Many <b>major retailers require</b> it to stock you','Proves your food-safety system actually works','Replaces many customer audits with <b>one certificate</b>','A real competitive advantage'],K)},
  {say:"Here's the reassuring part. S Q F isn't a whole new world — it's built on the same pieces you already know. Good manufacturing practices, a HACCP-based food safety plan, and the management systems that hold them together. If your G M P and HACCP work is solid, you're most of the way there.",html:flowSlide('SQF is built on what you know',[['🏭','GMPs','the foundation',K],['📋','Food Safety Plan','HACCP-based',AMBER],['🗂️','System elements','documents &amp; records',BLUE]],'SQF organizes your existing GMP + HACCP work into a certified system.')},
  {say:"An S Q F audit looks at four things: your documented system, your records proving you follow it, the actual conditions on your floor, and evidence that management is genuinely committed. It's not a pop quiz — it's a check that your system is real and running.",html:bulletsSlide('What an SQF audit checks',['Your <b>documented</b> food-safety system','<b>Records</b> that prove you follow it','The real <b>conditions on the floor</b>','Genuine <b>management commitment</b> &amp; traceability'],AMBER)},
  {say:"So how do you get there? Here's the typical path.",html:sectionCard('🎓','Getting certified','The typical path to an SQF certificate',BLUE)},
  {say:"Step one: management commitment, and naming an S Q F Practitioner — a trained person, on your team, responsible for the system. This is your internal owner, much like a PCQI.",html:bulletsSlide('Step 1 — Commit & appoint',['Leadership commits time and resources','Name an <b>SQF Practitioner</b> (trained, in-house)','They own the system day to day'],BLUE)},
  {say:"Step two: build the system. Your G M P programs, your HACCP-based food safety plan, your S O Ps, and the record templates that capture it all. Much of this you may already have — S Q F organizes it.",html:bulletsSlide('Step 2 — Build the system',['Document your <b>GMP</b> programs','Write the <b>HACCP-based food safety plan</b>','Create SOPs and record templates','Fill any gaps SQF identifies'],BLUE)},
  {say:"Step three: run it, and gather records. Auditors want to see history — usually at least two months of your system actually operating, with the records to prove it. You can't certify a system you turned on yesterday.",html:bulletsSlide('Step 3 — Run it & gather history',['Operate the system for real','Collect <b>2+ months</b> of records','Do an internal audit &amp; fix findings','Hold a management review'],BLUE)},
  {say:"Step four: the certification audit. Often you'll do an optional pre-assessment first to catch gaps, then a licensed certification body sends an auditor to score you against the S Q F code.",html:bulletsSlide('Step 4 — The certification audit',['Optional <b>pre-assessment</b> to catch gaps','A licensed <b>certification body</b> audits you','Scored against the SQF code','Close any non-conformances found'],BLUE)},
  {say:"Step five: you receive a score and your certificate — and then you keep it current with a re-audit, typically every year. Certification isn't a one-time event; it's an ongoing commitment.",html:bulletsSlide('Step 5 — Certificate & upkeep',['Receive your <b>score</b> and certificate','Re-audited <b>annually</b> to stay certified','Keep improving between audits','It’s ongoing, not one-and-done'],BLUE)},
  {say:"The takeaway: S Q F doesn't replace your food-safety work — it recognizes it. Do the G M P and HACCP fundamentals well, appoint a practitioner, keep your records, and certification becomes the natural next step.",html:closeSlide('The takeaway','SQF <span style="color:'+K+'">recognizes</span> the work you already do',[['🏭 Solid GMP + HACCP',K],['🎓 A trained practitioner',BLUE],['🗂️ Records &amp; upkeep',AMBER]],'Educational overview — not legal advice. Confirm requirements with the SQFI code and your certification body.')}
]},

'allergen':{ brand:'Allergen Control', slides:[
  {say:"In this video we'll cover allergen control — one of the most important, and most tested, parts of any food-safety plan. For a co-packer running many brands on shared lines, it deserves real attention.",html:titleSlide('ALLERGEN CONTROL','Protecting consumers — and your brand','Why it matters, and how to control it')},
  {say:"Why does it matter so much? Undeclared allergens are consistently one of the leading causes of food recalls in the United States. For a sensitive consumer, a single mislabeled can isn't a quality issue — it can be life-threatening. Get this wrong, and it's both a safety failure and a brand crisis.",html:bulletsSlide('Why allergen control matters',['Undeclared allergens are a <b>top cause of recalls</b>','For a sensitive consumer, a mistake can be <b>fatal</b>','It’s a safety failure <i>and</i> a brand crisis','A required preventive control under FSMA'],RED)},
  {say:"In the U.S., the law recognizes nine major allergens — the Big Nine. Milk, egg, fish, crustacean shellfish, tree nuts, peanuts, wheat, and soy — and, since the FASTER Act, sesame. If any of these is in a product, it must be declared on the label.",html:principlesSlide('The Big 9 major allergens',AMBER,[['🥛','Milk'],['🥚','Egg'],['🐟','Fish'],['🦐','Shellfish'],['🌰','Tree nuts'],['🥜','Peanuts'],['🌾','Wheat'],['🫘','Soy'],['🌱','Sesame']])},
  {say:"There are really two risks to manage. The first is an undeclared allergen — the label is wrong, and a consumer never sees the warning. The second is cross-contact — an allergen from one product physically gets into another that isn't supposed to contain it. Good programs control both.",html:compareSlide('Two risks to control',[
    {label:'Undeclared allergen',color:RED,lines:['The <b>label</b> is wrong or incomplete','Consumer never sees the warning','A labeling &amp; reconciliation problem']},
    {label:'Cross-contact',color:AMBER,lines:['Allergen physically <b>gets into</b> another product','From shared tools, lines, or air','A sanitation &amp; segregation problem']}
  ])},
  {say:"So how do you control it? Five practical controls, working together.",html:sectionCard('🛡️','How to control it','Five controls, working together',K)},
  {say:"First, know your ingredients. Get allergen statements from your suppliers, watch for hidden allergens in flavors, colors, and processing aids, and keep it all documented. You can't control what you haven't identified.",html:bulletsSlide('Control 1 — Know your ingredients',['Get <b>allergen statements</b> from suppliers','Watch for <b>hidden</b> allergens in flavors &amp; aids','Map which products contain which allergens','Document it all'],K)},
  {say:"Second, segregate and schedule. Store allergen-containing ingredients apart, use dedicated or clearly-marked tools, and where you can, schedule production so allergen-free products run first and allergen-containing products run last.",html:bulletsSlide('Control 2 — Segregate & schedule',['<b>Store</b> allergens separately &amp; labeled','Use <b>dedicated or color-coded</b> tools','Run <b>allergen-free first</b>, allergen-containing last','Prevent contact before it can happen'],K)},
  {say:"Third, cleaning and changeover. Between an allergen run and the next product, you perform a validated allergen cleaning — one you've proven actually removes the allergen — and you record that it was done.",html:bulletsSlide('Control 3 — Cleaning & changeover',['<b>Validated</b> allergen cleaning between runs','Proven to actually remove the allergen','Verify — visually or with allergen test swabs','<b>Record</b> every changeover'],K)},
  {say:"Fourth, labeling and reconciliation. Confirm the right label is on the right product, that every allergen is declared, and reconcile your labels at the end of a run so a wrong or leftover label can't reach the field.",html:bulletsSlide('Control 4 — Labeling & reconciliation',['Right <b>label</b> on the right product','Every allergen <b>clearly declared</b>','<b>Reconcile</b> labels used vs. produced','Catch a mislabel before it ships'],K)},
  {say:"And fifth, training. Every person on the floor needs to understand what allergens are, why they matter, and their role in controlling them. A program is only as strong as the people running it.",html:bulletsSlide('Control 5 — Training',['Everyone understands <b>what allergens are</b>','And their <b>role</b> in controlling them','Refreshed regularly','A program is only as strong as its people'],K)},
  {say:"Put it together and the flow is: know your ingredients, segregate them, clean between runs, label and reconcile, and train your team. Five controls that keep an allergen where it belongs — and off the labels where it doesn't.",html:flowSlide('The five controls',[['🔎','Ingredients','know them',K],['↔️','Segregate','keep apart',BLUE],['🧼','Clean','between runs',AMBER],['🏷️','Label','&amp; reconcile',PURP],['🎓','Train','the team',RED]],'Together they control both undeclared allergens and cross-contact.')},
  {say:"Done well, allergen control protects the consumers who trust your brands, and it keeps you off the recall list. Build these five controls into your food safety plan, and keep the records that prove they're working.",html:closeSlide('The bottom line','Keep the allergen where it <span style="color:'+K+'">belongs</span>',[['✓ Consumers protected',K],['✓ Off the recall list',AMBER],['✓ Audit-ready',BLUE]],'Educational overview — not legal advice. Build allergen controls into your Food Safety Plan and validate them.')}
]}
};

const CSS=`
*{box-sizing:border-box}
html{min-height:100%;background:#0a1628;background-image:radial-gradient(1200px 760px at 72% -12%, #163a56, #0a1628 62%)}
body{margin:0;min-height:100vh;background:transparent;font-family:Inter,Segoe UI,Arial,sans-serif;color:#eef4ff;overflow:hidden}
#brandbar{position:fixed;top:0;left:0;right:0;height:44px;display:flex;align-items:center;padding:0 26px;font-size:12px;letter-spacing:2px;color:#7feadd;background:rgba(10,22,40,.5);border-bottom:1px solid rgba(0,229,192,.15);z-index:5}
#brandbar b{color:#00e5c0;font-weight:800;letter-spacing:3px}
#slide-root{position:fixed;inset:44px 0 96px 0;display:flex;align-items:center;justify-content:center;padding:20px 70px}
.slide{width:100%;max-width:1060px}
.slide.center{text-align:center;display:flex;flex-direction:column;align-items:center;justify-content:center}
.kicker{font-size:15px;letter-spacing:5px;color:#00e5c0;margin-bottom:14px;animation:fadeUp .6s both}
.bigtitle{font-size:54px;font-weight:800;line-height:1.08;letter-spacing:.5px;animation:fadeUp .7s .05s both;text-shadow:0 4px 30px rgba(0,0,0,.4)}
.subtitle{font-size:22px;color:#9fb2c9;margin-top:18px;animation:fadeUp .7s .18s both}
.sheading{font-size:33px;font-weight:800;margin-bottom:24px;animation:fadeUp .6s both}
.blist{list-style:none;margin:0;padding:0}
.blist li{display:flex;align-items:flex-start;gap:16px;font-size:23px;line-height:1.5;margin-bottom:18px;animation:fadeUp .55s both}
.bdot{flex:0 0 auto;width:13px;height:13px;border-radius:50%;margin-top:9px;box-shadow:0 0 12px currentColor}
.blist b{color:#fff}.blist i{color:#cfe0ee}
.seccard{border:2px solid;border-radius:22px;padding:44px 60px;background:rgba(255,255,255,.03);animation:fadeUp .6s both}
.secicon{font-size:66px;animation:pop .6s .1s both}
.seclabel{font-size:40px;font-weight:800;margin-top:10px;letter-spacing:.5px}
.sectag{font-size:18px;color:#9fb2c9;margin-top:8px}
.pyramid{display:flex;flex-direction:column;align-items:center;gap:14px}
.pyrow{border:1.5px solid;border-radius:14px;padding:20px 24px;text-align:center;animation:fadeUp .6s both}
.pyrow:nth-child(1){animation-delay:.05s}.pyrow:nth-child(2){animation-delay:.2s}.pyrow:nth-child(3){animation-delay:.35s}
.pylab{font-size:26px;font-weight:800}.pysub{font-size:15px;color:#9fb2c9;margin-top:3px}
.pgrid{display:grid;gap:14px}
.pgrid.pg7,.pgrid.pg9{grid-template-columns:repeat(4,1fr)}
.pgrid.pg7 .pcard:last-child{grid-column:span 4;max-width:260px;margin:0 auto}
.pcard{background:rgba(255,255,255,.04);border:1px solid;border-radius:14px;padding:18px 14px;text-align:center;animation:fadeUp .5s both}
.pnum{font-size:28px;font-weight:800}
.ptxt{font-size:16px;margin-top:6px;color:#dfe7f1;line-height:1.35}
.cmp{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
.cmpcol{background:rgba(255,255,255,.03);border:1.5px solid;border-radius:16px;padding:22px 18px;animation:fadeUp .55s both}
.cmplab{font-size:21px;font-weight:800;margin-bottom:12px}
.cmpln{font-size:16.5px;color:#dfe7f1;line-height:1.5;margin-bottom:7px}
.cmpln b{color:#fff}
.flow{display:flex;align-items:stretch;justify-content:center;gap:8px;flex-wrap:nowrap}
.fstep{flex:1;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:20px 8px;text-align:center;animation:fadeUp .6s both}
.ficon{font-size:36px}.flab{font-size:18px;font-weight:800;margin-top:8px}.fsub{font-size:12.5px;color:#9fb2c9;margin-top:4px}
.farrow{display:flex;align-items:center;font-size:26px;color:#4f6b86;animation:fadeUp .6s .3s both}
.fnote{text-align:center;font-size:16.5px;color:#9fb2c9;margin-top:24px;animation:fadeUp .6s .6s both}
.chips{display:flex;gap:14px;margin-top:26px;flex-wrap:wrap;justify-content:center;animation:fadeUp .6s .2s both}
.chip{border:1.5px solid;border-radius:30px;padding:10px 20px;font-size:18px;font-weight:700}
.disclaim{font-size:13px;color:#6b7c92;margin-top:32px;max-width:700px;animation:fadeUp .6s .5s both}
@keyframes fadeUp{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}
@keyframes pop{from{opacity:0;transform:scale(.7)}to{opacity:1;transform:none}}
`;

function hudJs(){
  const cap=document.createElement('div'); cap.id='vcap';
  cap.style.cssText='position:fixed;left:0;right:0;bottom:0;padding:16px 200px 18px 200px;background:linear-gradient(180deg,rgba(10,22,40,0),rgba(10,22,40,.97) 45%);color:#eaf3f0;font-size:19px;line-height:1.5;font-weight:600;z-index:9;text-align:center;min-height:60px;pointer-events:none';
  document.body.appendChild(cap);
  window.__vcap=t=>{cap.textContent=t;};
  const st=document.createElement('style'); st.textContent=
    '@keyframes gm-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}@keyframes gm-blink{0%,90%,100%{transform:scaleY(1)}95%{transform:scaleY(.08)}}@keyframes gm-talk{0%,100%{transform:scaleY(.32)}50%{transform:scaleY(1)}}@keyframes gm-wave{0%,100%{transform:rotate(-4deg)}50%{transform:rotate(-32deg)}}#gm{animation:gm-bob 2.6s ease-in-out infinite;position:fixed;left:26px;bottom:74px;width:120px;height:150px;z-index:10;filter:drop-shadow(0 6px 14px rgba(0,0,0,.5))}#gm .gm-eyes{transform-box:fill-box;transform-origin:center;animation:gm-blink 4s infinite}#gm .gm-mouth{transform-box:fill-box;transform-origin:center;animation:gm-talk .26s ease-in-out infinite}#gm .gm-arm{transform-box:fill-box;transform-origin:top center;animation:gm-wave 1.1s ease-in-out infinite}';
  document.head.appendChild(st);
  const m=document.createElement('div'); m.id='gm';
  m.innerHTML='<svg viewBox="0 0 120 152" width="120" height="150"><defs><linearGradient id="gc" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#00e5c0"/><stop offset="1" stop-color="#00a88c"/></linearGradient></defs><rect class="gm-arm" x="14" y="72" width="12" height="34" rx="6" fill="#00c4a7"/><rect x="94" y="74" width="12" height="30" rx="6" fill="#00c4a7"/><rect x="28" y="34" width="64" height="98" rx="16" fill="url(#gc)" stroke="#0a3d34" stroke-width="2"/><ellipse cx="60" cy="34" rx="32" ry="8" fill="#7ff0dd" stroke="#0a3d34" stroke-width="2"/><rect x="28" y="82" width="64" height="24" fill="rgba(255,255,255,.15)"/><text x="60" y="99" text-anchor="middle" font-family="Arial" font-weight="bold" font-size="12" fill="#eafff9">GOOD LIQUID</text><circle cx="42" cy="64" r="4" fill="rgba(255,120,120,.5)"/><circle cx="78" cy="64" r="4" fill="rgba(255,120,120,.5)"/><g class="gm-eyes"><circle cx="49" cy="54" r="9" fill="#fff"/><circle cx="71" cy="54" r="9" fill="#fff"/><circle cx="50" cy="55" r="4" fill="#08201b"/><circle cx="72" cy="55" r="4" fill="#08201b"/></g><ellipse class="gm-mouth" cx="60" cy="70" rx="8.5" ry="6" fill="#08201b"/><rect x="42" y="132" width="9" height="12" rx="4" fill="#00a88c"/><rect x="69" y="132" width="9" height="12" rx="4" fill="#00a88c"/></svg>';
  document.body.appendChild(m);
}

(async()=>{
const deck=process.argv[2]||'gmp-haccp-pcqi';
const D=DECKS[deck]; if(!D){ console.error('unknown deck',deck); process.exit(1); }
const SLIDES=D.slides;
const work=path.join(SCRATCH,'video','exp-'+deck); fs.mkdirSync(work,{recursive:true});
console.log('deck',deck,'— synthesizing narration…');
const T=[]; let A=0;
SLIDES.forEach((s,i)=>{
  const raw=path.join(work,`raw_${i}.wav`);
  execSync(`piper --model ${MODEL} --output_file "${raw}"`,{input:s.say});
  const d=dur(raw); const Ti=LEAD+d+TAILPAD; T.push(Ti); A+=Ti;
  execSync(`ffmpeg -y -loglevel error -i "${raw}" -af "adelay=${Math.round(LEAD*1000)}:all=1,apad" -t ${Ti.toFixed(3)} -ar 22050 -ac 1 "${path.join(work,`seg_${i}.wav`)}"`);
});
fs.writeFileSync(path.join(work,'list.txt'), SLIDES.map((_,i)=>`file 'seg_${i}.wav'`).join('\n'));
const narration=path.join(work,'narration.wav');
execSync(`ffmpeg -y -loglevel error -f concat -safe 0 -i "${path.join(work,'list.txt')}" -c copy "${narration}"`);
console.log(`narration ${A.toFixed(1)}s across ${SLIDES.length} slides`);

const br=await chromium.launch({executablePath:process.env.PW_CHROMIUM||undefined,args:['--no-sandbox','--disable-setuid-sandbox']});
const ctx=await br.newContext({viewport:{width:W,height:H},deviceScaleFactor:1,recordVideo:{dir:work,size:{width:W,height:H}}});
const pg=await ctx.newPage();
await pg.setContent('<!doctype html><html><head><meta charset="utf-8"><style>'+CSS+'</style></head><body><div id="brandbar"><b>GOOD LIQUID BEV CO</b>&nbsp;&nbsp;·&nbsp;&nbsp;'+D.brand+'</div><div id="slide-root"></div></body></html>',{waitUntil:'domcontentloaded'});
await pg.evaluate(hudJs);
await sleep(300);
for(let i=0;i<SLIDES.length;i++){
  const t=Date.now();
  await pg.evaluate(({html,say})=>{ document.getElementById('slide-root').innerHTML=html; window.__vcap(say); }, {html:SLIDES[i].html, say:SLIDES[i].say});
  const el=(Date.now()-t)/1000, rem=T[i]-el; if(rem>0) await sleep(rem*1000);
}
const video=pg.video(); await ctx.close();
const vpath=await video.path(); const V=dur(vpath);
console.log(`video ${V.toFixed(1)}s (audio ${A.toFixed(1)}s) → front-trim ${(V-A).toFixed(2)}s`);
await br.close();
const P=Math.max(0,V-A);
const out=path.join(SCRATCH,'explainer-'+deck+'.mp4');
execSync(`ffmpeg -y -loglevel error -ss ${P.toFixed(3)} -i "${vpath}" -i "${narration}" -map 0:v:0 -map 1:a:0 -c:v libx264 -preset veryfast -pix_fmt yuv420p -r 25 -c:a aac -b:a 128k -shortest -movflags +faststart "${out}"`);
console.log('WROTE', out, fs.statSync(out).size, 'bytes', dur(out).toFixed(1)+'s');
process.exit(0);
})().catch(e=>{console.error('ERR',e);process.exit(1);});
