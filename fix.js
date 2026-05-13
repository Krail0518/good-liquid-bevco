
/* === CAN FORMAT PATCH FINAL v2 === */
(function(){
var RATES={
  "12oz-standard":[[150,0.48],[340,0.43],[501,0.38],[1000,0.35],[2500,0.31],[5000,0.28]],
  "12oz-sleek":   [[150,0.48],[340,0.43],[501,0.38],[1000,0.35],[2500,0.31],[5000,0.28]],
  "16oz-standard":[[150,0.58],[340,0.53],[501,0.48],[1000,0.45],[2500,0.41],[5000,0.38]]
};
var CANS=24;
var FMT=[{value:"12oz-standard",label:"12oz Standard"},{value:"12oz-sleek",label:"12oz Sleek"},{value:"16oz-standard",label:"16oz Standard"}];
function rate(cases,fmt){var t=RATES[fmt]||RATES["12oz-standard"],v=t[0][1];for(var i=0;i<t.length;i++)if(cases>=t[i][0])v=t[i][1];return v;}
function calc(cases,fmt){var pc=rate(cases,fmt);return{perCan:pc,perCase:pc*CANS,total:pc*CANS*cases,cans:cases*CANS};}
function usd(n,d){return"$"+n.toLocaleString("en-US",{minimumFractionDigits:d==null?2:d,maximumFractionDigits:d==null?2:d});}
function tbl(){var b=document.getElementById("gl-inv-body");return b?b.children[2]:null;}
window.glCanFormatChange=function(uid){
  var ce=document.getElementById(uid+"-cases"),fe=document.getElementById(uid+"-format");
  if(!ce||!fe)return;
  var b=calc(Math.max(1,parseInt(ce.value)||150),fe.value);
  function s(id,v){var e=document.getElementById(id);if(e)e.textContent=v;}
  s(uid+"-total",usd(b.total));
  s(uid+"-pcase",usd(b.perCase)+"/case");
  s(uid+"-pcan",usd(b.perCan,4)+"/can");
  s(uid+"-cans",b.cans.toLocaleString()+" cans");
  if(typeof window.glCalcInvTotal==="function")window.glCalcInvTotal();
};
window.glRemoveCanLine=function(uid){var e=document.getElementById(uid);if(e)e.remove();if(typeof window.glCalcInvTotal==="function")window.glCalcInvTotal();};
var _p=window.glAddLine;
window.glAddLine=function(type){
  if(type!=="canning"){if(typeof _p==="function")_p(type);return;}
  var t=tbl();if(!t)return;
  var uid="glcan"+Date.now(),b=calc(150,"12oz-standard");
  var opts=FMT.map(function(f){return'<option value="'+f.value+'"'+(f.value==="12oz-standard"?" selected":"")+'>'+f.label+'</option>';}).join("");
  var row=document.createElement("div");
  row.id=uid;
  row.setAttribute("style","display:grid;grid-template-columns:2fr 1fr 1fr 1fr 36px;gap:0;padding:10px 12px;border-top:1px solid rgba(255,255,255,.05);align-items:start");
  row.innerHTML=
    '<div><div style="font-size:12px;font-weight:700;color:var(--teal);margin-bottom:5px">Canning</div>'
    +'<select id="'+uid+'-format" onchange="window.glCanFormatChange(this.closest(\'[id^=glcan]\').id)" style="background:#1a2a3a;color:#fff;border:1px solid rgba(0,229,192,.4);border-radius:6px;padding:3px 8px;font-size:11px;cursor:pointer;width:100%;max-width:160px">'+opts+'</select></div>'
    +'<div style="text-align:center"><input id="'+uid+'-cases" type="number" min="1" value="150" onchange="window.glCanFormatChange(this.closest(\'[id^=glcan]\').id)" style="width:60px;background:#1a2a3a;color:#fff;border:1px solid rgba(255,255,255,.18);border-radius:6px;padding:3px 6px;font-size:12px;font-weight:600;text-align:center"/>'
    +'<div id="'+uid+'-cans" style="font-size:10px;color:var(--muted);margin-top:3px">'+b.cans.toLocaleString()+' cans</div></div>'
    +'<div style="text-align:right;padding-right:4px"><div id="'+uid+'-pcase" style="font-size:12px;color:#fff;font-weight:600">'+usd(b.perCase)+'/case</div>'
    +'<div id="'+uid+'-pcan" style="font-size:10px;color:var(--muted);margin-top:3px">'+usd(b.perCan,4)+'/can</div></div>'
    +'<div id="'+uid+'-total" style="text-align:right;font-size:14px;font-weight:700;color:#fff">'+usd(b.total)+'</div>'
    +'<div style="text-align:center"><button onclick="window.glRemoveCanLine(this.closest(\'[id^=glcan]\').id)" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:16px;opacity:.5;padding:0;line-height:1">x</button></div>';
  t.appendChild(row);
  if(typeof window.glCalcInvTotal==="function")window.glCalcInvTotal();
};
console.log("[GL] rate card patch v2 loaded");
}());
