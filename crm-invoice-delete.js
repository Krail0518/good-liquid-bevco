/* ============================================================
   TWO-STEP INVOICE DELETE

   Prevents accidental hard-deletes by requiring two separate
   clicks to confirm. Flow:
     1st click → button arms: shows "⚠ Confirm delete?" + Cancel
     2nd click → fires the actual delete (skipConfirm=true)
     5 s timeout / click-outside / Cancel → disarms, no action

   Uses replaceChild so the armed button has ZERO prior event
   listeners (the original button's addEventListener would
   re-trigger arm() on the second click, preventing delete).
   ============================================================ */
(function(){
  var _orig  = null;    // original window.deleteInvoice
  var _armed = null;    // { id, orig, btn, cancelBtn, timer }

  function disarm(){
    if(!_armed) return;
    clearTimeout(_armed.timer);
    try {
      // Restore the original button element with its listeners intact
      if(_armed.btn && _armed.btn.parentNode)
        _armed.btn.parentNode.replaceChild(_armed.orig, _armed.btn);
      if(_armed.cancelBtn && _armed.cancelBtn.parentNode)
        _armed.cancelBtn.parentNode.removeChild(_armed.cancelBtn);
    } catch(e){}
    _armed = null;
  }

  function arm(id, btn){
    disarm();

    // Fresh element — no addEventListener baggage from the original button
    var fresh = document.createElement('button');
    fresh.className     = btn.className;
    fresh.innerHTML     = '⚠ Confirm delete?';
    fresh.style.cssText = 'background:rgba(231,76,60,.45);border:1px solid #ff5555;color:#fff;font-size:10px;padding:3px 10px;border-radius:5px;cursor:pointer;white-space:nowrap';
    fresh.onclick = function(e){
      e.stopPropagation();
      var del_id = _armed ? _armed.id : null;
      disarm();
      if(del_id && typeof _orig === 'function') _orig(del_id, { skipConfirm: true });
    };

    var cancelBtn = document.createElement('button');
    cancelBtn.className   = 'cbtn';
    cancelBtn.style.cssText = 'font-size:10px;padding:3px 7px;margin-left:4px';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.onclick = function(e){ e.stopPropagation(); disarm(); };

    if(btn.parentNode){
      btn.parentNode.replaceChild(fresh, btn);
      fresh.insertAdjacentElement('afterend', cancelBtn);
    }

    // Auto-disarm after 5 s so the UI doesn't stay in an armed state forever
    var timer = setTimeout(disarm, 5000);
    _armed = { id: id, orig: btn, btn: fresh, cancelBtn: cancelBtn, timer: timer };
  }

  function patch(){
    if(typeof window.deleteInvoice !== 'function'){ setTimeout(patch, 200); return; }
    if(window.deleteInvoice._gl2step) return; // already patched
    _orig = window.deleteInvoice;

    window.deleteInvoice = function(id, opts){
      opts = opts || {};
      // skipConfirm=true means this is the confirmed second click — pass through
      if(opts.skipConfirm) return _orig.call(this, id, opts);

      // Walk up from the event target to find the clicked button
      var ev  = window.event || null;
      var btn = null;
      if(ev){
        var t = ev.currentTarget || ev.target;
        while(t && t.tagName !== 'BUTTON' && t !== document.body) t = t.parentNode;
        if(t && t.tagName === 'BUTTON') btn = t;
      }
      if(!btn && document.activeElement && document.activeElement.tagName === 'BUTTON')
        btn = document.activeElement;

      if(btn){
        arm(id, btn);
      } else {
        // No button found (programmatic call) — execute directly
        _orig.call(this, id, opts);
      }
    };
    window.deleteInvoice._gl2step = true;
    console.log('[GL] Two-step invoice delete ready');
  }

  // Click-outside: any click that isn't on the armed or cancel button disarms
  document.addEventListener('click', function(e){
    if(!_armed) return;
    if(e.target !== _armed.btn && e.target !== _armed.cancelBtn) disarm();
  }, true);

  if(document.readyState !== 'loading') patch();
  else document.addEventListener('DOMContentLoaded', patch);
}());
