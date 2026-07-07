/* ============================================================
   AI CHAT ENHANCEMENT v2
   - Markdown → HTML rendering so bold/bullets/headers display
     correctly instead of raw symbols
   - Comprehensive CRM how-to system prompt so the AI can
     explain every feature in the admin area
   - Top-bar "Chat" button now navigates to the AI Hub page
     instead of opening the public-facing website chat widget
   ============================================================ */
(function(){
  'use strict';

  /* ── Markdown → safe HTML converter ──────────────────────── */
  function mdToHtml(text) {
    if (!text) return '';
    // Escape HTML entities first so AI output can never inject raw HTML
    var h = String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Headers — must run before bold so ** inside headers still renders
    h = h.replace(/^### (.+)$/gm,
      '<div style="font-size:11px;letter-spacing:1.5px;color:var(--teal,#00e5c0);font-weight:700;margin:14px 0 4px;text-transform:uppercase">$1</div>');
    h = h.replace(/^## (.+)$/gm,
      '<div style="font-size:13px;color:var(--teal,#00e5c0);font-weight:700;margin:12px 0 4px">$1</div>');
    h = h.replace(/^# (.+)$/gm,
      '<div style="font-size:14px;color:var(--teal,#00e5c0);font-weight:700;margin:14px 0 6px">$1</div>');

    // Inline emphasis
    h = h.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    h = h.replace(/\*(.+?)\*/g, '<em>$1</em>');

    // Inline code
    h = h.replace(/`([^`]+)`/g, '<code style="background:rgba(255,255,255,.08);padding:1px 5px;border-radius:3px;font-size:12px">$1</code>');

    // Unordered lists — collect consecutive bullet lines into one <ul>
    h = h.replace(/((?:^[-•] .+\n?)+)/gm, function(block) {
      var items = block.replace(/^[-•] (.+)$/gm, '<li>$1</li>');
      return '<ul style="margin:6px 0 8px 0;padding-left:18px;list-style:disc">' + items + '</ul>';
    });

    // Ordered lists
    h = h.replace(/((?:^\d+\. .+\n?)+)/gm, function(block) {
      var items = block.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
      return '<ol style="margin:6px 0 8px 0;padding-left:18px">' + items + '</ol>';
    });

    // Horizontal rule
    h = h.replace(/^---+$/gm, '<hr style="border:none;border-top:1px solid rgba(255,255,255,.08);margin:12px 0">');

    // Paragraph and line breaks
    h = h.replace(/\n{2,}/g, '<br><br>');
    h = h.replace(/\n/g, '<br>');

    return h;
  }

  /* ── CRM how-to system prompt ─────────────────────────────── */
  var CRM_SYSTEM_PROMPT =
    'You are the Good Liquid Bev Co CRM assistant. Your primary job is to help ' +
    'admin users navigate and use the CRM. Give clear, step-by-step instructions. ' +
    'Use markdown: **bold** for button names and field labels, bullet lists for steps, ' +
    '## for section headings.\n\n' +

    '## About Good Liquid\n' +
    'Family-run beverage co-packer, Palmetto FL (Est. 2017). Services: small-batch canning ' +
    '(12oz/16oz), bottle filling (750ml), beverage R&D/formulation, consulting. ' +
    'Min order 150 cases. R&D from $1,000/SKU. Canning from $0.28/can. ' +
    'Contact: Mike@GoodLiquid.com | (803) 493-5065.\n\n' +

    '## CRM Sections & How to Use Them\n\n' +

    '**Dashboard** — Live business overview. Shows total revenue, active clients, ' +
    'overdue invoice count, recent activity, and revenue charts. Data auto-loads on login.\n\n' +

    '**Clients** — Full client directory.\n' +
    '- Add a client: click **+ Add Client** → fill in company name, contact, email, phone, address, then Save.\n' +
    '- Edit a client: click any client row to open the detail panel. Edit any field and click Save.\n' +
    '- Client detail has tabs: Contact Info, Billing/Shipping address, COI status, W-9 on file, ' +
    'tax-exempt status, Stripe/QuickBooks IDs, and notes.\n\n' +

    '**Pipeline** — Kanban sales board.\n' +
    '- Stages: New Lead → Qualified → Proposal Sent → In Negotiation → Won / Lost.\n' +
    '- Add a deal: click **+ New Deal** in any column, fill in company, contact, value, notes.\n' +
    '- Click a deal card to view full details, edit stage, or link an invoice.\n\n' +

    '**Invoices** — Manage all invoices.\n' +
    '- Filter by status: All, Draft, Pending, Paid, Overdue.\n' +
    '- Click any row to open the invoice detail view.\n' +
    '- Mark paid: open invoice → click **✓ Mark Paid**.\n' +
    '- Send payment link: open invoice → click **Send Payment Link** (requires Stripe setup).\n\n' +

    '**New Invoice** — Build a new invoice.\n' +
    '- Select a client, add line items (description, qty, rate), set payment terms and due date.\n' +
    '- Click **Save Invoice** to create it. It appears immediately in the Invoices list.\n\n' +

    '**Referrals** — Track client referrals and commissions.\n' +
    '- Add referral: click **+ New Referral** → select referrer and client, set commission rate.\n' +
    '- Mark commission paid: open referral → click **Mark Commission Paid**.\n\n' +

    '**Activity** — Full team activity log.\n' +
    '- Filter by type: All, Emails, Calls, Notes, Deals, Invoices.\n' +
    '- Click any row to jump to the related record.\n\n' +

    '**Calendar** — Schedule and manage general events (tours, calls, meetings).\n' +
    '- Click any date to add an event (title, time, notes, reminder).\n' +
    '- Events show as colored dots. Click a date with events to see them and delete if needed.\n' +
    '- Use the **Month / List** toggle to switch views.\n\n' +

    '**Production Calendar** — Schedule production runs.\n' +
    '- Click a date to add a production run with product, batch size, and run details.\n' +
    '- Color-coded by product type. Click any event to view or delete it.\n\n' +

    '**Tasks** — Team task management.\n' +
    '- Add task: click **+ New Task** → set title, due date, assignee, priority (High/Medium/Low), and client link.\n' +
    '- Mark done: click the checkbox on any task row.\n' +
    '- Filter by status (open/completed) or by assignee.\n\n' +

    '**Documents** — Secure client file storage.\n' +
    '- Upload: select a client, choose document type (W-9, COI, Contract, Other), then upload a file.\n' +
    '- Download: click any document row. Files are stored in Supabase Storage.\n\n' +

    '**Inventory** — Track raw materials and finished goods.\n' +
    '- Add item: click **+ Add Item** → name, category, quantity, unit, reorder threshold.\n' +
    '- Update quantity: click any row and edit the quantity. Low-stock items are highlighted.\n\n' +

    '**Announcements** — Company-wide posts for all staff.\n' +
    '- New post: click **+ New Announcement** → title and body → Save.\n' +
    '- All logged-in staff see current announcements.\n\n' +

    '**AI Chat (this page)** — Ask anything. 14 quick-access AI tools are below the chat:\n' +
    '💰 Estimate Quote, 🧾 Draft Invoice, ✉️ Draft Email, 📝 Meeting Notes, ' +
    '📈 Revenue Forecast, 📣 Social Post, 🎯 Cross-sell Ideas, 📊 Win-Loss, ' +
    '🔮 Churn Risk, 🎨 Image Prompts, 📊 Reports, ⏱️ Time Tracker, ' +
    '💼 LinkedIn Outreach, 🧮 Recipe Cost.\n\n' +

    '**Users** (admin only) — Manage staff accounts.\n' +
    '- Add user: click **+ Add User** → name, email, role (Admin/Sales/Viewer), set password.\n' +
    '- Roles: **Admin** = full access; **Sales** = no Users or Customers pages; **Viewer** = read-only.\n' +
    '- Deactivate: open user → set Status to Inactive.\n\n' +

    '**Customers** (admin only) — Customer portal access.\n' +
    '- Grant access: click **+ Add Customer** → link to a client → set email and temporary password.\n' +
    '- Customers log in at /portal to view their own invoices and documents.\n\n' +

    '## Tips\n' +
    '- **↻ Refresh** in the top bar reloads all data without leaving your current page.\n' +
    '- The **💬 Chat button** in the top bar opens this AI Chat page.\n' +
    '- AI Settings (⚙️ in sidebar) is where you configure your AI API key (OpenAI, Anthropic, etc.).\n' +
    '- Compliance, Holds, CIP, Audit, Formulas, Yield, Content, Defects, Vendors, Samples, ' +
    'and Production Runs are all available in the sidebar under their respective sections.';

  /* ── Replace glAIHubSend with markdown-rendering version ───── */
  window.glAIHubSend = async function() {
    var input = document.getElementById('ai-hub-input');
    var msgs  = document.getElementById('ai-hub-messages');
    if (!input || !msgs) return;
    var msg = input.value.trim();
    if (!msg) return;
    input.value = '';

    // Remove placeholder greeting if present
    var ph = msgs.querySelector('[style*="text-align:center"]');
    if (ph) ph.remove();

    // User message bubble
    var userEl = document.createElement('div');
    userEl.className = 'chat-msg user';
    userEl.textContent = msg;
    msgs.appendChild(userEl);

    // Thinking indicator while waiting for AI response
    var thinkEl = document.createElement('div');
    thinkEl.className = 'chat-msg bot';
    thinkEl.innerHTML = '<em style="color:#6b87ad">Thinking…</em>';
    msgs.appendChild(thinkEl);
    msgs.scrollTop = msgs.scrollHeight;

    var reply = '';
    try {
      if (typeof window.callAI === 'function') {
        reply = await window.callAI(CRM_SYSTEM_PROMPT, msg);
      } else {
        reply = 'AI not configured. Go to **⚙️ AI Settings** in the sidebar to add your API key.';
      }
    } catch(e) {
      reply = 'Error: ' + (e.message || 'AI call failed. Check your API key in AI Settings.');
    }

    // Replace thinking indicator with rendered markdown
    thinkEl.innerHTML = mdToHtml(reply);
    msgs.scrollTop = msgs.scrollHeight;
  };

  /* ── Redirect top-bar "Chat" button to AI Hub page ─────────── */
  function redirectChatBtn() {
    window.glToggleCRMChat = function() {
      if (typeof window.cNav === 'function') {
        window.cNav('ai', document.getElementById('nav-ai-hub') || null);
      }
    };
    var chatBtn = document.getElementById('crm-chat-btn');
    if (chatBtn) {
      chatBtn.title = 'Open AI Chat';
      chatBtn.onclick = function() { window.glToggleCRMChat(); };
    }
  }

  /* ── Inject CSS for proper bot-bubble line-height ─────────── */
  function injectChatCss() {
    if (document.getElementById('gl-chat-css-v2')) return;
    var s = document.createElement('style');
    s.id = 'gl-chat-css-v2';
    s.textContent =
      '#ai-hub-messages .chat-msg.bot { line-height:1.7; font-size:13px; }' +
      '#ai-hub-messages .chat-msg.bot ul, #ai-hub-messages .chat-msg.bot ol { margin:6px 0 8px 0; }' +
      '#ai-hub-messages .chat-msg.bot li { margin-bottom:3px; }' +
      '#ai-hub-messages .chat-msg.bot strong { color:#e8f0fe; }' +
      '#gl-chat-messages .chat-msg.bot { line-height:1.6; font-size:13px; }';
    document.head.appendChild(s);
  }

  function boot() {
    redirectChatBtn();
    injectChatCss();
  }

  if (document.readyState !== 'loading') setTimeout(boot, 400);
  else document.addEventListener('DOMContentLoaded', function(){ setTimeout(boot, 400); });

  // Re-run after login in case the top bar re-renders
  window.GL_HOOKS.registerLoginHook(function(){ setTimeout(boot, 600); });

  console.log('[GL] AI chat v2 — markdown rendering + CRM system prompt loaded');

  /* ── CHAT BUBBLE — admin only ── */
  setTimeout(function(){
    var b=document.getElementById('gl-chat-bubble'),w=document.getElementById('gl-chat-window'),p=document.getElementById('crm-panel');
    if(!b||!p)return;b.style.display='none';
    new MutationObserver(function(){b.style.display='none';if(!p.classList.contains('show')&&w)w.classList.remove('show');}).observe(p,{attributes:true,attributeFilter:['class']});
    window.glToggleCRMChat=function(){if(!w)return;w.style.top='54px';w.style.bottom='auto';w.style.right='12px';if(typeof toggleChat==='function')toggleChat();else w.classList.toggle('show');};
  },200);

}());
