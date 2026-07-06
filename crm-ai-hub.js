/* ============================================================
   AI HUB — dedicated page: inline chat at the top + tool grid
   • Adds an "AI" section to the sidebar (after MAIN, before Billing)
   • Creates #cpg-ai if missing and wires cNav('ai')
   • Re-boots after loginUser so nav items survive fresh logins
   ============================================================ */
(function(){
  /* ─── Quick-access tool grid ─────────────────────────────────── */
  var QUICK_TOOLS = [
    { icon:'💰', label:'Estimate Quote',    fn:'aiEstimateQuote' },
    { icon:'🧾', label:'Draft Invoice',     fn:'aiDraftInvoice' },
    { icon:'✉️', label:'Draft Email',       fn:'openAICommModal' },
    { icon:'📝', label:'Meeting Notes',     fn:'openMeetingNotesModal' },
    { icon:'📈', label:'Revenue Forecast',  fn:'aiGenerateForecast' },
    { icon:'📣', label:'Social Post',       fn:'openSocialDrafter' },
    { icon:'🎯', label:'Cross-sell Ideas',  fn:'openCrossSellSuggester' },
    { icon:'📊', label:'Win-Loss',          fn:'openWinLossAnalytics' },
    { icon:'🔮', label:'Churn Risk',        fn:'openChurnPredictor' },
    { icon:'🎨', label:'Image Prompts',     fn:'openAIImagePrompts' },
    { icon:'📊', label:'Reports',           fn:'openReports' },
    { icon:'⏱️', label:'Time Tracker',      fn:'openTimeTracker' },
    { icon:'💼', label:'LinkedIn Outreach', fn:'openLinkedInOutreach' },
    { icon:'🧮', label:'Recipe Cost',       fn:'openRecipeCostCalc' },
  ];

  /* ─── Chat state (persists while session is open) ─────────────── */
  var _chatHistory = [];

  /* ─── Render AI Hub page ───────────────────────────────────────── */
  function renderHub(){
    var host = document.getElementById('cpg-ai');
    if(!host) return;
    if(host.querySelector('#ai-hub-chat')) {
      // Already rendered — just refocus input
      var inp = document.getElementById('ai-hub-input');
      if(inp) setTimeout(function(){ inp.focus(); }, 50);
      return;
    }

    var toolBtns = QUICK_TOOLS.map(function(t){
      return '<button data-fn="' + t.fn + '" ' +
        'style="display:flex;align-items:center;gap:9px;padding:12px 14px;background:rgba(255,255,255,.04);' +
        'border:1px solid rgba(255,255,255,.08);border-radius:10px;color:var(--white,#e8f0fe);cursor:pointer;' +
        'font-size:13px;font-weight:500;text-align:left;transition:all .15s;min-height:44px">' +
        '<span style="font-size:18px;flex-shrink:0">' + t.icon + '</span>' +
        '<span>' + t.label + '</span>' +
      '</button>';
    }).join('');

    host.innerHTML =
      '<div class="cph" style="margin-bottom:0">' +
        '<div><div class="cpt">AI ASSISTANT</div>' +
        '<div class="cps">Chat with your Good Liquid AI · use tools below for specific tasks</div></div>' +
      '</div>' +

      /* Chat card */
      '<div class="ccard" style="margin-bottom:16px">' +
        '<div id="ai-hub-chat" style="display:flex;flex-direction:column;height:340px">' +
          '<div id="ai-hub-messages" style="flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:10px;padding:4px 0 8px"></div>' +
          '<div style="display:flex;gap:8px;padding-top:10px;border-top:1px solid rgba(255,255,255,.06)">' +
            '<input id="ai-hub-input" type="text" autocomplete="off" ' +
              'placeholder="Ask anything about your pipeline, clients, invoices…" ' +
              'style="flex:1;background:#0a1628;border:1px solid rgba(255,255,255,.1);border-radius:8px;' +
              'padding:10px 14px;color:var(--white,#e8f0fe);font-size:13px;outline:none" ' +
              'onkeydown="if(event.key===\'Enter\'&&!event.shiftKey){event.preventDefault();window.glAIHubSend();}">' +
            '<button onclick="window.glAIHubSend()" class="cbtn pri" style="padding:10px 20px;flex-shrink:0">Send</button>' +
          '</div>' +
        '</div>' +
      '</div>' +

      /* Tool grid */
      '<div style="font-size:10px;letter-spacing:2px;color:var(--muted,#6b87ad);font-weight:600;margin-bottom:10px">AI TOOLS</div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:8px">' +
        toolBtns +
      '</div>';

    /* Tool grid click handler */
    host.querySelectorAll('[data-fn]').forEach(function(btn){
      btn.addEventListener('mouseenter', function(){
        btn.style.background = 'rgba(0,229,192,.08)';
        btn.style.borderColor = 'rgba(0,229,192,.3)';
      });
      btn.addEventListener('mouseleave', function(){
        btn.style.background = 'rgba(255,255,255,.04)';
        btn.style.borderColor = 'rgba(255,255,255,.08)';
      });
      btn.addEventListener('click', function(){
        var fn = btn.dataset.fn;
        try {
          if(typeof window[fn] === 'function') window[fn]();
          else { alert(btn.querySelector('span:last-child').textContent + ' — coming soon!'); }
        } catch(e) { console.error('[AI hub]', fn, e); }
      });
    });

    /* Restore history or show greeting */
    var msgs = document.getElementById('ai-hub-messages');
    if(_chatHistory.length === 0){
      msgs.innerHTML = '<div style="color:var(--muted,#6b87ad);font-size:13px;text-align:center;padding:50px 0">' +
        '👋 Hi! Ask me anything about your Good Liquid business.</div>';
    } else {
      _chatHistory.forEach(function(m){ appendMsg(m.role, m.text); });
    }

    var inp = document.getElementById('ai-hub-input');
    if(inp) setTimeout(function(){ inp.focus(); }, 80);
  }

  function appendMsg(role, text){
    var msgs = document.getElementById('ai-hub-messages');
    if(!msgs) return;
    var d = document.createElement('div');
    d.className = 'chat-msg ' + role;
    d.textContent = text;
    msgs.appendChild(d);
    msgs.scrollTop = msgs.scrollHeight;
  }

  window.glAIHubSend = async function(){
    var input = document.getElementById('ai-hub-input');
    var msgs = document.getElementById('ai-hub-messages');
    if(!input || !msgs) return;
    var msg = input.value.trim();
    if(!msg) return;
    input.value = '';

    /* Remove placeholder greeting */
    var ph = msgs.querySelector('[style*="text-align:center"]');
    if(ph) ph.remove();

    appendMsg('user', msg);
    _chatHistory.push({ role:'user', text:msg });

    var thinkEl = document.createElement('div');
    thinkEl.className = 'chat-msg bot';
    thinkEl.textContent = 'Thinking…';
    msgs.appendChild(thinkEl);
    msgs.scrollTop = msgs.scrollHeight;

    var reply = '';
    try {
      if(typeof window.callAI === 'function'){
        var sys = 'You are the Good Liquid Bev Co CRM assistant. Be concise and helpful. ' +
          'Good Liquid is a family-run beverage co-packer in Palmetto FL (Est. 2017). ' +
          'Services: Canning (12oz/16oz), Bottling (750ml), R&D, Consulting. ' +
          'Min order 150 cases. Canning from $0.28/can. Contact: Mike@GoodLiquid.com.';
        reply = await window.callAI(sys, msg);
      } else {
        reply = 'AI not configured. Open 🤖 AI Tools → AI Settings to add your API key.';
      }
    } catch(e){
      reply = 'Error: ' + (e.message || 'AI call failed. Check your API key in AI Settings.');
    }

    thinkEl.textContent = reply;
    _chatHistory.push({ role:'bot', text:reply });
    msgs.scrollTop = msgs.scrollHeight;
  };

  /* ─── Inject nav items (AI section above Billing) ─────────────── */
  function injectNav(){
    if(document.getElementById('nav-ai-hub')) return; // already done
    var cnav = document.querySelector('.cnav');
    if(!cnav) return;

    /* Find the Billing section header */
    var billingHeader = null;
    cnav.querySelectorAll('.cni-sec').forEach(function(s){
      if(!billingHeader && s.textContent.trim().toUpperCase() === 'BILLING') billingHeader = s;
    });
    if(!billingHeader) return;

    var wrapper = document.createElement('div');
    wrapper.innerHTML =
      '<div class="cni-sec">AI</div>' +
      '<div class="cni" id="nav-ai-hub" onclick="cNav(\'ai\',this)" style="color:var(--teal,#00e5c0)">' +
        '<span class="cni-ico">💬</span>AI Chat' +
      '</div>' +
      '<div class="cni" id="nav-ai-tools-btn" ' +
        'onclick="(function(){var p=document.getElementById(\'gl-ai-panel\');if(p){p.style.display=p.style.display===\'flex\'?\'none\':\'flex\';}})()" ' +
        'style="color:var(--teal,#00e5c0)">' +
        '<span class="cni-ico">🤖</span>AI Tools' +
      '</div>';

    while(wrapper.firstChild) cnav.insertBefore(wrapper.firstChild, billingHeader);
  }

  /* ─── Inject #cpg-ai page container ───────────────────────────── */
  function injectPage(){
    if(document.getElementById('cpg-ai')) return;
    var main = document.querySelector('.crm-main');
    if(!main) return;
    var div = document.createElement('div');
    div.id = 'cpg-ai';
    div.className = 'cpg';
    main.insertBefore(div, main.firstChild);
  }

  /* ─── Wire MutationObserver on cpg-ai ─────────────────────────── */
  function watchPage(){
    var pg = document.getElementById('cpg-ai');
    if(!pg){ setTimeout(watchPage, 500); return; }
    if(pg.__aiHubWatched) return;
    pg.__aiHubWatched = true;
    new MutationObserver(function(){
      if(pg.classList.contains('act')) renderHub();
    }).observe(pg, { attributes:true, attributeFilter:['class'] });
  }

  /* ─── Also update top-bar chat button label ──────────────────────── */
  function polishTopBar(){
    var chatBtn = document.getElementById('crm-chat-btn');
    if(chatBtn && chatBtn.textContent === '💬'){
      chatBtn.innerHTML = '💬 <span style="font-size:11px;font-weight:600">Chat</span>';
      chatBtn.style.width = 'auto';
      chatBtn.style.padding = '0 10px';
      chatBtn.style.gap = '4px';
    }
  }

  /* ─── Boot ─────────────────────────────────────────────────────── */
  function boot(){
    // Grant 'ai' page access to all roles (like calendar/tasks)
    if(window.PERMISSIONS){
      ['admin','sales','viewer'].forEach(function(r){
        if(window.PERMISSIONS[r] && !window.PERMISSIONS[r].includes('ai'))
          window.PERMISSIONS[r].push('ai');
      });
    }
    injectPage();
    injectNav();
    watchPage();
    polishTopBar();
  }

  if(document.readyState !== 'loading') setTimeout(boot, 350);
  else document.addEventListener('DOMContentLoaded', function(){ setTimeout(boot, 350); });

  /* Re-run after login so the nav items survive re-mounts */
  window.GL_HOOKS.registerLoginHook(function(){ setTimeout(boot, 500); });

  console.log('[GL] AI hub loaded');
}());

