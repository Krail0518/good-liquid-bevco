/*
 * actions.js — the delegated event dispatcher (GL-DEF-01, phase 1).
 *
 * WHY THIS EXISTS
 * ---------------
 * The CSP allows script-src 'unsafe-inline' because 556 inline on* handlers
 * resolve against window. Removing that allowance means removing the handlers,
 * and this is what they become.
 *
 * THIS FILE CHANGES NOTHING ON ITS OWN. It listens for data-gl-action
 * attributes, of which there are currently zero. Every existing onclick keeps
 * working untouched, and 'unsafe-inline' stays until the last phase. The CRM
 * runs on both mechanisms for as long as the migration takes, so there is no
 * flag day and any single conversion can be reverted by itself.
 *
 * WHY A REGISTRY RATHER THAN LOOKING UP window[name]
 * --------------------------------------------------
 * window[name] would be a smaller change and would reproduce the current
 * behaviour exactly -- which is the problem. Today an inline handler can call
 * ANY global on the page. Resolving against a registry makes that an allowlist:
 * a converted control reaches only what was explicitly registered. That is a
 * real reduction in surface, and it arrives with each converted file rather
 * than only at the end.
 *
 * HOW ARGUMENTS TRAVEL
 * --------------------
 * One attribute per argument, escaped with the page's own esc(), read back
 * through dataset:
 *
 *     <button data-gl-action="deleteDoc" data-gl-arg1="${esc(d.id)}">
 *
 * NOT JSON in an attribute. CLAUDE.md rule 5: JSON.stringify(x).replace(/"/g,
 * '&quot;') is not an escape, because the HTML parser decodes entities
 * afterwards. dataset returns the decoded original, which is what the handler
 * wants, and the parser never sees anything it could treat as markup.
 *
 * That is a claim about parser behaviour, so it was tested before this file
 * was written: ten hostile payloads through a real browser -- including
 * `" onmouseover="alert(1)`, `"><img src=x onerror=alert(3)>` and
 * `</script><script>alert(4)</script>` -- all round-tripped byte-identical,
 * no dialog fired, and every element ended up with exactly the two attributes
 * it was given.
 *
 * UNREGISTERED ACTIONS FAIL LOUDLY
 * --------------------------------
 * A converted control that silently does nothing is the worst outcome here:
 * no console error, no failed request, just a dead button. That is the
 * logoutCRM shape. So an unknown action name logs an error and reports itself
 * rather than being ignored.
 */
(function () {
  'use strict';

  var registry = Object.create(null);

  // Only the event types the codebase actually uses. Measured, not guessed:
  // click 485, change 31, input 19, keydown 7, mouseover 5, mouseout 5,
  // mouseenter 2, mouseleave 2. mouseenter/mouseleave do not bubble, so they
  // are handled with capture below.
  var BUBBLING = ['click', 'change', 'input', 'keydown', 'mouseover', 'mouseout'];
  var NON_BUBBLING = ['mouseenter', 'mouseleave'];

  var MAX_ARGS = 6;

  /**
   * Register an action a data-gl-action attribute may name.
   * Re-registering the same name is a mistake worth hearing about: it means
   * two capabilities picked the same string, and one silently wins.
   */
  window.glRegisterAction = function glRegisterAction(name, fn) {
    if (typeof name !== 'string' || !name) throw new Error('glRegisterAction: name required');
    if (typeof fn !== 'function') throw new Error('glRegisterAction: ' + name + ' is not a function');
    if (registry[name]) {
      console.error('[gl-actions] "' + name + '" is already registered; the later one wins. ' +
        'Two capabilities have picked the same action name.');
    }
    registry[name] = fn;
    return fn;
  };

  /** Register many at once: glRegisterActions({ save: fn, close: fn }). */
  window.glRegisterActions = function glRegisterActions(map) {
    Object.keys(map || {}).forEach(function (k) { window.glRegisterAction(k, map[k]); });
  };

  /**
   * Register action names that resolve to an existing global at CALL time.
   *
   * The functions these name are declared across crm-index-core.js and 45
   * modules, and load order means most do not exist when this file runs.
   * Registering a thunk defers the lookup without weakening anything: the
   * ALLOWLIST IS THE SET OF NAMES, and a name absent from this list is still
   * unreachable no matter what globals exist. It is the difference between
   * "any global" and "these 82".
   *
   * A name that resolves to nothing at call time is reported the same way an
   * unregistered action is — a dead control has to be loud.
   */
  window.glRegisterGlobalActions = function glRegisterGlobalActions(names) {
    (names || []).forEach(function (name) {
      window.glRegisterAction(name, function () {
        var fn = window[name];
        if (typeof fn !== 'function') {
          console.error('[gl-actions] "' + name + '" is registered but no such global ' +
            'exists at call time. The control is dead. Was its module renamed or ' +
            'did it fail to load?');
          if (typeof window.addNotification === 'function') {
            window.addNotification('Control not available', name + ' is not loaded.', 'warning');
          }
          return;
        }
        return fn.apply(this, arguments);
      });
    });
  };

  /** Read-only view, for tests and for debugging a dead control. */
  window.glActionNames = function glActionNames() { return Object.keys(registry).sort(); };

  function readArgs(el) {
    var args = [];
    for (var i = 1; i <= MAX_ARGS; i++) {
      var v = el.getAttribute('data-gl-arg' + i);
      if (v === null) break;      // arguments are positional; stop at the first gap
      args.push(v);
    }
    return args;
  }

  function run(el, ev) {
    var name = el.getAttribute('data-gl-action');
    var fn = registry[name];
    if (!fn) {
      // Loudly, on purpose. A dead control with a silent console is the
      // failure mode this whole mechanism has to avoid.
      console.error('[gl-actions] no action registered for "' + name + '". ' +
        'The control is dead. Registered: ' + window.glActionNames().join(', '));
      if (typeof window.addNotification === 'function') {
        window.addNotification('Control not wired up', 'Action "' + name + '" is not registered.', 'warning');
      }
      return;
    }
    if (el.getAttribute('data-gl-prevent') !== null && ev && ev.preventDefault) ev.preventDefault();

    // The element as an ARGUMENT, not just the receiver. Several handlers take
    // it as a parameter — showPanel('canning', this), setInvFilter(this, 'all')
    // — and fn.apply(el, ...) only sets `this`, which those do not read.
    //
    //   data-gl-el            append it after the declared arguments
    //   data-gl-el-at="1"     insert it at that 1-based position
    //
    // Two forms because the element appears in both places in this codebase,
    // and rewriting the functions to agree on one would be a behaviour change
    // smuggled into a mechanical conversion.
    var args = readArgs(el);
    var elAt = el.getAttribute('data-gl-el-at');
    if (elAt !== null) {
      var pos = parseInt(elAt, 10);
      if (!(pos >= 1)) {
        console.error('[gl-actions] data-gl-el-at="' + elAt + '" is not a 1-based position');
        return;
      }
      args.splice(pos - 1, 0, el);
    } else if (el.getAttribute('data-gl-el') !== null) {
      args.push(el);
    }
    try {
      fn.apply(el, args.concat([ev]));
    } catch (e) {
      console.error('[gl-actions] "' + name + '" threw', e);
      throw e;
    }
  }

  function handler(ev) {
    var start = ev.target;
    if (!start || start.nodeType !== 1) {
      start = start && start.parentElement;
      if (!start) return;
    }
    var el = start.closest ? start.closest('[data-gl-action],[data-gl-close]') : null;
    if (!el) return;

    // The attribute must match the event that fired, or a button with
    // data-gl-action would run on click AND on any other bound type.
    var want = el.getAttribute('data-gl-on') || 'click';
    if (want !== ev.type) return;

    if (el.hasAttribute('data-gl-close')) {
      closeTarget(el, ev);
      return;
    }
    run(el, ev);
  }

  /**
   * The generic close. 53 handlers are nothing but "remove this element" or
   * "hide it", and giving each one a named action would be noise.
   *
   *   data-gl-close="#some-id"   remove the matching element
   *   data-gl-close=""           remove the nearest .modal-ov ancestor
   *   plus data-gl-close-mode="hide" to drop the .show class instead
   */
  function closeTarget(el, ev) {
    var sel = el.getAttribute('data-gl-close');
    var target = sel ? document.querySelector(sel) : (el.closest ? el.closest('.modal-ov') : null);
    if (!target) {
      console.error('[gl-actions] data-gl-close found nothing for "' + (sel || '(nearest .modal-ov)') + '"');
      return;
    }
    if (ev && ev.preventDefault && el.getAttribute('data-gl-prevent') !== null) ev.preventDefault();
    if (el.getAttribute('data-gl-close-mode') === 'hide') target.classList.remove('show');
    else target.remove();
  }

  BUBBLING.forEach(function (type) {
    document.addEventListener(type, handler, false);
  });
  // mouseenter/mouseleave do not bubble; capture reaches them without
  // attaching a listener per element.
  NON_BUBBLING.forEach(function (type) {
    document.addEventListener(type, handler, true);
  });

  console.log('[GL] action dispatcher loaded (' + (BUBBLING.length + NON_BUBBLING.length) + ' event types)');
}());
