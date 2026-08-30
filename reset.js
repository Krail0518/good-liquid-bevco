/*
 * reset.js — extracted verbatim from reset.html (GL-DEF-01).
 *
 * The code below is byte-for-byte what was inside the page's inline
 * <script> block. Nothing was rewritten: the move exists so that
 * script-src can drop 'unsafe-inline', which an inline block would keep
 * alive on its own regardless of how many on* handlers were converted.
 *
 * The tag replacing it sits in the same document position, so execution
 * order is unchanged.
 */
  (function(){
    // Unregister every service worker + delete every cache for this site, then
    // reload the app fresh. No DevTools required. Login/localStorage are left
    // alone so the user is not signed out.
    function finish(){
      document.getElementById('spin').style.display='none';
      document.getElementById('title').textContent='All set';
      document.getElementById('msg').style.display='none';
      document.getElementById('done').style.display='block';
      document.getElementById('go').style.display='inline-block';
      // Bust the HTTP cache for the shell too, just in case.
      setTimeout(function(){ location.replace('/?fresh=' + Date.now()); }, 900);
    }
    var tasks = [];
    try {
      if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
        tasks.push(
          navigator.serviceWorker.getRegistrations()
            .then(function(rs){ return Promise.all(rs.map(function(r){ return r.unregister(); })); })
            .catch(function(){})
        );
      }
      if (window.caches && caches.keys) {
        tasks.push(
          caches.keys()
            .then(function(keys){ return Promise.all(keys.map(function(k){ return caches.delete(k); })); })
            .catch(function(){})
        );
      }
    } catch(e){}
    Promise.all(tasks).then(finish).catch(finish);
    // Safety net: never hang.
    setTimeout(finish, 4000);
  })();
  
