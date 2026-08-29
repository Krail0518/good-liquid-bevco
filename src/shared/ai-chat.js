/*
 * ai-chat.js — extracted from crm-index-core.js (GL-037).
 *
 * VERBATIM move: the code below is byte-for-byte what was in the core, so
 * this diff is a relocation and nothing else.
 *
 * Loads AFTER crm-index-core.js and must stay a CLASSIC script — no defer,
 * async or type="module". Its top-level declarations become window
 * properties, which is how the inline on* handlers in index.html resolve
 * them. A module-scoped version would leave those handlers dead with no
 * error to show for it.
 *
 * Declares: toggleChat, sendChatMsg
 */
/* ═══════════════════════════════════════════
   AI CHAT WIDGET
═══════════════════════════════════════════ */
let chatOpen=false;

function toggleChat(){
  chatOpen=!chatOpen;
  document.getElementById('gl-chat-window').classList.toggle('show',chatOpen);
}

async function sendChatMsg(){
  const input=document.getElementById('gl-chat-input');
  const msg=input.value.trim();
  if(!msg) return;
  input.value='';
  
  const msgs=document.getElementById('gl-chat-messages');
  msgs.innerHTML+=`<div class="chat-msg user">${esc(msg)}</div>`;
  msgs.innerHTML+=`<div class="chat-msg bot" id="chat-thinking">Thinking…</div>`;
  msgs.scrollTop=msgs.scrollHeight;
  
  const reply=await callAI(
    `You are the Good Liquid Bev Co assistant. You help website visitors learn about our beverage co-packing services.
    
    Key facts:
    - We are a veteran-owned, family-run beverage co-packer in Palmetto, FL (Est. 2017)
    - Services: Small-batch canning (12oz & 16oz), Bottle filling (750ml), Beverage R&D/formulation, Consulting
    - Minimum order: 200 cases (4,800 units)
    - R&D starting at $2,500/SKU (3 iterations)
    - Canning from $0.28/can at volume
    - Typical timeline: 8 weeks concept to pallet
    - GMP, PCQI, HACCP certified
    - Contact: Mike@GoodLiquid.com | (803) 493-5065
    - Address: 2011 51st Ave E, Unit 100, Palmetto, FL 34221
    
    Be friendly, helpful, and concise. If they want to get started, encourage them to fill out the contact form or schedule a tour.`,
    msg);
  
  document.getElementById('chat-thinking').outerHTML=`<div class="chat-msg bot">${esc(reply)}</div>`;
  msgs.scrollTop=msgs.scrollHeight;
}

