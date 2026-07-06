/* ============================================================
   IN-APP HELP PANEL (v2 — fixed layout + visual wireframes)
   Replaces the broken v1 grid layout with a flexbox row that
   actually renders, larger TOC items, and inline SVG mockups
   on the busiest sections (Dashboard, Invoices, New Invoice,
   Users) with numbered callouts mapped to bullets.
   ============================================================ */
(function(){
  function section(id, heading, html){
    return '<section id="' + id + '" style="padding:22px 4px 26px;border-bottom:1px solid rgba(255,255,255,.06);scroll-margin-top:20px">' +
      '<h3 style="margin:0 0 14px;font-family:var(--ff-disp);font-size:15px;letter-spacing:2px;color:var(--teal)">' + heading + '</h3>' +
      html +
    '</section>';
  }
  function bullets(items){
    return '<ul style="margin:10px 0 4px;padding-left:20px;color:#cfd9e6;font-size:13px;line-height:1.75">' +
      items.map(function(t){ return '<li style="margin-bottom:6px">' + t + '</li>'; }).join('') +
    '</ul>';
  }
  function wf(width, height, content){
    return '<svg viewBox="0 0 ' + width + ' ' + height + '" width="100%" style="background:#0a1628;border-radius:10px;border:1px solid rgba(255,255,255,.08);margin:12px 0 4px;display:block;max-height:340px">' +
      content +
    '</svg>';
  }
  function box(x,y,w,h,fill,stroke){ return '<rect x="'+x+'" y="'+y+'" width="'+w+'" height="'+h+'" rx="6" fill="'+(fill||'#243a56')+'" stroke="'+(stroke||'rgba(255,255,255,.06)')+'"/>'; }
  function txt(x,y,t,size,color,anchor){ return '<text x="'+x+'" y="'+y+'" fill="'+(color||'#cfd9e6')+'" font-size="'+(size||11)+'" text-anchor="'+(anchor||'start')+'" font-family="Arial">'+t+'</text>'; }
  function tag(x,y,n){ return '<circle cx="'+x+'" cy="'+y+'" r="11" fill="#00e5c0"/><text x="'+x+'" y="'+(y+4)+'" fill="#0a1628" font-size="11" text-anchor="middle" font-weight="bold" font-family="Arial">'+n+'</text>'; }

  var MOCK_DASHBOARD = wf(620, 320,
    box(0,0,140,320,'#142238','rgba(255,255,255,.05)') +
    txt(15,28,'CRM nav',10,'#9aa7bd') +
    txt(15,52,'• Dashboard',11,'#00e5c0') + txt(15,72,'• Clients',11,'#9aa7bd') +
    txt(15,92,'• Pipeline',11,'#9aa7bd') + txt(15,112,'• Invoices',11,'#9aa7bd') +
    txt(160,28,'DASHBOARD',13,'#fff') + txt(160,46,'Good Liquid · 2026',10,'#9aa7bd') +
    box(160,60,100,52) + txt(170,82,'Collected',9,'#9aa7bd') + txt(170,103,'$0K',13,'#00e5c0') +
    box(270,60,100,52) + txt(280,82,'Pending',9,'#9aa7bd') + txt(280,103,'$0K',13,'#fff') +
    box(380,60,100,52) + txt(390,82,'Overdue',9,'#9aa7bd') + txt(390,103,'$0K',13,'#e74c3c') +
    box(490,60,115,52) + txt(500,82,'Active brands',9,'#9aa7bd') + txt(500,103,'0',13,'#00e5c0') +
    box(160,122,100,52) + txt(170,144,'Avg inv',9,'#9aa7bd') + txt(170,165,'$—',13,'#00e5c0') +
    box(270,122,100,52) + txt(280,144,'Outstanding',9,'#9aa7bd') + txt(280,165,'$0',13,'#f5c842') +
    box(380,122,100,52) + txt(390,144,'Days to paid',9,'#9aa7bd') + txt(390,165,'—',13,'#fff') +
    box(490,122,115,52) + txt(500,144,'Quotes',9,'#9aa7bd') + txt(500,165,'0',13,'#6b9fff') +
    box(160,184,280,120) + txt(300,210,'Revenue by service',10,'#9aa7bd','middle') +
    '<rect x="190" y="240" width="20" height="50" rx="2" fill="#1a6fff"/>' +
    '<rect x="230" y="260" width="20" height="30" rx="2" fill="#00c4a7"/>' +
    '<rect x="270" y="245" width="20" height="45" rx="2" fill="#1a6fff"/>' +
    '<rect x="310" y="270" width="20" height="20" rx="2" fill="#00c4a7"/>' +
    box(450,184,155,120) + txt(460,205,'Recent activity',10,'#9aa7bd') +
    '<line x1="460" y1="220" x2="595" y2="220" stroke="rgba(255,255,255,.05)"/>' +
    txt(460,238,'• Invoice saved',9,'#cfd9e6') + txt(460,256,'• Deal moved',9,'#cfd9e6') + txt(460,274,'• Note added',9,'#cfd9e6') +
    box(160,310,445,8,'rgba(0,229,192,.1)','rgba(0,229,192,.3)') +
    tag(155,60,1) + tag(155,122,2) + tag(155,184,3) + tag(440,184,4) + tag(445,318,5)
  );

  var MOCK_INVOICES = wf(620, 290,
    box(0,0,140,290,'#142238','rgba(255,255,255,.05)') +
    txt(15,28,'CRM nav',10,'#9aa7bd') +
    txt(160,28,'INVOICES',13,'#fff') + txt(160,46,'X invoices',10,'#9aa7bd') +
    box(380,16,80,24,'#00e5c0','#00e5c0') + txt(420,32,'+ New',10,'#0a1628','middle') +
    box(465,16,80,24,'rgba(0,229,192,.08)','rgba(0,229,192,.3)') + txt(505,32,'📊 CSV',10,'#00e5c0','middle') +
    box(550,16,55,24,'rgba(245,200,66,.08)','rgba(245,200,66,.3)') + txt(577,32,'📧',10,'#f5c842','middle') +
    box(160,56,445,28) + txt(175,75,'🔍 Search invoices…',11,'#9aa7bd') +
    box(160,96,40,22,'rgba(0,229,192,.2)','rgba(0,229,192,.3)') + txt(180,111,'All',10,'#00e5c0','middle') +
    box(205,96,55,22,'rgba(255,255,255,.04)') + txt(232,111,'Draft',10,'#9aa7bd','middle') +
    box(265,96,65,22,'rgba(255,255,255,.04)') + txt(297,111,'Pending',10,'#9aa7bd','middle') +
    box(335,96,55,22,'rgba(255,255,255,.04)') + txt(362,111,'Paid',10,'#9aa7bd','middle') +
    box(395,96,65,22,'rgba(255,255,255,.04)') + txt(427,111,'Overdue',10,'#9aa7bd','middle') +
    box(465,96,55,22,'rgba(255,255,255,.04)') + txt(492,111,'Quote',10,'#6b9fff','middle') +
    box(160,130,445,150) +
    '<line x1="160" y1="160" x2="605" y2="160" stroke="rgba(255,255,255,.06)"/>' +
    txt(170,150,'Invoice #',9,'#9aa7bd') + txt(245,150,'Client',9,'#9aa7bd') +
    txt(320,150,'Amount',9,'#9aa7bd') + txt(380,150,'Status',9,'#9aa7bd') + txt(455,150,'Actions',9,'#9aa7bd') +
    txt(170,180,'GL-1001',10,'#00e5c0') + txt(245,180,'Acme Co.',10,'#fff') + txt(320,180,'$3,850',10,'#fff') +
    box(380,170,55,16,'rgba(245,200,66,.12)','rgba(245,200,66,.3)') + txt(407,182,'pending',9,'#f5c842','middle') +
    box(455,170,35,16,'rgba(34,197,94,.15)','rgba(34,197,94,.3)') + txt(472,182,'Paid',8,'#22c55e','middle') +
    box(495,170,25,16,'rgba(168,85,247,.15)') + txt(507,182,'💳',9,'#c4a4f8','middle') +
    box(525,170,40,16,'rgba(255,255,255,.06)') + txt(545,182,'👁',9,'#9aa7bd','middle') +
    txt(170,210,'GL-1002',10,'#00e5c0') + txt(245,210,'Beta Brands',10,'#fff') + txt(320,210,'$5,420',10,'#fff') +
    box(380,200,55,16,'rgba(107,159,255,.12)','rgba(107,159,255,.3)') + txt(407,212,'quote',9,'#6b9fff','middle') +
    box(455,200,75,16,'rgba(107,159,255,.15)','rgba(107,159,255,.3)') + txt(492,212,'→ Invoice',8,'#6b9fff','middle') +
    tag(380,16,1) + tag(465,16,2) + tag(550,16,3) + tag(160,96,4) + tag(530,178,5) + tag(490,210,6)
  );

  var MOCK_NEWINV = wf(620, 320,
    box(0,0,620,320,'#142238','rgba(255,255,255,.05)') +
    txt(20,28,'NEW INVOICE',13,'#00e5c0') +
    box(20,48,180,46) + txt(28,64,'Client *',9,'#9aa7bd') + txt(28,84,'— pick a client —',11,'#cfd9e6') +
    box(210,48,180,46) + txt(218,64,'Invoice date',9,'#9aa7bd') + txt(218,84,'2026-05-15',11,'#fff') +
    box(400,48,200,46) + txt(408,64,'Invoice #',9,'#9aa7bd') + txt(408,84,'GL-1001',11,'#fff') +
    box(20,104,90,26,'rgba(0,229,192,.08)','rgba(0,229,192,.3)') + txt(65,121,'+ Canning',10,'#00e5c0','middle') +
    box(115,104,90,26,'rgba(0,229,192,.08)','rgba(0,229,192,.3)') + txt(160,121,'+ Bottling',10,'#00e5c0','middle') +
    box(210,104,90,26,'rgba(0,229,192,.08)','rgba(0,229,192,.3)') + txt(255,121,'+ R&amp;D',10,'#00e5c0','middle') +
    box(305,104,90,26,'rgba(0,229,192,.08)','rgba(0,229,192,.3)') + txt(350,121,'+ Hours',10,'#00e5c0','middle') +
    box(400,104,90,26,'rgba(0,229,192,.08)','rgba(0,229,192,.3)') + txt(445,121,'+ Custom',10,'#00e5c0','middle') +
    box(20,140,580,90) +
    txt(30,156,'Canning · 12oz Std',10,'#00e5c0') + txt(180,156,'150 cases',10,'#fff') + txt(280,156,'$11.52/case',10,'#9aa7bd') + txt(540,156,'$1,728.00',11,'#fff','end') +
    '<line x1="30" y1="170" x2="590" y2="170" stroke="rgba(255,255,255,.05)"/>' +
    txt(30,188,'Bottling · 750ml',10,'#00e5c0') + txt(180,188,'500 btl',10,'#fff') + txt(280,188,'$1.85/btl',10,'#9aa7bd') + txt(540,188,'$925.00',11,'#fff','end') +
    '<line x1="30" y1="202" x2="590" y2="202" stroke="rgba(255,255,255,.05)"/>' +
    txt(30,220,'R&amp;D · Formulation',10,'#00e5c0') + txt(180,220,'1',10,'#fff') + txt(280,220,'$1,500',10,'#9aa7bd') + txt(540,220,'$1,500.00',11,'#fff','end') +
    box(360,240,240,32) + txt(370,260,'Discount %',9,'#9aa7bd') + txt(550,260,'0',10,'#fff','end') +
    box(360,278,240,28,'rgba(0,229,192,.08)','rgba(0,229,192,.3)') + txt(370,296,'TOTAL',10,'#00e5c0') + txt(590,296,'$4,153.00',12,'#00e5c0','end') +
    box(20,278,75,28,'#00e5c0','#00e5c0') + txt(57,296,'💾 Save',10,'#0a1628','middle') +
    box(100,278,90,28,'rgba(107,159,255,.12)','rgba(107,159,255,.3)') + txt(145,296,'💾 Quote',10,'#6b9fff','middle') +
    box(195,278,75,28,'rgba(0,229,192,.08)','rgba(0,229,192,.3)') + txt(232,296,'📄 PDF',10,'#00e5c0','middle') +
    box(275,278,80,28,'rgba(107,159,255,.12)','rgba(107,159,255,.3)') + txt(315,296,'📋 Q-PDF',10,'#6b9fff','middle') +
    tag(20,48,1) + tag(20,104,2) + tag(20,140,3) + tag(360,240,4) + tag(20,278,5)
  );

  var MOCK_USERS = wf(620, 250,
    box(0,0,620,250,'#142238','rgba(255,255,255,.05)') +
    txt(20,28,'USERS &amp; PERMISSIONS',13,'#fff') + txt(20,46,'Manage team access',10,'#9aa7bd') +
    box(380,16,80,24,'#00e5c0','#00e5c0') + txt(420,32,'+ Invite',10,'#0a1628','middle') +
    box(465,16,110,24,'rgba(0,229,192,.08)','rgba(0,229,192,.3)') + txt(520,32,'📋 Activity log',9,'#00e5c0','middle') +
    box(20,60,180,42,'rgba(0,229,192,.06)','rgba(0,229,192,.18)') + txt(30,78,'👑 ADMIN',10,'#00e5c0') + txt(30,94,'Full access',9,'#9aa7bd') +
    box(210,60,180,42,'rgba(26,111,255,.06)','rgba(26,111,255,.18)') + txt(220,78,'💼 SALES',10,'#6b9fff') + txt(220,94,'CRM only',9,'#9aa7bd') +
    box(400,60,200,42,'rgba(255,255,255,.04)') + txt(410,78,'👁 VIEWER',10,'#9aa7bd') + txt(410,94,'Read only',9,'#9aa7bd') +
    box(20,114,580,120) +
    txt(30,134,'Name',9,'#9aa7bd') + txt(180,134,'Email',9,'#9aa7bd') + txt(310,134,'Role',9,'#9aa7bd') + txt(390,134,'Actions',9,'#9aa7bd') +
    '<line x1="30" y1="142" x2="590" y2="142" stroke="rgba(255,255,255,.06)"/>' +
    txt(30,160,'Mike Krail',11,'#fff') + txt(180,160,'mike@goodliquid.com',10,'#9aa7bd') +
    box(310,150,55,16,'rgba(245,200,66,.12)','rgba(245,200,66,.3)') + txt(337,162,'admin',9,'#f5c842','middle') +
    txt(390,160,'Owner',10,'#9aa7bd') +
    txt(30,190,'Sandra Krail',11,'#fff') + txt(180,190,'sandra@goodliquid.com',10,'#9aa7bd') +
    box(310,180,55,18,'#243a56','rgba(255,255,255,.18)') + txt(337,193,'sales ▾',9,'#fff','middle') +
    box(375,180,72,18,'rgba(255,255,255,.06)') + txt(411,193,'Set password',8,'#fff','middle') +
    box(450,180,68,18,'rgba(245,200,66,.08)','rgba(245,200,66,.3)') + txt(484,193,'Email reset',8,'#f5c842','middle') +
    box(522,180,55,18,'rgba(231,76,60,.15)','rgba(231,76,60,.3)') + txt(549,193,'Remove',8,'#e74c3c','middle') +
    tag(380,16,1) + tag(465,16,2) + tag(20,60,3) + tag(310,180,4) + tag(450,180,5)
  );

  var MOCK_PIPELINE = wf(620, 280,
    box(0,0,620,280,'#142238','rgba(255,255,255,.05)') +
    txt(20,28,'PIPELINE',13,'#fff') + txt(20,46,'X active deals',10,'#9aa7bd') +
    box(520,16,80,24,'#00e5c0','#00e5c0') + txt(560,32,'+ Add Deal',9,'#0a1628','middle') +
    // 5 columns
    box(20,60,110,210,'#243a56','rgba(255,255,255,.06)') + txt(28,80,'Prospecting',10,'#6b87ad') + txt(118,80,'2',10,'#9aa7bd','end') +
    box(20,98,110,52,'#1c2e48','rgba(255,255,255,.08)') + txt(28,116,'NorthWave',10,'#fff') + txt(28,130,'NorthWave Drinks',8,'#9aa7bd') + txt(28,144,'$11,000',9,'#00e5c0') +
    box(20,156,110,52,'#1c2e48','rgba(255,255,255,.08)') + txt(28,174,'Datasphere',10,'#fff') + txt(28,188,'Datasphere',8,'#9aa7bd') + txt(28,202,'$22,000',9,'#00e5c0') +
    // stale badge example on first card
    '<circle cx="120" cy="106" r="9" fill="rgba(245,200,66,.4)"/>' + txt(120,110,'⏰',8,'#f5c842','middle') +
    box(140,60,110,210,'#243a56','rgba(255,255,255,.06)') + txt(148,80,'Proposal',10,'#1a6fff') + txt(238,80,'2',10,'#9aa7bd','end') +
    box(140,98,110,52,'#1c2e48','rgba(255,255,255,.08)') + txt(148,116,'Harbor Pilot',10,'#fff') + txt(148,130,'Harbor Brew',8,'#9aa7bd') + txt(148,144,'$5,200',9,'#00e5c0') +
    box(140,156,110,52,'#1c2e48','rgba(255,255,255,.08)') + txt(148,174,'Bloom Batch #3',10,'#fff') + txt(148,188,'Bloom Functional',8,'#9aa7bd') + txt(148,202,'$18,400',9,'#00e5c0') +
    box(260,60,110,210,'#243a56','rgba(255,255,255,.06)') + txt(268,80,'Negotiation',10,'#f5c842') + txt(358,80,'1',10,'#9aa7bd','end') +
    box(260,98,110,52,'#1c2e48','rgba(255,255,255,.08)') + txt(268,116,'Verde IP',10,'#fff') + txt(268,130,'Verde Wellness',8,'#9aa7bd') + txt(268,144,'$6,000',9,'#00e5c0') +
    box(380,60,110,210,'#243a56','rgba(255,255,255,.06)') + txt(388,80,'Closed Won',10,'#00c4a7') + txt(478,80,'1',10,'#9aa7bd','end') +
    box(380,98,110,52,'#1c2e48','rgba(255,255,255,.08)') + txt(388,116,'SunBurst Q2',10,'#fff') + txt(388,130,'SunBurst',8,'#9aa7bd') + txt(388,144,'$35,820',9,'#00e5c0') +
    box(500,60,110,210,'#243a56','rgba(255,255,255,.06)') + txt(508,80,'Closed Lost',10,'#e74c3c') + txt(598,80,'0',10,'#9aa7bd','end') +
    tag(520,16,1) + tag(75,98,2) + tag(135,106,3) + tag(380,98,4)
  );

  var MOCK_CLIENTS = wf(620, 240,
    box(0,0,620,240,'#142238','rgba(255,255,255,.05)') +
    txt(20,28,'CLIENTS',13,'#fff') + txt(20,46,'X active brands',10,'#9aa7bd') +
    box(510,16,90,24,'#00e5c0','#00e5c0') + txt(555,32,'+ Add Client',9,'#0a1628','middle') +
    box(20,56,580,28) + txt(35,75,'🔍 Search clients…',11,'#9aa7bd') +
    box(20,96,580,130) +
    '<line x1="20" y1="124" x2="600" y2="124" stroke="rgba(255,255,255,.06)"/>' +
    txt(30,116,'Brand',9,'#9aa7bd') + txt(180,116,'Contact',9,'#9aa7bd') + txt(290,116,'Service',9,'#9aa7bd') + txt(400,116,'Status',9,'#9aa7bd') + txt(490,116,'Total billed',9,'#9aa7bd') +
    '<circle cx="40" cy="148" r="10" fill="#1a3a6e"/><text x="40" y="151" fill="#9FE1CB" font-size="9" text-anchor="middle" font-family="Arial">TT</text>' +
    txt(58,151,'Tide & Taste Co.',10,'#fff') + txt(180,151,'Jordan Mills',9,'#9aa7bd') + txt(290,151,'Canning',10,'#cfd9e6') +
    box(400,142,55,16,'rgba(34,197,94,.15)','rgba(34,197,94,.3)') + txt(427,154,'active',9,'#22c55e','middle') +
    txt(490,151,'$48,240',10,'#00e5c0') +
    '<circle cx="40" cy="178" r="10" fill="#0F6E56"/><text x="40" y="181" fill="#E1F5EE" font-size="9" text-anchor="middle" font-family="Arial">BF</text>' +
    txt(58,181,'Bloom Functional',10,'#fff') + txt(180,181,'Riley Park',9,'#9aa7bd') + txt(290,181,'R&amp;D + Canning',10,'#cfd9e6') +
    box(400,172,55,16,'rgba(34,197,94,.15)','rgba(34,197,94,.3)') + txt(427,184,'active',9,'#22c55e','middle') +
    txt(490,181,'$24,800',10,'#00e5c0') +
    '<circle cx="40" cy="208" r="10" fill="#854F0B"/><text x="40" y="211" fill="#FAEEDA" font-size="9" text-anchor="middle" font-family="Arial">SS</text>' +
    txt(58,211,'SunBurst Seltzers',10,'#fff') + txt(180,211,'Alex Torres',9,'#9aa7bd') + txt(290,211,'Canning',10,'#cfd9e6') +
    box(400,202,45,16,'rgba(107,159,255,.15)','rgba(107,159,255,.3)') + txt(422,214,'lead',9,'#6b9fff','middle') +
    txt(490,211,'$0',10,'#9aa7bd') +
    tag(510,16,1) + tag(20,96,2) + tag(58,151,3) + tag(400,151,4)
  );

  var MOCK_REFERRALS = wf(620, 220,
    box(0,0,620,220,'#142238','rgba(255,255,255,.05)') +
    txt(20,28,'REFERRALS',13,'#fff') + txt(20,46,'X tracked',10,'#9aa7bd') +
    box(490,16,110,24,'#00e5c0','#00e5c0') + txt(545,32,'+ Add referral',9,'#0a1628','middle') +
    box(20,56,580,150) +
    '<line x1="20" y1="84" x2="600" y2="84" stroke="rgba(255,255,255,.06)"/>' +
    txt(30,76,'Referrer',9,'#9aa7bd') + txt(150,76,'Client',9,'#9aa7bd') + txt(270,76,'Deal',9,'#9aa7bd') + txt(360,76,'Rate',9,'#9aa7bd') + txt(420,76,'Commission',9,'#9aa7bd') + txt(520,76,'Status',9,'#9aa7bd') +
    txt(30,108,'Jake Denton',10,'#fff') + txt(150,108,'SunBurst',10,'#cfd9e6') + txt(270,108,'$35,820',10,'#cfd9e6') + txt(360,108,'5%',10,'#9aa7bd') + txt(420,108,'$1,791',10,'#00e5c0') +
    box(520,98,55,16,'rgba(34,197,94,.15)','rgba(34,197,94,.3)') + txt(547,110,'paid',9,'#22c55e','middle') +
    txt(30,140,'Maria Santos',10,'#fff') + txt(150,140,'Bloom',10,'#cfd9e6') + txt(270,140,'$16,000',10,'#cfd9e6') + txt(360,140,'7%',10,'#9aa7bd') + txt(420,140,'$1,120',10,'#00e5c0') +
    box(520,130,55,16,'rgba(245,200,66,.15)','rgba(245,200,66,.3)') + txt(547,142,'won',9,'#f5c842','middle') +
    box(580,130,15,16,'rgba(245,200,66,.18)','rgba(245,200,66,.4)') + txt(587,142,'✓',9,'#f5c842','middle') +
    txt(30,172,'Dave Okafor',10,'#fff') + txt(150,172,'Crest Bev',10,'#cfd9e6') + txt(270,172,'$22,000',10,'#cfd9e6') + txt(360,172,'6%',10,'#9aa7bd') + txt(420,172,'$1,320',10,'#9aa7bd') +
    box(520,162,55,16,'rgba(231,76,60,.15)','rgba(231,76,60,.3)') + txt(547,174,'lost',9,'#e74c3c','middle') +
    tag(490,16,1) + tag(520,108,2) + tag(595,140,3)
  );

  var MOCK_REFERRERS = wf(620, 220,
    box(0,0,620,220,'#142238','rgba(255,255,255,.05)') +
    txt(20,28,'REFERRERS',13,'#fff') + txt(20,46,'External partners',10,'#9aa7bd') +
    box(480,16,120,24,'#00e5c0','#00e5c0') + txt(540,32,'+ Add referrer',9,'#0a1628','middle') +
    // 3 referrer cards
    box(20,60,190,150) +
    '<circle cx="44" cy="84" r="12" fill="#1a3a6e"/><text x="44" y="88" fill="#9FE1CB" font-size="10" text-anchor="middle" font-family="Arial">JD</text>' +
    txt(64,82,'Jake Denton',11,'#fff') + txt(64,98,'Broker',9,'#9aa7bd') +
    txt(30,124,'jake@dentonsales.com',9,'#9aa7bd') + txt(30,142,'(813) 555-0144',9,'#9aa7bd') +
    txt(30,168,'Rate: 5% · 2 referrals',9,'#cfd9e6') + box(30,178,160,22,'rgba(245,200,66,.08)','rgba(245,200,66,.3)') + txt(110,193,'$1,791 owed',9,'#f5c842','middle') +
    box(220,60,190,150) +
    '<circle cx="244" cy="84" r="12" fill="#0F6E56"/><text x="244" y="88" fill="#E1F5EE" font-size="10" text-anchor="middle" font-family="Arial">MS</text>' +
    txt(264,82,'Maria Santos',11,'#fff') + txt(264,98,'Industry contact',9,'#9aa7bd') +
    txt(230,124,'msantos@bevworld.com',9,'#9aa7bd') + txt(230,142,'(727) 555-0289',9,'#9aa7bd') +
    txt(230,168,'Rate: 7% · 2 referrals',9,'#cfd9e6') + box(230,178,160,22,'rgba(29,158,117,.08)','rgba(29,158,117,.3)') + txt(310,193,'$1,120 paid YTD',9,'#1D9E75','middle') +
    box(420,60,190,150) +
    '<circle cx="444" cy="84" r="12" fill="#854F0B"/><text x="444" y="88" fill="#FAEEDA" font-size="10" text-anchor="middle" font-family="Arial">DO</text>' +
    txt(464,82,'Dave Okafor',11,'#fff') + txt(464,98,'Business partner',9,'#9aa7bd') +
    txt(430,124,'dave@okaforgroup.com',9,'#9aa7bd') + txt(430,142,'(941) 555-0076',9,'#9aa7bd') +
    txt(430,168,'Rate: 6% · 1 referral',9,'#cfd9e6') + box(430,178,160,22,'rgba(255,255,255,.04)') + txt(510,193,'$0 owed',9,'#9aa7bd','middle') +
    tag(480,16,1) + tag(20,60,2)
  );

  var MOCK_DOCUMENTS = wf(620, 230,
    box(0,0,620,230,'#142238','rgba(255,255,255,.05)') +
    txt(20,28,'DOCUMENTS',13,'#fff') + txt(20,46,'Per-client file storage',10,'#9aa7bd') +
    box(490,16,110,24,'#00e5c0','#00e5c0') + txt(545,32,'+ Upload',9,'#0a1628','middle') +
    box(20,60,580,160) +
    '<line x1="20" y1="88" x2="600" y2="88" stroke="rgba(255,255,255,.06)"/>' +
    txt(30,80,'Name',9,'#9aa7bd') + txt(220,80,'Client',9,'#9aa7bd') + txt(340,80,'Type',9,'#9aa7bd') + txt(420,80,'Uploaded',9,'#9aa7bd') + txt(530,80,'Action',9,'#9aa7bd') +
    txt(30,108,'📄 Bloom Master Formula.pdf',10,'#fff') + txt(220,108,'Bloom Functional',10,'#cfd9e6') +
    box(340,98,55,16,'rgba(0,229,192,.1)','rgba(0,229,192,.3)') + txt(367,110,'R&amp;D',9,'#00e5c0','middle') +
    txt(420,108,'2026-05-12',10,'#9aa7bd') +
    box(530,98,55,16,'rgba(0,229,192,.1)','rgba(0,229,192,.3)') + txt(557,110,'⬇ Open',9,'#00e5c0','middle') +
    txt(30,140,'🖼️ SunBurst label artwork.png',10,'#fff') + txt(220,140,'SunBurst Seltzers',10,'#cfd9e6') +
    box(340,130,55,16,'rgba(168,85,247,.1)','rgba(168,85,247,.3)') + txt(367,142,'design',9,'#c4a4f8','middle') +
    txt(420,140,'2026-05-08',10,'#9aa7bd') +
    box(530,130,55,16,'rgba(0,229,192,.1)','rgba(0,229,192,.3)') + txt(557,142,'⬇ Open',9,'#00e5c0','middle') +
    txt(30,172,'📊 Q2 production schedule.xlsx',10,'#fff') + txt(220,172,'(general)',10,'#9aa7bd') +
    box(340,162,55,16,'rgba(245,200,66,.1)','rgba(245,200,66,.3)') + txt(367,174,'ops',9,'#f5c842','middle') +
    txt(420,172,'2026-05-01',10,'#9aa7bd') +
    box(530,162,55,16,'rgba(0,229,192,.1)','rgba(0,229,192,.3)') + txt(557,174,'⬇ Open',9,'#00e5c0','middle') +
    txt(30,205,'Files persist to Supabase Storage (client-docs bucket)',9,'#9aa7bd') +
    tag(490,16,1) + tag(20,60,2) + tag(530,108,3)
  );

  var MOCK_CALENDAR = wf(620, 290,
    box(0,0,620,290,'#142238','rgba(255,255,255,.05)') +
    txt(20,24,'GENERAL CALENDAR',13,'#fff') +
    // Month / List view toggle
    box(16,36,88,24,'rgba(0,229,192,.18)','rgba(0,229,192,.4)') + txt(60,52,'Month',10,'#00e5c0','middle') +
    box(108,36,62,24,'rgba(255,255,255,.04)','rgba(255,255,255,.1)') + txt(139,52,'List',10,'#9aa7bd','middle') +
    // Nav arrows + month label
    box(390,36,28,24,'rgba(255,255,255,.06)') + txt(404,52,'‹',12,'#cfd9e6','middle') +
    txt(450,52,'May 2026',11,'#fff','middle') +
    box(504,36,28,24,'rgba(255,255,255,.06)') + txt(518,52,'›',12,'#cfd9e6','middle') +
    // + Add Event button
    box(538,36,76,24,'rgba(0,229,192,.1)','rgba(0,229,192,.28)') + txt(576,52,'+ Add Event',9,'#00e5c0','middle') +
    // Day-of-week headers
    txt(55,74,'Su',9,'#9aa7bd','middle') + txt(141,74,'Mo',9,'#9aa7bd','middle') + txt(227,74,'Tu',9,'#9aa7bd','middle') +
    txt(313,74,'We',9,'#9aa7bd','middle') + txt(399,74,'Th',9,'#9aa7bd','middle') + txt(485,74,'Fr',9,'#9aa7bd','middle') + txt(571,74,'Sa',9,'#9aa7bd','middle') +
    // Row 1 (days 1-7): weekend tint on Su (col 0) and Sa (col 6)
    box(14,80,82,34,'rgba(127,90,240,.07)','rgba(255,255,255,.04)') + txt(24,97,'1',10,'#cfd9e6') +
    box(100,80,82,34,'rgba(255,255,255,.02)','rgba(255,255,255,.04)') + txt(110,97,'2',10,'#cfd9e6') +
    box(186,80,82,34,'rgba(255,255,255,.02)','rgba(255,255,255,.04)') + txt(196,97,'3',10,'#cfd9e6') +
    box(272,80,82,34,'rgba(255,255,255,.02)','rgba(255,255,255,.04)') + txt(282,97,'4',10,'#cfd9e6') +
    box(358,80,82,34,'rgba(255,255,255,.02)','rgba(255,255,255,.04)') + txt(368,97,'5',10,'#cfd9e6') +
    box(444,80,82,34,'rgba(255,255,255,.02)','rgba(255,255,255,.04)') + txt(454,97,'6',10,'#cfd9e6') +
    box(530,80,82,34,'rgba(127,90,240,.07)','rgba(255,255,255,.04)') + txt(540,97,'7',10,'#cfd9e6') +
    // Row 2 (days 8-14): event chip on Thu day 12 (col 4, x=358)
    box(14,118,82,34,'rgba(127,90,240,.07)','rgba(255,255,255,.04)') + txt(24,135,'8',10,'#cfd9e6') +
    box(100,118,82,34,'rgba(255,255,255,.02)','rgba(255,255,255,.04)') + txt(110,135,'9',10,'#cfd9e6') +
    box(186,118,82,34,'rgba(255,255,255,.02)','rgba(255,255,255,.04)') + txt(196,135,'10',10,'#cfd9e6') +
    box(272,118,82,34,'rgba(255,255,255,.02)','rgba(255,255,255,.04)') + txt(282,135,'11',10,'#cfd9e6') +
    box(358,118,82,34,'rgba(255,255,255,.02)','rgba(0,229,192,.32)') + txt(368,133,'12',10,'#00e5c0') +
    box(362,136,70,10,'rgba(0,229,192,.22)','rgba(0,229,192,.4)') + txt(397,144,'Tour 9am',7,'#00e5c0','middle') +
    box(444,118,82,34,'rgba(255,255,255,.02)','rgba(255,255,255,.04)') + txt(454,135,'13',10,'#cfd9e6') +
    box(530,118,82,34,'rgba(127,90,240,.07)','rgba(255,255,255,.04)') + txt(540,135,'14',10,'#cfd9e6') +
    // Row 3 (days 15-21): past — dimmed opacity
    box(14,156,82,34,'rgba(127,90,240,.04)','rgba(255,255,255,.03)') + txt(24,173,'15',10,'rgba(107,135,173,.38)') +
    box(100,156,82,34,'rgba(255,255,255,.01)','rgba(255,255,255,.03)') + txt(110,173,'16',10,'rgba(107,135,173,.38)') +
    box(186,156,82,34,'rgba(255,255,255,.01)','rgba(255,255,255,.03)') + txt(196,173,'17',10,'rgba(107,135,173,.38)') +
    box(272,156,82,34,'rgba(255,255,255,.01)','rgba(255,255,255,.03)') + txt(282,173,'18',10,'rgba(107,135,173,.38)') +
    box(358,156,82,34,'rgba(255,255,255,.01)','rgba(255,255,255,.03)') + txt(368,173,'19',10,'rgba(107,135,173,.38)') +
    box(444,156,82,34,'rgba(255,255,255,.01)','rgba(255,255,255,.03)') + txt(454,173,'20',10,'rgba(107,135,173,.38)') +
    box(530,156,82,34,'rgba(127,90,240,.04)','rgba(255,255,255,.03)') + txt(540,173,'21',10,'rgba(107,135,173,.38)') +
    // Row 4 (days 22-28): past — dimmed
    box(14,194,82,34,'rgba(127,90,240,.04)','rgba(255,255,255,.03)') + txt(24,211,'22',10,'rgba(107,135,173,.38)') +
    box(100,194,82,34,'rgba(255,255,255,.01)','rgba(255,255,255,.03)') + txt(110,211,'23',10,'rgba(107,135,173,.38)') +
    box(186,194,82,34,'rgba(255,255,255,.01)','rgba(255,255,255,.03)') + txt(196,211,'24',10,'rgba(107,135,173,.38)') +
    box(272,194,82,34,'rgba(255,255,255,.01)','rgba(255,255,255,.03)') + txt(282,211,'25',10,'rgba(107,135,173,.38)') +
    box(358,194,82,34,'rgba(255,255,255,.01)','rgba(255,255,255,.03)') + txt(368,211,'26',10,'rgba(107,135,173,.38)') +
    box(444,194,82,34,'rgba(255,255,255,.01)','rgba(255,255,255,.03)') + txt(454,211,'27',10,'rgba(107,135,173,.38)') +
    box(530,194,82,34,'rgba(127,90,240,.04)','rgba(255,255,255,.03)') + txt(540,211,'28',10,'rgba(107,135,173,.38)') +
    // Row 5: Fr 29 (past) + Sa 30 TODAY
    box(444,232,82,34,'rgba(255,255,255,.01)','rgba(255,255,255,.03)') + txt(454,249,'29',10,'rgba(107,135,173,.38)') +
    box(530,232,82,34,'rgba(0,229,192,.1)','rgba(0,229,192,.45)') +
    '<circle cx="548" cy="249" r="11" fill="rgba(0,229,192,.25)" stroke="#00e5c0" stroke-width="1.5"/>' +
    txt(548,253,'30',9,'#00e5c0','middle') +
    box(560,234,48,10,'rgba(0,229,192,.32)','none') + txt(584,242,'TODAY',7,'#00e5c0','middle') +
    // Callout tags
    tag(60,48,1) + tag(548,249,2) + tag(24,169,3) + tag(370,130,4)
  );

  var MOCK_TASKS = wf(620, 220,
    box(0,0,620,220,'#142238','rgba(255,255,255,.05)') +
    txt(20,28,'TASKS',13,'#fff') + txt(20,46,'Personal to-do list',10,'#9aa7bd') +
    box(510,16,90,24,'#00e5c0','#00e5c0') + txt(555,32,'+ Add Task',9,'#0a1628','middle') +
    // Filter pills
    box(20,56,55,22,'rgba(0,229,192,.2)','rgba(0,229,192,.3)') + txt(47,71,'All',10,'#00e5c0','middle') +
    box(80,56,65,22,'rgba(255,255,255,.04)') + txt(112,71,'Open',10,'#9aa7bd','middle') +
    box(150,56,75,22,'rgba(255,255,255,.04)') + txt(187,71,'Done',10,'#9aa7bd','middle') +
    // Task rows
    box(20,90,580,120) +
    box(36,104,14,14,'rgba(255,255,255,.04)','rgba(255,255,255,.18)') +
    txt(60,116,'Follow up with Bloom on Q3 volume',11,'#fff') + box(440,108,90,16,'rgba(26,111,255,.12)','rgba(26,111,255,.3)') + txt(485,120,'Bloom Functional',9,'#6b9fff','middle') +
    box(540,108,55,16,'rgba(245,200,66,.12)','rgba(245,200,66,.3)') + txt(567,120,'due today',9,'#f5c842','middle') +
    box(36,134,14,14,'#00e5c0','#00e5c0') + txt(43,144,'✓',10,'#0a1628','middle') +
    txt(60,146,'Send tour confirmation to Verde',11,'#9aa7bd','start') +
    '<line x1="60" y1="142" x2="380" y2="142" stroke="#9aa7bd" stroke-opacity=".5"/>' +
    txt(440,146,'completed yesterday',9,'#9aa7bd') +
    box(36,164,14,14,'rgba(255,255,255,.04)','rgba(255,255,255,.18)') +
    txt(60,176,'Reply to NorthWave intro email',11,'#fff') + box(440,168,90,16,'rgba(26,111,255,.12)','rgba(26,111,255,.3)') + txt(485,180,'NorthWave',9,'#6b9fff','middle') +
    box(36,194,14,14,'rgba(255,255,255,.04)','rgba(255,255,255,.18)') +
    txt(60,206,'Order more 12oz Sleek cans',11,'#fff') + txt(440,206,'no client',9,'#9aa7bd') +
    tag(510,16,1) + tag(36,104,2) + tag(540,108,3)
  );

  var MOCK_INVENTORY = wf(620, 220,
    box(0,0,620,220,'#142238','rgba(255,255,255,.05)') +
    txt(20,28,'INVENTORY',13,'#fff') + txt(20,46,'Stock tracker',10,'#9aa7bd') +
    box(510,16,90,24,'#00e5c0','#00e5c0') + txt(555,32,'+ Add Item',9,'#0a1628','middle') +
    box(20,60,580,150) +
    '<line x1="20" y1="88" x2="600" y2="88" stroke="rgba(255,255,255,.06)"/>' +
    txt(30,80,'Item',9,'#9aa7bd') + txt(280,80,'Quantity',9,'#9aa7bd') + txt(380,80,'Unit',9,'#9aa7bd') + txt(470,80,'Low at',9,'#9aa7bd') + txt(550,80,'Status',9,'#9aa7bd') +
    txt(30,108,'12oz Standard Cans',11,'#fff') + txt(280,108,'1,200',11,'#00e5c0') + txt(380,108,'cases',10,'#cfd9e6') + txt(470,108,'200',10,'#9aa7bd') +
    box(540,98,50,16,'rgba(34,197,94,.15)','rgba(34,197,94,.3)') + txt(565,110,'OK',9,'#22c55e','middle') +
    txt(30,138,'CO₂ Gas',11,'#fff') + txt(280,138,'2',11,'#f5c842') + txt(380,138,'tanks',10,'#cfd9e6') + txt(470,138,'3',10,'#9aa7bd') +
    box(540,128,50,16,'rgba(245,200,66,.15)','rgba(245,200,66,.3)') + txt(565,140,'LOW',9,'#f5c842','middle') +
    txt(30,168,'PakTech Handles',11,'#fff') + txt(280,168,'500',11,'#00e5c0') + txt(380,168,'bags',10,'#cfd9e6') + txt(470,168,'100',10,'#9aa7bd') +
    box(540,158,50,16,'rgba(34,197,94,.15)','rgba(34,197,94,.3)') + txt(565,170,'OK',9,'#22c55e','middle') +
    txt(30,196,'750ml Bottles',11,'#fff') + txt(280,196,'220',11,'#00e5c0') + txt(380,196,'cases',10,'#cfd9e6') + txt(470,196,'50',10,'#9aa7bd') +
    box(540,186,50,16,'rgba(34,197,94,.15)','rgba(34,197,94,.3)') + txt(565,198,'OK',9,'#22c55e','middle') +
    tag(510,16,1) + tag(540,138,2)
  );

  var MOCK_CUSTOMERS = wf(620, 200,
    box(0,0,620,200,'#142238','rgba(255,255,255,.05)') +
    txt(20,28,'CUSTOMER LOGINS',13,'#fff') + txt(20,46,'Portal access for your clients',10,'#9aa7bd') +
    box(420,16,180,24,'#00e5c0','#00e5c0') + txt(510,32,'📧 Send Onboarding Email',9,'#0a1628','middle') +
    box(20,60,580,120) +
    '<line x1="20" y1="88" x2="600" y2="88" stroke="rgba(255,255,255,.06)"/>' +
    txt(30,80,'Name',9,'#9aa7bd') + txt(220,80,'Email',9,'#9aa7bd') + txt(390,80,'Created',9,'#9aa7bd') + txt(500,80,'Actions',9,'#9aa7bd') +
    txt(30,108,'Jordan Mills',11,'#fff') + txt(220,108,'jordan@tidetaste.com',10,'#9aa7bd') + txt(390,108,'2026-05-10',10,'#9aa7bd') +
    box(500,98,55,16,'rgba(245,200,66,.12)','rgba(245,200,66,.3)') + txt(527,110,'reset',9,'#f5c842','middle') +
    box(560,98,40,16,'rgba(231,76,60,.15)','rgba(231,76,60,.3)') + txt(580,110,'remove',8,'#e74c3c','middle') +
    txt(30,140,'Riley Park',11,'#fff') + txt(220,140,'r.park@bloomfx.com',10,'#9aa7bd') + txt(390,140,'2026-05-08',10,'#9aa7bd') +
    box(500,130,55,16,'rgba(245,200,66,.12)','rgba(245,200,66,.3)') + txt(527,142,'reset',9,'#f5c842','middle') +
    box(560,130,40,16,'rgba(231,76,60,.15)','rgba(231,76,60,.3)') + txt(580,142,'remove',8,'#e74c3c','middle') +
    tag(420,16,1) + tag(500,108,2)
  );

  var MOCK_SETTINGS = wf(620, 320,
    box(0,0,620,320,'#142238','rgba(255,255,255,.05)') +
    txt(20,28,'CRM AREA',13,'#9aa7bd') + txt(20,46,'(any panel)',10,'#9aa7bd') +
    // Floating 🤖 FAB bottom-right
    '<circle cx="560" cy="270" r="26" fill="url(#fabGrad)"/>' +
    '<defs><linearGradient id="fabGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#00e5c0"/><stop offset="100%" stop-color="#1a6fff"/></linearGradient></defs>' +
    txt(560,277,'🤖',18,'#0a1628','middle') +
    // Popout menu above the FAB
    box(420,60,180,200) +
    txt(515,80,'AI tools',10,'#9aa7bd','middle') +
    box(432,90,156,22,'rgba(0,229,192,.06)') + txt(440,105,'💰 Estimate Quote',10,'#00e5c0') +
    box(432,116,156,22,'rgba(0,229,192,.06)') + txt(440,131,'🧾 Draft Invoice',10,'#00e5c0') +
    box(432,142,156,22,'rgba(0,229,192,.06)') + txt(440,157,'📝 Meeting Notes',10,'#00e5c0') +
    box(432,168,156,22,'rgba(0,229,192,.06)') + txt(440,183,'✉️ Draft Email',10,'#00e5c0') +
    box(432,194,156,22,'rgba(0,229,192,.06)') + txt(440,209,'📧 Mailgun Settings',10,'#00e5c0') +
    box(432,220,156,22,'rgba(0,229,192,.06)') + txt(440,235,'🤖 AI Settings',10,'#00e5c0') +
    box(432,246,156,22,'rgba(231,76,60,.08)','rgba(231,76,60,.3)') + txt(440,261,'🗑️ Clear cache',10,'#ff8579') +
    // Arrow from popout to FAB
    '<line x1="560" y1="262" x2="540" y2="245" stroke="rgba(255,255,255,.2)" stroke-dasharray="3,3"/>' +
    tag(560,247,1) + tag(515,60,2)
  );

  var SEC_OVERVIEW =
    wf(620, 220,
      box(0,0,140,220,'#142238','rgba(255,255,255,.05)') +
      txt(15,22,'GOOD LIQUID',9,'#00e5c0') +
      txt(15,40,'• Dashboard',11,'#9aa7bd') +
      txt(15,58,'• Clients',11,'#9aa7bd') +
      txt(15,76,'• Pipeline',11,'#9aa7bd') +
      txt(15,94,'• Invoices',11,'#9aa7bd') +
      txt(15,112,'• Compliance',11,'#9aa7bd') +
      txt(15,130,'• Production',11,'#9aa7bd') +
      txt(15,148,'• Reports',11,'#9aa7bd') +
      box(0,158,140,62,'#1a3c30','rgba(0,229,192,.2)') +
      txt(15,174,'── AI ──',9,'#00e5c0') +
      txt(15,192,'💬 AI Chat',11,'#00e5c0') +
      txt(15,210,'🤖 AI Tools',11,'#00e5c0') +
      box(155,10,450,200,'#0d1e35','rgba(255,255,255,.05)') +
      txt(170,30,'GOOD LIQUID BEV CO  ·  CRM',13,'#fff') +
      box(170,46,130,36,'#1a2c48','rgba(0,229,192,.15)') + txt(180,64,'Ctrl+K',11,'#00e5c0') + txt(180,78,'Quick search',9,'#9aa7bd') +
      box(310,46,130,36,'#1a2c48','rgba(107,159,255,.15)') + txt(320,64,'?',11,'#6b9fff') + txt(320,78,'Help panel',9,'#9aa7bd') +
      box(450,46,145,36,'#1a2c48','rgba(245,200,66,.15)') + txt(460,64,'🤖 AI Tools FAB',11,'#f5c842') + txt(460,78,'Bottom-right',9,'#9aa7bd') +
      txt(170,110,'All data syncs across devices via Supabase',10,'#9aa7bd') +
      txt(170,128,'Tasks · Calendar · Activity — per device (localStorage)',10,'#9aa7bd') +
      tag(141,170,1) + tag(310,46,2) + tag(450,46,3)
    ) +
    '<div style="font-size:11px;color:#9aa7bd;margin-bottom:6px">Numbered callouts on the wireframe above:</div>' +
    bullets([
      '<b>(1) AI section in the sidebar</b> — click <b>💬 AI Chat</b> for the full-page conversational assistant or <b>🤖 AI Tools</b> for the categorised panel with 30+ tools across 6 categories (Invoicing, Clients, Pipeline, Compliance, Production, Marketing).',
      '<b>(2) Quick search (Ctrl+K)</b> — jump to any invoice, client, deal, or user by name from anywhere in the app.',
      '<b>(3) Help panel (?)</b> — press ? any time or click ❓ Help in the topbar. Opens to the section matching the page you\'re on.',
      '<b>Data sync:</b> invoices, clients, deals, referrers, referrals, and user profiles all live in Supabase and sync across devices. Tasks, calendar, notifications, and the activity feed live in localStorage (per device).'
    ]);

  var SEC_DASHBOARD = MOCK_DASHBOARD +
    '<div style="font-size:11px;color:#9aa7bd;margin-bottom:6px">Numbered callouts on the wireframe above:</div>' +
    bullets([
      '<b>(1) Top metrics row</b> — Total collected (paid YTD), Pending, Overdue, Active brands.',
      '<b>(2) Second KPI row</b> — Avg invoice value, Outstanding ($ pending + overdue), Avg days to paid, Quotes pending.',
      '<b>(3) Revenue by service chart</b> — bar chart split by Canning / R&D / Bottling / Consulting. Mixed-service invoices split per line item.',
      '<b>(4) Recent activity feed</b> — last few CRM actions; click to jump to the related screen.',
      '<b>(5) System Health widget</b> (admin only) — ✓ or ✗ for Supabase Auth, Mailgun key, AI key, audit_log table, client-docs bucket. Each ✗ has a one-click fix button.'
    ]) +
    '<h4 style="margin:20px 0 8px;font-size:13px;letter-spacing:1.5px;color:#00e5c0">📊 OPEN PIPELINE WIDGET (NEW)</h4>' +
    wf(400, 140,
      box(0,0,400,140,'#142238','rgba(255,255,255,.05)') +
      txt(20,24,'OPEN PIPELINE',10,'#9aa7bd') +
      txt(200,56,'$500K',22,'#00e5c0','middle') +
      txt(200,76,'raw value across 8 open deals',9,'#9aa7bd','middle') +
      txt(200,98,'Weighted: $142K',13,'#f5c842','middle') +
      txt(200,114,'at default stage probabilities',9,'#9aa7bd','middle') +
      box(20,122,80,12,'rgba(107,159,255,.4)','none') + txt(20,138,'Prospecting',8,'#9aa7bd') +
      box(108,122,60,12,'rgba(245,200,66,.4)','none') + txt(108,138,'Proposal',8,'#9aa7bd') +
      box(176,122,40,12,'rgba(231,76,60,.4)','none') + txt(176,138,'Negotiation',8,'#9aa7bd') +
      box(224,122,30,12,'rgba(95,207,158,.4)','none') + txt(224,138,'Closed',8,'#9aa7bd') +
      tag(130,56,1) + tag(130,98,2)
    ) +
    bullets([
      '<b>(1) Raw pipeline value</b> — the sum of all deal values for every open deal (Prospecting + Proposal + Negotiation). No probability weighting applied.',
      '<b>(2) Weighted pipeline value</b> — each deal\'s value multiplied by its stage probability percentage, then summed. Gives a more conservative revenue forecast.',
      '<b>Stage probability defaults</b>: Prospecting 20%, Proposal 50%, Negotiation 75%, Closed Won 100%. You can override the probability on individual deals in the deal detail modal.',
      '<b>Stage bars</b> — the colour bars below the number show the proportion of pipeline value sitting in each stage at a glance.'
    ]);

  var SEC_DAILY_DIGEST =
    wf(620, 240,
      box(0,0,620,240,'#0a1628','rgba(255,255,255,.05)') +
      box(0,0,620,40,'#142238','rgba(0,229,192,.3)') +
      txt(20,26,'📨 Good Liquid Daily Digest  ·  Fri, May 29 2026  ·  7:00 AM',11,'#00e5c0') +
      box(20,54,130,64,'#1a2c48','rgba(95,207,158,.2)') + txt(30,72,'COLLECTED (24h)',8,'#9aa7bd') + txt(30,96,'$3,125',14,'#5fcf9e') + txt(30,112,'1 payment',8,'#9aa7bd') +
      box(160,54,130,64,'#1a2c48','rgba(245,200,66,.2)') + txt(170,72,'NEW INVOICES',8,'#9aa7bd') + txt(170,96,'2',14,'#f5c842') + txt(170,112,'$6,820 total',8,'#9aa7bd') +
      box(300,54,130,64,'#1a2c48','rgba(196,181,253,.2)') + txt(310,72,'OPEN REQUESTS',8,'#9aa7bd') + txt(310,96,'3',14,'#c4b5fd') + txt(310,112,'1 new today',8,'#9aa7bd') +
      box(440,54,160,64,'#1a2c48','rgba(231,76,60,.2)') + txt(450,72,'A/R OUTSTANDING',8,'#9aa7bd') + txt(450,96,'$14.2K',14,'#e74c3c') + txt(450,112,'$5K overdue',8,'#9aa7bd') +
      box(20,132,580,22,'#142238','rgba(255,255,255,.05)') + txt(30,148,'💰 Payments received (1)',10,'#5fcf9e') +
      box(20,162,580,22,'#142238','rgba(255,255,255,.05)') + txt(30,178,'🧾 New invoices (2)',10,'#f5c842') +
      box(20,192,580,22,'#142238','rgba(255,255,255,.05)') + txt(30,208,'📩 Customer requests (3)',10,'#c4b5fd') +
      box(20,222,580,14,'#142238','rgba(255,255,255,.05)') + txt(30,233,'🏭 Production stage changes',10,'#9aa7bd') +
      tag(20,54,1) + tag(160,54,2) + tag(300,54,3) + tag(440,54,4)
    ) +
    '<div style="font-size:11px;color:#9aa7bd;margin-bottom:6px">Numbered callouts on the wireframe above:</div>' +
    bullets([
    '<b>What it is</b>: a single morning email that summarizes the past 24 hours of CRM activity so you start the day knowing where things stand without opening the app.',
    '<b>Schedule</b>: fires automatically at <b>7:00 AM ET / 11:00 UTC</b> via pg_cron + the deployed <code>daily-digest</code> Edge Function. If nothing happened in the last 24 hours, the email is suppressed (no daily "nothing happened" spam).',
    '<b>Recipients</b>: every <code>profiles</code> row where <code>role</code> is <code>admin</code> or <code>staff</code> AND <code>notify_daily_digest = true</code> (the column is default-true). To opt a staff user out, open <b>🔑 Users & permissions</b> → click their row → uncheck "📨 Send Daily Digest email at 7am" in the purple <b>NOTIFICATIONS</b> panel.',
    '<b>What\'s in it</b>: 4 KPI tiles up top — Collected (24h), New invoices, Open customer requests, A/R outstanding (with overdue $). Then expandable sections for: payments received, new invoices, customer requests, production-run stage changes, new clients.',
    '<b>📨 Send digest button</b> (admin top-right) — bypasses the cron schedule and fires the digest right now. Useful for testing after a big day or before a board meeting. Shows the recipient/sent/failed counts in an alert.',
    '<b>Audit trail</b>: every send (manual or scheduled) inserts a <code>daily_digest_sent</code> row into <code>audit_log</code> with full counts, so you can verify the morning email actually went out.'
  ]);

  var SEC_INVOICES = MOCK_INVOICES +
    '<div style="font-size:11px;color:#9aa7bd;margin-bottom:6px">Numbered callouts on the wireframe above:</div>' +
    bullets([
      '<b>(1) + New invoice</b> — opens the builder modal.',
      '<b>(2) 📊 Export CSV</b> — downloads every non-quote invoice as CSV (drop into QuickBooks or hand to your accountant).',
      '<b>(3) 📊 Activity</b> — opens the Email Activity view across <i>every</i> invoice (sent / delivered / opened / clicked / bounced). See the <a href="#help-email-activity" style="color:#00e5c0">Email Activity</a> section for details.',
      '<b>(4) 📧 Send overdue reminders</b> — confirms, then emails every overdue client at once using Mailgun + your email signature.',
      '<b>(5) Status filter pills</b> — All / Draft / Pending / Paid / Overdue / Quote.',
      '<b>(6) Row actions</b> — 💳 opens the Stripe pay link for that invoice; 👁 opens the invoice detail.',
      '<b>(7) → Invoice button</b> — appears on quote-status rows. One-click conversion from "quote" to billable "pending".',
      '<b>On the invoice detail header</b> you now also have: ✏️ <b>Edit</b> (reopens the builder), 📧 <b>Send Invoice</b> (composer with To/Cc/Bcc + Stripe pay link), 📊 <b>Activity</b> (this invoice\'s sends only), 📅 <b>Schedule</b> (queue a future reminder). See the relevant sections in this guide.'
    ]) +
    '<h4 style="margin:20px 0 8px;font-size:13px;letter-spacing:1.5px;color:#00e5c0">💳 ACCOUNTING TOOLBAR (NEW)</h4>' +
    bullets([
      '<b>Where to find it</b>: a row of 5 buttons appears directly below the INVOICES header, above the search bar.',
      '<b>💰 Revenue by Client</b> — horizontal bar chart of total paid revenue per client (top 12). Great for quarterly reviews.',
      '<b>📈 Cash Flow</b> — bar chart of all pending + overdue invoices grouped by due month. Shows what\'s expected to come in and when.',
      '<b>🔄 Recurring</b> — manage recurring invoice templates. Set a client, amount, frequency (weekly / monthly / quarterly / annually) and start date. Invoices are generated automatically each cycle. Pause or resume any template at any time.',
      '<b>📝 Credit Memo</b> — issue a credit against a client\'s balance (return, discount, over-billing correction). Creates a negative-amount invoice with prefix CM-YYYY-XXXX, status paid, so it flows into the Statement of Account automatically.',
      '<b>💸 Expenses</b> — log business expenses (vendor, amount, category, date, optional client tag). Categories include Ingredients, Packaging, Equipment, Labor, Shipping, Marketing, and more. This-month total shown at a glance.'
    ]) +
    '<h4 style="margin:20px 0 8px;font-size:13px;letter-spacing:1.5px;color:#f5c842">🧾 INVOICE DETAIL — ACCOUNTING ACTIONS (NEW)</h4>' +
    bullets([
      '<b>💵 Record Payment</b> — open any invoice → click Record Payment in the action row. Log partial or full payments with method (Check / Wire / ACH / Cash / Stripe / Other) and an optional reference / check number. Payment history is shown above the form. When the balance hits $0 the invoice auto-marks paid and you\'re offered a receipt email.',
      '<b>🚫 Void</b> — permanently voids an invoice. You\'ll be prompted for a reason. Sets status to "voided" with a timestamp. Cannot be undone.',
      '<b>📋 Collect</b> — only appears on past-due invoices. Schedules a 4-step automated email sequence: gentle reminder (day 3), firm reminder (day 14), urgent notice (day 30), final notice (day 45). Shows the client\'s email on file before confirming.',
      '<b>⚠️ Late fee banner</b> — a red banner automatically appears at the top of any overdue invoice showing the number of days overdue and the suggested late fee (1.5%/month). Click <b>Add to Invoice</b> to append it as a line item.',
      '<b>⏰ Quote expired banner</b> — a yellow banner appears on any quote that is 30+ days old, prompting you to send an updated quote or convert to an invoice.'
    ]) +
    /* ── A/R aging + bulk + auto-overdue (PR 1 of 2026-05-20 enhancement series) ── */
    '<h4 style="margin:20px 0 8px;font-size:13px;letter-spacing:1.5px;color:#f5c842">📋 A/R AGING REPORT (NEW)</h4>' +
    wf(620, 200,
      box(0,0,620,200,'#142238','rgba(255,255,255,.05)') +
      txt(20,28,'📋 A/R Aging',13,'#f5c842') +
      txt(20,46,'Total outstanding: $2.3K',10,'#9aa7bd') +
      box(20,60,110,80,'#1a2c48','rgba(95,207,158,.3)') + txt(30,82,'CURRENT',9,'#5fcf9e') + txt(30,108,'$0',16,'#fff') + txt(30,128,'0 invoices',9,'#9aa7bd') +
      box(140,60,110,80,'#1a2c48','rgba(107,159,255,.3)') + txt(150,82,'1–30 d',9,'#6b9fff') + txt(150,108,'$813',14,'#fff') + txt(150,128,'1 invoice',9,'#9aa7bd') +
      box(260,60,110,80,'#1a2c48','rgba(245,200,66,.3)') + txt(270,82,'31–60 d',9,'#f5c842') + txt(270,108,'$1.5K',14,'#fff') + txt(270,128,'1 invoice',9,'#9aa7bd') +
      box(380,60,110,80,'#1a2c48','rgba(255,154,60,.3)') + txt(390,82,'61–90 d',9,'#ff9a3c') + txt(390,108,'$0',16,'#fff') + txt(390,128,'0 invoices',9,'#9aa7bd') +
      box(500,60,100,80,'#1a2c48','rgba(231,76,60,.3)') + txt(510,82,'90+ d',9,'#e74c3c') + txt(510,108,'$0',16,'#fff') + txt(510,128,'0 invoices',9,'#9aa7bd') +
      box(20,160,580,28,'#243a56','rgba(245,200,66,.3)') + txt(30,178,'📋 A/R Aging — Full Drill-Down (per-client roll-up, sorted worst-aged first)',10,'#f5c842')
    ) +
    bullets([
      '<b>Where to find it</b>: open <b>Reports</b> (sidebar or top toolbar). The aging strip is at the bottom of the modal, above the Insights/Close buttons.',
      '<b>The 5 buckets</b>: Current (not yet due), 1–30, 31–60, 61–90, 90+ days past due. Each tile shows total $ outstanding + invoice count.',
      '<b>Drill-down</b>: click <b>📋 A/R Aging — Full Drill-Down</b> to open a per-client roll-up. Every client with at least one unpaid invoice shows on its own row with bucket breakdown + worst-aged days. Sorted worst-first. Click a row to open that client\'s detail.',
      '<b>How "overdue" is decided</b>: a nightly pg_cron job (2 AM UTC) flips any <code>status=pending</code> invoice with <code>due_date &lt; today</code> to <code>status=overdue</code> in the database. No manual marking needed. The dashboard, aging report, and overdue-reminder blast all read the same column.'
    ]) +
    '<h4 style="margin:20px 0 8px;font-size:13px;letter-spacing:1.5px;color:#00e5c0">✓ BULK MARK PAID (NEW)</h4>' +
    wf(620, 180,
      box(0,0,620,180,'#142238','rgba(255,255,255,.05)') +
      txt(20,28,'INVOICES',13,'#fff') +
      box(20,46,580,40,'#243a56','rgba(0,229,192,.3)') +
      txt(30,68,'☐  2 selected  ·  Total: $2.3K',11,'#00e5c0') +
      box(440,54,90,24,'#5fcf9e','none') + txt(485,71,'✓ Mark 2 paid',10,'#0a1628','middle') +
      box(540,54,55,24,'#1a2c48','rgba(255,255,255,.1)') + txt(568,71,'Clear',10,'#9aa7bd','middle') +
      box(20,100,580,28,'#1a2c48','rgba(255,255,255,.05)') +
      txt(40,118,'☑',11,'#00e5c0') + txt(80,118,'GL-1002  ·  Lotus nutra  ·  $1,500',10,'#fff') + box(540,108,55,18,'#e74c3c','none') + txt(568,121,'overdue',9,'#fff','middle') +
      box(20,138,580,28,'#1a2c48','rgba(255,255,255,.05)') +
      txt(40,156,'☑',11,'#00e5c0') + txt(80,156,'GL-1003  ·  Lotus nutra  ·  $812.50',10,'#fff') + box(540,146,55,18,'#e74c3c','none') + txt(568,159,'overdue',9,'#fff','middle')
    ) +
    bullets([
      '<b>How it works</b>: a checkbox column on the Invoices table. Tick rows → bulk-action bar appears showing "N selected · Total: $X" with a <b>✓ Mark N paid</b> button.',
      '<b>Select all</b>: tick the header checkbox to select every visible (filtered) row at once.',
      '<b>Confirm dialog</b> warns "use only for offline payments — won\'t charge Stripe." Stripe-paid invoices flip automatically via the webhook; this button is for cash/check/wire receipts you book manually.',
      '<b>What it sets</b>: <code>status=paid</code>, <code>paid_at=now()</code>, <code>paid_method=manual</code>. The dashboard and A/R aging report update instantly.'
    ]) +
    /* ── SMS overdue reminders ── */
    '<h4 style="margin:20px 0 8px;font-size:13px;letter-spacing:1.5px;color:#f5c842">📱 SMS OVERDUE REMINDERS (NEW)</h4>' +
    bullets([
      '<b>Where to find it</b>: when an invoice is past due, a yellow <b>📱</b> button appears on its row (next to <b>Paid</b> / <b>👁</b> / <b>🗑</b>). Click it to text the client a short reminder.',
      '<b>What gets sent</b>: a single SMS reading "Good Liquid Bev Co: friendly reminder — invoice GL-XXXX for $X was due [date]. Pay online: [link] — Reply STOP to opt out." Routes through the deployed <code>send-sms</code> Edge Function so the Twilio credentials never touch the browser.',
      '<b>Opt-in gating</b> (legally required): the button only fires for clients who have explicitly opted in. Open the <b>✏️ Edit Client</b> modal → check <b>📱 SMS overdue reminders</b> under MAIN POINT OF CONTACT before sending. Without that flag, clicking 📱 shows an alert and does nothing.',
      '<b>Phone normalization</b>: bare 10-digit US numbers get auto-prefixed with <code>+1</code>; any other format must be valid E.164 (e.g. <code>+44…</code>) or the send is refused.',
      '<b>Logging</b>: every SMS attempt (success or failure) inserts a <code>followup_log</code> row with <code>channel=\'sms\'</code> so the invoice\'s follow-up history shows email + SMS interleaved. Also logged through the audit trail as <code>invoice_sms_reminder</code>.'
    ]);

  var SEC_NEWINV = MOCK_NEWINV +
    '<div style="font-size:11px;color:#9aa7bd;margin-bottom:6px">Numbered callouts on the wireframe above:</div>' +
    bullets([
      '<b>(1) Client / date / invoice #</b> — client dropdown is required; date defaults to today; invoice # auto-generates.',
      '<b>(2) Add-line buttons</b> — Canning, Bottling, R&D / IP, Production Hours, Custom. Canning & Bottling auto-tier their per-unit rate from Supabase canning_rates / bottling_rates. <b>Per-client overrides win</b> — if a client has a negotiated rate in <code>client_rate_overrides</code>, the builder uses that flat rate instead of the public tier ladder (a yellow "💵 N custom rates applied" badge appears next to "NEW INVOICE" so staff can see they\'re in effect).',
      '<b>(3) Line rows</b> — change qty inline; per-case / per-unit price + totals update live. Every line type has a <b>Description (optional)</b> input — type free-form notes like "Mango flavor" or "pilot batch" and they\'re appended to the saved line with an em-dash. The ↺ arrow under a Canning/Bottling price resets it to the catalog rate. The X on the right removes a line.',
      '<b>(4) Discount + total</b> — enter a discount percent; subtotal and grand total recompute live.',
      '<b>(5) Save buttons</b> — 💾 Save Invoice (status=pending), 📤 <b>Save & Send</b> (saves then opens the Send Invoice composer pre-filled), 💾 Save as Quote (status=quote), 📄 Save & Export PDF (real invoice PDF), 📋 Export as Quote (PDF only with 30-day validity, no DB save).',
      '<b>Edit existing invoices</b>: open any saved invoice → click ✏️ <b>Edit</b> on the header. The builder reopens with the client / date / lines / discount / addons / notes all pre-filled. Hitting Save updates the same Supabase row (no duplicate). Status is preserved — editing a paid invoice doesn\'t flip it back to pending.',
      '<b>PO Number (optional)</b> — a "PO Number" field appears at the top of the builder. Enter the customer\'s purchase order number if they require it on the invoice. Saved to the invoice record and visible on the invoice detail.'
    ]) +
    '<h4 style="margin:20px 0 8px;font-size:13px;letter-spacing:1.5px;color:#f5c842">⚠️ CREDIT LIMIT WARNING (NEW)</h4>' +
    bullets([
      '<b>What it does</b>: if a client has a credit limit set, a yellow warning banner appears inside the builder when their outstanding balance (pending + overdue invoices) reaches 80% or more of the limit.',
      '<b>Setting a credit limit</b>: go to <b>Clients</b> → open the client → <b>✏️ Edit Client</b>. The credit limit field stores a dollar amount in the client record.',
      '<b>Example</b>: client has a $5,000 limit and $4,200 outstanding → builder shows "⚠️ Credit limit alert: [Client] has $4,200 outstanding of $5,000 limit (84%)."'
    ]);

  // ────────────────────────────────────────────────────────────
  // Send Invoice composer
  // ────────────────────────────────────────────────────────────
  var SEC_SEND_INVOICE =
    wf(620, 250,
      box(0,0,620,250,'#0a1628','rgba(255,255,255,.05)') +
      box(0,0,620,36,'#142238','rgba(255,255,255,.08)') +
      txt(20,23,'📧 Send Invoice  ·  GL-1004',13,'#fff') +
      txt(580,23,'✕',12,'#9aa7bd','end') +
      txt(20,56,'To',10,'#9aa7bd') + box(50,44,550,22,'#1a2c48','rgba(255,255,255,.1)') + txt(58,59,'brandon@client.com',10,'#cfd9e6') +
      txt(20,86,'Cc',10,'#9aa7bd') + box(50,74,550,22,'#1a2c48','rgba(255,255,255,.1)') + txt(58,89,'ap@client.com',10,'#9aa7bd') +
      txt(20,116,'Subject',10,'#9aa7bd') + box(70,104,530,22,'#1a2c48','rgba(255,255,255,.1)') + txt(78,119,'Invoice GL-1004 from Good Liquid Bev Co — $3,125.00',10,'#cfd9e6') +
      txt(20,146,'Message',10,'#9aa7bd') + box(70,134,530,52,'#1a2c48','rgba(255,255,255,.1)') + txt(78,152,'Hi Brandon, please find your invoice attached…',10,'#cfd9e6') +
      box(20,200,240,22,'#142238','rgba(245,200,66,.25)') + txt(30,215,'📝 Apply a template…',10,'#f5c842') +
      box(270,200,160,22,'#1a2c48','rgba(0,229,192,.2)') + txt(280,215,'🔗 Stripe pay link ✓',10,'#00e5c0') +
      box(440,200,80,22,'rgba(0,229,192,.1)','rgba(0,229,192,.4)') + txt(480,215,'🔗 Get link',10,'#00e5c0','middle') +
      box(440,228,160,18,'#1a6fff','none') + txt(520,240,'📤 Send via Mailgun',10,'#fff','middle') +
      tag(50,44,1) + tag(50,74,2) + tag(70,104,3) + tag(270,200,4) + tag(440,228,5)
    ) +
    '<div style="font-size:11px;color:#9aa7bd;margin-bottom:6px">Numbered callouts on the wireframe above:</div>' +
    bullets([
    '<b>Where to find it</b>: open any saved invoice → click the blue <b>📧 Send Invoice</b> button on the header. Also fires automatically when you click <b>📤 Save & Send</b> in the builder.',
    '<b>To / Cc / Bcc</b> — all three accept comma-separated addresses (e.g. <code>brandon@client.com, ap@client.com</code>). To is pre-filled with the client\'s primary email; Cc is pre-filled with every entry from the Additional Emails section on the client record.',
    '<b>📝 Apply a template…</b> — drop a saved template into the Subject + Message with one click. Variables like <code>{{client_name}} {{invoice_number}} {{amount}} {{due_date}}</code> are filled in automatically. <b>⚙ Manage</b> opens the template editor.',
    '<b>Subject + Message</b> — auto-generated defaults but fully editable. The message is added <i>above</i> the invoice in the email body.',
    '<b>▶ Preview embedded invoice</b> — collapsible pane that shows the invoice exactly as the recipient will see it (header, line items, totals, wire instructions, Pay button).',
    '<b>🔗 Get public link</b> — copies the customer portal URL to your clipboard without sending an email. Useful for posting the invoice link in Slack / Twilio / a follow-up text message.',
    '<b>📤 Send via Mailgun</b> — fires the email. Every send is logged to the Email Activity view automatically. The customer receives an HTML invoice with a green <b>💳 View Invoice & Pay Online</b> CTA button at the top and the wire instructions at the bottom.'
  ]);

  // ────────────────────────────────────────────────────────────
  // Customer portal
  // ────────────────────────────────────────────────────────────
  var SEC_CUSTOMER_PORTAL =
    '<h4 style="margin:4px 0 8px;font-size:13px;letter-spacing:1.5px;color:#00e5c0">🌐 FULL CUSTOMER PORTAL (LOGIN)</h4>' +
    wf(620, 360,
      box(0,0,620,360,'#0a1628','rgba(255,255,255,.05)') +
      box(0,0,620,40,'#142238','rgba(0,229,192,.3)') +
      txt(20,26,'GOOD LIQUID BEV CO  ·  Customer Portal',12,'#00e5c0') +
      txt(575,26,'⚙ Sign out',10,'#9aa7bd','end') +
      box(20,55,140,55,'#142238','rgba(245,200,66,.3)') + txt(28,72,'OPEN BALANCE',9,'#9aa7bd') + txt(28,95,'$1,500',14,'#f5c842') +
      box(170,55,140,55,'#142238','rgba(95,207,158,.3)') + txt(178,72,'PAID TO DATE',9,'#9aa7bd') + txt(178,95,'$3,125',14,'#5fcf9e') +
      box(320,55,140,55,'#142238','rgba(0,229,192,.3)') + txt(328,72,'TOTAL INVOICES',9,'#9aa7bd') + txt(328,95,'3',14,'#00e5c0') +
      box(20,125,140,52,'#142238','rgba(0,229,192,.18)') + txt(28,148,'🧪',16,'#fff') + txt(28,167,'Request samples',9,'#fff') +
      box(170,125,140,52,'#142238','rgba(0,229,192,.18)') + txt(178,148,'📦',16,'#fff') + txt(178,167,'Place an order',9,'#fff') +
      box(320,125,140,52,'#142238','rgba(0,229,192,.18)') + txt(328,148,'💬',16,'#fff') + txt(328,167,'Request a quote',9,'#fff') +
      box(470,125,140,52,'#142238','rgba(0,229,192,.18)') + txt(478,148,'❓',16,'#fff') + txt(478,167,'Ask a question',9,'#fff') +
      box(20,190,590,40,'#142238','rgba(0,229,192,.18)') + txt(30,210,'YOUR INVOICES',10,'#00e5c0') + txt(30,224,'GL-1004 · $3,125 · paid',10,'#fff') + box(470,200,55,20,'#2a1a3c','rgba(124,58,237,.5)') + txt(497,213,'📥 PDF',9,'#c4b5fd','middle') + box(530,200,75,20,'#1a3c30','rgba(0,229,192,.5)') + txt(567,213,'View',9,'#00e5c0','middle') +
      box(20,240,590,40,'#142238','rgba(107,159,255,.18)') + txt(30,260,'PRODUCTION RUNS',10,'#6b9fff') + txt(30,274,'Mango pilot · 100 cases · Sample stage',9,'#fff') +
      box(20,290,590,30,'#142238','rgba(245,200,66,.18)') + txt(30,309,'SAMPLE SHIPMENTS · 2 shipped · 1 delivered (trackable)',10,'#f5c842') +
      box(20,330,590,22,'#142238','rgba(95,207,158,.18)') + txt(30,346,'FORMULAS · 3 approved · view IDs, batch sizes, allergens',10,'#5fcf9e')
    ) +
    bullets([
      '<b>What it is</b>: a logged-in self-service portal for customers. URL: <code>https://goodliquidbevco.com/?portal=1</code>. Each customer gets their own login (Supabase Auth).',
      '<b>How a customer gets access</b>: open Clients → click <b>🔑 Invite Customer Login</b> on the client row (or via the global "🔑 Invite Customer Login" button on the Clients page). Pick the client, type their email, send. The customer gets an email with a link to set their own password and land on the portal.',
      '<b>What the customer sees</b>:',
      '&nbsp;&nbsp;<b>KPI tiles</b> — Open balance, Paid to date, Total invoices.',
      '&nbsp;&nbsp;<b>Quick-action tiles</b> (NEW) — 🧪 Request samples / 📦 Place an order / 💬 Request a quote / ❓ Ask a question. See the Customer Requests section for the inbox side.',
      '&nbsp;&nbsp;<b>Your Invoices</b> — every invoice on their account, with a 📥 PDF download button and a View/Pay button (opens the same Stripe Checkout flow as the public link).',
      '&nbsp;&nbsp;<b>Production Runs</b> — every batch tied to their <code>client_id</code> with stage badge (Discovery → Formulation → Sample → COA → Production → Ship) + format + case count + scheduled date.',
      '&nbsp;&nbsp;<b>Sample Shipments</b> — kind / qty / carrier / status + clickable tracking links to UPS/FedEx/USPS/DHL.',
      '&nbsp;&nbsp;<b>Formulas</b> — every formula on their account (drafts hidden) with name, version, batch size, target yield, allergens, status.',
      '&nbsp;&nbsp;<b>Allergen Declarations</b> — every signed declaration with View link.',
      '&nbsp;&nbsp;<b>Account Settings</b> — top-right link. Customer can update their own contact info, billing/shipping address, lift-gate flag, receiving hours, and change their password.',
      '<b>Security</b>: RLS scopes every read to <code>client_id = current_customer_client_id()</code>. A portal customer can never see another client\'s invoices, runs, formulas, samples, allergens, or requests — enforced by Postgres, not just the JS.',
      '<b>Multi-device</b>: portal customers can log in from phone, laptop, anywhere. Account-settings changes sync across devices instantly.'
    ]) +
    '<h4 style="margin:22px 0 8px;font-size:13px;letter-spacing:1.5px;color:#c4b5fd">🔗 PUBLIC INVOICE LINK (NO LOGIN)</h4>' +
    bullets([
      '<b>What it is</b>: a public, read-only page that renders a <i>single</i> invoice for a one-off send. URL format: <code>https://goodliquidbevco.com/?invoice_view=&lt;token&gt;</code>. No login required. Useful for first-time clients who don\'t have a portal account yet.',
      '<b>How a token is generated</b>: clicking 📧 <b>Send Invoice</b> auto-generates a token on the first send. Also accessible via the <b>🔗 Get public link</b> button in the composer.',
      '<b>What the customer sees</b>: the styled invoice + two payment buttons: 💳 Pay with Card (purple, 3% surcharge) and 🏦 Pay with ACH (teal, 0% surcharge). Each opens Stripe Checkout.',
      '<b>Save as PDF</b> — button on the page opens the browser print dialog.',
      '<b>Paid state</b> — once status flips to paid (auto via Stripe webhook OR manually via bulk-paid), the Pay buttons disappear and a "✓ Paid in full · Thank you" banner appears.',
      '<b>Revoking access</b> — clear the <code>share_token</code> column on the invoice row in Supabase. Anyone hitting the old URL sees "Invoice not found or revoked."'
    ]);

  // ────────────────────────────────────────────────────────────
  // Email templates
  // ────────────────────────────────────────────────────────────
  var SEC_EMAIL_TEMPLATES =
    wf(620, 200,
      box(0,0,200,200,'#142238','rgba(255,255,255,.05)') +
      txt(15,22,'TEMPLATES',10,'#00e5c0') +
      box(10,32,180,22,'#1a3c30','rgba(0,229,192,.3)') + txt(20,47,'Invoice send',10,'#fff') +
      box(10,58,180,22,'#1a2c48','rgba(255,255,255,.05)') + txt(20,73,'Follow-up — gentle',10,'#9aa7bd') +
      box(10,84,180,22,'#1a2c48','rgba(255,255,255,.05)') + txt(20,99,'Follow-up — firm',10,'#9aa7bd') +
      box(10,110,180,22,'#1a2c48','rgba(255,255,255,.05)') + txt(20,125,'Onboarding welcome',10,'#9aa7bd') +
      box(10,170,180,22,'rgba(0,229,192,.1)','rgba(0,229,192,.3)') + txt(100,185,'+ New template',10,'#00e5c0','middle') +
      box(205,10,405,180,'#0d1e35','rgba(255,255,255,.05)') +
      txt(215,26,'PREVIEW  ·  Invoice send',10,'#00e5c0') +
      txt(215,46,'Subject:',9,'#9aa7bd') + txt(275,46,'Invoice {{invoice_number}} from Good Liquid Bev Co',10,'#cfd9e6') +
      txt(215,68,'Body:',9,'#9aa7bd') +
      txt(215,84,'Hi {{client_name}}, please find your invoice for',10,'#9aa7bd') +
      txt(215,100,'{{amount}} attached. Payment is due {{due_date}}.',10,'#9aa7bd') +
      txt(215,116,'— {{my_name}}  ·  {{my_phone}}',10,'#9aa7bd') +
      box(490,164,110,22,'#1a6fff','none') + txt(545,179,'Apply template',9,'#fff','middle') +
      tag(10,32,1) + tag(490,164,2)
    ) +
    '<div style="font-size:11px;color:#9aa7bd;margin-bottom:6px">Numbered callouts on the wireframe above:</div>' +
    bullets([
    '<b>What it is</b>: a library of reusable email subjects + bodies. Apply one to any Send Invoice or AI Follow-Up composer with one click — variables fill in automatically.',
    '<b>Where to open the manager</b>: in any composer, click <b>📝 Apply a template…</b> → ⚙ <b>Manage</b>. Or open the browser console and run <code>glOpenEmailTemplates()</code>.',
    '<b>Starter templates seeded for you</b>: <i>Invoice send</i>, <i>Follow-up — gentle</i>, <i>Follow-up — firm</i>. You can add / edit / delete or mark inactive.',
    '<b>Variables you can use in subject + body</b>: <code>{{client_name}}</code> <code>{{invoice_number}}</code> <code>{{amount}}</code> <code>{{date}}</code> <code>{{due_date}}</code> <code>{{days_late}}</code> <code>{{my_name}}</code> <code>{{my_phone}}</code>. Anything else in <code>{{…}}</code> is left as-is.',
    '<b>Categories</b>: <code>invoice</code>, <code>followup</code>, <code>quote</code>, <code>onboarding</code>, <code>general</code>. The composer picker filters to the matching category + general.',
    '<b>Active toggle</b>: setting a template to Inactive hides it from the pickers but keeps it in the manager (in case you want to re-enable it later).'
  ]);

  // ────────────────────────────────────────────────────────────
  // Schedule follow-ups
  // ────────────────────────────────────────────────────────────
  var SEC_EMAIL_SCHEDULE =
    wf(620, 190,
      box(0,0,620,190,'#142238','rgba(255,255,255,.05)') +
      txt(20,24,'📅 SCHEDULED FOLLOW-UPS',12,'#fff') +
      box(20,36,580,24,'#0d1e35','rgba(255,255,255,.05)') +
      txt(30,52,'Invoice',10,'#9aa7bd') + txt(160,52,'To',10,'#9aa7bd') + txt(280,52,'Send at',10,'#9aa7bd') + txt(400,52,'Subject',10,'#9aa7bd') + txt(530,52,'Status',10,'#9aa7bd') +
      box(20,64,580,26,'#1a2c48','rgba(255,255,255,.05)') +
      txt(30,81,'GL-1004',10,'#00e5c0') + txt(160,81,'brandon@client.com',10,'#cfd9e6') + txt(280,81,'Jun 5  9:00 AM',10,'#cfd9e6') + txt(400,81,'Follow-up on GL-1004',10,'#cfd9e6') +
      box(530,68,68,18,'#1a3c30','rgba(0,229,192,.4)') + txt(564,80,'pending',9,'#00e5c0','middle') +
      box(20,96,580,26,'#1a2c48','rgba(255,255,255,.05)') +
      txt(30,113,'GL-1002',10,'#00e5c0') + txt(160,113,'ap@brand.com',10,'#cfd9e6') + txt(280,113,'Jun 2  9:00 AM',10,'#cfd9e6') + txt(400,113,'Friendly reminder GL-1002',10,'#cfd9e6') +
      box(530,100,55,18,'#1a3c30','rgba(95,207,158,.4)') + txt(557,112,'sent',9,'#5fcf9e','middle') +
      box(20,128,580,26,'#1a2c48','rgba(255,255,255,.05)') +
      txt(30,145,'GL-1001',10,'#00e5c0') + txt(160,145,'info@acme.com',10,'#cfd9e6') + txt(280,145,'May 28  9:00 AM',10,'#cfd9e6') + txt(400,145,'Invoice still outstanding',10,'#9aa7bd') +
      box(530,132,55,18,'#3d1a1a','rgba(231,76,60,.4)') + txt(557,144,'failed',9,'#e74c3c','middle') +
      tag(530,68,1) + tag(530,100,2) + tag(530,132,3)
    ) +
    '<div style="font-size:11px;color:#9aa7bd;margin-bottom:6px">Numbered callouts on the wireframe above:</div>' +
    bullets([
    '<b>What it is</b>: queue a follow-up email to send automatically on a future date / time. A Supabase Edge Function runs every 15 minutes and dispatches anything due.',
    '<b>How to schedule</b>: open any saved invoice → click the yellow <b>📅 Schedule</b> button on the header. A modal opens with To (pre-filled with client email), Send At (defaults to T+7 days, 9 AM), Subject, and Message (defaults to a reminder template).',
    '<b>What happens next</b>: a row is inserted into the <code>email_schedule</code> table with status=pending. The cron job picks it up at the scheduled time, sends via Mailgun, marks it as sent, and logs an entry in Email Activity.',
    '<b>If a send fails</b>: the worker retries twice before marking the row failed. The failure reason is stored on the row (<code>last_error</code> column).',
    '<b>To cancel a queued send</b>: open Supabase → <code>email_schedule</code> table → set the row\'s status to <code>cancelled</code>. (A UI for managing the queue is on the roadmap.)'
  ]);

  // ────────────────────────────────────────────────────────────
  // Email Activity
  // ────────────────────────────────────────────────────────────
  var SEC_EMAIL_ACTIVITY =
    wf(620, 200,
      box(0,0,620,200,'#142238','rgba(255,255,255,.05)') +
      txt(20,24,'📊 EMAIL ACTIVITY',12,'#fff') + txt(500,24,'All invoices',10,'#9aa7bd') +
      box(20,36,580,24,'#0d1e35','rgba(255,255,255,.05)') +
      txt(30,52,'To',10,'#9aa7bd') + txt(180,52,'Subject',10,'#9aa7bd') + txt(360,52,'Sent',10,'#9aa7bd') + txt(430,52,'Status',10,'#9aa7bd') + txt(530,52,'Opens',10,'#9aa7bd') +
      box(20,64,580,26,'#1a2c48','rgba(95,207,158,.05)') +
      txt(30,81,'brandon@client.com',10,'#cfd9e6') + txt(180,81,'Invoice GL-1004…',10,'#cfd9e6') + txt(360,81,'May 29 10:02',10,'#9aa7bd') +
      box(430,68,58,18,'#1a3c30','rgba(0,229,192,.4)') + txt(459,80,'clicked',9,'#00e5c0','middle') + txt(530,81,'3',10,'#5fcf9e') +
      box(20,96,580,26,'#1a2c48','rgba(107,159,255,.05)') +
      txt(30,113,'ap@brand.com',10,'#cfd9e6') + txt(180,113,'Follow-up GL-1002…',10,'#cfd9e6') + txt(360,113,'May 28 09:15',10,'#9aa7bd') +
      box(430,100,58,18,'#1a2c48','rgba(107,159,255,.4)') + txt(459,112,'opened',9,'#6b9fff','middle') + txt(530,113,'1',10,'#6b9fff') +
      box(20,128,580,26,'#1a2c48','rgba(245,200,66,.05)') +
      txt(30,145,'info@acme.com',10,'#cfd9e6') + txt(180,145,'Invoice GL-1001…',10,'#cfd9e6') + txt(360,145,'May 27 14:30',10,'#9aa7bd') +
      box(430,132,72,18,'#1a2c48','rgba(245,200,66,.4)') + txt(466,144,'delivered',9,'#f5c842','middle') + txt(530,145,'0',10,'#9aa7bd') +
      box(20,160,580,26,'#1a2c48','rgba(231,76,60,.05)') +
      txt(30,177,'noreply@old.co',10,'#9aa7bd') + txt(180,177,'Invoice GL-1000…',10,'#9aa7bd') + txt(360,177,'May 26 11:00',10,'#9aa7bd') +
      box(430,164,58,18,'#3d1a1a','rgba(231,76,60,.4)') + txt(459,176,'bounced',9,'#e74c3c','middle') + txt(530,177,'—',10,'#9aa7bd') +
      tag(430,68,1) + tag(430,100,2) + tag(430,132,3) + tag(430,164,4)
    ) +
    '<div style="font-size:11px;color:#9aa7bd;margin-bottom:6px">Numbered callouts on the wireframe above:</div>' +
    bullets([
    '<b>What it is</b>: a list of every email sent from the CRM with real-time status (sent → delivered → opened → clicked → bounced).',
    '<b>Two ways to open it</b>: <ol style="margin:4px 0 4px 18px;padding:0"><li>From the <b>Invoices</b> list page header: <b>📊 Activity</b> (shows every send across every invoice).</li><li>From a single invoice\'s detail header: <b>📊 Activity</b> (shows only that invoice\'s sends).</li></ol>',
    '<b>Status meanings</b>: <code>sent</code> (Mailgun accepted) → <code>delivered</code> (recipient mail server accepted) → <code>opened</code> (recipient opened the email) → <code>clicked</code> (recipient clicked a link in the email). <code>bounced</code> = permanent delivery failure; <code>failed</code> = Mailgun rejected the request.',
    '<b>How tracking works</b>: Mailgun fires webhooks at our <code>mailgun-webhook</code> Edge Function, which updates the matching row in <code>email_log</code>. Status changes are reflected the next time you open the Activity view (or refresh).',
    '<b>Auto-tagging</b>: when an email subject or body contains <code>GL-####</code>, the log row is automatically linked to that invoice. So sends from the Send Invoice composer show up in their invoice\'s Activity tab.',
    '<b>What\'s logged</b>: To, Cc, Bcc, subject, body preview (first 280 chars), status, sent timestamp, delivered timestamp, first open timestamp, open count, click count, bounce reason. Stored in the <code>email_log</code> table.'
  ]);

  // ────────────────────────────────────────────────────────────
  // Stripe payments
  // ────────────────────────────────────────────────────────────
  var SEC_STRIPE_PAY =
    wf(620, 200,
      box(0,0,620,200,'#0a1628','rgba(255,255,255,.05)') +
      txt(310,26,'INVOICE GL-1004  ·  $3,125.00',13,'#fff','middle') +
      txt(310,44,'Good Liquid Bev Co  →  Lotus Nutra',10,'#9aa7bd','middle') +
      box(60,60,220,100,'#1a2c48','rgba(107,159,255,.25)') +
      txt(170,88,'💳 Pay with Card',13,'#6b9fff','middle') +
      txt(170,108,'$3,218.75 (incl. 3% surcharge)',9,'#9aa7bd','middle') +
      txt(170,128,'Visa / Mastercard / Amex',9,'#9aa7bd','middle') +
      box(340,60,220,100,'#1a2c48','rgba(0,229,192,.25)') +
      txt(450,88,'🏦 Pay with ACH',13,'#00e5c0','middle') +
      txt(450,108,'$3,125.00 (no surcharge)',9,'#9aa7bd','middle') +
      txt(450,128,'US bank account (2-5 days)',9,'#9aa7bd','middle') +
      box(200,172,220,22,'rgba(0,229,192,.15)','rgba(0,229,192,.3)') +
      txt(310,187,'💳 Surcharge toggle',10,'#00e5c0','middle') +
      tag(60,60,1) + tag(340,60,2) + tag(200,172,3)
    ) +
    '<div style="font-size:11px;color:#9aa7bd;margin-bottom:6px">Numbered callouts on the wireframe above:</div>' +
    bullets([
    '<b>How customers pay</b>: every invoice email includes a green <b>💳 View Invoice & Pay Online</b> CTA button. Clicking it opens the customer portal page. From there the customer sees <b>💳 Pay with Card</b> (3% surcharge added as a separate line on the Stripe receipt) and <b>🏦 Pay with ACH</b> (0% surcharge).',
    '<b>Card vs ACH</b>: the surcharge only applies to card payments (per Visa / MC rules — that\'s why ACH is shown separately). The customer sees the surcharge broken out on Stripe\'s checkout page, so it\'s never a surprise charge.',
    '<b>From the admin side</b>: open any unpaid invoice → click <b>💳 Charge via Stripe</b> on the detail header. A picker lets you choose card / ACH / both and per-invoice surcharge override.',
    '<b>Test mode vs live</b>: currently using <code>sk_test_…</code> keys. To go live, register Visa/MC, swap in <code>sk_live_…</code> in the <code>STRIPE_SECRET_KEY</code> Edge Function secret, and redeploy the function. Stripe\'s test card <code>4242 4242 4242 4242</code> works for any expiry/CVC in test mode.',
    '<b>Marking the invoice paid</b>: <i>currently manual</i>. When you see a Stripe payout, click <b>✓ Mark paid</b> on the invoice detail header. Auto-marking via Stripe webhook is on the roadmap.',
    '<b>Receipts</b>: Stripe emails the customer a receipt automatically. They can also save the invoice as PDF from the customer portal.'
  ]);

  // ────────────────────────────────────────────────────────────
  // Compliance
  // ────────────────────────────────────────────────────────────
  var SEC_COMPLIANCE =
    wf(620, 244,
      box(0,0,620,244,'#0a1628','rgba(0,0,0,0)') +
      box(0,0,620,32,'#0d1e35','rgba(0,229,192,.12)') +
      txt(14,14,'📋 COMPLIANCE TASKS',11,'#00e5c0') +
      txt(14,28,'Sidebar → Compliance Tasks · 3 tabs: Today · Open/Unsigned · History',9,'#9aa7bd') +
      box(0,34,620,20,'#111e34','rgba(255,255,255,.05)') +
      txt(14,47,'TASK',8,'#7a8ba0') + txt(300,47,'FORM CODE',8,'#7a8ba0') + txt(430,47,'STATUS',8,'#7a8ba0') +
      box(0,56,620,26,'#0f1b30','rgba(95,207,158,.05)') +
      txt(14,73,'📦 Receiving inspection — LOT-2026-0628-CH-001',10,'#cfd9e6') + txt(300,73,'GMP-REC-001',9,'#f5c842') +
      box(430,60,80,18,'#1a3c30','rgba(0,229,192,.4)') + txt(470,72,'✓ Done',9,'#00e5c0','middle') + tag(590,69,1) +
      box(0,84,620,26,'#111e34','rgba(245,200,66,.05)') +
      txt(14,101,'🧫 Fermentation pH check — Run #14',10,'#cfd9e6') + txt(300,101,'FSP-PC-005',9,'#f5c842') +
      box(430,88,80,18,'#3d2f0a','rgba(245,200,66,.4)') + txt(470,100,'⏳ Due now',9,'#f5c842','middle') + tag(590,97,2) +
      box(0,112,620,26,'#0f1b30','rgba(231,76,60,.05)') +
      txt(14,129,'🧬 Listeria swab — Zone 1 food-contact',10,'#cfd9e6') + txt(300,129,'FSP-SAN-001',9,'#f5c842') +
      box(430,116,80,18,'#3d1a1a','rgba(231,76,60,.4)') + txt(470,128,'Overdue',9,'#e74c3c','middle') + tag(590,125,3) +
      box(0,140,620,26,'#111e34','rgba(255,255,255,.03)') +
      txt(14,157,'🌡 HTST pasteurization log — Run #14',10,'#cfd9e6') + txt(300,157,'FSP-PC-001',9,'#f5c842') +
      box(430,144,80,18,'#1a3c30','rgba(0,229,192,.4)') + txt(470,156,'✓ Done',9,'#00e5c0','middle') +
      box(0,168,620,26,'#111e34','rgba(255,255,255,.02)') +
      txt(14,185,'🏷 Label verification — Run #14',10,'#cfd9e6') + txt(300,185,'GMP-LAB-001',9,'#f5c842') +
      box(430,172,80,18,'#1a3c30','rgba(0,229,192,.4)') + txt(470,184,'✓ Done',9,'#00e5c0','middle') +
      box(0,196,620,48,'#0d1e35','rgba(196,181,253,.08)') +
      txt(14,210,'HEADER ACTIONS:',8,'#c4b5fd') +
      txt(14,226,'📤 Export  🎲 Mock recall  🪟 Glass break  🔒 Inspector link  🥜 Allergen decl  📊 Monthly report  🎯 CCP Limits  🆕 New Hold Tag',8,'#9aa7bd')
    ) +
    '<div style="font-size:11px;color:#9aa7bd;margin:4px 0 8px">Callouts: ① Completed task — record stored in Supabase with PCQI timestamp · ② Due now — ▶ Start button opens the form · ③ Overdue — turns red after its window passes.</div>' +
    bullets([
      '<b>What it is</b>: a 21 CFR Part 117 + Part 11-compliant logging system built into the CRM. Three Supabase tables back it: <code>compliance_tasks</code> (the daily schedule), <code>compliance_records</code> (all FDA form entries, append-only), <code>hold_tags</code> (product holds that block shipping).',
      '<b>Where to find it</b>: left sidebar → 📋 <b>Compliance Tasks</b> · 🚫 <b>Hold Tags</b> · 🧼 <b>CIP / Sanitation Log</b> · 📊 <b>Defects / NCRs</b>.',
      '<b>Three tabs on the Compliance page</b>: <b>Today</b> — tasks queued for today based on your production schedule, each with a ▶ Start button that opens the correct form. <b>Open / Unsigned</b> — saved drafts and complete records waiting for PCQI sign-off. <b>History</b> — all signed records, filterable by form code.',
      '<b>Auto-generated tasks</b>: creating a Production Run automatically queues the right forms: Pre-Op Sanitation, Label Verification, the correct CCP logs (HTST, hot fill, UV, fermentation, can seam — based on process type), post-run CIP, and Batch Record. A Receiving task is queued for any run that involves an incoming delivery.',
      '<b>Add manual task</b>: <b>+ Add manual task</b> button → pick any built form from the list to log a record not triggered by the schedule (spot-check receiving, walk-in delivery, unscheduled training, etc.).',
      '<b>Header buttons</b>: 📤 Export · 🚨 SMS alerts · 🎲 Mock recall · 🪟 Glass break · 🗄 Archive old · 📄 Documents · 🔒 Inspector link · 🥜 Allergen decl · 📥 Import training CSV · 📧 Send digest · 📊 Monthly report · ⚙️ Applicability · 🎯 CCP Limits · 🆕 New Hold Tag.',
      '<b>Inspector mode</b>: <b>🔒 Inspector link</b> → enter the inspector\'s name + agency + token hours → you get a copyable URL. In Inspector Mode the page shows a red banner and every input is disabled — the inspector can only view and print. Tokens auto-expire.',
      '<b>Monthly PDF report</b>: <b>📊 Monthly report</b> generates a printable summary of all compliance records for the last 30 days — ready to go into an audit binder.',
      '<b>Multi-PCQI signing</b>: any signed record gets a ✍️ <b>Add second PCQI signature</b> button. Captures typed name + timestamp for dual-sign critical records.',
      '<b>Allergen declarations</b>: <b>🥜 Allergen decl</b> → pick a client → fill all 9 FASTER Act allergens + custom claims → Save + Share gives a public URL the client can bookmark.',
      '<b>CCP Limits</b>: <b>🎯 CCP Limits</b> shows all Critical Control Point thresholds (HTST ≥ 165°F, hot fill ≥ 185°F, UV ≥ 40 mJ/cm², fermentation pH ≤ 4.6). Editing a limit requires PCQI sign-off and is logged to the audit trail.',
      '<b>AI root-cause suggester</b>: on any Defect / NCR modal, click 🤖 <b>Suggest root cause</b> → sends defect type + description to Claude → returns root cause, corrective action, and preventive action you can copy in.',
      '<b>Camera scanning</b>: 🥫 <b>Scan Lot QR</b> opens the device camera and decodes lot barcodes (native BarcodeDetector — Chrome / Edge). 📷 <b>Scan COA</b> on the receiving form snaps a Certificate of Analysis — Claude Vision auto-fills lot number, vendor, dates, and test results.',
      '<b>Multi-facility</b>: a 🏭 chip top-right shows the active facility (default GL-PALMETTO). Every new record / task / hold tag is auto-tagged with that facility.'
    ]) +

    '<h4 style="margin:22px 0 8px;font-size:13px;letter-spacing:1.5px;color:#00e5c0">📦 GMP-REC-001 · RECEIVING INSPECTION &amp; COA REVIEW</h4>' +
    wf(620, 370,
      box(0,0,620,370,'#0a1628','rgba(0,0,0,0)') +
      box(0,0,620,40,'#0d1e35','rgba(0,229,192,.14)') +
      txt(14,16,'GMP-REC-001 · RECEIVING INSPECTION &amp; COA REVIEW',11,'#00e5c0') +
      txt(14,32,'Required for every incoming delivery  ·  21 CFR 117.80',9,'#9aa7bd') +
      txt(14,54,'FIELD',8,'#7a8ba0') + txt(240,54,'EXAMPLE VALUE',8,'#7a8ba0') + txt(490,54,'NOTES',8,'#7a8ba0') +
      box(0,60,620,26,'#111e34','rgba(255,255,255,.03)') +
      txt(14,77,'Supplier',9,'#9aa7bd') +
      box(240,63,370,18,'#0d1e35','rgba(255,255,255,.12)') + txt(246,75,'Hop Valley Brewing Co.',9,'#cfd9e6') +
      box(0,88,620,26,'#0f1b30','rgba(255,255,255,.02)') +
      txt(14,105,'Ingredient / material',9,'#9aa7bd') +
      box(240,91,370,18,'#0d1e35','rgba(255,255,255,.12)') + txt(246,103,'Cascade Hops (pellet)',9,'#cfd9e6') +
      box(0,116,620,26,'#111e34','rgba(255,255,255,.03)') +
      txt(14,133,'Lot number',9,'#9aa7bd') +
      box(240,119,370,18,'#0d1e35','rgba(255,255,255,.12)') + txt(246,131,'LOT-2026-0628-CH-001',9,'#cfd9e6') +
      box(0,144,620,26,'#0c201a','rgba(95,207,158,.08)') +
      txt(14,161,'Expiration / best-by date',9,'#9aa7bd') +
      box(240,147,180,18,'#0d1e35','rgba(255,255,255,.12)') + txt(246,159,'2027-03-15',9,'#cfd9e6') +
      box(430,149,34,14,'#1a3c30','rgba(95,207,158,.5)') + txt(447,159,'NEW',7,'#5fcf9e','middle') +
      tag(596,157,1) +
      box(0,172,620,26,'#0f1b30','rgba(255,255,255,.02)') +
      txt(14,189,'Quantity received',9,'#9aa7bd') +
      box(240,175,370,18,'#0d1e35','rgba(255,255,255,.12)') + txt(246,187,'50 lbs',9,'#cfd9e6') +
      box(0,200,620,26,'#0c201a','rgba(95,207,158,.08)') +
      txt(14,217,'Temperature on receipt (°F)',9,'#9aa7bd') +
      box(240,203,80,18,'#0d1e35','rgba(255,255,255,.12)') + txt(246,215,'38',9,'#cfd9e6') +
      txt(328,215,'leave blank if ambient / dry goods',8,'#7a8ba0') +
      box(430,205,34,14,'#1a3c30','rgba(95,207,158,.5)') + txt(447,215,'NEW',7,'#5fcf9e','middle') +
      tag(596,213,2) +
      box(0,228,620,26,'#0c201a','rgba(95,207,158,.08)') +
      txt(14,245,'Temperature within acceptable range?',9,'#9aa7bd') +
      box(240,231,28,18,'#1a3c30','rgba(95,207,158,.35)') + txt(254,244,'Y',9,'#5fcf9e','middle') +
      box(270,231,28,18,'#0d1e35','rgba(255,255,255,.1)') + txt(284,244,'N',9,'#9aa7bd','middle') +
      txt(306,245,'N → auto Hold Tag (same as quarantine)',8,'#ff8579') +
      box(430,233,34,14,'#1a3c30','rgba(95,207,158,.5)') + txt(447,243,'NEW',7,'#5fcf9e','middle') +
      box(0,256,620,26,'#0c201a','rgba(95,207,158,.08)') +
      txt(14,273,'Storage location assigned',9,'#9aa7bd') +
      box(240,259,370,18,'#0d1e35','rgba(255,255,255,.12)') + txt(246,271,'Walk-in cooler A2',9,'#cfd9e6') +
      box(430,261,34,14,'#1a3c30','rgba(95,207,158,.5)') + txt(447,271,'NEW',7,'#5fcf9e','middle') +
      tag(596,269,3) +
      box(0,284,620,26,'#111e34','rgba(255,255,255,.03)') +
      txt(14,301,'COA received?',9,'#9aa7bd') +
      box(240,287,28,18,'#1a3c30','rgba(95,207,158,.35)') + txt(254,300,'Y',9,'#5fcf9e','middle') +
      box(270,287,28,18,'#0d1e35','rgba(255,255,255,.1)') + txt(284,300,'N',9,'#9aa7bd','middle') +
      txt(306,300,'also ask: COA lot matches received lot?',8,'#7a8ba0') +
      box(0,312,620,26,'#0f1b30','rgba(255,255,255,.02)') +
      txt(14,329,'Visual condition OK?',9,'#9aa7bd') +
      box(240,315,28,18,'#1a3c30','rgba(95,207,158,.35)') + txt(254,328,'Y',9,'#5fcf9e','middle') +
      box(270,315,28,18,'#0d1e35','rgba(255,255,255,.1)') + txt(284,328,'N',9,'#9aa7bd','middle') +
      box(0,340,620,26,'#111e34','rgba(255,255,255,.03)') +
      txt(14,357,'Disposition',9,'#9aa7bd') +
      box(240,343,120,18,'#0d1e35','rgba(255,255,255,.12)') + txt(246,355,'Accept',9,'#5fcf9e') +
      txt(368,355,'or: Quarantine — Hold Tag needed',8,'#ff8579') +
      tag(596,353,4) +
      box(240,370,110,18,'#0d1e35','rgba(255,255,255,.1)') + txt(295,382,'Save draft',8,'#9aa7bd','middle') +
      box(358,370,140,18,'#1a3c30','rgba(95,207,158,.4)') + txt(428,382,'✓ Sign &amp; complete',8,'#5fcf9e','middle')
    ) +
    '<div style="font-size:11px;color:#9aa7bd;margin:4px 0 8px">Callouts on the form above:</div>' +
    bullets([
      '① <b>Expiration / best-by date</b> (NEW) — captures the date from the supplier\'s label. Enables FIFO tracking and flags aged inventory. Leave blank for materials with no expiration date (e.g., some packaging).',
      '② <b>Temperature on receipt (°F)</b> (NEW) — enter the measured temperature for cold-chain deliveries: cultures, botanical extracts, certain natural flavors. Leave blank for ambient or dry goods. The number itself is just recorded — the next field decides pass/fail.',
      '<b>Temperature within acceptable range? Y/N</b> (NEW) — this is the pass/fail gate. Marking N when a temperature is entered automatically creates a Hold Tag and flags a deviation, exactly like a Quarantine disposition. A 38°F yogurt culture delivery might be in range; a 55°F one would not be.',
      '③ <b>Storage location assigned</b> (NEW) — where the material is physically placed after receipt (Walk-in cooler A2, dry storage bay 3, quarantine area, etc.). Required so any inspector can locate a specific lot. If disposition is Quarantine, document the quarantine area here.',
      '④ <b>Disposition → Quarantine = auto Hold Tag</b> — selecting Quarantine (or marking temperature out of range) creates a Hold Tag automatically, tagged with the ingredient name, lot number, and failure reason. The material stays blocked from production use until a PCQI dispositions it from the Hold Tags page.',
      '<b>COA lot match check</b> — the form separately asks "COA lot matches received lot?" A supplier sometimes sends a generic COA from a prior run. Mismatches flag a deviation even if the material looks fine visually.',
      '<b>How to open it</b>: Sidebar → Compliance Tasks → Today tab → ▶ Start on the Receiving task. Or: <b>+ Add manual task</b> → 📦 Receiving Inspection. On mobile, 🥫 Scan Lot QR pre-fills the lot number from a delivery barcode; 📷 Scan COA snaps the Certificate of Analysis and auto-fills lot, vendor, and dates.',
      '<b>Save draft vs. Sign &amp; complete</b>: Save draft stores the record without a PCQI signature (status = draft — appears in the Open / Unsigned tab). Sign &amp; complete records your name and timestamps the sign-off (status = signed — counts toward your FDA audit trail).'
    ]) +

    '<h4 style="margin:22px 0 8px;font-size:13px;letter-spacing:1.5px;color:#ff8579">🚨 GMP-GHP-001 · GLASS BREAKAGE EVENT</h4>' +
    wf(620, 248,
      box(0,0,620,248,'#0a1628','rgba(0,0,0,0)') +
      box(0,0,620,40,'#1a0d0d','rgba(231,76,60,.18)') +
      txt(14,16,'🚨 GMP-GHP-001 · GLASS BREAKAGE EVENT',11,'#ff8579') +
      txt(14,32,'STOP line · quarantine 10-ft radius · full cleanup · PCQI sign before restart',9,'#9aa7bd') +
      box(0,42,620,26,'#111e34','rgba(255,255,255,.03)') +
      txt(14,59,'Time of breakage',9,'#9aa7bd') +
      box(240,45,300,18,'#0d1e35','rgba(255,255,255,.12)') + txt(246,57,'2026-06-28  10:22 AM',9,'#cfd9e6') +
      box(0,70,620,26,'#0f1b30','rgba(255,255,255,.02)') +
      txt(14,87,'Location in facility',9,'#9aa7bd') +
      box(240,73,300,18,'#0d1e35','rgba(255,255,255,.12)') + txt(246,85,'Filling Line 1, nozzle station 3',9,'#cfd9e6') +
      box(0,98,620,26,'#111e34','rgba(255,255,255,.03)') +
      txt(14,115,'Source of breakage',9,'#9aa7bd') +
      box(240,101,300,18,'#0d1e35','rgba(255,255,255,.12)') + txt(246,113,'Filled glass bottle',9,'#cfd9e6') +
      box(0,126,620,26,'#0f1b30','rgba(255,255,255,.02)') +
      txt(14,143,'Estimated radius cleared (ft)',9,'#9aa7bd') +
      box(240,129,80,18,'#0d1e35','rgba(255,255,255,.12)') + txt(246,141,'10',9,'#cfd9e6') +
      txt(328,141,'minimum — increase if contamination visible beyond',8,'#7a8ba0') +
      box(0,154,620,26,'#111e34','rgba(255,255,255,.03)') +
      txt(14,171,'Was line stopped?',9,'#9aa7bd') +
      box(240,157,120,18,'#1a0d0d','rgba(231,76,60,.3)') + txt(300,170,'Yes — immediately',9,'#ff8579','middle') + tag(590,167,1) +
      box(0,182,620,26,'#0f1b30','rgba(255,255,255,.02)') +
      txt(14,199,'Cleanup method',9,'#9aa7bd') +
      box(240,185,370,18,'#0d1e35','rgba(255,255,255,.12)') + txt(246,197,'Sweep + vacuum + full CIP all food-contact surfaces',9,'#9aa7bd') +
      box(0,210,620,38,'#1a0d0d','rgba(231,76,60,.1)') +
      txt(14,224,'🚨 Auto Hold Tag created for all product within cleared radius',9,'#ff8579') +
      txt(14,238,'PCQI must disposition hold from Hold Tags page before product can ship',8,'#9aa7bd') +
      tag(590,224,2)
    ) +
    '<div style="font-size:11px;color:#9aa7bd;margin:4px 0 8px">Callouts: ① Line stop is required — document whether the line was immediately halted · ② Auto Hold Tag is created on save for all product within the cleared radius.</div>' +
    bullets([
      '<b>How to open</b>: Compliance Tasks page → header row → <b>🪟 Glass break</b> button (red).',
      '<b>When to use</b>: any glass breakage in the production area — filled or empty bottles, sight glasses, sample containers, lab glassware, overhead lighting. When in doubt, log it.',
      '<b>10-foot rule</b>: the form pre-fills a 10-ft minimum radius. Enter the actual radius cleared. All product within that radius is automatically placed on hold.',
      '<b>Auto Hold Tag</b>: saving the form immediately creates a Hold Tag for affected product. The PCQI must disposition the hold (release / reprocess / destroy) from the Hold Tags page before that product can ship.',
      '<b>PCQI sign before restart</b>: the form saves as signed with your PCQI identity and timestamp. Do not restart the line until a second person physically verifies the area is clear — document that in the Notes field or add a second PCQI signature on the record.',
      '<b>Cleanup instructions</b>: the Cleanup method field pre-fills with the standard procedure (sweep all visible shards, vacuum, full CIP all food-contact surfaces, magnetic sweep around the line). Edit as needed for your situation and save the updated text as the permanent record.'
    ]) +

    '<h4 style="margin:22px 0 8px;font-size:13px;letter-spacing:1.5px;color:#00e5c0">🎯 MOCK RECALL SIMULATOR</h4>' +
    wf(620, 236,
      box(0,0,620,236,'#0a1628','rgba(0,0,0,0)') +
      box(0,0,620,40,'#0d1e35','rgba(0,229,192,.12)') +
      txt(14,16,'🎯 MOCK RECALL SIMULATOR',12,'#00e5c0') +
      txt(14,32,'Evidence for FSP-VER-002 · must trace a lot to all customers under 4 hours',9,'#9aa7bd') +
      txt(14,58,'Lot number to recall',9,'#9aa7bd') +
      box(14,64,370,22,'#0d1e35','rgba(255,255,255,.12)') +
      txt(20,79,'GLBC-JUC01-20260516-L1-001',9,'#cfd9e6') +
      box(392,64,84,22,'rgba(0,229,192,.06)','rgba(0,229,192,.2)') +
      txt(434,79,'🎲 Pick lot',9,'#00e5c0','middle') +
      box(484,64,124,22,'rgba(0,229,192,.18)','rgba(0,229,192,.45)') +
      txt(546,79,'▶ Start timer',9,'#00e5c0','middle') +
      txt(14,108,'⏱  Trace complete — elapsed: 2.4 seconds',12,'#00e5c0') +
      box(14,116,592,22,'#0d2430','rgba(0,229,192,.1)') +
      txt(20,131,'Lot GLBC-JUC01-20260516-L1-001  →  3 distribution records  ·  260 cs total',9,'#cfd9e6') +
      box(14,140,592,20,'#111e34','rgba(255,255,255,.04)') +
      txt(20,153,'📦  Whole Foods Tampa  ·  120 cs  ·  shipped Jun 2 2026  ·  BOL 7742',9,'#9aa7bd') +
      box(14,162,592,20,'#0f1b30','rgba(255,255,255,.03)') +
      txt(20,175,'📦  Winn-Dixie Sarasota  ·  60 cs  ·  shipped Jun 4 2026  ·  BOL 7751',9,'#9aa7bd') +
      box(14,184,592,20,'#111e34','rgba(255,255,255,.04)') +
      txt(20,197,'📦  Total Wine Orlando  ·  80 cs  ·  shipped Jun 6 2026  ·  BOL 7763',9,'#9aa7bd') +
      box(420,206,192,26,'#1a3c30','rgba(95,207,158,.35)') +
      txt(516,223,'✓ PASS — under 4-hour target',9,'#5fcf9e','middle') +
      box(14,206,400,26,'#0d1e35','rgba(255,255,255,.06)') +
      txt(20,223,'🖨  Print mock recall report  (files result in FSP-VER-002 annual review)',8,'#9aa7bd')
    ) +
    bullets([
      '<b>How to open</b>: Compliance Tasks page → header row → <b>🎲 Mock recall</b> button.',
      '<b>What it does</b>: pulls every GMP-DIST-001 distribution record and compliance record that references the lot number you enter. Lists every customer who received product from that lot, the quantity shipped, ship date, and Bill of Lading number. Times the entire trace in real-time.',
      '<b>Pick a recent lot</b>: click 🎲 <b>Pick lot</b> to auto-fill the most recently shipped lot number from GMP-DIST-001 records — useful if you\'re doing a scheduled drill and don\'t have a specific lot in mind.',
      '<b>FDA requirement</b>: 21 CFR Part 117 requires documented ability to identify and locate all affected product within 4 hours of a recall decision. The PASS / FAIL badge confirms whether your trace met that threshold.',
      '<b>Print report</b>: 🖨 <b>Print mock recall report</b> generates a formatted summary — lot, all customers, quantities, elapsed time, and a statement that this was a mock exercise. File it in your audit binder.',
      '<b>Annual FSP Review</b>: the Annual FSP Review form (FSP-VER-002) has a "Mock recall conducted this year? Date + 4-hr result?" field. Enter the date and elapsed time from the printout. Together they satisfy the HACCP plan\'s annual verification requirement for traceability.'
    ]) +

    '<h4 style="margin:22px 0 8px;font-size:13px;letter-spacing:1.5px;color:#c4b5fd">📋 ALL GMP / HACCP FORMS — QUICK REFERENCE</h4>' +
    '<div style="overflow-x:auto;margin:8px 0 4px">' +
    '<table style="width:100%;border-collapse:collapse;font-size:12px;color:#cfd9e6">' +
    '<thead><tr style="background:#0d1e35;border-bottom:2px solid rgba(0,229,192,.25)">' +
    '<th style="text-align:left;padding:8px 10px;color:#00e5c0;font-size:11px;letter-spacing:1px;white-space:nowrap">FORM CODE</th>' +
    '<th style="text-align:left;padding:8px 10px;color:#00e5c0;font-size:11px;letter-spacing:1px">NAME</th>' +
    '<th style="text-align:left;padding:8px 10px;color:#00e5c0;font-size:11px;letter-spacing:1px">WHAT IT CAPTURES</th>' +
    '<th style="text-align:left;padding:8px 10px;color:#00e5c0;font-size:11px;letter-spacing:1px;white-space:nowrap">FREQUENCY</th>' +
    '</tr></thead><tbody>' +
    '<tr style="background:#111e34"><td style="padding:7px 10px;color:#f5c842;font-family:monospace;white-space:nowrap">GMP-REC-001</td><td style="padding:7px 10px;white-space:nowrap">📦 Receiving Inspection</td><td style="padding:7px 10px;color:#9aa7bd">Supplier, lot, <b style="color:#5fcf9e">expiration date</b>, qty, <b style="color:#5fcf9e">temperature on receipt</b>, <b style="color:#5fcf9e">storage location</b>, COA, visual check, disposition</td><td style="padding:7px 10px;color:#9aa7bd;white-space:nowrap">Every delivery</td></tr>' +
    '<tr style="background:#0f1b30"><td style="padding:7px 10px;color:#f5c842;font-family:monospace;white-space:nowrap">GMP-LAB-001</td><td style="padding:7px 10px;white-space:nowrap">🏷 Label Verification</td><td style="padding:7px 10px;color:#9aa7bd">8-point label check: name, weight, ingredients, all 9 FASTER Act allergens, best-by coding, lot code, TTB COLA, co-pack spec match</td><td style="padding:7px 10px;color:#9aa7bd;white-space:nowrap">Every run</td></tr>' +
    '<tr style="background:#111e34"><td style="padding:7px 10px;color:#f5c842;font-family:monospace;white-space:nowrap">GMP-INSP-001</td><td style="padding:7px 10px;white-space:nowrap">🔍 Pre-Op Sanitation</td><td style="padding:7px 10px;color:#9aa7bd">Equipment cleanliness, allergen status, sanitation sign-off before each run begins</td><td style="padding:7px 10px;color:#9aa7bd;white-space:nowrap">Daily / per run</td></tr>' +
    '<tr style="background:#0f1b30"><td style="padding:7px 10px;color:#f5c842;font-family:monospace;white-space:nowrap">GMP-SAN-002</td><td style="padding:7px 10px;white-space:nowrap">🧼 CIP / Sanitation Log</td><td style="padding:7px 10px;color:#9aa7bd">9-step CIP cycle with temperature, chemical type, concentration, and pass/fail per step</td><td style="padding:7px 10px;color:#9aa7bd;white-space:nowrap">Post-run</td></tr>' +
    '<tr style="background:#111e34"><td style="padding:7px 10px;color:#f5c842;font-family:monospace;white-space:nowrap">GMP-CAL-001</td><td style="padding:7px 10px;white-space:nowrap">📐 Equipment Calibration</td><td style="padding:7px 10px;color:#9aa7bd">pH meter, thermometers, scales, UV sensors, FDD, conductivity meter — NIST-traceable reference, pass/fail, next-due date</td><td style="padding:7px 10px;color:#9aa7bd;white-space:nowrap">Monthly minimum</td></tr>' +
    '<tr style="background:#0f1b30"><td style="padding:7px 10px;color:#f5c842;font-family:monospace;white-space:nowrap">GMP-DIST-001</td><td style="padding:7px 10px;white-space:nowrap">🚚 Distribution / Traceability</td><td style="padding:7px 10px;color:#9aa7bd">Lot, qty, customer name + address, contact, ship method, BOL number — backs up the 4-hour mock recall</td><td style="padding:7px 10px;color:#9aa7bd;white-space:nowrap">Every shipment</td></tr>' +
    '<tr style="background:#111e34"><td style="padding:7px 10px;color:#f5c842;font-family:monospace;white-space:nowrap">GMP-HR-001</td><td style="padding:7px 10px;white-space:nowrap">🤒 Illness Exclusion</td><td style="padding:7px 10px;color:#9aa7bd">Symptoms (all 7 FDA exclusion conditions), exclusion decision, return-to-work date, medical clearance</td><td style="padding:7px 10px;color:#9aa7bd;white-space:nowrap">Upon event</td></tr>' +
    '<tr style="background:#0f1b30"><td style="padding:7px 10px;color:#f5c842;font-family:monospace;white-space:nowrap">GMP-TR-001</td><td style="padding:7px 10px;white-space:nowrap">🎓 Employee Training</td><td style="padding:7px 10px;color:#9aa7bd">Topic, training method, duration, trainer, tested Y/N, pass/fail, employee signature on file, next-due date</td><td style="padding:7px 10px;color:#9aa7bd;white-space:nowrap">Each event + annual</td></tr>' +
    '<tr style="background:#111e34"><td style="padding:7px 10px;color:#f5c842;font-family:monospace;white-space:nowrap">GMP-GHP-001</td><td style="padding:7px 10px;white-space:nowrap">🚨 Glass Breakage</td><td style="padding:7px 10px;color:#9aa7bd">Time, location, source, radius cleared, line stopped Y/N, cleanup method, auto Hold Tag for affected product</td><td style="padding:7px 10px;color:#9aa7bd;white-space:nowrap">Upon event</td></tr>' +
    '<tr style="background:#0f1b30"><td style="padding:7px 10px;color:#f5c842;font-family:monospace;white-space:nowrap">GMP-QC-001</td><td style="padding:7px 10px;white-space:nowrap">🚫 Hold Tags</td><td style="padding:7px 10px;color:#9aa7bd">Product name, lot, qty held, location, reason, hazard type, PCQI notification, disposition (release / reprocess / destroy)</td><td style="padding:7px 10px;color:#9aa7bd;white-space:nowrap">Upon hold event</td></tr>' +
    '<tr style="background:#111e34"><td style="padding:7px 10px;color:#6b9fff;font-family:monospace;white-space:nowrap">FSP-PC-001</td><td style="padding:7px 10px;white-space:nowrap">🌡 HTST Pasteurization (CCP-1)</td><td style="padding:7px 10px;color:#9aa7bd">Hold-tube temp (critical limit ≥ 165°F), cold-side temp, FDD status (OK / DIVERT), holding time, corrective action</td><td style="padding:7px 10px;color:#9aa7bd;white-space:nowrap">Every run</td></tr>' +
    '<tr style="background:#0f1b30"><td style="padding:7px 10px;color:#6b9fff;font-family:monospace;white-space:nowrap">FSP-PC-002</td><td style="padding:7px 10px;white-space:nowrap">🔥 Hot Fill (CCP-2)</td><td style="padding:7px 10px;color:#9aa7bd">Fill nozzle temperature (critical limit ≥ 185°F), thermocouple calibration date, corrective action if below CL</td><td style="padding:7px 10px;color:#9aa7bd;white-space:nowrap">Every run</td></tr>' +
    '<tr style="background:#111e34"><td style="padding:7px 10px;color:#6b9fff;font-family:monospace;white-space:nowrap">FSP-PC-003</td><td style="padding:7px 10px;white-space:nowrap">🥫 Can Seam (CCP-4)</td><td style="padding:7px 10px;color:#9aa7bd">Seam thickness, length, body hook, cover hook, overlap % — must meet BCMA specification</td><td style="padding:7px 10px;color:#9aa7bd;white-space:nowrap">Every 30 min (canning)</td></tr>' +
    '<tr style="background:#0f1b30"><td style="padding:7px 10px;color:#6b9fff;font-family:monospace;white-space:nowrap">FSP-PC-004</td><td style="padding:7px 10px;white-space:nowrap">💡 UV Water Treatment (CCP-3)</td><td style="padding:7px 10px;color:#9aa7bd">UV dose (critical limit ≥ 40 mJ/cm²), intensity sensor reading, corrective action</td><td style="padding:7px 10px;color:#9aa7bd;white-space:nowrap">Hourly during production</td></tr>' +
    '<tr style="background:#111e34"><td style="padding:7px 10px;color:#6b9fff;font-family:monospace;white-space:nowrap">FSP-PC-005</td><td style="padding:7px 10px;white-space:nowrap">🧫 Fermentation (CCP-A)</td><td style="padding:7px 10px;color:#9aa7bd">Final pH (critical limit ≤ 4.6) and ABV ≥ spec — multiple readings per batch</td><td style="padding:7px 10px;color:#9aa7bd;white-space:nowrap">Per batch</td></tr>' +
    '<tr style="background:#0f1b30"><td style="padding:7px 10px;color:#c4b5fd;font-family:monospace;white-space:nowrap">FSP-SAN-001</td><td style="padding:7px 10px;white-space:nowrap">🧬 Environmental Monitoring</td><td style="padding:7px 10px;color:#9aa7bd">Listeria spp. + L. monocytogenes swabs across 4 zones. Zone 1-2 positive = stop production, deep clean, intensified sanitation, re-swab</td><td style="padding:7px 10px;color:#9aa7bd;white-space:nowrap">Monthly minimum</td></tr>' +
    '<tr style="background:#111e34"><td style="padding:7px 10px;color:#c4b5fd;font-family:monospace;white-space:nowrap">FSP-SC-002</td><td style="padding:7px 10px;white-space:nowrap">📋 Supplier COA Review</td><td style="padding:7px 10px;color:#9aa7bd">Micro results, heavy metals, pesticides, potency / identity (botanicals), PCQI sign-off for high-risk lots</td><td style="padding:7px 10px;color:#9aa7bd;white-space:nowrap">Per high-risk lot</td></tr>' +
    '<tr style="background:#0f1b30"><td style="padding:7px 10px;color:#c4b5fd;font-family:monospace;white-space:nowrap">FSP-VER-002</td><td style="padding:7px 10px;white-space:nowrap">📅 Annual FSP Review</td><td style="padding:7px 10px;color:#9aa7bd">Scope changes (products, processes, suppliers, allergens, facility), CCP validity, deviations this year, mock recall result, overall assessment, PCQI sign-off</td><td style="padding:7px 10px;color:#9aa7bd;white-space:nowrap">Annually</td></tr>' +
    '<tr style="background:#111e34"><td style="padding:7px 10px;color:#c4b5fd;font-family:monospace;white-space:nowrap">QC-BR-001</td><td style="padding:7px 10px;white-space:nowrap">📄 Production Batch Record</td><td style="padding:7px 10px;color:#9aa7bd">All ingredients + lot numbers, batch size, process temperatures, fill temp, final pH, QC checks, operator sign-off</td><td style="padding:7px 10px;color:#9aa7bd;white-space:nowrap">Every batch</td></tr>' +
    '</tbody></table></div>';

  // ────────────────────────────────────────────────────────────
  // Additional emails (per-client)
  // ────────────────────────────────────────────────────────────
  var SEC_CLIENT_EMAILS = bullets([
    '<b>What it is</b>: every client record can have any number of additional emails (AP, ops, sales contacts, etc.) beyond the primary contact email.',
    '<b>Where to add</b>: open any client → ✏️ <b>Edit Client</b> → scroll to <b>ADDITIONAL EMAILS</b> below the Main Point of Contact section. Click <b>+ Add email</b> to add a row. Each row has an optional label (e.g. "AP", "Ops") and the email address. The × button removes a row.',
    '<b>How they\'re used in sends</b>:<ol style="margin:4px 0 4px 18px;padding:0"><li><b>Send Invoice composer</b>: primary email pre-fills To; every additional email pre-fills Cc.</li><li><b>AI Follow-Up</b>: primary email is To; additional emails are Cc. A new "Cc" row in the composer shows you who\'ll be copied before you hit Send.</li><li><b>AR Collection</b>: the "📧 Send" button label shows "+Cc N" so you know how many extras will be copied.</li></ol>',
    '<b>De-dup</b>: if a customer\'s primary email is also in the additional list, it\'s automatically excluded from Cc (you won\'t double-mail anyone).',
    '<b>Display</b>: every additional email is listed below the primary on the client\'s detail card, with its label in muted text.'
  ]);

  var SEC_USERS = MOCK_USERS +
    '<div style="font-size:11px;color:#9aa7bd;margin-bottom:6px">Numbered callouts on the wireframe above:</div>' +
    bullets([
      '<b>(1) + Invite</b> — creates a Supabase Auth account. Invitee clicks the email confirmation link before they can log in.',
      '<b>(2) 📋 Activity log</b> — last 100 audit_log entries. Requires the audit_log table SQL.',
      '<b>(3) Role legend</b> — Admin (full access), Sales (CRM only), Viewer (read-only).',
      '<b>(4) Role dropdown per row</b> — change role inline. Persists to profiles immediately.',
      '<b>(5) Row actions</b> — Set password (masked-input modal → admin_set_user_password RPC, no email), Email reset (Supabase recovery email), Remove (soft-delete via profile.status = inactive). Owner row is locked.'
    ]) +
    /* ── Permission system (component-level gates) ── */
    '<h4 style="margin:22px 0 8px;font-size:13px;letter-spacing:1.5px;color:#00e5c0">🔑 PER-USER, PER-COMPONENT PERMISSIONS</h4>' +
    wf(620, 320,
      box(0,0,620,320,'#142238','rgba(255,255,255,.05)') +
      txt(20,28,'USERS & PERMISSIONS  (in the top toolbar)',12,'#fff') +
      txt(20,46,'Step 1 — team members table',10,'#00e5c0') +
      box(20,58,580,28,'#1a2c48','rgba(255,255,255,.1)') +
      txt(35,76,'NAME',9,'#9aa7bd') + txt(180,76,'EMAIL',9,'#9aa7bd') + txt(380,76,'ROLE',9,'#9aa7bd') + txt(460,76,'OVERRIDES',9,'#9aa7bd') + txt(560,76,'MANAGE',9,'#9aa7bd') +
      box(20,90,580,28,'#1a2c48','rgba(255,255,255,.05)') +
      txt(35,108,'Mike Krail',11,'#fff') + txt(180,108,'mike@goodliquid.com',10,'#9aa7bd') + txt(380,108,'ADMIN',10,'#f5c842') + txt(460,108,'all access',10,'#f5c842') + box(550,98,55,18,'#1a3c30','rgba(0,229,192,.3)') + txt(577,111,'Manage →',9,'#00e5c0','middle') +
      box(20,124,580,28,'#1a2c48','rgba(255,255,255,.05)') +
      txt(35,142,'Sandra Krail',11,'#fff') + txt(180,142,'sandra@goodliquid.com',10,'#9aa7bd') + txt(380,142,'SALES',10,'#6b9fff') + txt(460,142,'4 overrides',10,'#6b9fff') + box(550,132,55,18,'#1a3c30','rgba(0,229,192,.3)') + txt(577,145,'Manage →',9,'#00e5c0','middle') +
      txt(20,176,'Step 2 — click Manage → drill into matrix',10,'#00e5c0') +
      box(20,188,580,32,'#1a2c48','rgba(107,159,255,.3)') +
      txt(35,208,'APPLY PRESET:  [ Sales ▼ ]  [ Apply ]  · overwrites all overrides',10,'#6b9fff') +
      txt(20,236,'Pages section',10,'#00e5c0') +
      box(20,248,580,28,'#1a2c48','rgba(255,255,255,.05)') +
      txt(35,266,'Dashboard',11,'#fff') + txt(220,266,'KPI dashboard',10,'#9aa7bd') + txt(440,266,'☑',11,'#5fcf9e') + txt(490,266,'default (on)',10,'#9aa7bd') +
      box(20,282,580,28,'#1a2c48','rgba(255,255,255,.05)') +
      txt(35,300,'Audit Log',11,'#fff') + txt(220,300,'All admin actions',10,'#9aa7bd') + txt(440,300,'☐',11,'#9aa7bd') + txt(490,300,'overridden — revert',10,'#6b9fff')
    ) +
    bullets([
      '<b>Where to find it</b>: top toolbar (admin-only) — <b>🔑 Users & permissions</b> button between the user badge and Password.',
      '<b>Two layers of access control</b>:',
      '&nbsp;&nbsp;<b>Role</b> (admin / sales / viewer) — sets the wide-open default. <b>Admins bypass every gate</b>.',
      '&nbsp;&nbsp;<b>Component overrides</b> — per-user, per-feature toggles that flip a single page or action on or off for that user only.',
      '<b>The team members table</b> (default view): one row per staff user. Shows name, email, role pill, override count, Manage button. Click any row to drill into their matrix.',
      '<b>The matrix view</b>: three sections — <b style="color:#00e5c0">Pages</b> (which CRM pages they can navigate to), <b style="color:#f5c842">Actions</b> (Delete invoices / Mark paid / Send emails / Export backup / Invite customers / etc.), <b style="color:#c4b5fd">Data</b> (placeholder for future row-level scoping). Each component shows a checkbox and a state label: "default (on)" or "overridden — revert".',
      '<b>Apply preset (bulk toggle)</b>: pick <b>Admin</b> / <b>Sales</b> / <b>Viewer</b> from the dropdown → Apply. Only writes overrides where the preset differs from the default, so the matrix stays clean instead of showing 42 redundant "overridden" rows.',
      '<b>Visual hiding (proactive)</b>: components a user can\'t access are <b>hidden</b> from their UI — not greyed out, not error-on-click. Sidebar nav items disappear. Destructive buttons (delete invoice, export backup, etc.) disappear. Admins see everything.',
      '<b>Audit log</b>: every permission change is recorded in <code>permissions_audit</code> with actor + target + component + old/new value + timestamp. Shown at the bottom of the Users & Permissions page as "Recent permission changes."',
      '<b>Role change UI</b>: drill into a user → ROLE row at the top has a dropdown (Admin / Sales / Viewer). Confirm dialog before promoting to Admin. Your own dropdown is disabled — preventing accidental self-lockout.'
    ]);

  var SEC_CLIENTS = MOCK_CLIENTS +
    '<div style="font-size:11px;color:#9aa7bd;margin-bottom:6px">Numbered callouts on the wireframe above:</div>' +
    bullets([
      '<b>(1) + Add Client</b> — header button. Opens a modal: name, contact, email, service, status (lead / active).',
      '<b>(2) Search bar</b> — filters the list as you type (matches across name / contact / email).',
      '<b>(3) Row click</b> — opens the client detail panel: billed-to-date, recent invoices, deals, notes, 🤖 AI Summary button.',
      '<b>(4) Status badge</b> — green = active, blue = lead. Active clients count toward the dashboard "Active brands" metric. New clients persist to Supabase.'
    ]) +
    '<h4 style="margin:20px 0 8px;font-size:13px;letter-spacing:1.5px;color:#f5c842">💵 PRICING OVERRIDES (NEW)</h4>' +
    bullets([
      '<b>Where</b>: open <b>✏️ Edit Client</b> → scroll near the bottom to the yellow "💵 PRICING OVERRIDES" panel.',
      '<b>What it does</b>: lets you lock in a flat negotiated rate that overrides the public tier ladder for that specific client. Use it for pilots, incubator deals, bulk pre-quotes, or anyone you\'ve hand-shaken on a number outside the published canning_rates / bottling_rates ladder.',
      '<b>Five services supported</b>: Canning (per can), Bottling (per unit), R&D / formulation (per hour), Production hours (per hour), Consulting (per hour). Canning + Bottling require a format; the three hour-based services apply to all formats.',
      '<b>Optional date range</b>: <i>Effective from</i> + <i>Effective until</i> let you queue up a future rate change or expire an old one without deleting it.',
      '<b>How the builder uses it</b>: when you open a new invoice for that client, the canning + bottling lines compute totals using the override rate. A yellow "💵 N custom rates applied" badge appears next to "NEW INVOICE" so you can\'t accidentally invoice the wrong number. R&D / Production / Consulting lines still need their rates set manually for now, but the override is logged in the audit trail.',
      '<b>Removing an override</b> reverts that service back to the public tier ladder on the next invoice.'
    ]) +
    '<h4 style="margin:20px 0 8px;font-size:13px;letter-spacing:1.5px;color:#00e5c0">📄 STATEMENT OF ACCOUNT (NEW)</h4>' +
    bullets([
      '<b>Where to find it</b>: open any client detail → click the <b>📄 Statement</b> button in the action row at the bottom (alongside ✏️ Edit Client, 🤖 AI Health Score, etc.).',
      '<b>What it shows</b>: Total Billed, Total Paid, Credits (from credit memos), and Balance Due — plus a full invoice-by-invoice table with dates, statuses, and amounts.',
      '<b>Credit memos</b> appear as their own rows tagged "(CM)" and are automatically subtracted from the balance.',
      '<b>Printing</b>: click <b>🖨️ Print Statement</b> in the modal to open the browser print dialog. Use "Save as PDF" to email a statement to your client.'
    ]);

  var SEC_PIPELINE = MOCK_PIPELINE +
    '<div style="font-size:11px;color:#9aa7bd;margin-bottom:6px">Numbered callouts on the wireframe above:</div>' +
    bullets([
      '<b>(1) + Add Deal</b> — creates a card in Prospecting. Click any card to open the deal detail modal (edit name / company / value / probability / notes / stage).',
      '<b>(2) Deal card</b> — name, company, value. Click to open detail. Drag cards between columns (or use the arrow buttons inside each card).',
      '<b>(3) ⏰ Stale badge</b> — appears on cards in active stages (Prospecting / Proposal / Negotiation) that haven\'t been touched in >14 days. Visual cue to follow up.',
      '<b>(4) Closed Won column</b> — moving a card here also auto-bumps the related Activity Feed. Use the <b>→ Invoice</b> button in the deal detail to spin a billable invoice from a Closed Won deal.'
    ]) +
    '<h4 style="margin:20px 0 8px;font-size:13px;letter-spacing:1.5px;color:#00e5c0">📅 DAYS-IN-STAGE BADGE (NEW)</h4>' +
    wf(400, 100,
      box(0,0,400,100,'#142238','rgba(255,255,255,.05)') +
      txt(20,24,'PROSPECTING',10,'#9aa7bd') +
      box(20,34,160,56,'#243a56','rgba(107,159,255,.3)') +
      txt(30,54,'Apex Beverages',11,'#fff') + txt(30,68,'$12,000',10,'#9aa7bd') +
      box(110,78,60,14,'rgba(245,200,66,.4)','none') + txt(140,89,'8d',9,'#f5c842','middle') +
      txt(240,24,'PROPOSAL',10,'#9aa7bd') +
      box(240,34,150,56,'#243a56','rgba(0,229,192,.3)') +
      txt(250,54,'BlueSky Drinks',11,'#fff') + txt(250,68,'$8,500',10,'#9aa7bd') +
      box(330,78,50,14,'rgba(0,229,192,.25)','none') + txt(355,89,'3d',9,'#00e5c0','middle') +
      tag(110,78,1)
    ) +
    bullets([
      '<b>Days-in-stage badge</b>: every deal card shows a small colored pill in the bottom-right corner counting how many days the deal has been in its current stage.',
      '<b>Color coding</b>: <span style="color:#00e5c0">green &lt; 7 days</span> (active), <span style="color:#f5c842">yellow 7–14 days</span> (watch it), <span style="color:#e74c3c">red &gt; 14 days</span> (stale — take action).',
      '<b>What to do when stale</b>: open the deal, send a follow-up (or use Bulk Outreach below), log a note, and move the stage forward. The badge resets when the stage changes.'
    ]) +
    '<h4 style="margin:20px 0 8px;font-size:13px;letter-spacing:1.5px;color:#c4b5fd">📤 BULK OUTREACH (NEW)</h4>' +
    bullets([
      '<b>Where to find it</b>: Pipeline page header → <b>📤 Bulk Outreach</b> button (admin and sales roles only).',
      '<b>What it does</b>: lets you select multiple Prospecting leads, review an AI-drafted personalised cold-outreach email for each, and send them all in one click. See the <a href="#help-bulk-outreach" style="color:#00e5c0">Bulk Outreach</a> section for full details.',
      '<b>After sending</b>: each deal gets an "outreach sent" badge on its kanban card, and the sends are logged to Email Activity so you can track opens and clicks.'
    ]);

  var SEC_REFERRALS = MOCK_REFERRALS +
    '<div style="font-size:11px;color:#9aa7bd;margin-bottom:6px">Numbered callouts on the wireframe above:</div>' +
    bullets([
      '<b>What it is</b>: a commission-tracking ledger for deals brought in by external referrers (brokers, industry contacts, business partners). Each row links a referrer to a client deal and tracks the commission owed or already paid.',
      '<b>(1) + Add referral</b> — click the button top-right. Fill in:<ol style="margin:4px 0 4px 18px;padding:0"><li><b>Referrer</b> — pick from the Referrers list. Must be added there first.</li><li><b>Client name</b> — the client or prospect that was referred (free text; does not need to be a CRM client record yet).</li><li><b>Deal value</b> — total $ value of the deal (the full contract amount, not the commission).</li><li><b>Rate %</b> — commission percentage for this deal. Defaults to the referrer\'s standard rate, but can be overridden per deal.</li><li><b>Status</b> — set the opening status, usually "lead".</li></ol>Click Save.',
      '<b>Status workflow</b>: move the deal through stages as it progresses:<ul style="margin:4px 0 4px 18px;padding:0"><li><span style="color:#9aa7bd"><b>Lead</b></span> — initial intro, no proposal yet.</li><li><span style="color:#6b9fff"><b>Presented</b></span> — proposal or quote has been sent.</li><li><span style="color:#f5c842"><b>Won</b></span> — deal closed; commission is now owed.</li><li><span style="color:#22c55e"><b>Paid</b></span> — commission has been paid out.</li><li><span style="color:#e74c3c"><b>Lost</b></span> — deal fell through; no commission due.</li></ul>Click the status badge on any row to change it via a dropdown.',
      '<b>(2) Status badge</b> — color-coded for quick scanning. <span style="color:#f5c842">Yellow "won"</span> = commission is owed and appears on the dashboard referrer card. <span style="color:#22c55e">Green "paid"</span> = commission settled and counted toward Paid YTD.',
      '<b>Commission column</b> — calculated automatically as <code>deal value × rate %</code>. Example: $35,820 at 5% = <b>$1,791</b>. Read-only; recomputes whenever deal value or rate changes.',
      '<b>(3) ✓ Pay commission</b> — a green checkmark button appears on Won rows. Clicking it:<ol style="margin:4px 0 4px 18px;padding:0"><li>Flips the referral status to <b>Paid</b>.</li><li>Adds the commission amount to the referrer\'s <b>Paid YTD</b> total on their referrer card.</li><li>Removes the "owed" badge from the dashboard referrer widget.</li><li>Logs the payment event to the Activity Feed.</li></ol>',
      '<b>Editing a referral</b> — click any row to open the edit modal. Adjust the deal value, rate, client name, or status at any time. Click Save.',
      '<b>Deleting a referral</b> — open the edit modal → click the red Delete button → confirm. The row is permanently removed and the referrer\'s commission totals adjust automatically.'
    ]);

  var SEC_REFERRERS = MOCK_REFERRERS +
    '<div style="font-size:11px;color:#9aa7bd;margin-bottom:6px">Numbered callouts on the wireframe above:</div>' +
    bullets([
      '<b>What it is</b>: the master directory of external partners who send new business your way. Referrers can be brokers, industry contacts, or business partners. Each referrer card tracks contact info, a default commission rate, and a running commission summary across all their referrals.',
      '<b>(1) + Add referrer</b> — click the button top-right. Fill in:<ol style="margin:4px 0 4px 18px;padding:0"><li><b>Name</b> — full name of the person or company.</li><li><b>Relationship type</b> — Broker, Industry contact, or Business partner. Used for filtering and display.</li><li><b>Email</b> — contact email (used for reaching out manually; not connected to automated sends).</li><li><b>Phone</b> — contact phone number.</li><li><b>Default commission rate %</b> — the standard percentage applied to referrals from this person. Can be overridden per deal on the Referrals page.</li></ol>Click Save.',
      '<b>(2) Referrer card</b> — each referrer has a card showing their avatar (initials), name, relationship label, email, phone, commission rate, total referral count, and a commission summary badge:<ul style="margin:4px 0 4px 18px;padding:0"><li><span style="color:#f5c842"><b>$ owed</b></span> — sum of commissions on Won referrals not yet marked Paid. This amount appears on the dashboard "Top Referrers" widget as a yellow badge.</li><li><span style="color:#1D9E75"><b>$ paid YTD</b></span> — total commissions already paid out this calendar year. Resets each January 1.</li></ul>',
      '<b>Editing a referrer</b> — click any card to open the edit modal. Change name, relationship type, contact info, or default rate. Click Save.',
      '<b>Deleting a referrer</b> — open the edit modal → click the red Delete button. Confirm in the dialog. Deleting a referrer does not delete their referral rows — those rows remain but their referrer field shows "(deleted referrer)". Recover by re-creating the referrer and updating the referral rows.',
      '<b>Dashboard integration</b> — the dashboard shows the top 3 referrers by total deal value. Any referrer with an outstanding commission balance shows a yellow "$ owed" badge. Click the referrer card on the dashboard to jump directly to their Referrers page card.',
      '<b>How default rate works</b> — when you add a new referral and pick this referrer, the rate field pre-fills with their default rate. You can override it on that specific deal without changing the default. The default only applies to new referrals created after the change.'
    ]);
  // ────────────────────────────────────────────────────────────
  // Customer Requests inbox (PR 2 of 2026-05-20 enhancement series)
  // ────────────────────────────────────────────────────────────
  var MOCK_CUST_REQ = wf(620, 320,
    box(0,0,620,320,'#142238','rgba(255,255,255,.05)') +
    txt(20,28,'PORTAL DASHBOARD — quick-action tiles',12,'#00e5c0') +
    box(20,44,140,70,'#1a2c48','rgba(0,229,192,.2)') + txt(30,68,'🧪',18,'#fff') + txt(30,90,'Request samples',10,'#fff') + txt(30,104,'Ask for new product samples',8,'#9aa7bd') +
    box(170,44,140,70,'#1a2c48','rgba(0,229,192,.2)') + txt(180,68,'📦',18,'#fff') + txt(180,90,'Place an order',10,'#fff') + txt(180,104,'Reorder a previous run',8,'#9aa7bd') +
    box(320,44,140,70,'#1a2c48','rgba(0,229,192,.2)') + txt(330,68,'💬',18,'#fff') + txt(330,90,'Request a quote',10,'#fff') + txt(330,104,'Pricing on a new project',8,'#9aa7bd') +
    box(470,44,140,70,'#1a2c48','rgba(0,229,192,.2)') + txt(480,68,'❓',18,'#fff') + txt(480,90,'Ask a question',10,'#fff') + txt(480,104,'General question for Mike',8,'#9aa7bd') +
    txt(20,150,'CRM DASHBOARD — incoming banner',12,'#f5c842') +
    box(20,166,580,46,'#1a2c48','rgba(245,200,66,.3)') +
    txt(36,194,'📩  3 new customer requests',12,'#f5c842') +
    txt(36,208,'Click to triage',9,'#9aa7bd') +
    txt(570,194,'Open inbox →',10,'#f5c842','end') +
    txt(20,240,'INBOX MODAL — filter pills + cards',12,'#fff') +
    box(20,256,80,22,'#3d2f0a','rgba(245,200,66,.4)') + txt(60,272,'New (3)',10,'#f5c842','middle') +
    box(105,256,90,22,'#1a2c48','rgba(255,255,255,.1)') + txt(150,272,'In progress',10,'#9aa7bd','middle') +
    box(200,256,80,22,'#1a2c48','rgba(255,255,255,.1)') + txt(240,272,'Resolved',10,'#9aa7bd','middle') +
    box(285,256,80,22,'#1a2c48','rgba(255,255,255,.1)') + txt(325,272,'Dismissed',10,'#9aa7bd','middle') +
    box(20,290,580,22,'#1a2c48','rgba(196,181,253,.4)') +
    txt(30,306,'🧪 Sample request — Lotus nutra — "Pilot run of mango seltzer"',10,'#c4b5fd')
  );

  var SEC_CUSTOMER_REQUESTS =
    '<div style="font-size:13px;color:#cfd9e6;line-height:1.7;margin-bottom:10px">Customers can submit four types of requests from their portal dashboard. Each lands in your CRM inbox so nothing falls through the cracks of email threads.</div>' +
    MOCK_CUST_REQ +
    '<h4 style="margin:20px 0 8px;font-size:13px;letter-spacing:1.5px;color:#00e5c0">PORTAL SIDE — what customers see</h4>' +
    bullets([
      '<b>Four quick-action tiles</b> on the customer portal dashboard, above their invoices:',
      '&nbsp;&nbsp;<b>🧪 Request samples</b> — placeholder: "Which products? Any flavor or pack-size variants? Where should we ship to?"',
      '&nbsp;&nbsp;<b>📦 Place an order</b> — placeholder: "Which previous run? Quantity? Target ship date?"',
      '&nbsp;&nbsp;<b>💬 Request a quote</b> — placeholder: "Describe the new project — formulation, format, target volume, timeline."',
      '&nbsp;&nbsp;<b>❓ Ask a question</b> — free-form general inquiry.',
      'Customer fills in subject (optional) + details, hits Submit. Confirmation: "Mike will reply by email within 1 business day."'
    ]) +
    '<h4 style="margin:20px 0 8px;font-size:13px;letter-spacing:1.5px;color:#f5c842">CRM SIDE — your triage inbox</h4>' +
    bullets([
      '<b>Dashboard banner</b>: as soon as a customer submits, a gold "📩 N new customer requests · Click to triage" banner appears at the top of your dashboard. Realtime — no refresh needed. The banner only shows when at least one row is in <code>status=new</code>.',
      '<b>Click → inbox modal</b>: status filter pills (New / In progress / Resolved / Dismissed / All). Each card shows kind badge (color-coded by type), client + subject + body, and creation timestamp.',
      '<b>Per-card actions</b>: <span style="color:#6b9fff">Mark in progress</span>, <span style="color:#5fcf9e">✓ Resolve</span> (prompts for resolution notes), <span style="color:#9aa7bd">Dismiss</span>, <span style="color:#00e5c0">↩ Reply via email</span> (opens your mail client with To + Subject pre-filled).',
      '<b>Permissions</b>: portal customers can only see/insert rows tied to their own <code>client_id</code> (enforced by Postgres RLS). Staff can see and manage everything.'
    ]);

  var SEC_ACTIVITY =
    wf(620, 200,
      box(0,0,620,200,'#142238','rgba(255,255,255,.05)') +
      txt(20,28,'ACTIVITY FEED · 12 of 47 events',12,'#fff') +
      box(20,46,55,22,'#1a3c30','rgba(0,229,192,.4)') + txt(47,62,'All',10,'#00e5c0','middle') +
      box(80,46,80,22,'#1a2c48','rgba(255,255,255,.1)') + txt(120,62,'📞 Calls',10,'#9aa7bd','middle') +
      box(165,46,85,22,'#1a2c48','rgba(255,255,255,.1)') + txt(207,62,'✉️ Emails',10,'#9aa7bd','middle') +
      box(255,46,75,22,'#1a2c48','rgba(255,255,255,.1)') + txt(292,62,'📝 Notes',10,'#9aa7bd','middle') +
      box(335,46,75,22,'#1a2c48','rgba(255,255,255,.1)') + txt(372,62,'⭐ Deals',10,'#9aa7bd','middle') +
      box(415,46,85,22,'#1a2c48','rgba(255,255,255,.1)') + txt(457,62,'🧾 Invoices',10,'#9aa7bd','middle') +
      box(505,46,90,22,'#1a2c48','rgba(255,255,255,.1)') + txt(550,62,'🤝 Referrals',10,'#9aa7bd','middle') +
      box(20,80,580,32,'#1a2c48','rgba(255,255,255,.1)') + txt(35,100,'🔍 Search activity by name or detail…',11,'#6b87ad') +
      box(20,124,580,28,'#1a2c48','rgba(255,255,255,.05)') +
      txt(40,142,'✉️',12,'#5fcf9e') + txt(80,142,'Invoice GL-1004 sent · Lotus nutra',11,'#fff') + txt(580,142,'2h ago',10,'#9aa7bd','end') +
      box(20,158,580,28,'#1a2c48','rgba(255,255,255,.05)') +
      txt(40,176,'📞',12,'#6b9fff') + txt(80,176,'Call: Ceres 14 about Q3 production',11,'#fff') + txt(580,176,'5h ago',10,'#9aa7bd','end')
    ) +
    bullets([
      'Chronological log of CRM events: calls, emails, referrals, deal moves, notes, commissions.',
      '<b>Type filter pills (NEW)</b>: All / 📞 Calls / ✉️ Emails / 📝 Notes / ⭐ Deals / 🧾 Invoices / 🤝 Referrals. Click to narrow the feed by event type.',
      '<b>Free-text search (NEW)</b>: type into the search box to filter by event name or detail (case-insensitive). Composes with the type filter — pick "Emails" + search "Lotus" to see only Lotus-related emails.',
      '<b>Live count</b>: subtitle shows "12 of 47 events" so you know how much the filter is hiding.',
      'Stored in localStorage (gl_activities). <b>Per device</b>, capped at 100.',
      'Distinct from the <b>audit_log</b> (security-relevant admin actions) — see Users → 📋 Activity log for that.'
    ]);
  var SEC_CALENDAR = MOCK_CALENDAR +
    '<div style="font-size:11px;color:#9aa7bd;margin-bottom:6px">Numbered callouts on the wireframe above:</div>' +
    bullets([
      '<b>(1) Month / List toggle</b> — switch between a monthly grid view and a scrollable agenda list. Your last choice is remembered.',
      '<b>(2) Today indicator</b> — today\'s date gets a teal circle badge and a "TODAY" chip so you always know where you are in the month.',
      '<b>(3) Past days</b> — days that have already passed are dimmed so you can focus on upcoming dates.',
      '<b>(4) Event chips</b> — a colored chip on a day means at least one event is scheduled. Click the chip or the day cell to view or edit it.',
      '<b>Weekend tinting</b> — Saturday and Sunday columns have a subtle purple tint to distinguish them from weekdays at a glance.',
      '<b>Adding an event</b> — click "+ Add Event" in the top-right corner (or click any empty day cell) to open the event form. Fill in title, date, time, duration, notes, and guest email addresses.',
      '<b>Editing / deleting</b> — click an existing event chip to open the detail drawer. From there you can edit any field or delete the event.',
      '<b>Cancelling with notification</b> — when deleting an event that has guests, you will be prompted to send a cancellation email to all invitees automatically.',
      '<b>Public tour requests</b> — when a visitor submits a tour request through the marketing site, it lands here automatically as a calendar event.',
      '<b>Where to find it</b>: Sidebar → <b>Calendars → General Calendar</b>.'
    ]) +
    '<h4 style="color:#9aa7bd;margin:20px 0 8px;font-size:12px;letter-spacing:.5px;text-transform:uppercase">List / Agenda View</h4>' +
    wf(620, 220,
      box(0,0,620,220,'#142238','rgba(255,255,255,.05)') +
      txt(20,22,'LIST VIEW — May 2026',12,'#fff') +
      box(16,36,88,24,'rgba(255,255,255,.04)','rgba(255,255,255,.1)') + txt(60,52,'Month',10,'#9aa7bd','middle') +
      box(108,36,62,24,'rgba(0,229,192,.18)','rgba(0,229,192,.4)') + txt(139,52,'List',10,'#00e5c0','middle') +
      box(20,70,580,28,'rgba(0,229,192,.06)','rgba(0,229,192,.18)') +
      txt(30,88,'TODAY  ·  May 30',9,'#00e5c0') +
      box(20,102,580,26,'rgba(255,255,255,.02)','rgba(255,255,255,.05)') +
      txt(30,118,'May 30',9,'#9aa7bd') + txt(110,118,'10:00 AM',9,'#fff') + txt(210,118,'Client call — Lotus Nutra',10,'#fff') + txt(590,118,'30 min',9,'#9aa7bd','end') +
      box(20,130,580,26,'rgba(255,255,255,.02)','rgba(255,255,255,.05)') +
      txt(30,146,'Jun 2',9,'#9aa7bd') + txt(110,146,'2:00 PM',9,'#fff') + txt(210,146,'Line changeover — Canning L1',10,'#fff') + txt(590,146,'1 hr',9,'#9aa7bd','end') +
      box(20,158,580,26,'rgba(255,255,255,.02)','rgba(255,255,255,.05)') +
      txt(30,174,'Jun 5',9,'#9aa7bd') + txt(110,174,'10:00 AM',9,'#fff') + txt(210,174,'Jane Smith — Discovery call',10,'#fff') + txt(590,174,'30 min',9,'#9aa7bd','end') +
      txt(30,204,'Showing next 30 days  ·  3 events',9,'#5a7a9a') +
      tag(108,36,1) + tag(20,102,2) + tag(590,118,3)
    ) +
    bullets([
      '<b>(1) List toggle active</b> — when List is selected the calendar switches to a scrollable agenda grouped by day.',
      '<b>(2) Event row</b> — each event shows the date, start time, title, and duration. Click any row to open the edit drawer.',
      '<b>(3) Duration column</b> — quick glance at how long the event runs without opening the detail drawer.'
    ]);

  var SEC_PRODUCTION =
    wf(620, 240,
      box(0,0,620,240,'#142238','rgba(255,255,255,.05)') +
      txt(20,22,'🏭 PRODUCTION SCHEDULE  ·  Week of May 26',12,'#fff') +
      txt(20,38,'Canning Line 1:',10,'#9aa7bd') +
      box(140,28,240,18,'#1a3c30','none') + box(140,28,168,18,'#00e5c0','none') +
      txt(150,41,'68%  ·  340 cases / 500 cap',9,'#0a1628') +
      txt(20,58,'Bottling Line 1:',10,'#9aa7bd') +
      box(140,48,240,18,'#1a3c30','none') + box(140,48,220,18,'#f5c842','none') +
      txt(150,61,'92%  ·  92 hrs / 100 cap',9,'#0a1628') +
      box(20,76,580,148,'#0d1e35','rgba(255,255,255,.05)') +
      txt(30,92,'MON 26',9,'#9aa7bd','middle') + txt(30,92,'',9,'#9aa7bd') +
      txt(121,92,'TUE 27',9,'#9aa7bd') + txt(224,92,'WED 28',9,'#9aa7bd') + txt(327,92,'THU 29',9,'#9aa7bd') + txt(430,92,'FRI 30',9,'#9aa7bd') + txt(533,92,'SAT 31',9,'#9aa7bd') +
      box(24,100,90,50,'#1a6fff','rgba(107,159,255,.4)') + txt(30,116,'Lotus nutra',9,'#fff') + txt(30,130,'Canning L1',8,'#9aa7bd') + txt(30,144,'100 cases',8,'#9aa7bd') +
      box(127,100,90,50,'#1a6fff','rgba(107,159,255,.4)') + txt(133,116,'Lotus nutra',9,'#fff') + txt(133,130,'Canning L1',8,'#9aa7bd') + txt(133,144,'(cont.)',8,'#9aa7bd') +
      box(230,100,90,50,'rgba(0,229,192,.5)','rgba(0,229,192,.4)') + txt(236,116,'Ceres 14',9,'#fff') + txt(236,130,'Bottling L1',8,'#9aa7bd') + txt(236,144,'200 cases',8,'#9aa7bd') +
      box(333,100,90,50,'rgba(245,200,66,.4)','rgba(245,200,66,.4)') + txt(339,116,'PitStop',9,'#fff') + txt(339,130,'Canning L1',8,'#9aa7bd') + txt(339,144,'150 cases',8,'#9aa7bd') +
      box(20,158,580,62,'#142238','rgba(255,255,255,.05)') +
      txt(30,174,'⚙ Production lines',10,'#9aa7bd') + txt(160,174,'+ Add Run',10,'#00e5c0') +
      txt(30,194,'Capacity: 500 cases/day (Canning L1)  ·  100 hrs/wk (Bottling L1)',9,'#9aa7bd') +
      tag(140,28,1) + tag(140,48,2) + tag(24,100,3)
    ) +
    '<div style="font-size:11px;color:#9aa7bd;margin-bottom:6px">Numbered callouts on the wireframe above:</div>' +
    bullets([
    'Same calendar mechanics as the General Calendar, but focused on <b>production runs</b>: which client, what format, how many cases, what stage (scheduled / in production / quality check / completed / shipped).',
    'Customers see their own scheduled runs in the Customer Portal automatically.',
    '<b>Capacity-aware scheduling (NEW)</b> — every run is assigned to a <b>Production Line</b> (Canning Line 1, Bottling Line 1, R&D Bench, etc.) with its own cases-per-day or hours-per-day capacity. The schedule widget above the kanban shows this-week and next-week utilization per line (green &lt; 70%, yellow 70-100%, red &gt; 100%). Click <b>⚙ Production lines</b> on the toolbar to add/edit/deactivate lines.',
    '<b>Date range + conflict warning (NEW)</b> — runs now have a Start date + End date (blank end = single day). When the dates overlap another run already booked on the same line, a red banner appears inside the modal listing the conflicting runs. Saving still works — this is a warning, not a hard block, so you can choose to double-book intentionally.',
    '<b>Auto stage-change emails</b> — when you advance a run between kanban stages, the brand\'s portal customer gets an email with the new status. Skipped for clients with no portal user, or for users who opted out (Portal → Account Settings → <b>NOTIFICATIONS</b> → uncheck "Production stage emails").',
    '<b>📎 Lot Documents (NEW)</b> — every run now carries a <i>Lot number</i> field + an inline "📎 LOT DOCUMENTS" section. Click <b>+ Attach</b> on an existing run to upload a COA, spec sheet, allergen statement, kosher/organic cert, or NFP — anything the customer would otherwise email you for. The file lands in the <code>client-docs</code> Storage bucket under <code>&lt;client_id&gt;/lots/&lt;lot&gt;/</code> and a metadata row goes into <code>lot_documents</code>. Each row has 🗑 (delete) and ⬇ (download) buttons.',
    '<b>What the customer sees</b>: a new "📎 COAs & DOCUMENTS" section on their portal dashboard with type badges (COA / Spec sheet / Allergen / Kosher / Organic / Nutrition / Other) and a one-click <b>⬇ Download</b> that hits a 60-second signed URL. RLS gates this to <code>client_id = current_customer_client_id()</code> — no risk of one brand seeing another brand\'s files.',
    'Stored in Supabase <b>production_runs</b> + <b>lot_documents</b>.'
  ]);

  var SEC_TASKS = MOCK_TASKS +
    '<div style="font-size:11px;color:#9aa7bd;margin-bottom:6px">Numbered callouts on the wireframe above:</div>' +
    bullets([
      '<b>What it is</b>: a personal to-do list for tracking follow-up actions, reminders, and daily work items. Tasks can be optionally linked to a specific client account for quick context.',
      '<b>(1) + Add Task</b> — click the button top-right. A modal opens with three fields:<ol style="margin:4px 0 4px 18px;padding:0"><li><b>Task name</b> (required) — describe what needs to be done, e.g. "Follow up with Bloom on Q3 volume".</li><li><b>Client link</b> (optional) — pick a client from the dropdown. A blue client badge appears on the task row so you can see at a glance which account it belongs to.</li><li><b>Due date</b> (optional) — a date picker. Leave blank for open-ended tasks with no deadline.</li></ol>Click Save. The new task appears at the top of the list.',
      '<b>(2) Completing a task</b> — click the checkbox on the left of any row. The task immediately strikes through and dims. Click the checkbox again to un-complete it if needed. Completed tasks move to the Done view.',
      '<b>(3) Due-today badge</b> — a yellow "due today" pill appears on tasks whose due date is today. If the due date has already passed, the badge turns red and reads "overdue". Overdue tasks bubble up to the top of the Open filter automatically.',
      '<b>Filter pills</b> — three pills at the top: <b>All</b> (every task regardless of status), <b>Open</b> (incomplete tasks only — overdue first, then by due date), <b>Done</b> (completed tasks, newest first).',
      '<b>Editing a task</b> — click anywhere on a task row to reopen the edit modal. Change the name, client link, or due date, then click Save to update.',
      '<b>Deleting a task</b> — open the task edit modal → click the red <b>Delete</b> button at the bottom. Confirm in the dialog. Deleted tasks are permanently removed.',
      '<b>Client badge shortcut</b> — clicking the blue client badge on a task row navigates directly to that client\'s detail panel, so you can pull up account info without leaving context.',
      '<b>Data note</b> — tasks are stored in <code>localStorage (gl_tasks)</code> on your device. They are private to your browser, not visible to other team members, and clearing your browser data will erase them. For shared team to-dos, use the <b>📣 Announcements</b> board to broadcast context to the whole team.'
    ]);

  var SEC_DOCUMENTS = MOCK_DOCUMENTS +
    '<div style="font-size:11px;color:#9aa7bd;margin-bottom:6px">Numbered callouts on the wireframe above:</div>' +
    bullets([
      '<b>What it is</b>: centralized file storage for client-facing and internal documents — master formulas, label artwork, spec sheets, contracts, COAs, production schedules, and more. Files are stored securely in Supabase Storage (<b>client-docs</b> bucket) and require a staff login to view.',
      '<b>(1) + Upload</b> — click the button top-right. A modal opens:<ol style="margin:4px 0 4px 18px;padding:0"><li><b>Client</b> — pick from the dropdown, or "(general)" for documents not tied to a specific client.</li><li><b>Document type</b> — select from: R&amp;D, Design, Ops, Contract, Spec sheet, Certificate of Analysis (COA), Allergen, Label, Other.</li><li><b>File</b> — drag-and-drop or click to browse. Accepts PDF, Word (.doc/.docx), Excel (.xls/.xlsx), images (JPG, PNG), CSV, and ZIP. Max file size: 50 MB.</li></ol>Click Upload. A metadata row saves to the <code>documents</code> table; the file lands in Supabase Storage under <code>&lt;client_id&gt;/&lt;filename&gt;</code>.',
      '<b>(2) Document table</b> — every uploaded file with file name, client name, document type badge (color-coded by type), upload date, and action buttons. Sorted newest-first.',
      '<b>(3) ⬇ Open</b> — generates a 60-second signed URL from Supabase Storage and opens the file in a new tab. Because links are short-lived and signed, they cannot be shared publicly — the recipient must be a logged-in staff user.',
      '<b>Filtering documents</b> — use the <b>Filter by client</b> dropdown above the table to narrow results to one client\'s files. Use the type pills to filter by category (R&amp;D, COA, Label, etc.). Both filters work together.',
      '<b>Deleting a document</b> — click the red 🗑 icon on any row. A confirmation dialog appears. Confirming removes both the file from Supabase Storage and the metadata row from the database.',
      '<b>Lot-specific documents (COAs, certs)</b> — documents tied to a specific production lot are managed separately on the <b>Production Runs</b> page. Open a run → scroll to "📎 LOT DOCUMENTS" → click + Attach. Customers can download these directly from their portal without a staff login.',
      '<b>Missing bucket warning</b> — if the <code>client-docs</code> Storage bucket hasn\'t been created yet, uploads fail silently. The dashboard <b>System Health</b> widget surfaces this with a one-click "Copy SQL" fix — run that SQL in the Supabase SQL editor to create the bucket with correct Row-Level Security policies.'
    ]);

  var SEC_INVENTORY = MOCK_INVENTORY +
    '<div style="font-size:11px;color:#9aa7bd;margin-bottom:6px">Numbered callouts on the wireframe above:</div>' +
    bullets([
      '<b>What it is</b>: a lightweight stock tracker for raw materials, packaging components, and finished goods. Set reorder thresholds and get dashboard alerts when stock runs low.',
      '<b>(1) + Add Item</b> — click the button top-right. Fill in:<ol style="margin:4px 0 4px 18px;padding:0"><li><b>Item name</b> (required) — e.g. "12oz Sleek Cans", "CO₂ Gas", "PakTech Handles", "750ml Bottles".</li><li><b>Quantity</b> — current stock on hand (a number).</li><li><b>Unit</b> — free text: cases, tanks, bags, pallets, lbs, kg, gallons, each — whatever makes sense for that item.</li><li><b>Low-stock threshold</b> — the quantity at or below which the LOW badge triggers and the dashboard alert fires. Example: set to 3 for CO₂ tanks so you get warned before you run out.</li></ol>Click Save. The item appears in the table.',
      '<b>Updating a quantity</b> — after receiving a delivery or consuming material in a production run, click the item row to open the edit modal. Change the Quantity to the new on-hand number and click Save. The badge and dashboard alert recompute instantly.',
      '<b>(2) LOW badge</b> — a yellow "LOW" badge appears on any item where quantity ≤ threshold. LOW items sort to the top of the list and also surface in the dashboard\'s <b>System Health</b> / Alerts section, so you see shortages without opening the Inventory page.',
      '<b>OK badge</b> — a green "OK" badge appears when quantity is above the threshold. No action needed.',
      '<b>Editing an item</b> — click any row to reopen the edit modal. You can rename the item, change the unit, adjust the threshold, or update the quantity. Click Save.',
      '<b>Deleting an item</b> — open the edit modal → click the red <b>Delete</b> button → confirm. The item is permanently removed.',
      '<b>Sorting</b> — LOW items always appear first. Within the same status, items are sorted alphabetically.',
      '<b>Data note</b> — inventory data lives in <code>localStorage (gl_inventory)</code> on your device. It is not synced to Supabase or shared with other team members. For shared, production-grade inventory (with audit trails and multi-user visibility), use the Supabase <code>inventory</code> table directly or connect your ERP.'
    ]);
  var SEC_ANNOUNCEMENTS =
    wf(620, 200,
      box(0,0,620,200,'#142238','rgba(255,255,255,.05)') +
      txt(20,24,'📣 ANNOUNCEMENTS',12,'#fff') +
      box(520,12,90,22,'rgba(0,229,192,.1)','rgba(0,229,192,.3)') + txt(565,27,'+ New post',10,'#00e5c0','middle') +
      box(20,38,580,60,'#1a2c48','rgba(245,200,66,.15)') +
      txt(30,56,'📌  LINE MAINTENANCE — Canning Line 1 down Fri May 30',11,'#f5c842') +
      txt(30,74,'Please reschedule any runs booked for Friday. Eng team will be in 7am–noon.',10,'#9aa7bd') +
      txt(560,82,'May 29',9,'#9aa7bd','end') +
      box(20,106,580,46,'#1a2c48','rgba(255,255,255,.06)') +
      txt(30,124,'🎉  New client signed — Ceres 14 (200 cases, Bottling)',11,'#cfd9e6') +
      txt(30,140,'Kick-off call scheduled for June 2. Details in pipeline.',10,'#9aa7bd') +
      txt(560,148,'May 28',9,'#9aa7bd','end') +
      box(20,160,580,32,'#1a2c48','rgba(255,255,255,.06)') +
      txt(30,180,'🏭  Reminder: submit monthly capacity forecast by EOD Monday.',10,'#9aa7bd') +
      txt(560,180,'May 27',9,'#9aa7bd','end') +
      tag(520,12,1) + tag(20,38,2)
    ) +
    bullets([
      '<b>What it is</b>: a shared notice board for company-wide messages. Announcements appear on every staff user\'s dashboard at the top of the page. Use it for shift reminders, maintenance windows, client wins, production updates, or anything the whole team needs to see.',
      '<b>+ New post</b> — click the button top-right. A modal opens with two fields:<ol style="margin:4px 0 4px 18px;padding:0"><li><b>Title</b> (required) — a short headline, e.g. "LINE MAINTENANCE — Canning Line 1 down Fri May 30".</li><li><b>Body</b> — optional additional detail. Supports plain text. Use short, actionable sentences.</li></ol>Click Save. The announcement appears immediately on the board.',
      '<b>Pinned posts (📌)</b> — check the "📌 Pin this post" checkbox in the new-post modal to pin it to the top of the board regardless of date. Use pinning for time-sensitive notices that must stay visible, like a line shutdown or a safety bulletin. Pinned posts remain at the top until you unpin or delete them.',
      '<b>Emoji openers</b> — starting your title with an emoji helps team members scan the board at a glance: 📌 urgent/pinned · 🎉 celebration · 🏭 production · 🚨 safety · 📋 reminder.',
      '<b>Editing a post</b> — click any announcement row to open the edit modal. Change the title, body, or pin status, then click Save.',
      '<b>Deleting a post</b> — open the edit modal → click the red Delete button → confirm. The post is immediately removed from all dashboards.',
      '<b>Data note</b> — announcements are stored in localStorage on each device. They are visible only to users on the same browser/device and are not synced across the team via Supabase. For team-wide sync, use the Supabase <code>announcements</code> table directly.'
    ]);
  var SEC_CUSTOMERS = MOCK_CUSTOMERS +
    '<div style="font-size:11px;color:#9aa7bd;margin-bottom:6px">Numbered callouts on the wireframe above:</div>' +
    bullets([
      '<b>(1) 📧 Send Onboarding Email</b> — opens the invite picker (client dropdown + email field). Behind the scenes it calls Supabase to create a real auth user, links them to the picked client, and fires a password-reset email so the customer sets their own password. Mailgun is configured server-side in the <code>mailgun-send</code> Edge Function — no per-browser API key needed anymore.',
      '<b>(2) Row actions</b> — <span style="color:#f5c842">reset</span> sends a Supabase password recovery email; <span style="color:#e74c3c">remove</span> deletes the portal login.',
      'Customers who log in see invoices addressed to them, 💳 Pay Now buttons (using Stripe links you saved per-invoice), ✓ Accept Quote buttons (emails Mike on click), and a contact form to message you.'
    ]) +
    '<h4 style="margin:20px 0 8px;font-size:13px;letter-spacing:1.5px;color:#7fc6f5">👥 MULTI-USER PORTAL ACCOUNTS (NEW)</h4>' +
    bullets([
      '<b>Two roles per brand</b>: <span style="color:#00e5c0;font-weight:700">OWNER</span> can invite/remove teammates and edit account settings. <span style="color:#7fc6f5;font-weight:700">MEMBER</span> is view-only — sees the same invoices/runs/samples but can\'t change billing info or invite others.',
      '<b>The first invite is owner</b>: when a CRM admin clicks "🔑 Invite Customer Login" on a client, that first user becomes the owner. Every subsequent invite (from CRM or from the portal itself) becomes a member.',
      '<b>Portal-side invites</b>: the customer\'s owner can add their AP/ops/buyer themselves — Customer Portal → <b>Account settings</b> → <b>TEAMMATES</b> section → enter email + display name → <b>+ Invite</b>. The new user gets a password-reset email; once they set a password they\'re in the portal under the same brand.',
      '<b>CRM-side controls</b>: the Customer Logins table now shows a <b>Role</b> column. Click <b>Make owner</b> on a member row to promote them (e.g. if the original owner left and you need to hand off the account). Deactivate works the same as before.',
      '<b>What members CAN\'T do</b>: invite teammates, remove teammates, edit account settings (the Teammates section says "Only the brand owner can invite teammates" instead of showing the invite form). They CAN see everything an owner sees on the portal.',
      '<b>Behind the scenes</b>: a single Postgres RPC (<code>portal_invite_teammate</code>) runs as SECURITY DEFINER so the portal user — who has no insert privileges on customer_users — can still create the row. The RPC refuses if the caller isn\'t an owner. A companion RPC (<code>portal_remove_teammate</code>) deactivates teammates with the same gating.'
    ]);

  var SEC_SETTINGS = MOCK_SETTINGS +
    '<div style="font-size:11px;color:#9aa7bd;margin-bottom:6px">Numbered callouts on the wireframe above:</div>' +
    bullets([
      '<b>What it is</b>: the Settings &amp; Integrations panel, accessed via the floating <b>🤖</b> button in the bottom-right corner of any CRM page. The same menu also provides quick access to AI Tools (see the AI Chat &amp; AI Tools section for those).',
      '<b>(1) Floating 🤖 FAB button</b> — a teal-to-blue gradient circle fixed to the bottom-right corner on every CRM page. Click it to open the popout menu.',
      '<b>(2) Popout menu — Settings items</b> (scroll down below the AI tools to find these):<ul style="margin:4px 0 4px 18px;padding:0"><li><b>📧 Mailgun Settings</b> — paste your Mailgun private API key (starts with <code>key-</code>). Required for all outgoing email (send invoice, follow-up, schedules). After pasting, click <b>Test send</b> to verify it works. The key is saved to localStorage on this device.</li><li><b>🤖 AI Settings</b> — paste your Anthropic API key (starts with <code>sk-ant-</code>). Required for all AI features: quote estimates, invoice drafting, meeting notes, AI chat, NCR root-cause suggester, COA parser, formula generation. Saved to localStorage.</li><li><b>✍️ Email Signature</b> — your name, title, phone, and any footer text. Auto-appended to the bottom of every outgoing follow-up email. Edit directly in the text area and click Save.</li><li><b>🗑️ Clear local cache</b> (admin only, shown in red) — opens a checklist of all <code>gl_*</code> localStorage keys (tasks, inventory, announcements, activity, Mailgun key, AI key, etc.). Check the ones you want to delete, click Confirm. Use when handing a device to a new team member.</li></ul>',
      '<b>Where settings are stored</b>: API keys, signatures, and per-device preferences are stored in <code>localStorage</code> on your current browser. They are not synced to Supabase. Each device or browser profile needs its own keys set.',
      '<b>QuickBooks Online (QBO)</b>: connect your QBO account from the 🤖 menu → <b>⚙ Settings → QuickBooks → Connect</b>. This opens the Intuit OAuth flow. Once connected, invoices can be pushed to QBO as bills with one click from the invoice detail page.',
      '<b>System Health widget</b>: the dashboard\'s System Health section surfaces missing integrations (no Mailgun key, no AI key, missing Storage bucket, missing database tables) with one-click fix buttons. Always check System Health after first login on a new device.'
    ]);
  var SEC_SHORTCUTS = bullets([
    '<kbd style="background:rgba(255,255,255,.06);padding:1px 5px;border-radius:4px;border:1px solid rgba(255,255,255,.1)">Ctrl+K</kbd> / <kbd style="background:rgba(255,255,255,.06);padding:1px 5px;border-radius:4px;border:1px solid rgba(255,255,255,.1)">⌘K</kbd> — open Global Search across invoices / clients / deals / referrers / users.',
    '<kbd style="background:rgba(255,255,255,.06);padding:1px 5px;border-radius:4px;border:1px solid rgba(255,255,255,.1)">?</kbd> — open this Help panel (auto-scrolled to the section matching your current page).',
    '<kbd style="background:rgba(255,255,255,.06);padding:1px 5px;border-radius:4px;border:1px solid rgba(255,255,255,.1)">Esc</kbd> — close most overlays.',
    '<kbd style="background:rgba(255,255,255,.06);padding:1px 5px;border-radius:4px;border:1px solid rgba(255,255,255,.1)">↑↓</kbd> in Global Search — navigate; <kbd style="background:rgba(255,255,255,.06);padding:1px 5px;border-radius:4px;border:1px solid rgba(255,255,255,.1)">Enter</kbd> opens.'
  ]);

  // ────────────────────────────────────────────────────────────
  // NEW SECTIONS (Task 2)
  // ────────────────────────────────────────────────────────────

  var SEC_AI_HUB =
    wf(620, 270,
      box(0,0,620,270,'#0a1628','rgba(255,255,255,.05)') +
      // Chat area
      box(0,0,620,160,'#142238','rgba(0,229,192,.1)') +
      txt(20,20,'💬 AI CHAT',11,'#00e5c0') +
      box(20,32,580,32,'#1a2c48','rgba(255,255,255,.05)') + txt(30,52,'How do I send an invoice reminder?',11,'#9aa7bd') +
      box(20,70,580,46,'#1a3c30','rgba(0,229,192,.15)') + txt(30,88,'You can send overdue reminders in bulk from the Invoices page',11,'#cfd9e6') + txt(30,108,'by clicking "📧 Send overdue reminders" in the header.',11,'#cfd9e6') +
      box(20,122,580,22,'#0d1e35','rgba(255,255,255,.05)') + txt(30,137,'Ask anything about Good Liquid CRM…',10,'#9aa7bd') +
      box(560,122,50,22,'#1a6fff','none') + txt(585,137,'Send',9,'#fff','middle') +
      // Tool grid
      box(0,165,620,105,'#0d1e35','rgba(255,255,255,.03)') +
      txt(20,182,'🤖 AI TOOLS  ·  6 categories  ·  30+ tools',10,'#00e5c0') +
      box(20,192,90,34,'#1a2c48','rgba(0,229,192,.1)') + txt(65,213,'💰 Quote',9,'#cfd9e6','middle') +
      box(118,192,90,34,'#1a2c48','rgba(0,229,192,.1)') + txt(163,213,'🧾 Invoice',9,'#cfd9e6','middle') +
      box(216,192,90,34,'#1a2c48','rgba(0,229,192,.1)') + txt(261,213,'📝 Notes',9,'#cfd9e6','middle') +
      box(314,192,90,34,'#1a2c48','rgba(0,229,192,.1)') + txt(359,213,'✉️ Email',9,'#cfd9e6','middle') +
      box(412,192,90,34,'#1a2c48','rgba(245,200,66,.1)') + txt(457,213,'📋 Comply',9,'#f5c842','middle') +
      box(510,192,90,34,'#1a2c48','rgba(107,159,255,.1)') + txt(555,213,'🏭 Prod.',9,'#6b9fff','middle') +
      box(20,232,90,34,'#1a2c48','rgba(196,181,253,.1)') + txt(65,253,'🤖 AI Key',9,'#c4b5fd','middle') +
      box(118,232,90,34,'#1a2c48','rgba(196,181,253,.1)') + txt(163,253,'📣 Social',9,'#c4b5fd','middle') +
      box(216,232,90,34,'#1a2c48','rgba(196,181,253,.1)') + txt(261,253,'🌱 Growth',9,'#c4b5fd','middle') +
      box(314,232,90,34,'#1a2c48','rgba(95,207,158,.1)') + txt(359,253,'📊 Report',9,'#5fcf9e','middle') +
      tag(20,32,1) + tag(20,70,2) + tag(20,192,3)
    ) +
    '<div style="font-size:11px;color:#9aa7bd;margin-bottom:6px">Numbered callouts on the wireframe above:</div>' +
    bullets([
      '<b>(1) AI Chat input</b> — type any question about the CRM and Claude answers in context. Use it to learn the app, troubleshoot a workflow, or draft content quickly.',
      '<b>(2) AI response</b> — responses appear inline. The chat history persists for the session.',
      '<b>(3) AI Tools panel</b> — 30+ one-click tools organised across 6 categories: Invoicing (Quote, Draft Invoice, Meeting Notes, Draft Email, Email Signature), Compliance (Root-Cause Suggester, COA Parser, Allergen Check), Production (Run Summary, Lot Notes), Marketing (Social Post, Press Release, Growth Tips), Reports, and Settings (AI key config). Click any tile to launch that tool.',
      '<b>How to access</b>: click <b>💬 AI Chat</b> in the sidebar AI section for the chat page, or <b>🤖 AI Tools</b> for the full categorised panel. The floating 🤖 FAB button (bottom-right) also opens a quick-access sub-menu.',
      '<b>AI key setup</b>: go to AI Tools → <b>🤖 AI Settings</b> and paste your Anthropic API key. Without a key the tools show a prompt asking you to add one.'
    ]);

  var SEC_PRODUCTION_RUNS =
    wf(620, 230,
      box(0,0,620,230,'#142238','rgba(255,255,255,.05)') +
      txt(20,22,'🏭 PRODUCTION RUNS',12,'#fff') +
      box(530,10,80,22,'rgba(0,229,192,.1)','rgba(0,229,192,.3)') + txt(570,24,'+ Add Run',9,'#00e5c0','middle') +
      box(20,36,104,180,'#0d1e35','rgba(255,255,255,.05)') + txt(30,54,'DISCOVERY',9,'#9aa7bd') +
      box(25,62,94,54,'#243a56','rgba(107,159,255,.3)') + txt(30,78,'Ceres 14',10,'#fff') + txt(30,92,'Jun 2',9,'#9aa7bd') +
      box(40,100,60,14,'#1a3c30','none') + txt(70,111,'2d',8,'#00e5c0','middle') +
      box(130,36,104,180,'#0d1e35','rgba(255,255,255,.05)') + txt(140,54,'FORMULATION',9,'#9aa7bd') +
      box(135,62,94,54,'#243a56','rgba(245,200,66,.3)') + txt(140,78,'PitStop',10,'#fff') + txt(140,92,'Jun 5',9,'#9aa7bd') +
      box(150,100,60,14,'rgba(245,200,66,.4)','none') + txt(180,111,'9d',8,'#f5c842','middle') +
      box(240,36,104,180,'#0d1e35','rgba(255,255,255,.05)') + txt(250,54,'SCHEDULING',9,'#9aa7bd') +
      box(245,62,94,54,'#243a56','rgba(0,229,192,.3)') + txt(250,78,'Lotus nutra',10,'#fff') + txt(250,92,'Jun 10',9,'#9aa7bd') +
      box(260,100,60,14,'#1a3c30','none') + txt(290,111,'5d',8,'#00e5c0','middle') +
      box(350,36,104,180,'#0d1e35','rgba(255,255,255,.05)') + txt(360,54,'PRODUCTION',9,'#9aa7bd') +
      box(355,62,94,54,'#243a56','rgba(95,207,158,.3)') + txt(360,78,'TacoLoco',10,'#fff') + txt(360,92,'May 28',9,'#9aa7bd') +
      box(370,100,60,14,'#1a2c48','none') + txt(400,111,'3d',8,'#5fcf9e','middle') +
      box(460,36,104,180,'#0d1e35','rgba(255,255,255,.05)') + txt(470,54,'SHIP',9,'#9aa7bd') +
      box(465,62,94,54,'#243a56','rgba(196,181,253,.3)') + txt(470,78,'GreenCo',10,'#fff') + txt(470,92,'May 22',9,'#9aa7bd') +
      box(480,100,60,14,'#2a1a3c','none') + txt(510,111,'14d',8,'#c4b5fd','middle') +
      tag(150,100,1) + tag(40,100,2) + tag(530,10,3)
    ) +
    '<div style="font-size:11px;color:#9aa7bd;margin-bottom:6px">Numbered callouts on the wireframe above:</div>' +
    bullets([
      '<b>Five kanban stages</b>: Discovery → Formulation → Scheduling → Production → Ship. Drag cards between columns or use the arrow buttons inside each card.',
      '<b>(1) Days-in-stage badge</b> — colored pill on every card: <span style="color:#00e5c0">green &lt; 7 days</span>, <span style="color:#f5c842">yellow 7–14 days</span>, <span style="color:#e74c3c">red &gt; 14 days</span>. A red badge means the run is stale and needs attention.',
      '<b>(2) Adding a run</b> — click <b>+ Add Run</b> (top-right), fill in client, format, case count, lot number, assigned production line, start / end dates.',
      '<b>Lot Documents</b> — click any run card → open the 📎 LOT DOCUMENTS section → <b>+ Attach</b> to upload COAs, spec sheets, or certs. Files land in Supabase Storage and appear in the customer\'s portal instantly.',
      '<b>Auto stage-change emails</b> — advancing a run to a new stage fires an email to the brand\'s portal customer with the new status badge.',
      '<b>Production lines</b> — click <b>⚙ Production lines</b> in the toolbar to configure lines with capacity (cases/day or hours/week). A capacity bar above the board shows week utilisation.'
    ]);

  var SEC_FORMULA_VAULT =
    wf(620, 190,
      box(0,0,620,190,'#142238','rgba(255,255,255,.05)') +
      txt(20,22,'🧪 FORMULA VAULT',12,'#fff') +
      box(20,34,580,24,'#0d1e35','rgba(255,255,255,.05)') +
      txt(30,50,'Formula name',10,'#9aa7bd') + txt(200,50,'Version',10,'#9aa7bd') + txt(280,50,'Status',10,'#9aa7bd') + txt(380,50,'Allergens',10,'#9aa7bd') + txt(500,50,'Client',10,'#9aa7bd') +
      box(20,62,580,26,'#1a2c48','rgba(255,255,255,.05)') +
      txt(30,79,'Mango Seltzer 12oz',10,'#cfd9e6') + txt(200,79,'v2.1',10,'#cfd9e6') +
      box(280,66,65,18,'#1a3c30','rgba(0,229,192,.4)') + txt(312,78,'Approved',8,'#00e5c0','middle') +
      txt(380,79,'Tree nuts',10,'#9aa7bd') + txt(500,79,'Lotus nutra',10,'#cfd9e6') +
      box(20,94,580,26,'#1a2c48','rgba(255,255,255,.05)') +
      txt(30,111,'Citrus Burst 16oz',10,'#cfd9e6') + txt(200,111,'v1.0',10,'#cfd9e6') +
      box(280,98,65,18,'#3d2f0a','rgba(245,200,66,.4)') + txt(312,110,'Benchtop',8,'#f5c842','middle') +
      txt(380,111,'None',10,'#9aa7bd') + txt(500,111,'Ceres 14',10,'#cfd9e6') +
      box(20,126,580,26,'#1a2c48','rgba(255,255,255,.05)') +
      txt(30,143,'Classic Cola 355ml',10,'#cfd9e6') + txt(200,143,'v3.0',10,'#cfd9e6') +
      box(280,130,50,18,'#1a2c48','rgba(255,255,255,.2)') + txt(305,142,'Draft',8,'#9aa7bd','middle') +
      txt(380,143,'Wheat',10,'#9aa7bd') + txt(500,143,'PitStop',10,'#cfd9e6') +
      box(20,158,580,26,'#1a2c48','rgba(231,76,60,.05)') +
      txt(30,175,'OG Recipe 2022',10,'#9aa7bd') + txt(200,175,'v1.2',10,'#9aa7bd') +
      box(280,162,62,18,'#3d1a1a','rgba(231,76,60,.4)') + txt(311,174,'Archived',8,'#e74c3c','middle') +
      txt(380,175,'Soy, Wheat',10,'#9aa7bd') + txt(500,175,'—',10,'#9aa7bd') +
      tag(280,66,1) + tag(280,98,2) + tag(280,130,3)
    ) +
    '<div style="font-size:11px;color:#9aa7bd;margin-bottom:6px">Numbered callouts on the wireframe above:</div>' +
    bullets([
      '<b>What it stores</b>: every formula tied to a client — name, version, batch size, target yield, allergens, status, and file attachments (spec sheets, COAs).',
      '<b>Status workflow (1–3)</b>: Draft (grey) → Benchtop (yellow, pilot batch underway) → Approved (green, cleared for production) → Archived (red, no longer active). Only approved formulas appear in the customer portal.',
      '<b>Allergen tracking</b>: the 9 major US allergens (milk, eggs, fish, shellfish, tree nuts, peanuts, wheat, soybeans, sesame) plus free-text custom allergens. Used to auto-generate allergen declarations.',
      '<b>Version numbering</b>: each save bumps the minor version (v1.0 → v1.1). Major reformulations get a new major version (v2.0). Previous versions are preserved in the history tab.'
    ]);

  var SEC_YIELD_TRACKER =
    wf(620, 190,
      box(0,0,620,190,'#142238','rgba(255,255,255,.05)') +
      txt(20,22,'📈 YIELD TRACKER',12,'#fff') +
      box(20,34,580,28,'#1a3c30','rgba(0,229,192,.15)') +
      txt(30,48,'Rolling 90-day avg yield:',10,'#9aa7bd') + txt(200,48,'91.4%',13,'#00e5c0') +
      txt(350,48,'Best run:',10,'#9aa7bd') + txt(420,48,'LOT-2026-08  ·  96.2%',10,'#5fcf9e') +
      box(20,66,580,22,'#0d1e35','rgba(255,255,255,.05)') +
      txt(30,80,'Run Ref',10,'#9aa7bd') + txt(140,80,'Client',10,'#9aa7bd') + txt(250,80,'Planned cases',10,'#9aa7bd') + txt(370,80,'Actual cases',10,'#9aa7bd') + txt(480,80,'Yield %',10,'#9aa7bd') +
      box(20,92,580,26,'#1a2c48','rgba(95,207,158,.05)') +
      txt(30,109,'LOT-2026-12',10,'#00e5c0') + txt(140,109,'Lotus nutra',10,'#cfd9e6') + txt(250,109,'500',10,'#cfd9e6') + txt(370,109,'488',10,'#cfd9e6') +
      box(480,96,60,18,'#1a3c30','rgba(0,229,192,.4)') + txt(510,108,'97.6%',9,'#00e5c0','middle') +
      box(20,124,580,26,'#1a2c48','rgba(245,200,66,.05)') +
      txt(30,141,'LOT-2026-10',10,'#00e5c0') + txt(140,141,'Ceres 14',10,'#cfd9e6') + txt(250,141,'200',10,'#cfd9e6') + txt(370,141,'174',10,'#cfd9e6') +
      box(480,128,60,18,'#3d2f0a','rgba(245,200,66,.4)') + txt(510,140,'87.0%',9,'#f5c842','middle') +
      box(20,156,580,26,'#1a2c48','rgba(255,255,255,.05)') +
      txt(30,173,'LOT-2026-08',10,'#00e5c0') + txt(140,173,'PitStop',10,'#cfd9e6') + txt(250,173,'300',10,'#cfd9e6') + txt(370,173,'289',10,'#cfd9e6') +
      box(480,160,60,18,'#1a3c30','rgba(0,229,192,.4)') + txt(510,172,'96.2%',9,'#00e5c0','middle') +
      tag(20,34,1) + tag(480,96,2)
    ) +
    '<div style="font-size:11px;color:#9aa7bd;margin-bottom:6px">Numbered callouts on the wireframe above:</div>' +
    bullets([
      '<b>What yield % means</b>: (actual cases shipped / planned cases) × 100. Captures losses from breakage, rework, underfill, or QC rejects.',
      '<b>(1) Rolling average bar</b> — shows your 90-day average yield and the best single run. Useful for trend analysis and client SLAs.',
      '<b>(2) Color-coded yield column</b>: green ≥ 93%, yellow 85–92%, red &lt; 85%. Anything red should trigger a root-cause review.',
      '<b>Logging a completion</b>: open any Production Run card → set stage to "Ship" → fill in <b>Actual cases shipped</b>. The yield row is created automatically.'
    ]);

  var SEC_SAMPLE_SHIPMENTS =
    wf(620, 190,
      box(0,0,620,190,'#142238','rgba(255,255,255,.05)') +
      txt(20,22,'📦 SAMPLE SHIPMENTS',12,'#fff') +
      box(530,10,80,22,'rgba(0,229,192,.1)','rgba(0,229,192,.3)') + txt(570,24,'+ Log',9,'#00e5c0','middle') +
      box(20,36,580,22,'#0d1e35','rgba(255,255,255,.05)') +
      txt(30,51,'Sample #',10,'#9aa7bd') + txt(120,51,'Client',10,'#9aa7bd') + txt(230,51,'Product',10,'#9aa7bd') + txt(340,51,'Shipped',10,'#9aa7bd') + txt(430,51,'Follow-up',10,'#9aa7bd') + txt(530,51,'Status',10,'#9aa7bd') +
      box(20,62,580,26,'#1a2c48','rgba(107,159,255,.05)') +
      txt(30,79,'SMP-041',10,'#00e5c0') + txt(120,79,'Lotus nutra',10,'#cfd9e6') + txt(230,79,'Mango Seltzer',10,'#cfd9e6') + txt(340,79,'May 27',10,'#cfd9e6') + txt(430,79,'Jun 3',10,'#cfd9e6') +
      box(530,66,60,18,'#1a2c48','rgba(107,159,255,.4)') + txt(560,78,'sent',9,'#6b9fff','middle') +
      box(20,94,580,26,'#1a2c48','rgba(231,76,60,.05)') +
      txt(30,111,'SMP-039',10,'#00e5c0') + txt(120,111,'PitStop',10,'#cfd9e6') + txt(230,111,'Classic Cola',10,'#cfd9e6') + txt(340,111,'May 18',10,'#cfd9e6') + txt(430,111,'May 25',10,'#9aa7bd') +
      box(530,98,65,18,'#3d1a1a','rgba(231,76,60,.4)') + txt(562,110,'overdue',9,'#e74c3c','middle') +
      box(20,126,580,26,'#1a2c48','rgba(95,207,158,.05)') +
      txt(30,143,'SMP-037',10,'#00e5c0') + txt(120,143,'Ceres 14',10,'#cfd9e6') + txt(230,143,'Citrus Burst',10,'#cfd9e6') + txt(340,143,'May 12',10,'#cfd9e6') + txt(430,143,'May 19',10,'#cfd9e6') +
      box(530,130,75,18,'#1a3c30','rgba(0,229,192,.4)') + txt(567,142,'delivered',9,'#00e5c0','middle') +
      tag(530,66,1) + tag(530,98,2) + tag(530,10,3)
    ) +
    '<div style="font-size:11px;color:#9aa7bd;margin-bottom:6px">Numbered callouts on the wireframe above:</div>' +
    bullets([
      '<b>How to log a shipment</b>: click <b>+ Log</b>, fill in client, product description, carrier, tracking number, kind (flavor sample / spec sample / prototype / COA sample), quantity, and ship date.',
      '<b>(1) Sent status</b> — shipment logged but follow-up not yet due.',
      '<b>(2) Overdue follow-up</b> — 7 days after the ship date, the row turns red if no follow-up has been recorded. Click the row to log a follow-up note or mark it received.',
      '<b>Ties to pipeline</b>: each shipment can be linked to a Deal card. When a sample is delivered and followed up, the linked deal can be advanced to the next pipeline stage from the shipment row.'
    ]);

  var SEC_CONTENT_CALENDAR =
    wf(620, 220,
      box(0,0,620,220,'#142238','rgba(255,255,255,.05)') +
      txt(20,22,'📣 CONTENT CALENDAR  ·  June 2026',12,'#fff') +
      box(510,10,100,22,'rgba(0,229,192,.1)','rgba(0,229,192,.3)') + txt(560,24,'+ New Post',9,'#00e5c0','middle') +
      // Day headers
      txt(30,48,'SUN',8,'#9aa7bd') + txt(110,48,'MON',8,'#9aa7bd') + txt(190,48,'TUE',8,'#9aa7bd') + txt(270,48,'WED',8,'#9aa7bd') + txt(350,48,'THU',8,'#9aa7bd') + txt(430,48,'FRI',8,'#9aa7bd') + txt(510,48,'SAT',8,'#9aa7bd') +
      // Week row 1
      box(20,56,74,44,'#1a2c48','rgba(255,255,255,.05)') + txt(25,72,'1',9,'#9aa7bd') +
      box(100,56,74,44,'#1a2c48','rgba(255,255,255,.05)') + txt(105,72,'2',9,'#9aa7bd') +
      box(100,74,70,20,'#d63384','none') + txt(135,88,'Instagram',8,'#fff','middle') +
      box(180,56,74,44,'#1a2c48','rgba(255,255,255,.05)') + txt(185,72,'3',9,'#9aa7bd') +
      box(260,56,74,44,'#1a2c48','rgba(255,255,255,.05)') + txt(265,72,'4',9,'#9aa7bd') +
      box(260,74,70,20,'#0077b5','none') + txt(295,88,'LinkedIn',8,'#fff','middle') +
      box(340,56,74,44,'#1a2c48','rgba(255,255,255,.05)') + txt(345,72,'5',9,'#9aa7bd') +
      box(420,56,74,44,'#1a2c48','rgba(255,255,255,.05)') + txt(425,72,'6',9,'#9aa7bd') +
      box(420,74,70,20,'#00e5c0','none') + txt(455,88,'Email',8,'#0a1628','middle') +
      box(500,56,74,44,'#1a2c48','rgba(255,255,255,.05)') + txt(505,72,'7',9,'#9aa7bd') +
      // Week row 2
      box(20,106,74,44,'#1a2c48','rgba(255,255,255,.05)') + txt(25,122,'8',9,'#9aa7bd') +
      box(100,106,74,44,'#1a2c48','rgba(255,255,255,.05)') + txt(105,122,'9',9,'#9aa7bd') +
      box(180,106,74,44,'#1a2c48','rgba(255,255,255,.05)') + txt(185,122,'10',9,'#9aa7bd') +
      box(180,124,70,20,'#7952b3','none') + txt(215,138,'Facebook',8,'#fff','middle') +
      box(260,106,74,44,'#1a2c48','rgba(255,255,255,.05)') + txt(265,122,'11',9,'#9aa7bd') +
      box(340,106,74,44,'#1a2c48','rgba(255,255,255,.05)') + txt(345,122,'12',9,'#9aa7bd') +
      box(340,124,70,20,'#d63384','none') + txt(375,138,'Instagram',8,'#fff','middle') +
      box(420,106,74,44,'#1a2c48','rgba(255,255,255,.05)') + txt(425,122,'13',9,'#9aa7bd') +
      box(500,106,74,44,'#1a2c48','rgba(255,255,255,.05)') + txt(505,122,'14',9,'#9aa7bd') +
      // Legend
      box(20,158,74,20,'#d63384','none') + txt(57,172,'Instagram',8,'#fff','middle') +
      box(100,158,66,20,'#0077b5','none') + txt(133,172,'LinkedIn',8,'#fff','middle') +
      box(172,158,50,20,'#00e5c0','none') + txt(197,172,'Email',8,'#0a1628','middle') +
      box(228,158,66,20,'#7952b3','none') + txt(261,172,'Facebook',8,'#fff','middle') +
      tag(510,10,1) + tag(100,74,2) + tag(260,74,3)
    ) +
    '<div style="font-size:11px;color:#9aa7bd;margin-bottom:6px">Numbered callouts on the wireframe above:</div>' +
    bullets([
      '<b>Channels supported</b>: Instagram (pink), LinkedIn (blue), Email (teal), Facebook (purple). Each post chip is color-coded by channel on the calendar.',
      '<b>(1) + New Post</b> — click to create a post: pick the channel, set the date, write the caption / subject, and optionally attach an image.',
      '<b>(2)–(3) AI Social Post drafter</b> — when creating a post, click <b>🤖 Draft with AI</b> to generate a platform-optimised caption based on your product and audience. Edit before saving.',
      '<b>How to publish</b>: the calendar is a planning tool — posts are drafted and tracked here. When the date arrives, copy the caption and post manually (or via a connected scheduler like Buffer). Future automation is on the roadmap.'
    ]);

  var SEC_CIP_LOG =
    wf(620, 200,
      box(0,0,620,200,'#142238','rgba(255,255,255,.05)') +
      txt(20,22,'🧼 CIP / SANITATION LOG',12,'#fff') +
      box(480,10,130,22,'rgba(0,229,192,.1)','rgba(0,229,192,.3)') + txt(545,24,'+ Add Cycle',9,'#00e5c0','middle') +
      box(20,36,580,22,'#0d1e35','rgba(255,255,255,.05)') +
      txt(30,51,'Date / Time',10,'#9aa7bd') + txt(155,51,'Line',10,'#9aa7bd') + txt(250,51,'Sanitizer',10,'#9aa7bd') + txt(350,51,'Temp (°F)',10,'#9aa7bd') + txt(420,51,'Duration',10,'#9aa7bd') + txt(490,51,'Logged by',10,'#9aa7bd') +
      box(20,62,580,26,'#1a2c48','rgba(95,207,158,.05)') +
      txt(30,79,'May 29  06:30',10,'#cfd9e6') + txt(155,79,'Canning L1',10,'#cfd9e6') + txt(250,79,'Saniclean 1%',10,'#cfd9e6') + txt(350,79,'145°F',10,'#cfd9e6') + txt(420,79,'22 min',10,'#cfd9e6') + txt(490,79,'J. Rivera',10,'#cfd9e6') +
      box(20,94,580,26,'#1a2c48','rgba(255,255,255,.05)') +
      txt(30,111,'May 28  17:15',10,'#cfd9e6') + txt(155,111,'Bottling L1',10,'#cfd9e6') + txt(250,111,'PAA 200ppm',10,'#cfd9e6') + txt(350,111,'140°F',10,'#cfd9e6') + txt(420,111,'18 min',10,'#cfd9e6') + txt(490,111,'M. Krail',10,'#cfd9e6') +
      box(20,126,580,26,'#1a2c48','rgba(255,255,255,.05)') +
      txt(30,143,'May 28  06:00',10,'#cfd9e6') + txt(155,143,'R&D Bench',10,'#cfd9e6') + txt(250,143,'Saniclean 1%',10,'#cfd9e6') + txt(350,143,'140°F',10,'#cfd9e6') + txt(420,143,'15 min',10,'#cfd9e6') + txt(490,143,'J. Rivera',10,'#cfd9e6') +
      box(430,168,180,22,'#1a3c30','rgba(0,229,192,.3)') + txt(520,183,'FDA-defensible record ✓',9,'#00e5c0','middle') +
      tag(480,10,1) + tag(430,168,2)
    ) +
    '<div style="font-size:11px;color:#9aa7bd;margin-bottom:6px">Numbered callouts on the wireframe above:</div>' +
    bullets([
      '<b>What Clean-In-Place (CIP) is</b>: the automated or manual process of cleaning and sanitising production equipment without disassembly. Required between every production run under 21 CFR Part 117 (FSMA Preventive Controls).',
      '<b>When to log it</b>: after every production run, before switching products, and at the start/end of each shift. The log should be completed by the operator who performed the CIP, not a supervisor.',
      '<b>(1) + Add Cycle</b> — fill in: line, sanitizer name + concentration, rinse water temperature, contact time (minutes), and your name. Hit Save. The record is timestamped server-side and is immutable (Part 11 compliant).',
      '<b>(2) FDA-defensible record</b> — each entry is stored in Supabase with a server timestamp, user ID, and a hash. During an FDA inspection you can export the full log as a signed PDF from the Compliance → 📤 Export button.'
    ]);

  var SEC_HOLD_TAGS =
    wf(620, 210,
      box(0,0,620,210,'#142238','rgba(255,255,255,.05)') +
      txt(20,22,'🚫 HOLD TAGS',12,'#fff') +
      box(510,10,100,22,'rgba(231,76,60,.1)','rgba(231,76,60,.3)') + txt(560,24,'+ New Hold',9,'#e74c3c','middle') +
      box(20,38,580,58,'#1a2c48','rgba(231,76,60,.15)') +
      txt(30,56,'Mango Seltzer  ·  LOT-2026-12',11,'#fff') +
      txt(30,72,'Reason: Foreign object detected in inspection — metal fragment &lt; 2mm.',10,'#9aa7bd') +
      txt(30,86,'Blocked from shipping. Hold placed May 29 by M. Krail.',9,'#9aa7bd') +
      box(490,48,100,20,'#3d1a1a','rgba(231,76,60,.5)') + txt(540,61,'🔴 Active hold',8,'#e74c3c','middle') +
      box(490,72,100,20,'rgba(255,255,255,.05)','rgba(231,76,60,.3)') + txt(540,85,'Release Hold',8,'#e74c3c','middle') +
      box(20,104,580,52,'#1a2c48','rgba(95,207,158,.15)') +
      txt(30,122,'Classic Cola  ·  LOT-2026-10',11,'#fff') +
      txt(30,138,'Reason: pH out of spec — corrected and re-tested. Lab sign-off received.',10,'#9aa7bd') +
      txt(30,152,'Released May 27 by M. Krail. Root cause logged.',9,'#9aa7bd') +
      box(490,114,100,20,'#1a3c30','rgba(0,229,192,.4)') + txt(540,127,'🟢 Released',8,'#00e5c0','middle') +
      txt(20,180,'GMP-QC-001  ·  Hold Tag SOP  ·  Supabase hold_tags table',9,'#9aa7bd') +
      tag(490,48,1) + tag(490,114,2) + tag(510,10,3)
    ) +
    '<div style="font-size:11px;color:#9aa7bd;margin-bottom:6px">Numbered callouts on the wireframe above:</div>' +
    bullets([
      '<b>What a hold tag does</b>: quarantines a product lot and prevents it from being shipped or released until the issue is resolved and the hold is cleared. Required procedure under GMP-QC-001.',
      '<b>How to create a hold (3)</b>: Compliance → 🚫 Hold Tags → <b>+ New Hold Tag</b>. Fill in lot number, product, reason, and severity. The lot is immediately flagged across the system.',
      '<b>(1) Active hold</b> — lot is quarantined. A red banner appears on the matching Production Run card. The customer portal also surfaces the hold on their run view.',
      '<b>(2) Releasing a hold</b> — click <b>Release Hold</b>, enter the corrective action taken + confirmation of re-test / lab sign-off. The record is permanently logged (immutable for FDA audit trail). Status flips to Released (green) and shipping is unblocked.'
    ]);

  var SEC_DEFECTS_NCR =
    wf(620, 200,
      box(0,0,620,200,'#142238','rgba(255,255,255,.05)') +
      txt(20,22,'⚠️ DEFECTS / NCRs (Non-Conformance Reports)',12,'#fff') +
      box(510,10,100,22,'rgba(245,200,66,.1)','rgba(245,200,66,.3)') + txt(560,24,'+ New NCR',9,'#f5c842','middle') +
      box(20,36,580,22,'#0d1e35','rgba(255,255,255,.05)') +
      txt(30,51,'Date',10,'#9aa7bd') + txt(110,51,'Run Ref',10,'#9aa7bd') + txt(210,51,'Type',10,'#9aa7bd') + txt(330,51,'Severity',10,'#9aa7bd') + txt(430,51,'Status',10,'#9aa7bd') + txt(530,51,'Action',10,'#9aa7bd') +
      box(20,62,580,26,'#1a2c48','rgba(231,76,60,.05)') +
      txt(30,79,'May 29',10,'#cfd9e6') + txt(110,79,'LOT-2026-12',10,'#00e5c0') + txt(210,79,'Metal contamination',10,'#cfd9e6') +
      box(330,66,58,18,'#3d1a1a','rgba(231,76,60,.5)') + txt(359,78,'Critical',8,'#e74c3c','middle') +
      box(430,66,50,18,'#3d2f0a','rgba(245,200,66,.4)') + txt(455,78,'Open',8,'#f5c842','middle') +
      txt(530,79,'🤖 Suggest',9,'#c4b5fd') +
      box(20,94,580,26,'#1a2c48','rgba(255,154,60,.05)') +
      txt(30,111,'May 26',10,'#cfd9e6') + txt(110,111,'LOT-2026-10',10,'#00e5c0') + txt(210,111,'pH out of spec',10,'#cfd9e6') +
      box(330,98,50,18,'#3d2000','rgba(255,154,60,.4)') + txt(355,110,'Major',8,'#ff9a3c','middle') +
      box(430,98,55,18,'#1a3c30','rgba(0,229,192,.4)') + txt(457,110,'Closed',8,'#00e5c0','middle') +
      txt(530,111,'View RCA',9,'#9aa7bd') +
      box(20,126,580,26,'#1a2c48','rgba(245,200,66,.05)') +
      txt(30,143,'May 22',10,'#cfd9e6') + txt(110,143,'LOT-2026-08',10,'#00e5c0') + txt(210,143,'Label misprint',10,'#cfd9e6') +
      box(330,130,50,18,'#3d2f0a','rgba(245,200,66,.3)') + txt(355,142,'Minor',8,'#f5c842','middle') +
      box(430,130,55,18,'#1a3c30','rgba(0,229,192,.4)') + txt(457,142,'Closed',8,'#00e5c0','middle') +
      txt(530,143,'View RCA',9,'#9aa7bd') +
      tag(330,66,1) + tag(330,98,2) + tag(330,130,3)
    ) +
    '<div style="font-size:11px;color:#9aa7bd;margin-bottom:6px">Numbered callouts on the wireframe above:</div>' +
    bullets([
      '<b>What NCRs are</b>: Non-Conformance Reports document any product, process, or material that fails to meet specification. Required under 21 CFR Part 117 preventive controls.',
      '<b>Three severity levels (1–3)</b>: <span style="color:#e74c3c">Critical</span> — potential safety hazard (metal, allergen, pathogen); <span style="color:#ff9a3c">Major</span> — significant quality deviation (out-of-spec pH, fill weight); <span style="color:#f5c842">Minor</span> — cosmetic or documentation issue (label misprint).',
      '<b>Root-cause workflow</b>: open any NCR → click <b>🤖 Suggest root cause</b> → AI returns root cause, corrective action, and preventive action based on the defect type and description. Edit and save to lock in the Root Cause Analysis (RCA).',
      '<b>Closing a defect</b>: once corrective action is complete and verified, set status to Closed. The record is immutable (FDA audit trail). Closed NCRs remain searchable by lot number.'
    ]);

  var SEC_VENDORS =
    wf(620, 200,
      box(0,0,620,200,'#142238','rgba(255,255,255,.05)') +
      txt(20,22,'🏭 VENDOR DIRECTORY',12,'#fff') +
      box(510,10,100,22,'rgba(0,229,192,.1)','rgba(0,229,192,.3)') + txt(560,24,'+ Add Vendor',9,'#00e5c0','middle') +
      box(20,36,580,22,'#0d1e35','rgba(255,255,255,.05)') +
      txt(30,51,'Vendor name',10,'#9aa7bd') + txt(185,51,'Type',10,'#9aa7bd') + txt(280,51,'Lead time',10,'#9aa7bd') + txt(360,51,'Certificate of Insurance',10,'#9aa7bd') + txt(510,51,'Last order',10,'#9aa7bd') +
      box(20,62,580,26,'#1a2c48','rgba(95,207,158,.05)') +
      txt(30,79,'Allied Filling Solutions',10,'#cfd9e6') + txt(185,79,'Co-packer',10,'#9aa7bd') + txt(280,79,'5 days',10,'#cfd9e6') +
      box(360,66,75,18,'#1a3c30','rgba(0,229,192,.4)') + txt(397,78,'Valid',8,'#00e5c0','middle') +
      txt(510,79,'May 15',10,'#cfd9e6') +
      box(20,94,580,26,'#1a2c48','rgba(231,76,60,.05)') +
      txt(30,111,'AgroPack Ingredients',10,'#cfd9e6') + txt(185,111,'Supplier',10,'#9aa7bd') + txt(280,111,'14 days',10,'#cfd9e6') +
      box(360,98,70,18,'#3d1a1a','rgba(231,76,60,.4)') + txt(395,110,'Expired',8,'#e74c3c','middle') +
      txt(510,111,'Apr 2',10,'#cfd9e6') +
      box(20,126,580,26,'#1a2c48','rgba(255,255,255,.05)') +
      txt(30,143,'PackRight Labels',10,'#cfd9e6') + txt(185,143,'Packaging',10,'#9aa7bd') + txt(280,143,'7 days',10,'#cfd9e6') +
      box(360,130,55,18,'#1a2c48','rgba(255,255,255,.2)') + txt(387,142,'None',8,'#9aa7bd','middle') +
      txt(510,143,'May 22',10,'#cfd9e6') +
      box(20,162,580,26,'#1a2c48','rgba(255,255,255,.05)') +
      txt(30,179,'BioVerify Labs',10,'#cfd9e6') + txt(185,179,'Lab / Testing',10,'#9aa7bd') + txt(280,179,'3 days',10,'#cfd9e6') +
      box(360,166,75,18,'#1a3c30','rgba(0,229,192,.4)') + txt(397,178,'Valid',8,'#00e5c0','middle') +
      txt(510,179,'May 27',10,'#cfd9e6') +
      tag(360,66,1) + tag(360,98,2) + tag(510,10,3)
    ) +
    '<div style="font-size:11px;color:#9aa7bd;margin-bottom:6px">Numbered callouts on the wireframe above:</div>' +
    bullets([
      '<b>What the directory tracks</b>: all ingredient suppliers, co-packers, packaging vendors, labs, and service providers. Each entry stores contact info, type, typical lead time, Certificate of Insurance (COI) status and expiry, and last order date.',
      '<b>(1) COI Valid</b> — Certificate of Insurance on file and not expired. <b>(2) COI Expired</b> — a red badge appears and the dashboard surfaces an alert. Always collect a new COI before placing the next order with that vendor.',
      '<b>COI expiry alerts</b>: the dashboard System Health widget shows a warning for any vendor whose COI expires within 30 days. Click the vendor row to upload the renewed certificate.',
      '<b>(3) + Add Vendor</b> — fill in name, type, contact, lead time, COI expiry date (optional), and any notes. The vendor is immediately available for linking to Production Runs.',
      '<b>How it connects to production</b>: when creating or editing a Production Run, you can tag the run\'s ingredient suppliers and packaging vendor. This creates a traceability link used in mock recall drills.'
    ]);

  var SEC_BULK_OUTREACH =
    wf(620, 220,
      box(0,0,620,220,'#0a1628','rgba(255,255,255,.05)') +
      box(0,0,620,36,'#142238','rgba(255,255,255,.08)') +
      txt(20,23,'📤 BULK OUTREACH  ·  Prospecting (8 leads)',13,'#fff') +
      txt(580,23,'✕',12,'#9aa7bd','end') +
      // Checklist
      box(20,46,240,160,'#142238','rgba(255,255,255,.05)') +
      txt(30,62,'SELECT LEADS',9,'#9aa7bd') +
      txt(34,80,'☑',11,'#00e5c0') + txt(58,80,'Apex Beverages',10,'#fff') +
      txt(34,98,'☑',11,'#00e5c0') + txt(58,98,'BlueSky Drinks',10,'#fff') +
      txt(34,116,'☐',11,'#9aa7bd') + txt(58,116,'Canyon Craft',10,'#9aa7bd') +
      txt(34,134,'☑',11,'#00e5c0') + txt(58,134,'DeltaDrinks LLC',10,'#fff') +
      txt(34,152,'☐',11,'#9aa7bd') + txt(58,152,'Echo Brewing',10,'#9aa7bd') +
      txt(34,170,'☑',11,'#00e5c0') + txt(58,170,'Floral Seltzers',10,'#fff') +
      // Preview pane
      box(270,46,340,160,'#142238','rgba(255,255,255,.05)') +
      txt(280,62,'AI-DRAFTED PREVIEW  ·  Apex Beverages',9,'#9aa7bd') +
      txt(280,80,'Subject: Good Liquid Bev Co — Private Label Production',10,'#00e5c0') +
      txt(280,98,'Hi [First Name],',10,'#cfd9e6') +
      txt(280,114,'I wanted to reach out about co-packing and private',10,'#9aa7bd') +
      txt(280,130,'label production for Apex Beverages. We specialise',10,'#9aa7bd') +
      txt(280,146,'in beverage runs from 50–5,000 cases with full R&D',10,'#9aa7bd') +
      txt(280,162,'support. Would love to connect. — Mike Krail',10,'#9aa7bd') +
      box(400,190,210,22,'#1a6fff','none') + txt(505,204,'📤 Send 4 emails',10,'#fff','middle') +
      tag(20,46,1) + tag(270,46,2) + tag(400,190,3)
    ) +
    '<div style="font-size:11px;color:#9aa7bd;margin-bottom:6px">Numbered callouts on the wireframe above:</div>' +
    bullets([
      '<b>How to find it</b>: Pipeline page → header → <b>📤 Bulk Outreach</b> button. Only appears for admin/sales roles.',
      '<b>(1) Lead checklist</b> — all deals in Prospecting are listed with checkboxes. Tick the ones you want to email. Unticked deals are skipped.',
      '<b>(2) AI-drafted preview</b> — the right pane shows an AI-generated cold-outreach email personalised to the selected lead\'s company name. You can edit the subject and body before sending.',
      '<b>(3) Send X emails</b> — fires one email per selected deal via Mailgun, marks each deal as "outreach sent" in the pipeline (a small badge appears on the card), and logs the sends to Email Activity.',
      '<b>Variables used</b>: company name, deal value (if set), and your email signature. The AI adjusts the tone based on the deal stage.'
    ]);

  var SEC_SCHEDULING =
    wf(620, 240,
      box(0,0,620,240,'#0a1628','rgba(255,255,255,.05)') +
      box(0,0,620,36,'#142238','rgba(255,255,255,.08)') +
      txt(20,23,'📅 SCHEDULING LINK  ·  Mike Krail',13,'#fff') +
      txt(580,23,'✕',12,'#9aa7bd','end') +
      // Link display
      box(20,50,580,28,'#0f1a2e','rgba(0,229,192,.07)') +
      txt(30,67,'goodliquidbevco.com/book?u=mike',11,'#00e5c0') +
      txt(560,67,'Copy',10,'#00e5c0','end') +
      // Settings grid
      box(20,90,180,130,'#142238','rgba(255,255,255,.05)') +
      txt(30,106,'AVAILABILITY',9,'#9aa7bd') +
      txt(30,124,'Duration: 30 min',10,'#fff') +
      txt(30,140,'Buffer: 10 min',10,'#9aa7bd') +
      txt(30,156,'Mon – Fri',10,'#fff') +
      txt(30,172,'9:00 AM – 5:00 PM',10,'#9aa7bd') +
      txt(30,188,'Eastern Time',10,'#9aa7bd') +
      // Upcoming bookings
      box(214,90,386,130,'#142238','rgba(255,255,255,.05)') +
      txt(224,106,'UPCOMING BOOKINGS',9,'#9aa7bd') +
      txt(224,124,'Jane Smith',10,'#fff') + txt(570,124,'Jun 5, 10:00 AM',10,'#9aa7bd','end') +
      txt(224,140,'jane@acmebrew.com · Acme Brewing',10,'#5fcf9e') +
      txt(224,162,'Carlos Rivera',10,'#fff') + txt(570,162,'Jun 6, 2:00 PM',10,'#9aa7bd','end') +
      txt(224,178,'carlos@sunseltzer.com',10,'#5fcf9e') +
      box(520,186,70,22,'rgba(231,70,70,.2)','none') + txt(555,200,'Cancel',9,'#e74646','middle') +
      tag(20,50,1) + tag(20,90,2) + tag(214,90,3)
    ) +
    '<div style="font-size:11px;color:#9aa7bd;margin-bottom:6px">Numbered callouts on the wireframe above:</div>' +
    bullets([
      '<b>(1) Your shareable link</b> — a unique URL like <code>goodliquidbevco.com/book?u=mike</code>. Anyone who opens it can see your availability and book a slot — no login required. Use "Copy Link" or "Send via Email" to share it.',
      '<b>(2) Availability settings</b> — set your meeting duration (15 / 30 / 60 min), buffer after each meeting, which days you\'re available, and your working hours. Changes save instantly. Visitors always see real-time availability.',
      '<b>(3) Upcoming bookings</b> — every confirmed booking appears here. The Cancel button cancels from your end; a confirmation email has already gone to the visitor. The booking also appears on your General Calendar.',
      '<b>What the visitor sees</b>: a clean booking page with a month calendar (unavailable days are greyed out), clickable time slots, and a short form (name, email, company, notes). On submit they get an instant confirmation email and you get a notification email.',
      '<b>Where to find it</b>: Sidebar → <b>Calendars → Scheduling Link</b>.'
    ]) +
    '<h4 style="color:#00e5c0;margin:20px 0 8px;font-size:12px;letter-spacing:.5px;text-transform:uppercase">Email Invite Button</h4>' +
    wf(620, 162,
      box(0,0,620,162,'#0a1628','rgba(255,255,255,.05)') +
      txt(20,22,'Send Scheduling Link via Email',12,'#fff') +
      txt(20,44,'To:',10,'#9aa7bd') +
      box(44,34,556,20,'#0f1a2e','rgba(255,255,255,.08)') + txt(54,48,'jane@acmebrew.com',10,'#fff') +
      txt(20,72,'Subject:',10,'#9aa7bd') +
      box(66,62,534,20,'#0f1a2e','rgba(255,255,255,.08)') + txt(76,76,'Your scheduling link from Good Liquid Bev Co',10,'#fff') +
      box(20,92,580,42,'#142238','rgba(255,255,255,.05)') +
      txt(30,108,'Hi Jane, you can book a time with us using the button below:',9,'#9aa7bd') +
      box(200,112,220,18,'#00e5c0','none') + txt(310,124,'Book a Time with Good Liquid',9,'#0a1628','middle') +
      txt(30,148,'The raw URL is hidden inside the button — the recipient sees clean branding, not a long link.',9,'#5a7a9a') +
      tag(200,112,1)
    ) +
    bullets([
      '<b>(1) Styled CTA button</b> — instead of a raw URL, the recipient gets a teal "Book a Time with Good Liquid" button. Clicking it opens your scheduling page directly.',
      '<b>How to send</b> — from the Scheduling Link panel, click "Send via Email", enter the recipient\'s address, and hit Send. The button email is generated automatically.',
      '<b>Custom subject line</b> — the subject is pre-filled but editable before you send.'
    ]) +
    '<h4 style="color:#00e5c0;margin:20px 0 8px;font-size:12px;letter-spacing:.5px;text-transform:uppercase">Double-Booking Prevention</h4>' +
    bullets([
      '<b>Automatic conflict check</b> — when a visitor tries to book a slot, the system checks your General Calendar for existing events at that time. Slots already taken are grayed out and unclickable on the public booking page.',
      '<b>Buffer time</b> — the buffer you configure (default 10 min) is added after each meeting before the next slot opens, so you are never booked back-to-back without a break.',
      '<b>Manual calendar blocks it too</b> — if you add an event directly to your General Calendar (a production run, lunch, etc.), that window is automatically blocked on the public booking page as well.'
    ]);

  var SEC_RESOURCE_LIBRARY =
    wf(620, 254,
      box(0,0,620,254,'#060d1a','rgba(255,255,255,.04)') +
      txt(20,22,'RESOURCE LIBRARY',12,'#fff') +
      txt(20,40,'Five deep-dive articles for beverage brand founders',10,'#5a7a9a') +
      box(20,54,292,88,'#0d1e35','rgba(196,164,248,.12)') +
      txt(30,72,'BRAND LAUNCH',8,'#c4a4f8') +
      txt(30,88,'How to launch a hard kombucha brand',10,'#fff') +
      txt(30,106,'6 min read',8,'#5a7a9a') + txt(303,130,'→',10,'#c4a4f8','end') +
      box(328,54,272,88,'#0d1e35','rgba(127,198,245,.12)') +
      txt(338,72,'OPERATIONS',8,'#7fc6f5') +
      txt(338,88,'Canning MOQs explained',10,'#fff') +
      txt(338,106,'4 min read',8,'#5a7a9a') + txt(592,130,'→',10,'#7fc6f5','end') +
      box(20,152,186,88,'#0d1e35','rgba(0,229,192,.12)') +
      txt(30,170,'R&amp;D',8,'#00e5c0') +
      txt(30,184,'Flash vs. tunnel pasteurization',10,'#fff') +
      txt(30,198,'for botanicals  ·  7 min',8,'#5a7a9a') +
      box(216,152,190,88,'#0d1e35','rgba(196,164,248,.12)') +
      txt(226,170,'R&amp;D',8,'#c4a4f8') +
      txt(226,184,'Pasteurization vs.',10,'#fff') +
      txt(226,198,'cold-fill  ·  5 min',8,'#5a7a9a') +
      box(416,152,184,88,'#0d1e35','rgba(245,200,66,.12)') +
      txt(426,170,'PACKAGING',8,'#f5c842') +
      txt(426,184,'PakTech handles +',10,'#fff') +
      txt(426,198,'custom lid colors  ·  3 min',8,'#5a7a9a') +
      tag(20,54,1) + tag(20,152,2) + tag(550,22,3)
    ) +
    '<div style="font-size:11px;color:#9aa7bd;margin-bottom:6px">Numbered callouts on the wireframe above:</div>' +
    bullets([
      '<b>(1) Top-row cards</b> — "How to launch a hard kombucha brand" (6 min, Brand Launch) and "Canning MOQs Explained" (4 min, Operations). Click either card to open the full article.',
      '<b>(2) Bottom-row cards</b> — three R&amp;D and Packaging articles: Flash vs. Tunnel Pasteurization for Botanicals (7 min), Pasteurization vs. Cold-Fill (5 min), and PakTech Handles + Custom Lid Colors (3 min).',
      '<b>(3) Live linked pages</b> — each article is a full standalone HTML page at <code>goodliquidbev.com/resources/</code>. They open directly in the browser — no modal, no login required.',
      '<b>Article categories</b>: Brand Launch · Operations · R&amp;D · Packaging. Each card is color-coded to its category and shows the estimated read time.',
      '<b>Where to find it</b>: Main marketing website home page → scroll down to the <b>Resource Library</b> section.'
    ]);

  // ──────────────────────────────────────────────────────────
  // ACCOUNTING ENHANCEMENT HELP SECTIONS
  // ──────────────────────────────────────────────────────────

  var SEC_PARTIAL_PAYMENTS =
    wf(620, 220,
      box(0,0,620,220,'#0a1628','rgba(255,255,255,.05)') +
      box(0,0,620,36,'#142238','rgba(255,255,255,.08)') +
      txt(20,23,'💵 Record Payment — GL-2025-042',13,'#fff') +
      txt(580,23,'✕',12,'#9aa7bd','end') +
      box(20,50,180,60,'#1a2c48','rgba(0,229,192,.15)') + txt(30,68,'Invoice Total',10,'#9aa7bd') + txt(30,94,'$1,250.00',16,'#fff') +
      box(210,50,180,60,'#1a2c48','rgba(95,207,158,.25)') + txt(220,68,'Paid',10,'#9aa7bd') + txt(220,94,'$750.00',16,'#5fcf9e') +
      box(400,50,200,60,'#1a2c48','rgba(231,76,60,.25)') + txt(410,68,'Remaining',10,'#9aa7bd') + txt(410,94,'$500.00',16,'#e74c3c') +
      box(20,124,580,28,'#1a2c48','rgba(255,255,255,.05)') + txt(30,142,'2025-05-01  ·  Check  ·  #1042',10,'#9aa7bd') + txt(560,142,'$750.00',10,'#5fcf9e','end') +
      box(20,158,200,40,'#243a56','rgba(0,229,192,.2)') + txt(30,178,'Amount: $500.00',10,'#00e5c0') +
      box(230,158,160,40,'#243a56','rgba(255,255,255,.08)') + txt(240,178,'Method: ACH',10,'#9aa7bd') +
      box(400,158,100,40,'#5fcf9e','none') + txt(450,178,'Save Payment',10,'#0a1628','middle')
    ) +
    bullets([
      '<b>Where to find it</b>: open any invoice → click <b>💵 Record Payment</b> in the button row.',
      '<b>Partial payments</b>: record any amount up to the remaining balance. Each payment is saved to <code>invoice_payments</code> with date, method, and optional reference/check number.',
      '<b>Payment methods</b>: Check, Wire transfer, ACH, Cash, Stripe, Other.',
      '<b>Full payment</b>: when the payment brings the balance to $0 the invoice status automatically flips to <b>paid</b> and you\'re offered the option to send a receipt email to the client.',
      '<b>Payment history</b>: every prior payment appears in the table above the "Record New Payment" form — date, method, reference, and amount.',
      '<b>Receipt email</b>: call <code>window.glSendPaymentReceipt(invId)</code> from the console, or just confirm when prompted after a full payment. Routes through your configured email provider (Mailgun).'
    ]);

  var SEC_COLLECTIONS_SEQ =
    wf(620, 200,
      box(0,0,620,200,'#0a1628','rgba(255,255,255,.05)') +
      box(0,0,620,36,'#142238','rgba(255,255,255,.08)') +
      txt(20,23,'📋 Collections Sequence — GL-2025-038',13,'#fff') +
      txt(580,23,'✕',12,'#9aa7bd','end') +
      txt(20,56,'Step',9,'#9aa7bd') + txt(160,56,'Send Date',9,'#9aa7bd') + txt(340,56,'Type',9,'#9aa7bd') +
      box(20,66,580,24,'#1a2c48','rgba(255,255,255,.05)') + txt(30,82,'Gentle reminder',10,'#fff') + txt(170,82,'Jun 3, 2025',10,'#9aa7bd') + txt(350,82,'gentle',10,'#9aa7bd') +
      box(20,96,580,24,'#1a2c48','rgba(107,159,255,.2)') + txt(30,112,'Firm reminder',10,'#fff') + txt(170,112,'Jun 14, 2025',10,'#9aa7bd') + txt(350,112,'firm',10,'#9aa7bd') +
      box(20,126,580,24,'#1a2c48','rgba(245,200,66,.2)') + txt(30,142,'Urgent notice',10,'#fff') + txt(170,142,'Jun 30, 2025',10,'#9aa7bd') + txt(350,142,'urgent',10,'#f5c842') +
      box(20,156,580,24,'#1a2c48','rgba(231,76,60,.2)') + txt(30,172,'Final notice',10,'#fff') + txt(170,172,'Jul 15, 2025',10,'#9aa7bd') + txt(350,172,'final',10,'#e74c3c') +
      box(440,184,160,12,'#e74c3c','none') + txt(520,192,'Schedule Sequence',9,'#fff','middle')
    ) +
    bullets([
      '<b>Where to find it</b>: on any overdue invoice detail, click the <b>📋 Collect</b> button in the action row (only appears on past-due invoices).',
      '<b>The 4-step sequence</b>: Gentle reminder (day 3) → Firm reminder (day 14) → Urgent notice (day 30) → Final notice (day 45). All dates computed from today.',
      '<b>Scheduling</b>: steps are inserted into the <code>email_schedule</code> table. A separate job picks them up and sends them at the right time via Mailgun.',
      '<b>Client email required</b>: the modal shows the client\'s email on file. If none exists, add the email via Client Edit before scheduling.',
      '<b>Cancelling</b>: delete rows from the <code>email_schedule</code> table in Supabase directly, or mark the invoice paid (pending steps won\'t fire for paid invoices).'
    ]);

  var SEC_RECURRING_INV =
    wf(620, 210,
      box(0,0,620,210,'#0a1628','rgba(255,255,255,.05)') +
      box(0,0,620,36,'#142238','rgba(255,255,255,.08)') +
      txt(20,23,'🔄 Recurring Invoices',13,'#fff') +
      txt(580,23,'✕',12,'#9aa7bd','end') +
      txt(20,56,'Client',9,'#9aa7bd') + txt(160,56,'Description',9,'#9aa7bd') + txt(310,56,'Amount',9,'#9aa7bd') + txt(380,56,'Frequency',9,'#9aa7bd') + txt(470,56,'Next Run',9,'#9aa7bd') + txt(540,56,'Status',9,'#9aa7bd') +
      box(20,66,580,24,'#1a2c48','rgba(95,207,158,.1)') + txt(30,82,'Lotus Nutra',10,'#fff') + txt(170,82,'Monthly retainer',10,'#9aa7bd') + txt(320,82,'$1,500',10,'#5fcf9e') + txt(390,82,'monthly',10,'#9aa7bd') + txt(480,82,'Jun 1',10,'#9aa7bd') + txt(540,82,'active',10,'#5fcf9e') +
      box(20,96,580,24,'#1a2c48','rgba(255,255,255,.04)') + txt(30,112,'AlphaFi',10,'#fff') + txt(170,112,'Quarterly formulation fee',10,'#9aa7bd') + txt(320,112,'$2,400',10,'#5fcf9e') + txt(390,112,'quarterly',10,'#9aa7bd') + txt(480,112,'Jul 1',10,'#9aa7bd') + txt(540,112,'active',10,'#5fcf9e') +
      box(20,136,580,64,'#1a2c48','rgba(255,255,255,.04)') +
      txt(30,154,'New Template:',10,'#00e5c0') +
      txt(30,172,'Client ▾',9,'#9aa7bd') + txt(130,172,'Amount',9,'#9aa7bd') + txt(230,172,'Description',9,'#9aa7bd') + txt(370,172,'monthly ▾',9,'#9aa7bd') + txt(460,172,'Start date',9,'#9aa7bd') +
      box(530,160,70,28,'#38a169','none') + txt(565,178,'Save',10,'#fff','middle')
    ) +
    bullets([
      '<b>Where to find it</b>: on the Invoices page, click the <b>🔄 Recurring</b> button in the toolbar.',
      '<b>Creating a template</b>: choose client → enter description, amount, frequency (weekly / monthly / quarterly / annually) and start date. Optionally set an end date.',
      '<b>Auto-generation</b>: when a <code>next_run</code> date arrives the system generates a real invoice automatically (via pg_cron job at 8 AM EST) and advances <code>next_run</code> to the next cycle.',
      '<b>Pause / Resume</b>: click the Pause or Resume button on any row. Paused templates are skipped by the auto-generator.',
      '<b>Payment terms</b>: new recurring invoices inherit the template\'s payment terms (default Net 30). Edit the template to change terms for future invoices.',
      '<b>Manual run</b>: if you need to generate a recurring invoice immediately, open the Supabase SQL editor and run the commented <code>pg_cron</code> body from the migration file.'
    ]);

  var SEC_CREDIT_MEMOS =
    wf(620, 180,
      box(0,0,620,180,'#0a1628','rgba(255,255,255,.05)') +
      box(0,0,620,36,'#142238','rgba(255,255,255,.08)') +
      txt(20,23,'📝 Issue Credit Memo',13,'#fff') +
      txt(580,23,'✕',12,'#9aa7bd','end') +
      txt(20,58,'A credit memo reduces a client\'s balance.',10,'#9aa7bd') +
      box(20,76,280,36,'#1a2c48','rgba(255,255,255,.06)') + txt(30,94,'Client: Lotus Nutra',11,'#fff') +
      box(310,76,290,36,'#1a2c48','rgba(255,255,255,.06)') + txt(320,94,'Amount: $250.00',11,'#fff') +
      box(20,120,580,28,'#1a2c48','rgba(255,255,255,.06)') + txt(30,138,'Reason: Return of excess packaging material',11,'#9aa7bd') +
      box(450,156,150,18,'#805ad5','none') + txt(525,168,'Issue Credit Memo',9,'#fff','middle')
    ) +
    bullets([
      '<b>Where to find it</b>: on the Invoices page, click the <b>📝 Credit Memo</b> button in the toolbar.',
      '<b>What it creates</b>: a new invoice record with prefix <code>CM-YYYY-XXXX</code>, negative amount, and <code>is_credit_memo=true</code>. Status is set to "paid" so it doesn\'t appear as an outstanding invoice.',
      '<b>Statement of Account</b>: credit memos appear in the client\'s statement as a "Credits" line item that reduces the balance due.',
      '<b>Use cases</b>: returns, over-billing corrections, goodwill discounts, or any other situation where you\'re reducing what a client owes.',
      '<b>Accounting note</b>: credit memos lower the client\'s Total Billed figure on the statement. Export CSV from Invoices to get the full picture for your accountant.'
    ]);

  var SEC_EXPENSE_TRACKER =
    wf(620, 210,
      box(0,0,620,210,'#0a1628','rgba(255,255,255,.05)') +
      box(0,0,620,36,'#142238','rgba(255,255,255,.08)') +
      txt(20,23,'💸 Expense Tracker',13,'#fff') +
      txt(580,23,'✕',12,'#9aa7bd','end') +
      box(20,44,200,52,'#1a2c48','rgba(231,76,60,.2)') + txt(30,62,'This Month',9,'#9aa7bd') + txt(30,84,'$4,320.00',18,'#e74c3c') +
      txt(360,62,'24 expenses tracked',10,'#9aa7bd') +
      txt(20,108,'Date',9,'#9aa7bd') + txt(100,108,'Vendor',9,'#9aa7bd') + txt(240,108,'Category',9,'#9aa7bd') + txt(360,108,'Notes',9,'#9aa7bd') + txt(560,108,'Amount',9,'#9aa7bd') +
      box(20,116,580,22,'#1a2c48','rgba(255,255,255,.05)') + txt(30,130,'2025-05-28',9,'#fff') + txt(110,130,'Crown Packaging',9,'#fff') + txt(250,130,'Packaging',9,'#9aa7bd') + txt(370,130,'Q2 order',9,'#9aa7bd') + txt(560,130,'$2,100',9,'#e74c3c','end') +
      box(20,140,580,22,'#1a2c48','rgba(255,255,255,.05)') + txt(30,154,'2025-05-25',9,'#fff') + txt(110,154,'Sysco',9,'#fff') + txt(250,154,'Ingredients',9,'#9aa7bd') + txt(370,154,'Botanicals',9,'#9aa7bd') + txt(560,154,'$980',9,'#e74c3c','end') +
      box(20,168,580,36,'#243a56','rgba(0,229,192,.1)') +
      txt(30,184,'Vendor ___',9,'#9aa7bd') + txt(140,184,'Amount ___',9,'#9aa7bd') + txt(260,184,'Category ▾',9,'#9aa7bd') + txt(380,184,'Date ___',9,'#9aa7bd') +
      box(530,172,70,28,'#e53e3e','none') + txt(565,188,'Save',10,'#fff','middle')
    ) +
    bullets([
      '<b>Where to find it</b>: on the Invoices page, click the <b>💸 Expenses</b> button in the toolbar.',
      '<b>Adding an expense</b>: enter vendor name, amount, category, date. Optionally link to a client or add notes. Hit <b>Save Expense</b>.',
      '<b>Categories</b>: Ingredients · Packaging · Equipment · Labor · Shipping · Marketing · Office · Travel · Utilities · Other.',
      '<b>This Month summary</b>: the top card shows total spend for the current calendar month at a glance.',
      '<b>Client tagging</b>: tag an expense to a specific client to track client-specific costs for profitability analysis.',
      '<b>Export</b>: expenses are stored in the <code>expenses</code> Supabase table. Pull a CSV from Supabase or build a custom report for your accountant.'
    ]);

  var SEC_STATEMENT_ACCT =
    wf(620, 210,
      box(0,0,620,210,'#0a1628','rgba(255,255,255,.05)') +
      box(0,0,620,36,'#142238','rgba(255,255,255,.08)') +
      txt(20,23,'📄 Statement of Account — Lotus Nutra',13,'#fff') +
      txt(560,23,'🖨️ Print',10,'#3182ce','end') +
      box(20,46,130,50,'#1a2c48','rgba(255,255,255,.06)') + txt(30,62,'Total Billed',9,'#9aa7bd') + txt(30,84,'$12,500',14,'#fff') +
      box(160,46,130,50,'#1a2c48','rgba(95,207,158,.2)') + txt(170,62,'Total Paid',9,'#9aa7bd') + txt(170,84,'$8,000',14,'#5fcf9e') +
      box(300,46,130,50,'#1a2c48','rgba(196,164,248,.2)') + txt(310,62,'Credits',9,'#9aa7bd') + txt(310,84,'$250',14,'#c4a4f8') +
      box(440,46,160,50,'#1a2c48','rgba(231,76,60,.2)') + txt(450,62,'Balance Due',9,'#9aa7bd') + txt(450,84,'$4,250',14,'#e74c3c') +
      txt(20,108,'Invoice #',9,'#9aa7bd') + txt(120,108,'Date',9,'#9aa7bd') + txt(200,108,'Due Date',9,'#9aa7bd') + txt(300,108,'Status',9,'#9aa7bd') + txt(560,108,'Amount',9,'#9aa7bd') +
      box(20,116,580,22,'#1a2c48','rgba(255,255,255,.05)') + txt(30,130,'GL-2025-038',9,'#fff') + txt(130,130,'Apr 1',9,'#9aa7bd') + txt(210,130,'May 1',9,'#9aa7bd') + txt(310,130,'overdue',9,'#e74c3c') + txt(560,130,'$4,500',9,'#e74c3c','end') +
      box(20,140,580,22,'#1a2c48','rgba(255,255,255,.05)') + txt(30,154,'GL-2025-029',9,'#fff') + txt(130,154,'Mar 1',9,'#9aa7bd') + txt(210,154,'Apr 1',9,'#9aa7bd') + txt(310,154,'paid',9,'#5fcf9e') + txt(560,154,'$3,500',9,'#5fcf9e','end') +
      box(20,164,580,22,'#1a2c48','rgba(196,164,248,.1)') + txt(30,178,'CM-2025-0001',9,'#c4a4f8') + txt(130,178,'May 28',9,'#9aa7bd') + txt(210,178,'May 28',9,'#9aa7bd') + txt(310,178,'paid (CM)',9,'#c4a4f8') + txt(560,178,'-$250',9,'#c4a4f8','end')
    ) +
    bullets([
      '<b>Where to find it</b>: open any client panel → click <b>📄 Statement</b> button in the client actions area.',
      '<b>Summary row</b>: four cards — Total Billed, Total Paid, Credits (from credit memos), and Balance Due.',
      '<b>Invoice list</b>: all invoices for the client in one place — invoice #, date, due date, status, and amount. Credit memos show as "(CM)".',
      '<b>Printing</b>: click <b>🖨️ Print Statement</b> to open the browser print dialog. The modal is formatted for clean A4/Letter output.',
      '<b>Sending to client</b>: print to PDF (browser built-in) and email the PDF via the Send Invoice composer.'
    ]);

  var HELP_HTML =
    section('help-overview',        '👋 OVERVIEW',                   SEC_OVERVIEW) +
    section('help-dashboard',       '📊 DASHBOARD',                  SEC_DASHBOARD) +
    section('help-daily-digest',    '📨 DAILY DIGEST EMAIL',         SEC_DAILY_DIGEST) +
    section('help-clients',         '👥 CLIENTS',                    SEC_CLIENTS) +
    section('help-client-emails',   '📧 ADDITIONAL EMAILS (AP / OPS)', SEC_CLIENT_EMAILS) +
    section('help-pipeline',        '📊 PIPELINE (DEALS)',           SEC_PIPELINE) +
    section('help-invoices',        '🧾 INVOICES',                   SEC_INVOICES) +
    section('help-newinv',          '➕ NEW INVOICE BUILDER',         SEC_NEWINV) +
    section('help-send-invoice',    '📧 SEND INVOICE (COMPOSER)',    SEC_SEND_INVOICE) +
    section('help-customer-portal', '🌐 CUSTOMER PORTAL (PUBLIC LINK)', SEC_CUSTOMER_PORTAL) +
    section('help-email-templates', '📝 EMAIL TEMPLATES',            SEC_EMAIL_TEMPLATES) +
    section('help-email-schedule',  '📅 SCHEDULED FOLLOW-UPS',       SEC_EMAIL_SCHEDULE) +
    section('help-email-activity',  '📊 EMAIL ACTIVITY (TRACKING)',  SEC_EMAIL_ACTIVITY) +
    section('help-stripe-pay',      '💳 STRIPE PAYMENTS',            SEC_STRIPE_PAY) +
    section('help-compliance',      '📋 COMPLIANCE (FDA / GMP)',     SEC_COMPLIANCE) +
    section('help-referrals',       '🤝 REFERRALS',                  SEC_REFERRALS) +
    section('help-referrers',       '👤 REFERRERS',                  SEC_REFERRERS) +
    section('help-activity',        '📡 ACTIVITY FEED',              SEC_ACTIVITY) +
    section('help-calendar',        '📅 CALENDAR',                   SEC_CALENDAR) +
    section('help-production',      '🏭 PRODUCTION SCHEDULE',        SEC_PRODUCTION) +
    section('help-tasks',           '✅ TASKS',                      SEC_TASKS) +
    section('help-documents',       '📁 DOCUMENTS',                  SEC_DOCUMENTS) +
    section('help-inventory',       '📦 INVENTORY',                  SEC_INVENTORY) +
    section('help-announcements',   '📣 ANNOUNCEMENTS',              SEC_ANNOUNCEMENTS) +
    section('help-customer-requests', '📩 CUSTOMER REQUESTS (INBOX)',  SEC_CUSTOMER_REQUESTS) +
    section('help-customers',       '🌐 CUSTOMER LOGINS (ADMIN)',    SEC_CUSTOMERS) +
    section('help-users',           '🔑 USERS & PERMISSIONS (ADMIN)',SEC_USERS) +
    section('help-settings',        '⚙️ SETTINGS & INTEGRATIONS',    SEC_SETTINGS) +
    section('help-ai-hub',          '🤖 AI CHAT & AI TOOLS',         SEC_AI_HUB) +
    section('help-production-runs', '🏭 PRODUCTION RUNS',            SEC_PRODUCTION_RUNS) +
    section('help-formula-vault',   '🧪 FORMULA VAULT',              SEC_FORMULA_VAULT) +
    section('help-yield-tracker',   '📈 YIELD TRACKER',              SEC_YIELD_TRACKER) +
    section('help-sample-shipments','📦 SAMPLE SHIPMENTS',           SEC_SAMPLE_SHIPMENTS) +
    section('help-content-calendar','📣 CONTENT CALENDAR',           SEC_CONTENT_CALENDAR) +
    section('help-cip-log',         '🧼 CIP / SANITATION LOG',       SEC_CIP_LOG) +
    section('help-hold-tags',       '🚫 HOLD TAGS',                  SEC_HOLD_TAGS) +
    section('help-defects-ncr',     '⚠️ DEFECTS / NCRs',             SEC_DEFECTS_NCR) +
    section('help-vendors',         '🏭 VENDORS',                    SEC_VENDORS) +
    section('help-bulk-outreach',   '📤 BULK OUTREACH',              SEC_BULK_OUTREACH) +
    section('help-scheduling',      '📅 SCHEDULING LINK',            SEC_SCHEDULING) +
    section('help-resource-library','📚 RESOURCE LIBRARY',           SEC_RESOURCE_LIBRARY) +
    section('help-shortcuts',       '⌨️ KEYBOARD SHORTCUTS',          SEC_SHORTCUTS) +
    section('help-partial-payments','💵 PARTIAL PAYMENTS',            SEC_PARTIAL_PAYMENTS) +
    section('help-collections',     '📋 COLLECTIONS SEQUENCE',        SEC_COLLECTIONS_SEQ) +
    section('help-recurring-inv',   '🔄 RECURRING INVOICES',          SEC_RECURRING_INV) +
    section('help-credit-memos',    '📝 CREDIT MEMOS',                SEC_CREDIT_MEMOS) +
    section('help-expenses',        '💸 EXPENSE TRACKER',             SEC_EXPENSE_TRACKER) +
    section('help-statement',       '📄 STATEMENT OF ACCOUNT',        SEC_STATEMENT_ACCT);

  var TOC_ENTRIES = [
    ['help-overview','👋 Overview'],['help-dashboard','📊 Dashboard'],
    ['help-daily-digest','📨 Daily Digest'],
    ['help-clients','👥 Clients'],['help-client-emails','📧 Additional Emails'],
    ['help-pipeline','📊 Pipeline'],
    ['help-invoices','🧾 Invoices'],['help-newinv','➕ New Invoice'],
    ['help-send-invoice','📧 Send Invoice'],['help-customer-portal','🌐 Customer Portal'],
    ['help-email-templates','📝 Email Templates'],['help-email-schedule','📅 Scheduled Follow-ups'],
    ['help-email-activity','📊 Email Activity'],['help-stripe-pay','💳 Stripe Payments'],
    ['help-compliance','📋 Compliance'],
    ['help-referrals','🤝 Referrals'],['help-referrers','👤 Referrers'],
    ['help-activity','📡 Activity'],['help-calendar','📅 Calendar'],
    ['help-production','🏭 Production'],['help-tasks','✅ Tasks'],
    ['help-documents','📁 Documents'],['help-inventory','📦 Inventory'],
    ['help-announcements','📣 Announcements'],
    ['help-customer-requests','📩 Customer Requests'],['help-customers','🌐 Customer Logins'],
    ['help-users','🔑 Users'],['help-settings','⚙️ Settings'],
    ['help-ai-hub','🤖 AI Chat & Tools'],
    ['help-production-runs','🏭 Production Runs'],
    ['help-formula-vault','🧪 Formula Vault'],
    ['help-yield-tracker','📈 Yield Tracker'],
    ['help-sample-shipments','📦 Sample Shipments'],
    ['help-content-calendar','📣 Content Calendar'],
    ['help-cip-log','🧼 CIP / Sanitation Log'],
    ['help-hold-tags','🚫 Hold Tags'],
    ['help-defects-ncr','⚠️ Defects / NCRs'],
    ['help-vendors','🏭 Vendors'],
    ['help-bulk-outreach','📤 Bulk Outreach'],
    ['help-scheduling','📅 Scheduling Link'],
    ['help-resource-library','📚 Resource Library'],
    ['help-shortcuts','⌨️ Shortcuts'],
    ['help-partial-payments','💵 Partial Payments'],
    ['help-collections','📋 Collections Sequence'],
    ['help-recurring-inv','🔄 Recurring Invoices'],
    ['help-credit-memos','📝 Credit Memos'],
    ['help-expenses','💸 Expense Tracker'],
    ['help-statement','📄 Statement of Account']
  ];
  var PAGE_TO_SECTION = {
    'cpg-dashboard':'help-dashboard','cpg-clients':'help-clients','cpg-pipeline':'help-pipeline',
    'cpg-invoices':'help-invoices','cpg-invoice-detail':'help-invoices','cpg-newinv':'help-newinv',
    'cpg-referrals':'help-referrals','cpg-referrers':'help-referrers','cpg-activity':'help-activity',
    'cpg-calendar':'help-calendar','cpg-production-cal':'help-production','cpg-tasks':'help-tasks',
    'cpg-documents':'help-documents','cpg-inventory':'help-inventory','cpg-announcements':'help-announcements',
    'cpg-customers':'help-customers','cpg-users':'help-users',
    'cpg-compliance':'help-compliance',
    'cpg-holds':'help-hold-tags','cpg-cip':'help-cip-log',
    'cpg-ai':'help-ai-hub',
    'cpg-production-runs':'help-production-runs',
    'cpg-formulas':'help-formula-vault',
    'cpg-yield':'help-yield-tracker',
    'cpg-samples':'help-sample-shipments',
    'cpg-content':'help-content-calendar',
    'cpg-defects':'help-defects-ncr',
    'cpg-vendors':'help-vendors',
    'cpg-scheduling':'help-scheduling',
    'cpg-expenses':'help-expenses',
    'cpg-recurring':'help-recurring-inv'
  };
  function currentSection(){
    var active = document.querySelector('#crm-panel .cpg.act');
    if(active && PAGE_TO_SECTION[active.id]) return PAGE_TO_SECTION[active.id];
    return 'help-overview';
  }
  function buildTOC(){
    return TOC_ENTRIES.map(function(e){
      return '<a href="#'+e[0]+'" data-anchor="'+e[0]+'" ' +
        'style="display:block;padding:8px 12px;margin:2px 0;border-radius:6px;font-size:12px;' +
        'color:#9aa7bd;text-decoration:none;line-height:1.4;white-space:nowrap;' +
        'overflow:hidden;text-overflow:ellipsis;transition:background .12s,color .12s">' + e[1] + '</a>';
    }).join('');
  }

  window.glOpenHelp = function(scrollTo){
    var prior = document.getElementById('gl-help-modal'); if(prior) prior.remove();
    var host = document.getElementById('crm-panel') || document.body;
    var target = scrollTo || currentSection();

    var ov = document.createElement('div');
    ov.id = 'gl-help-modal';
    ov.setAttribute('style','position:fixed;inset:0;z-index:950;background:rgba(6,13,26,.85);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:20px');

    var card = document.createElement('div');
    card.setAttribute('style','background:#142238;border:1px solid rgba(0,229,192,.2);border-radius:14px;width:100%;max-width:960px;height:88vh;max-height:88vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.6)');

    var header = document.createElement('div');
    header.setAttribute('style','display:flex;justify-content:space-between;align-items:center;padding:18px 22px;border-bottom:1px solid rgba(255,255,255,.06);flex-shrink:0');
    header.innerHTML =
      '<div>' +
        '<div style="font-family:var(--ff-disp);font-size:18px;letter-spacing:2px;color:var(--teal)">❓ HELP &amp; GUIDE</div>' +
        '<div style="font-size:11px;color:var(--muted);margin-top:2px">Press <kbd style="background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:4px;padding:1px 5px;font-size:10px">?</kbd> any time</div>' +
      '</div>' +
      '<button id="gl-help-close" title="Close" style="background:none;border:none;color:#9aa7bd;font-size:22px;cursor:pointer;padding:4px 8px;line-height:1">✕</button>';

    var split = document.createElement('div');
    split.setAttribute('style','display:flex;flex:1 1 auto;min-height:0;overflow:hidden');

    var toc = document.createElement('nav');
    toc.id = 'gl-help-toc';
    toc.setAttribute('style','width:220px;flex:0 0 220px;border-right:1px solid rgba(255,255,255,.06);padding:14px 10px;overflow-y:auto;background:rgba(0,0,0,.18)');
    toc.innerHTML = buildTOC();

    var body = document.createElement('main');
    body.id = 'gl-help-body';
    body.setAttribute('style','flex:1 1 auto;min-width:0;padding:6px 30px 24px;overflow-y:auto;background:#142238;color:#fff');
    body.innerHTML = HELP_HTML;

    split.appendChild(toc);
    split.appendChild(body);
    card.appendChild(header);
    card.appendChild(split);
    ov.appendChild(card);

    ov.addEventListener('click', function(e){ if(e.target === ov) ov.remove(); });
    header.querySelector('#gl-help-close').addEventListener('click', function(){ ov.remove(); });
    function highlightToc(id){
      toc.querySelectorAll('a').forEach(function(x){
        var on = x.getAttribute('data-anchor') === id;
        x.style.background = on ? 'rgba(0,229,192,.1)' : '';
        x.style.color = on ? 'var(--teal)' : '#9aa7bd';
      });
    }
    toc.querySelectorAll('a').forEach(function(a){
      a.addEventListener('click', function(e){
        e.preventDefault();
        highlightToc(a.getAttribute('data-anchor'));
        var el = body.querySelector('#' + a.getAttribute('data-anchor'));
        if(el) el.scrollIntoView({behavior:'smooth', block:'start'});
      });
    });
    document.addEventListener('keydown', function escH(e){
      if(e.key === 'Escape' && document.getElementById('gl-help-modal')){
        ov.remove();
        document.removeEventListener('keydown', escH);
      }
    });

    host.appendChild(ov);
    // Initial scroll + TOC highlight after the modal lays out
    setTimeout(function(){
      var el = body.querySelector('#' + target);
      if(el) el.scrollIntoView({behavior:'auto', block:'start'});
      highlightToc(target);
    }, 60);
  };

  // "?" hotkey to toggle
  document.addEventListener('keydown', function(e){
    if(e.key !== '?') return;
    var t = e.target;
    if(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if(!document.getElementById('crm-panel') || !document.getElementById('crm-panel').classList.contains('show')) return;
    e.preventDefault();
    if(document.getElementById('gl-help-modal')) document.getElementById('gl-help-modal').remove();
    else window.glOpenHelp();
  });

  // ❓ Help button in topbar
  function injectHelpButton(){
    var brand = document.querySelector('#crm-top .crm-brand');
    if(!brand || !brand.parentElement) return;
    if(brand.parentElement.querySelector('.gl-help-btn')) return;
    var btn = document.createElement('button');
    btn.className = 'gl-help-btn';
    btn.title = 'Open help (or press ?)';
    btn.setAttribute('style',
      'display:flex;align-items:center;gap:6px;padding:5px 10px;' +
      'background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);' +
      'border-radius:7px;color:var(--muted);font-size:11px;cursor:pointer;' +
      'font-family:var(--ff-body);transition:all .15s;margin-left:6px'
    );
    btn.innerHTML = '<span style="color:#9aa7bd">❓</span><span>Help</span>';
    btn.addEventListener('mouseenter', function(){
      btn.style.background = 'rgba(0,229,192,.08)';
      btn.style.borderColor = 'rgba(0,229,192,.25)';
      btn.style.color = 'var(--teal)';
    });
    btn.addEventListener('mouseleave', function(){
      btn.style.background = 'rgba(255,255,255,.04)';
      btn.style.borderColor = 'rgba(255,255,255,.08)';
      btn.style.color = 'var(--muted)';
    });
    btn.addEventListener('click', function(){ window.glOpenHelp(); });
    brand.parentElement.insertBefore(btn, brand);
  }
  function startObs(){
    var top = document.getElementById('crm-top');
    if(top){
      new MutationObserver(function(){ setTimeout(injectHelpButton, 50); }).observe(top, {childList:true, subtree:true});
      injectHelpButton();
    } else setTimeout(startObs, 500);
  }
  if(document.readyState !== 'loading') startObs();
  else document.addEventListener('DOMContentLoaded', startObs);

  console.log('[GL] In-app help panel v2 loaded (flexbox + wireframes)');
}());
