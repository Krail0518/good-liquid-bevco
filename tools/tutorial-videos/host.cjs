// host.cjs — Sofia, the on-screen host of the tutorial and explainer videos.
//
// An original cartoon drawn for Good Liquid (chosen by the owner, 2026-10-18),
// replacing the talking can. Both generators inject HOST_SVG into the page as
// window.__hostSvg and HOST_CSS as a style; the page shows her open mouth
// only while window.__speak(ms) says she is talking, so the mouth follows the
// narration instead of flapping through the silences.
'use strict';
function drawHost(o, open, blink){
  var s = o.skin, sd = o.skinShade, h = o.hair, hd = o.hairShade;
  var out = [];
  function P(d, fill, extra){ out.push('<path d="' + d + '" fill="' + fill + '"' + (extra || '') + '/>'); }
  function E(cx, cy, rx, ry, fill, extra){ out.push('<ellipse cx="' + cx + '" cy="' + cy + '" rx="' + rx + '" ry="' + ry + '" fill="' + fill + '"' + (extra || '') + '/>'); }
  function C(cx, cy, r, fill, extra){ out.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="' + fill + '"' + (extra || '') + '/>'); }
  function R(x, y, w, hh, rx, fill, extra){ out.push('<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + hh + '" rx="' + rx + '" fill="' + fill + '"' + (extra || '') + '/>'); }
  var id = o.id;
  out.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 440" width="360" height="440">');
  out.push('<defs><clipPath id="vl' + id + '"><path d="M58,440 C60,380 100,342 150,326 L166,440 Z"/></clipPath>' +
           '<clipPath id="vr' + id + '"><path d="M302,440 C300,380 260,342 210,326 L194,440 Z"/></clipPath></defs>');

  // ── hair behind the head
  if(o.style === 'ponytail'){
    P('M236,128 C300,120 318,190 300,250 C290,290 296,320 312,350 C270,340 252,300 258,250 C262,210 256,170 236,150 Z', hd);
    E(180, 192, 86, 92, h);
  } else if(o.style === 'bun'){
    E(180, 192, 86, 92, h);
  } else if(o.style === 'curly'){
    var pts = [[100,150],[96,190],[100,232],[112,268],[260,150],[264,190],[260,232],[248,268],[120,115],[150,96],[180,90],[210,96],[240,115],[106,300],[254,300],[124,322],[236,322]];
    pts.forEach(function(q){ C(q[0], q[1], 30, h); });
    E(180, 200, 92, 100, h);
  } else if(o.style === 'bob'){
    P('M92,200 C88,110 140,92 180,92 C220,92 272,110 268,200 L272,272 C250,290 220,284 214,270 L146,270 C140,284 110,290 88,272 Z', h);
  } else if(o.style === 'long'){
    P('M94,190 C88,110 140,92 180,92 C220,92 272,110 266,190 C276,260 286,320 270,370 C240,352 230,330 228,300 L132,300 C130,330 120,352 90,370 C74,320 84,260 94,190 Z', h);
  }

  // ── body
  P('M40,440 C40,362 98,326 158,316 L202,316 C262,326 320,362 320,440 Z', o.shirt);
  // collar / neck opening
  P('M158,316 L180,350 L202,316 Z', sd);
  R(162, 268, 36, 58, 14, s);
  P('M162,300 C172,312 188,312 198,300 L198,318 L162,318 Z', sd, ' opacity=".55"');
  // vest
  if(o.vest){
    P('M58,440 C60,380 100,342 150,326 L166,440 Z', o.vest);
    P('M302,440 C300,380 260,342 210,326 L194,440 Z', o.vest);
    ['l','r'].forEach(function(k){
      out.push('<g clip-path="url(#v' + k + id + ')"><rect x="40" y="384" width="280" height="12" fill="#e8eef2"/><rect x="40" y="412" width="280" height="12" fill="#e8eef2"/></g>');
    });
  }
  // chest patch
  if(o.patch){
    C(o.vest ? 238 : 232, 382, 17, '#fff');
    C(o.vest ? 238 : 232, 382, 14, '#00b89a');
    out.push('<text x="' + (o.vest ? 238 : 232) + '" y="387" font-family="Arial Black,Arial" font-weight="900" font-size="13" fill="#fff" text-anchor="middle">GL</text>');
  }

  // ── ears and head
  C(103, 214, 15, s); C(257, 214, 15, s);
  C(103, 214, 7, sd); C(257, 214, 7, sd);
  if(o.earring){ C(103, 232, 4, '#f5c842'); C(257, 232, 4, '#f5c842'); }
  P('M102,196 C102,128 136,110 180,110 C224,110 258,128 258,196 C258,256 224,292 180,292 C136,292 102,256 102,196 Z', s);

  // ── face
  var ey = 206;
  out.push('<g class="gm-eyes">');
  [[146, -1], [214, 1]].forEach(function(e){
    var x = e[0], side = e[1];
    if(blink){
      P('M' + (x-17) + ',' + ey + ' Q' + x + ',' + (ey+9) + ' ' + (x+17) + ',' + ey, 'none', ' stroke="#2a1b14" stroke-width="4" stroke-linecap="round"');
      return;
    }
    E(x, ey, 16, 19, '#fff');
    C(x + side * 1, ey + 2, 11, o.eyes);
    C(x + side * 1, ey + 3, 5.5, '#1a0f0a');
    C(x + side * 1 + 4, ey - 3, 3.2, '#fff');
    C(x + side * 1 - 3, ey + 7, 1.6, '#fff');
    // upper lash line with a flick at the outer corner
    P('M' + (x - 18) + ',' + (ey - 2) + ' Q' + x + ',' + (ey - 26) + ' ' + (x + 18) + ',' + (ey - 2) +
      ' L' + (x + 18 + side * 6) + ',' + (ey - 10) + ' L' + (x + 14) + ',' + (ey - 8) + ' Q' + x + ',' + (ey - 21) + ' ' + (x - 16) + ',' + (ey - 6) + ' Z', '#2a1b14');
    if(side > 0) P('M' + (x + 18) + ',' + (ey - 2) + ' l7,-11 l-3,10 Z', '#2a1b14'); else P('M' + (x - 18) + ',' + (ey - 2) + ' l-7,-11 l3,10 Z', '#2a1b14');
  });
  out.push('</g>');
  // brows
  P('M126,174 Q146,162 166,170', 'none', ' stroke="' + o.brow + '" stroke-width="5" stroke-linecap="round"');
  P('M194,170 Q214,162 234,174', 'none', ' stroke="' + o.brow + '" stroke-width="5" stroke-linecap="round"');
  // nose and cheeks
  P('M176,236 Q182,242 188,236', 'none', ' stroke="' + sd + '" stroke-width="3.5" stroke-linecap="round"');
  E(128, 244, 15, 9, '#ff7a8a', ' opacity=".35"'); E(232, 244, 15, 9, '#ff7a8a', ' opacity=".35"');
  if(o.freckles){ [[122,238],[130,233],[134,244],[226,238],[234,233],[238,244]].forEach(function(q){ C(q[0], q[1], 1.8, sd); }); }
  // mouth: both shapes, the page shows the open one while she is speaking
  out.push('<g class="gm-mopen">');
  P('M160,254 Q180,252 200,254 Q198,282 180,284 Q162,282 160,254 Z', '#7a2230');
  P('M166,272 Q180,264 194,272 Q190,282 180,283 Q170,282 166,272 Z', '#ff8a96');
  P('M161,254 Q180,252 199,254 L197,260 Q180,258 163,260 Z', '#fff');
  out.push('</g><g class="gm-mclosed">');
  P('M160,256 Q180,276 200,256 Q180,266 160,256 Z', '#a83246');
  out.push('</g>');
  if(o.lip) P('M160,256 Q180,250 200,256', 'none', ' stroke="' + o.lip + '" stroke-width="2" opacity=".5"');

  // ── front hair
  if(o.style === 'curly'){
    [[122,130],[148,114],[180,108],[212,114],[238,130],[112,160],[248,160]].forEach(function(q){ C(q[0], q[1], 24, h); });
  } else if(o.style === 'bob'){
    P('M100,206 C96,130 140,104 180,104 C222,104 264,130 260,206 C250,170 236,150 214,144 C190,160 140,160 124,150 C110,166 104,186 100,206 Z', h);
  } else {
    P('M102,206 C96,126 146,100 186,104 C232,108 262,140 258,204 C248,170 232,150 204,140 C186,158 150,168 118,166 C110,178 104,192 102,206 Z', h);
    P('M150,150 C170,146 190,138 204,140', 'none', ' stroke="' + hd + '" stroke-width="3" opacity=".6"');
  }
  if(o.style === 'bun' && !o.hat){ C(180, 98, 30, h); P('M156,110 Q180,122 204,110', 'none', ' stroke="' + hd + '" stroke-width="4"'); }

  // ── headwear
  if(o.hat === 'hardhat'){
    P('M100,170 C98,92 262,92 260,170 Z', o.hatColor);
    R(170, 98, 20, 70, 8, '#fff', ' opacity=".35"');
    R(86, 160, 188, 16, 8, o.hatShade);
    out.push('<text x="180" y="150" font-family="Arial Black,Arial" font-weight="900" font-size="20" fill="' + o.hatShade + '" text-anchor="middle" opacity=".8">GL</text>');
  } else if(o.hat === 'cap'){
    // Good Liquid ball cap: crown with panel seams, front logo, curved brim
    P('M100,170 C98,92 262,92 260,170 Q180,150 100,170 Z', o.hatColor);
    P('M180,96 L180,158', 'none', ' stroke="' + o.hatShade + '" stroke-width="2.5" opacity=".7"');
    P('M140,104 Q132,130 130,162', 'none', ' stroke="' + o.hatShade + '" stroke-width="2.5" opacity=".7"');
    P('M220,104 Q228,130 230,162', 'none', ' stroke="' + o.hatShade + '" stroke-width="2.5" opacity=".7"');
    C(180, 96, 7, o.hatShade);
    R(146, 118, 68, 30, 10, '#fff');
    out.push('<text x="180" y="133" font-family="Arial Black,Arial" font-weight="900" font-size="11" fill="' + o.hatShade + '" text-anchor="middle">GOOD</text>');
    out.push('<text x="180" y="145" font-family="Arial Black,Arial" font-weight="900" font-size="11" fill="' + o.hatShade + '" text-anchor="middle">LIQUID</text>');
    P('M84,170 Q180,138 276,170 Q284,186 262,190 Q180,166 98,190 Q76,186 84,170 Z', o.hatShade);
    P('M98,182 Q180,160 262,182', 'none', ' stroke="#fff" stroke-width="1.5" opacity=".25"');
    if(o.style === 'bun'){ C(262, 132, 22, h); }
  } else if(o.hat === 'bandana'){
    P('M104,170 C100,108 260,108 256,170 C220,150 140,150 104,170 Z', o.hatColor);
    [[140,140],[180,132],[220,140],[160,156],[200,156]].forEach(function(q){ C(q[0], q[1], 4, '#fff', ' opacity=".8"'); });
    P('M250,150 l30,-14 l-6,22 Z', o.hatColor); P('M252,158 l26,16 l-22,6 Z', o.hatColor);
  }
  if(o.glasses){
    R(122, 120, 44, 20, 9, 'none', ' stroke="#3a4a5a" stroke-width="4"'); R(194, 120, 44, 20, 9, 'none', ' stroke="#3a4a5a" stroke-width="4"');
    P('M166,128 L194,128', 'none', ' stroke="#3a4a5a" stroke-width="4"');
    R(124, 122, 40, 16, 8, '#9fe8ff', ' opacity=".35"'); R(196, 122, 40, 16, 8, '#9fe8ff', ' opacity=".35"');
  }
  if(o.headset){
    if(o.hat !== 'cap') P('M98,206 C90,110 270,110 262,206', 'none', ' stroke="#25303c" stroke-width="8" stroke-linecap="round"');
    R(88, 196, 20, 34, 9, '#25303c'); R(252, 196, 20, 34, 9, '#25303c');
    P('M98,226 Q110,268 152,268', 'none', ' stroke="#25303c" stroke-width="5" stroke-linecap="round"'); C(154, 268, 6, '#00e5c0');
  }

  // ── held item
  if(o.item === 'clipboard'){
    out.push('<g transform="rotate(-12 96 400)"><rect x="56" y="346" width="78" height="100" rx="8" fill="#8a5a33"/><rect x="64" y="362" width="62" height="78" rx="3" fill="#fff"/>' +
      '<rect x="80" y="338" width="30" height="16" rx="5" fill="#9aa7bd"/><rect x="72" y="376" width="44" height="5" rx="2" fill="#00b89a"/><rect x="72" y="390" width="38" height="4" rx="2" fill="#c8d2dc"/><rect x="72" y="402" width="44" height="4" rx="2" fill="#c8d2dc"/><rect x="72" y="414" width="30" height="4" rx="2" fill="#c8d2dc"/></g>');
    C(118, 418, 16, s);
  } else if(o.item === 'scanner'){
    out.push('<g transform="rotate(-20 100 390)"><rect x="70" y="360" width="56" height="34" rx="10" fill="#25303c"/><rect x="80" y="368" width="34" height="16" rx="4" fill="#00e5c0" opacity=".8"/><rect x="88" y="392" width="20" height="44" rx="8" fill="#25303c"/></g>');
    C(108, 412, 15, s);
  } else if(o.item === 'tablet'){
    out.push('<g transform="rotate(8 250 400)"><rect x="210" y="350" width="86" height="104" rx="10" fill="#25303c"/><rect x="218" y="358" width="70" height="86" rx="4" fill="#0a1628"/>' +
      '<rect x="226" y="368" width="40" height="6" rx="3" fill="#00e5c0"/><rect x="226" y="382" width="54" height="5" rx="2" fill="#6b87ad"/><rect x="226" y="394" width="48" height="5" rx="2" fill="#6b87ad"/><rect x="226" y="406" width="54" height="5" rx="2" fill="#6b87ad"/></g>');
    C(232, 430, 15, s);
  } else if(o.item === 'wave'){
    P('M268,440 C270,400 286,360 300,330', 'none', ' stroke="' + o.shirt + '" stroke-width="34" stroke-linecap="round"');
    C(304, 314, 22, s);
    [[290,290],[302,286],[314,288],[324,296]].forEach(function(q){ R(q[0] - 5, q[1] - 16, 10, 24, 5, s); });
  }
  out.push('</svg>');
  return out.join('');
}


var SOFIA = { id: 'f', name: 'Sofia', blurb: 'Brown ponytail, teal Good Liquid cap, navy shirt with the GL patch, clipboard.',
    skin: '#d9a77c', skinShade: '#b47e56', hair: '#3a2416', hairShade: '#22140a', brow: '#22140a', eyes: '#6b4320', style: 'ponytail',
    hat: 'cap', hatColor: '#00b89a', hatShade: '#007f6b', shirt: '#1e3a5f', vest: null, patch: true, item: 'clipboard' };

var HOST_SVG = drawHost(SOFIA).replace('width="360" height="440"', 'width="100%" height="100%"');
var HOST_CSS =
  '@keyframes gm-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}' +
  '@keyframes gm-blink{0%,92%,100%{transform:scaleY(1)}96%{transform:scaleY(.08)}}' +
  '@keyframes gm-flap{0%,100%{opacity:1}45%{opacity:0}}' +
  '@keyframes gm-flap2{0%,100%{opacity:0}45%{opacity:1}}' +
  '#gm-mascot,#gm{animation:gm-bob 3s ease-in-out infinite}' +
  '#gm-mascot .gm-eyes,#gm .gm-eyes{transform-box:fill-box;transform-origin:center;animation:gm-blink 4.2s infinite}' +
  '#gm-mascot .gm-mopen,#gm .gm-mopen{opacity:0}' +
  '.gm-talking .gm-mopen{animation:gm-flap .26s steps(1) infinite}' +
  '.gm-talking .gm-mclosed{animation:gm-flap2 .26s steps(1) infinite}';

module.exports = { HOST_SVG: HOST_SVG, HOST_CSS: HOST_CSS, drawHost: drawHost, SOFIA: SOFIA };
