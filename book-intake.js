/*
 * book-intake.js — extracted verbatim from book.html (GL-DEF-01).
 *
 * The code below is byte-for-byte what was inside the page's inline
 * <script> block. Nothing was rewritten: the move exists so that
 * script-src can drop 'unsafe-inline', which an inline block would keep
 * alive on its own regardless of how many on* handlers were converted.
 *
 * The tag replacing it sits in the same document position, so execution
 * order is unchanged. This page had 2 blocks; they keep their
 * relative order.
 */
(function(){
  function renderIntake(){
    if(window.GL_INTAKE && document.getElementById('bk-intake-mount'))
      window.GL_INTAKE.render(document.getElementById('bk-intake-mount'), {});
  }
  if(document.readyState !== 'loading') renderIntake();
  else document.addEventListener('DOMContentLoaded', renderIntake);
})();

