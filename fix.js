/* Good Liquid CRM — Structural + Login Patch
   Loaded after main script */

(function() {
  'use strict';


  /* ── 0. ALWAYS DEFINE CORE USERS ───────────────────
     The main script lost the users array.
     fix.js always provides it.
  ────────────────────────────────────────────────── */
  var coreUsers = [
    {
      id: 'u1', name: 'Mike Krail', email: 'mike@goodliquid.com',
      password: 'GL2026admin', role: 'admin', status: 'active',
      initials: 'MK', color: '#f5c842', tc: '#0a1628', lastLogin: 'Never'
    },
    {
      id: 'u2', name: 'Sandra Krail', email: 'sandra@goodliquid.com',
      password: 'GL2026ops', role: 'sales', status: 'active',
      initials: 'SK', color: '#1a6fff', tc: '#fff', lastLogin: 'Never'
    }
  ];

  // Merge with any existing users, always guaranteeing core users exist
  if (!window.users || window.users.length === 0) {
    window.users = coreUsers;
  } else {
    // Ensure Mike is admin and core users exist
    coreUsers.forEach(function(cu) {
      var existing = window.users.find(function(u){ return u.email === cu.email; });
      if (existing) {
        existing.role = cu.role; // enforce correct role
      } else {
        window.users.unshift(cu); // add if missing
      }
    });
  }
  console.log('[GL] Users:', window.users.map(function(u){ return u.email + ':' + u.role; }));

  /* ── 1. FIX BROKEN HTML STRUCTURE ─────────────────
     crm-body, notif-panel, cnav-overlay were trapped
     inside crm-top due to a missing </div> tag.
     This moves them to their correct parent: crm-panel.
  ────────────────────────────────────────────────── */
  function fixDOMStructure() {
    var panel      = document.getElementById('crm-panel');
    var crmTop     = document.getElementById('crm-top');
    var crmBody    = document.getElementById('crm-body');
    var notifPanel = document.getElementById('notif-panel');
    var cnavOv     = document.getElementById('cnav-overlay');

    if (!panel || !crmTop || !crmBody) return;

    // Move elements out of crm-top into crm-panel
    if (notifPanel && notifPanel.parentElement === crmTop) {
      panel.appendChild(notifPanel);
    }
    if (cnavOv && cnavOv.parentElement === crmTop) {
      panel.appendChild(cnavOv);
    }
    if (crmBody.parentElement === crmTop) {
      panel.appendChild(crmBody);
    }
  }

  // Run immediately and again after DOM settles
  fixDOMStructure();
  document.addEventListener('DOMContentLoaded', fixDOMStructure);
  setTimeout(fixDOMStructure, 100);

  /* ── 2. HIDE CHAT BUBBLE ON PUBLIC SITE ─────────── */
  function fixChatBubble() {
    var bubble  = document.getElementById('gl-chat-bubble');
    var chatWin = document.getElementById('gl-chat-window');
    var panel   = document.getElementById('crm-panel');
    if (!bubble || !panel) return;

    // Hide by default
    bubble.style.display = 'none';

    // Show only when CRM is open
    var observer = new MutationObserver(function() {
      var crmOpen = panel.classList.contains('show');
      bubble.style.display = crmOpen ? 'flex' : 'none';
      if (!crmOpen && chatWin) chatWin.classList.remove('show');
    });
    observer.observe(panel, { attributes: true, attributeFilter: ['class'] });
  }
  setTimeout(fixChatBubble, 200);

  /* ── 3. FIX navTo (Get a Quote / nav links) ─────── */
  window.navTo = function(id) {
    var panel = document.getElementById('crm-panel');
    if (panel && panel.classList.contains('show')) {
      panel.classList.remove('show');
      document.body.style.overflow = '';
    }
    var nav = document.getElementById('nav-links-list');
    if (nav) nav.classList.remove('mobile-open');
    setTimeout(function() {
      var el = document.getElementById(id);
      if (!el) return;
      var top = el.getBoundingClientRect().top + window.pageYOffset - 70;
      window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    }, 50);
  };

  /* ── 4. FIX exitCRM ─────────────────────────────── */
  window.exitCRM = function() {
    var panel = document.getElementById('crm-panel');
    if (panel) panel.classList.remove('show');
    document.body.style.overflow = '';
    var bubble = document.getElementById('gl-chat-bubble');
    if (bubble) bubble.style.display = 'none';
  };

  /* ── 5. loginUser ───────────────────────────────── */
  window.loginUser = function(u) {
    window.currentUser = u;
    u.lastLogin = 'Just now';

    // Fix structure first
    fixDOMStructure();

    if (typeof closePw === 'function') closePw();

    var avInit   = document.getElementById('crm-av-init');
    var userName = document.getElementById('crm-user-name');
    var rb       = document.getElementById('crm-role-badge');

    if (avInit)   avInit.textContent   = u.initials || u.name[0].toUpperCase();
    if (userName) userName.textContent = u.name;
    if (rb) {
      rb.textContent = u.role.charAt(0).toUpperCase() + u.role.slice(1);
      rb.style.cssText = u.role === 'admin'
        ? 'background:rgba(245,200,66,.12);color:#d4a200;border:1px solid rgba(245,200,66,.25)'
        : u.role === 'sales'
          ? 'background:rgba(26,111,255,.12);color:#6b9fff;border:1px solid rgba(26,111,255,.25)'
          : 'background:rgba(255,255,255,.06);color:#6b87ad';
    }

    if (u.role === 'admin') {
      var nu = document.getElementById('nav-users');
      var nc = document.getElementById('nav-customers');
      if (nu) nu.style.display = 'flex';
      if (nc) nc.style.display = 'flex';
    }

    var panel = document.getElementById('crm-panel');
    if (panel) panel.classList.add('show');
    document.body.style.overflow = 'hidden';

    if (!window.crmInited && typeof initCRM === 'function') initCRM();
    if (typeof addAIToolbar === 'function') addAIToolbar();
    if (typeof addNotifBadge === 'function') addNotifBadge();
    if (typeof checkStaleDeals === 'function') checkStaleDeals();
    if (typeof loadNotifications === 'function') loadNotifications();

    // Scroll sidebar to top so Dashboard is visible
    setTimeout(function() {
      var nav = document.querySelector('.cnav');
      if (nav) nav.scrollTop = 0;
    }, 150);
  };

  /* ── 6. checkPw — Supabase REST + local fallback ── */
  window.checkPw = async function() {
    var emailEl = document.getElementById('pw-email');
    var pwEl    = document.getElementById('pw-input');
    var err     = document.getElementById('pw-err');
    if (!emailEl || !pwEl) return;

    var email = emailEl.value.trim().toLowerCase();
    var pw    = pwEl.value;
    if (err) err.style.display = 'none';

    function showError() {
      if (err) err.style.display = 'block';
      pwEl.classList.add('wrong');
      setTimeout(function(){ pwEl.classList.remove('wrong'); }, 500);
    }

    // Customer portal
    if (window.customerLogins) {
      var cust = window.customerLogins.find(function(c) {
        return c.email.toLowerCase() === email && c.password === pw;
      });
      if (cust) {
        window.currentPortalUser = cust;
        if (typeof closePw === 'function') closePw();
        if (typeof openCustomerPortal === 'function') openCustomerPortal(cust);
        return;
      }
    }

    // Supabase crm_users via direct REST
    var sbKey = localStorage.getItem('gl_supabase_key');
    if (sbKey) {
      try {
        var res = await fetch(
          'https://ufjkeqmxwuyhbqyugcgg.supabase.co/rest/v1/crm_users'
          + '?email=eq.' + encodeURIComponent(email)
          + '&select=password_hash',
          { headers: { 'apikey': sbKey, 'Authorization': 'Bearer ' + sbKey } }
        );
        var rows = await res.json();
        if (Array.isArray(rows) && rows.length > 0 && rows[0].password_hash) {
          var decoded = atob(rows[0].password_hash);
          if (decoded !== pw) { showError(); return; }
          var u = (window.users || []).find(function(x) {
            return x.email.toLowerCase() === email;
          });
          if (u) { window.loginUser(u); return; }
          window.loginUser({
            id: 'sb' + Date.now(), name: email.split('@')[0],
            email: email, password: pw, role: 'sales',
            initials: email[0].toUpperCase(), color: '#1a6fff',
            tc: '#fff', status: 'active', lastLogin: 'Just now'
          });
          return;
        }
      } catch(e) { console.log('[GL] Supabase error:', e.message); }
    }

    // Local fallback
    var u = (window.users || []).find(function(x) {
      return x.email.toLowerCase() === email && x.password === pw && x.status === 'active';
    });
    if (!u) { showError(); return; }
    window.loginUser(u);
  };

  /* ── 7. syncPasswordToSupabase ──────────────────── */
  window.syncPasswordToSupabase = async function(email, newPw) {
    var sbKey = localStorage.getItem('gl_supabase_key');
    if (!sbKey) return;
    try {
      await fetch('https://ufjkeqmxwuyhbqyugcgg.supabase.co/rest/v1/crm_users', {
        method: 'POST',
        headers: {
          'apikey': sbKey, 'Authorization': 'Bearer ' + sbKey,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates'
        },
        body: JSON.stringify({
          email: email.toLowerCase(),
          password_hash: btoa(newPw),
          updated_at: new Date().toISOString()
        })
      });
    } catch(e) { console.log('[GL] Sync error:', e.message); }
  };

  /* ── 8. SEO META TAGS ───────────────────────────────
     Injects full SEO + Open Graph + Twitter Card tags
  ────────────────────────────────────────────────── */
  (function addSEO(){
    var head = document.head;

    function addMeta(attrs) {
      // Don't add if already exists
      var selector = attrs.name ? 'meta[name="'+attrs.name+'"]' :
                     attrs.property ? 'meta[property="'+attrs.property+'"]' : null;
      if(selector && document.querySelector(selector)) return;
      var m = document.createElement('meta');
      Object.keys(attrs).forEach(function(k){ m.setAttribute(k, attrs[k]); });
      head.appendChild(m);
    }

    // Core SEO
    document.title = 'Good Liquid Bev Co | Beverage Co-Packer | Palmetto, FL';
    addMeta({name:'description', content:'Good Liquid Bev Co is a family-run beverage co-packer in Palmetto, FL. Small-batch canning, bottling, R&D and consulting. GMP, PCQI & HACCP certified. Min 150 cases.'});
    addMeta({name:'keywords', content:'beverage co-packer, small batch canning, bottling, beverage R&D, Palmetto FL, craft beverage manufacturing, GMP certified, HACCP, co-packing Florida'});
    addMeta({name:'author', content:'Good Liquid Bev Co'});
    addMeta({name:'robots', content:'index, follow'});
    addMeta({name:'geo.region', content:'US-FL'});
    addMeta({name:'geo.placename', content:'Palmetto, Florida'});

    // Open Graph (Facebook, LinkedIn)
    addMeta({property:'og:type', content:'business.business'});
    addMeta({property:'og:title', content:'Good Liquid Bev Co | Beverage Co-Packer'});
    addMeta({property:'og:description', content:'Family-run beverage co-packer in Palmetto, FL. Small-batch canning, bottling & R&D. GMP, PCQI & HACCP certified. Min 150 cases. Est. 2017.'});
    addMeta({property:'og:url', content:'https://www.goodliquidbevco.com'});
    addMeta({property:'og:site_name', content:'Good Liquid Bev Co'});
    addMeta({property:'og:locale', content:'en_US'});

    // Twitter Card
    addMeta({name:'twitter:card', content:'summary_large_image'});
    addMeta({name:'twitter:title', content:'Good Liquid Bev Co | Beverage Co-Packer'});
    addMeta({name:'twitter:description', content:'Family-run beverage co-packer in Palmetto, FL. Small-batch canning, bottling & R&D. Min 150 cases. GMP certified.'});
    addMeta({name:'twitter:site', content:'@goodliquidbevco'});

    // Canonical URL
    if(!document.querySelector('link[rel="canonical"]')) {
      var link = document.createElement('link');
      link.rel = 'canonical';
      link.href = 'https://www.goodliquidbevco.com';
      head.appendChild(link);
    }

    // Schema.org structured data (local business)
    if(!document.getElementById('gl-schema')) {
      var script = document.createElement('script');
      script.id = 'gl-schema';
      script.type = 'application/ld+json';
      script.textContent = JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'LocalBusiness',
        'name': 'Good Liquid Bev Co',
        'description': 'Family-run beverage co-packer specializing in small-batch canning, bottling, and beverage R&D.',
        'url': 'https://www.goodliquidbevco.com',
        'telephone': '+18034935065',
        'email': 'Mike@GoodLiquid.com',
        'foundingDate': '2017',
        'address': {
          '@type': 'PostalAddress',
          'streetAddress': '2011 51st Ave E, Unit 100',
          'addressLocality': 'Palmetto',
          'addressRegion': 'FL',
          'postalCode': '34221',
          'addressCountry': 'US'
        },
        'geo': {
          '@type': 'GeoCoordinates',
          'latitude': 27.5306,
          'longitude': -82.5695
        },
        'openingHours': 'Mo-Fr 08:00-17:00',
        'priceRange': '$$',
        'hasCredential': ['GMP Certified','PCQI Certified','HACCP Certified'],
        'sameAs': ['https://www.goodliquidbevco.com']
      });
      head.appendChild(script);
    }
  })();

  /* ── 9. GOOGLE ANALYTICS 4 ──────────────────────────
     Loads GA4 and tracks page views + key events.
     Replace GA_MEASUREMENT_ID with your real ID from
     analytics.google.com (format: G-XXXXXXXXXX)
  ────────────────────────────────────────────────── */
  (function addGA(){
    var GA_ID = localStorage.getItem('gl_ga_id');
    if(!GA_ID) {
      console.log('[GL] Google Analytics: Set your GA4 ID with: localStorage.setItem("gl_ga_id","G-XXXXXXXXXX")');
      return;
    }

    // Load GA4 script
    if(document.querySelector('script[src*="googletagmanager"]')) return;
    var script = document.createElement('script');
    script.async = true;
    script.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
    document.head.appendChild(script);

    // Init gtag
    window.dataLayer = window.dataLayer || [];
    window.gtag = function(){ window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', GA_ID, {
      page_title: document.title,
      page_location: window.location.href,
      anonymize_ip: true
    });

    // Track key events
    // Track Get a Quote clicks
    document.addEventListener('click', function(e) {
      var el = e.target.closest('a, button');
      if(!el) return;
      var text = el.textContent.trim();

      if(text.includes('Get a quote') || text.includes('Get a Quote')) {
        window.gtag('event','get_quote_click',{event_category:'CTA',event_label:'Hero or Nav'});
      }
      if(text.includes('Schedule a tour') || text.includes('tour')) {
        window.gtag('event','schedule_tour_click',{event_category:'CTA',event_label:'Tour Button'});
      }
      if(text.includes('See capabilities')) {
        window.gtag('event','see_capabilities_click',{event_category:'CTA',event_label:'Hero'});
      }
    });

    // Track contact form submissions
    document.addEventListener('submit', function(e) {
      window.gtag('event','form_submit',{event_category:'Contact',event_label:'Contact Form'});
    });

    // Track booking completions
    var origSubmitBooking = window.submitBooking;
    if(typeof origSubmitBooking === 'function') {
      window.submitBooking = async function() {
        window.gtag('event','booking_submitted',{event_category:'Conversion',event_label:'Tour Booking'});
        return origSubmitBooking.apply(this, arguments);
      };
    }

    // Track section views with Intersection Observer
    var sections = {
      'hero':'Homepage View',
      'about':'About Section',
      'services':'Services Section',
      'pricing':'Pricing Section',
      'certifications':'Certifications Section',
      'team':'Team Section',
      'contact':'Contact Section'
    };

    if('IntersectionObserver' in window) {
      var observer = new IntersectionObserver(function(entries) {
        entries.forEach(function(entry) {
          if(entry.isIntersecting) {
            var label = sections[entry.target.id];
            if(label) {
              window.gtag('event','section_view',{
                event_category:'Engagement',
                event_label: label,
                non_interaction: true
              });
              observer.unobserve(entry.target);
            }
          }
        });
      }, {threshold: 0.3});

      Object.keys(sections).forEach(function(id) {
        var el = document.getElementById(id);
        if(el) observer.observe(el);
      });
    }

    console.log('[GL] Google Analytics loaded:', GA_ID);
  })();

  console.log('[GL] fix.js loaded — DOM structure fixed, login patched');

})();
