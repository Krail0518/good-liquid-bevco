(function(){
  'use strict';
  var debug = localStorage.getItem('gl_debug') === '1' || location.search.indexOf('gl_debug=1') !== -1;
  if(!debug) return;

  console.log('[GL] crm-selftest loaded — checks fire in 800ms');

  window.addEventListener('load', function(){
    setTimeout(function(){
      var pass = 0, fail = 0;

      function ok(label, condition){
        if(condition){
          pass++;
          console.log('%c[GL-TEST] ✓ ' + label, 'color:#1D9E75;font-weight:600');
        } else {
          fail++;
          console.error('[GL-TEST] ✗ ' + label);
        }
      }

      // ── Core globals ────────────────────────────────────────
      ok('glEsc is a function',             typeof window.glEsc === 'function');
      ok('glEsc encodes all 5 chars',       typeof window.glEsc === 'function' &&
                                            window.glEsc('<"\'&>') === '&lt;&quot;&#39;&amp;&gt;');
      ok('onerror boundary installed',      typeof window.onerror === 'function');
      ok('loginUser is a function',         typeof window.loginUser === 'function');
      ok('glGetSupa is a function',         typeof window.glGetSupa === 'function');
      ok('navTo is a function',             typeof window.navTo === 'function');
      ok('exitCRM is a function',           typeof window.exitCRM === 'function');
      ok('can() is a function',             typeof window.can === 'function');
      ok('PERMISSIONS is an object',        window.PERMISSIONS && typeof window.PERMISSIONS === 'object');

      // ── GL_HOOKS counts ──────────────────────────────────────
      var h = window.GL_HOOKS;
      ok('GL_HOOKS exists',                 h && typeof h === 'object');
      if(h){
        ok('_dashPatches: 8',              (h._dashPatches||[]).length === 8);
        ok('_loginHooks: 9',              (h._loginHooks||[]).length === 9);
        ok('_navGuards: 3',               (h._navGuards||[]).length === 3);
        ok('_navHooks: 4',                (h._navHooks||[]).length === 4);
      }

      // ── Summary ──────────────────────────────────────────────
      var total = pass + fail;
      if(fail === 0){
        console.log('%c[GL-TEST] All ' + total + ' checks passed ✓', 'color:#1D9E75;font-size:13px;font-weight:700');
      } else {
        console.error('[GL-TEST] ' + fail + '/' + total + ' FAILED — counts above show actual vs expected');
        console.log('[GL-TEST] Hook counts → dashPatches:' + ((h&&h._dashPatches)||[]).length +
                    ' loginHooks:' + ((h&&h._loginHooks)||[]).length +
                    ' navGuards:' + ((h&&h._navGuards)||[]).length +
                    ' navHooks:' + ((h&&h._navHooks)||[]).length);
      }
    }, 800);
  });
}());
