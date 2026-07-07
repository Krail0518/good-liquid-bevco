/* crm-seo.js — SEO meta tags, structured data, GA4 */
(function(){
  'use strict';

  /* ── SEO ── */
  (function(){
    var h=document.head;
    function m(a){var s=a.name?'meta[name="'+a.name+'"]':a.property?'meta[property="'+a.property+'"]':null;if(s&&document.querySelector(s))return;var el=document.createElement('meta');Object.keys(a).forEach(function(k){el.setAttribute(k,a[k]);});h.appendChild(el);}
    document.title='Good Liquid Bev Co | Beverage Co-Packer | Palmetto, FL';
    m({name:'description',content:'Family-run beverage co-packer in Palmetto, FL. Small-batch canning, bottling & R&D. GMP, PCQI & HACCP certified. Min 150 cases.'});
    m({name:'robots',content:'index, follow'});
    m({property:'og:title',content:'Good Liquid Bev Co | Beverage Co-Packer'});
    m({property:'og:description',content:'Family-run beverage co-packer in Palmetto, FL. Min 150 cases. GMP certified.'});
    m({property:'og:url',content:'https://www.goodliquidbevco.com'});
    m({name:'twitter:card',content:'summary_large_image'});
    if(!document.querySelector('link[rel="canonical"]')){var l=document.createElement('link');l.rel='canonical';l.href='https://www.goodliquidbevco.com';h.appendChild(l);}
    if(!document.getElementById('gl-schema')){var s=document.createElement('script');s.id='gl-schema';s.type='application/ld+json';s.textContent=JSON.stringify({'@context':'https://schema.org','@type':'LocalBusiness','name':'Good Liquid Bev Co','telephone':'+18034935065','email':'Mike@GoodLiquid.com','foundingDate':'2017','address':{'@type':'PostalAddress','streetAddress':'2011 51st Ave E, Unit 100','addressLocality':'Palmetto','addressRegion':'FL','postalCode':'34221','addressCountry':'US'}});h.appendChild(s);}
  })();

  /* ── GA4 ── */
  (function(){
    var id=localStorage.getItem('gl_ga_id');if(!id)return;
    if(document.querySelector('script[src*="googletagmanager"]'))return;
    var s=document.createElement('script');s.async=true;s.src='https://www.googletagmanager.com/gtag/js?id='+id;document.head.appendChild(s);
    window.dataLayer=window.dataLayer||[];window.gtag=function(){window.dataLayer.push(arguments);};window.gtag('js',new Date());window.gtag('config',id,{anonymize_ip:true});
  })();

}());
