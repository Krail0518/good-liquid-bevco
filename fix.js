/* fix.js v2.3 — Good Liquid Bev Co
   Bootstrap only: console guard, window.users/clients init.
   All features are in module files loaded after this. */
(function(){
  'use strict';

  /* ── Production console guard ──────────────────────────────
     Suppress all console.log output in production so the
     feature map, record counts, and internal state are not
     visible to anyone with DevTools open.
     To re-enable for debugging, run in the browser console:
       localStorage.setItem('gl_debug','1'); location.reload();
     To disable again:
       localStorage.removeItem('gl_debug'); location.reload();
  ─────────────────────────────────────────────────────────── */
  window.GL_DEBUG = (localStorage.getItem('gl_debug') === '1');
  if(!window.GL_DEBUG){
    var _noop = function(){};
    console.log  = _noop;
    console.info = _noop;
    // Keep console.warn and console.error so real problems still surface.
  }

  /* ── Global error boundary ──
     Catches uncaught errors and unhandled promise rejections.
     Pipes to Sentry when the SDK has loaded (crm-integrations.js
     initializes it after login); logs to console.error otherwise
     (console.error is always enabled, even in production mode). */
  window.onerror = function(msg, src, line, col, err){
    if(window.Sentry && typeof window.Sentry.captureException === 'function' && err){
      try{ window.Sentry.captureException(err); }catch(_){}
    }
  };
  window.addEventListener('unhandledrejection', function(e){
    if(window.Sentry && typeof window.Sentry.captureException === 'function'){
      try{ window.Sentry.captureException(e.reason || new Error(String(e))); }catch(_){}
    }
  });

  /* ── Shared runtime arrays ── */
  window.users   = window.users   || [];
  window.clients = window.clients || [];

  console.log('[GL] fix.js v2.3 loaded');
}());
