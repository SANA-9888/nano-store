// Persian Store V2 — Storefront
// PART 1 OF 3
// Append parts 2 and 3 directly below this part.

export default String.raw`<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#637c68">
<meta name="description" content="مشاهده محصولات، انتخاب و ثبت سفارش از فروشگاه">
<title>فروشگاه</title>

<link rel="stylesheet"
 href="https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/Vazirmatn-font-face.css">

<style id="uploaded-font"></style>

<style>
:root{
 --brand:#637c68;
 --bg:#fafbf9;
 --surface:#fff;
 --text:#24332a;
 --muted:#718077;
 --line:#e5ebe5;
 --soft:#f0f4ef;
 --danger:#b73747;
 --shadow:0 12px 36px #26382b09;
 --radius:24px;
 --font:StoreFont,Vazirmatn,Tahoma,sans-serif;
 color-scheme:light;
}
:root[data-theme="dark"]{
 --bg:#121914;
 --surface:#1c251e;
 --text:#edf4ec;
 --muted:#a9b8ad;
 --line:#344237;
 --soft:#263329;
 --danger:#ff9bac;
 --shadow:0 12px 36px #0002;
 color-scheme:dark;
}
*{box-sizing:border-box}
html{scroll-behavior:smooth;scroll-padding-top:100px}
body{
 margin:0;
 background:var(--bg);
 color:var(--text);
 font-family:var(--font);
 line-height:1.9;
 padding-bottom:calc(100px + env(safe-area-inset-bottom));
}
body.modal-open{overflow:hidden}
button,input,textarea,select{font:inherit;color:inherit}
button,a,input,textarea,select{-webkit-tap-highlight-color:transparent}
button{
 min-height:44px;
 border:1px solid var(--line);
 border-radius:14px;
 padding:9px 15px;
 background:var(--surface);
 cursor:pointer;
 transition:background .16s,transform .16s;
}
button:hover{background:var(--soft)}
button:active{transform:scale(.98)}
button:disabled{opacity:.5;cursor:not-allowed}
button:disabled:active{transform:none}
a{color:var(--brand);text-decoration:none}
a:hover{text-decoration:underline}
:focus-visible{outline:3px solid var(--brand);outline-offset:3px}
input,textarea,select{
 width:100%;
 min-height:48px;
 padding:11px 14px;
 border:1px solid var(--line);
 border-radius:14px;
 background:var(--surface);
}
textarea{resize:vertical;min-height:105px}
label{display:grid;gap:7px;font-size:.9rem}
img{display:block;max-width:100%}
h1,h2,h3,p{margin-top:0}
h1,h2,h3{line-height:1.8}
h2{font-size:1.35rem}
h3{font-size:1rem}
[hidden]{display:none!important}
.wrap{width:min(1160px,calc(100% - 32px));margin-inline:auto}
.row{display:flex;align-items:center;gap:10px}
.between{justify-content:space-between}
.muted{color:var(--muted)}
.pre{white-space:pre-wrap;overflow-wrap:anywhere}
.small{font-size:.82rem}
.wide{width:100%}
.primary{
 background:var(--brand);
 color:var(--brand-ink,#fff);
 border-color:transparent;
}
.primary:hover{background:var(--brand);filter:brightness(1.07)}
.soft{background:var(--soft)}
.icon{
 width:44px;
 height:44px;
 flex-shrink:0;
 padding:10px;
 display:inline-grid;
 place-items:center;
}
.icon svg,.nav-icon{
 width:23px;
 height:23px;
 fill:none;
 stroke:currentColor;
 stroke-width:1.8;
 stroke-linecap:round;
 stroke-linejoin:round;
}
.panel{
 background:var(--surface);
 border:1px solid var(--line);
 border-radius:var(--radius);
 padding:23px;
 box-shadow:var(--shadow);
}
.error{
 color:var(--danger);
 font-size:.87rem;
 white-space:pre-wrap;
 overflow-wrap:anywhere;
}
.empty{
 grid-column:1/-1;
 text-align:center;
 padding:45px 18px;
 color:var(--muted);
}
.sr-only{
 position:absolute;
 width:1px;height:1px;
 padding:0;margin:-1px;
 overflow:hidden;
 clip:rect(0,0,0,0);
 white-space:nowrap;border:0;
}
.skip-link{
 position:fixed;top:8px;right:8px;z-index:100;
 padding:10px 18px;background:var(--surface);
 border:2px solid var(--brand);border-radius:12px;
 transform:translateY(-150%);
}
.skip-link:focus{transform:none}

/* Header */
#announcement{
 padding:10px 18px;
 background:var(--brand);
 color:var(--brand-ink,#fff);
 text-align:center;
 font-size:.85rem;
 overflow-wrap:anywhere;
}
.site-header{
 position:sticky;top:0;z-index:20;
 background:var(--surface);
 border-bottom:1px solid var(--line);
 box-shadow:0 5px 22px #20312505;
}
.header-inner{
 min-height:90px;
 display:grid;
 grid-template-columns:1fr minmax(100px,2fr) 1fr;
 align-items:center;
 gap:12px;
}
.header-actions{display:flex;align-items:center;gap:8px}
.header-actions.end{justify-content:flex-end}
.brand-home{
 display:flex;flex-direction:column;align-items:center;
 justify-content:center;min-width:0;padding:9px 0;
 color:var(--text);
}
.brand-home:hover{text-decoration:none}
#store-logo{width:135px;height:58px;object-fit:contain}
#store-name{
 max-width:100%;overflow:hidden;text-overflow:ellipsis;
 white-space:nowrap;font-size:1.13rem;
}
#tagline{
 display:block;max-width:100%;
 text-overflow:ellipsis;overflow:hidden;white-space:nowrap;
 font-size:.7rem;color:var(--muted);
}
.cart-trigger{position:relative}
.cart-badge{
 position:absolute;top:-4px;left:-5px;
 min-width:21px;height:21px;padding:0 4px;
 display:grid;place-items:center;border-radius:99px;
 background:var(--brand);color:var(--brand-ink,#fff);
 font-size:.66rem;border:2px solid var(--surface);
}

/* Carousel */
.hero{margin-top:28px}
.slider-shell{
 position:relative;overflow:hidden;
 border-radius:30px;border:1px solid var(--line);
 background:var(--soft);aspect-ratio:2.55;
}
.slide{
 position:absolute;inset:0;
 width:100%;height:100%;
 background:var(--soft);
}
.slide-image{width:100%;height:100%;object-fit:cover}
.slide-shade{
 position:absolute;inset:0;
 background:linear-gradient(0deg,#0d1c17a6,transparent 75%);
 pointer-events:none;
}
.slide-content{
 position:absolute;bottom:26px;right:28px;left:90px;
 color:#fff;
}
.slide-content h2{
 font-size:clamp(1.2rem,3vw,2rem);
 margin:0 0 8px;
 text-shadow:0 2px 15px #0005;
}
.slide-content p{
 margin:0 0 14px;max-width:620px;font-size:.9rem;
}
.slide-cta{
 display:inline-flex;align-items:center;gap:12px;
 min-height:44px;padding:9px 24px;
 border:1px solid #fff9;border-radius:99px;
 background:#ffffffeb;color:#20352a;
 font-weight:600;
}
.slide-cta:hover{background:#fff;text-decoration:none}
.slider-controls{
 display:flex;align-items:center;justify-content:center;
 gap:9px;margin-top:12px;
}
.slider-controls .icon{width:40px;height:40px;min-height:40px}
.slider-dots{display:flex;align-items:center;gap:4px;direction:ltr}
.slider-dot{
 width:28px;height:34px;min-height:34px;
 padding:8px;border:none;background:transparent;
 display:grid;place-items:center;
}
.slider-dot::after{
 content:"";width:8px;height:8px;border-radius:50%;
 background:var(--muted);opacity:.35;
}
.slider-dot[aria-current="true"]::after{
 background:var(--brand);opacity:1;width:19px;border-radius:9px;
}

/* Sections and categories */
.section{margin-top:35px}
.section-heading{
 display:flex;align-items:center;justify-content:space-between;
 gap:12px;margin-bottom:18px;
}
.section-heading h2{margin:0}
.section-heading .muted{font-size:.8rem}
.category-grid{
 display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:20px;
}
.category-card{
 min-width:0;display:flex;flex-direction:column;align-items:center;
 padding:18px 12px;border:1px solid transparent;
 border-radius:24px;background:transparent;
}
.category-card:hover{
 background:var(--surface);border-color:var(--line);
}
.category-image{
 width:clamp(80px,13vw,145px);aspect-ratio:1;
 border-radius:50%;object-fit:cover;
 background:var(--soft);margin-bottom:17px;
}
.category-placeholder{
 display:grid;place-items:center;font-size:2rem;color:var(--brand);
}
.category-name{
 width:100%;text-align:center;padding:7px 14px;
 border-radius:99px;background:var(--soft);
 font-size:.9rem;font-weight:600;overflow-wrap:anywhere;
}
.category-card.active .category-name{
 background:var(--chip-active-bg,var(--brand));color:var(--chip-active-ink,var(--brand-ink,#fff));
}

/* Catalog */
.tools{
 display:grid;grid-template-columns:auto minmax(0,1fr);
 gap:12px;margin-bottom:14px;
}
#search-wrap{
 position:relative;width:52px;min-width:52px;
 transition:width .25s ease;
}
#search-wrap:focus-within,#search-wrap.open{width:min(240px,58vw)}
#search-wrap .search-glass{
 position:absolute;top:50%;right:15px;transform:translateY(-50%);
 width:20px;height:20px;pointer-events:none;color:var(--muted);
 fill:none;stroke:currentColor;stroke-width:1.8;
 stroke-linecap:round;stroke-linejoin:round;
}
#search{
 width:100%;height:46px;margin:0;
 padding-right:42px;padding-left:12px;
 border-radius:99px;
}
#search::-webkit-search-cancel-button{-webkit-appearance:none}
#sort-wrap{display:flex;gap:8px;align-items:stretch;min-width:0}
#sort-wrap select{flex:1;min-width:0}
#filter-button{
 width:48px;flex-shrink:0;padding:0;
 display:grid;place-items:center;
 position:relative;
}
#filter-button .icon{width:22px;height:22px}
#filter-button.active{
 border-color:var(--brand);
 color:var(--brand);
 background:var(--soft);
}
#filter-button.active::after{
 content:"";position:absolute;top:7px;left:7px;
 width:8px;height:8px;border-radius:99px;
 background:var(--brand);
}
#filter-dialog{width:min(430px,calc(100% - 24px))}
#filter-dialog .dialog-body{display:grid;gap:16px}
@media (max-width:560px){
 #filter-dialog{
  width:100%;max-width:100%;margin:0;
  border-radius:var(--radius) var(--radius) 0 0;
  border-bottom:none;
  position:fixed;left:0;right:0;bottom:0;
 }
}
#active-filter-note{margin:0}
.filter-chips{
 display:flex;gap:8px;overflow-x:auto;
 margin-bottom:20px;padding:2px 1px 10px;
}
.filter-chips button{
 white-space:nowrap;border-radius:99px;font-size:.82rem;
}
.filter-chips button.active{
 background:var(--chip-active-bg,var(--brand));color:var(--chip-active-ink,var(--brand-ink,#fff));
}
.product-grid{
 display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:18px;
}
.product-card{
 min-width:0;overflow:hidden;
 border:1px solid var(--line);border-radius:22px;
 background:var(--surface);box-shadow:var(--shadow);
}
.product-open{
 display:block;width:100%;padding:0;border:0;
 text-align:right;border-radius:0;background:transparent;
}
.product-open:hover{background:transparent}
.product-cover{
 position:relative;aspect-ratio:1;overflow:hidden;
 background:var(--soft);
}
.product-cover img{
 width:100%;height:100%;object-fit:cover;
 transition:transform .25s;
}
.product-card:hover .product-cover img{transform:scale(1.025)}
.placeholder{
 width:100%;height:100%;display:grid;place-items:center;
 color:var(--muted);font-size:2rem;
}
.product-info{padding:14px}
.product-info h3{
 margin:4px 0 12px;min-height:3.6em;
 font-size:.94rem;overflow-wrap:anywhere;
}
.product-category{font-size:.7rem;color:var(--muted)}
.price{font-size:.96rem;font-weight:800}
.price small{font-size:.7rem;font-weight:400}
.product-action{padding:0 12px 13px}
.product-action button{width:100%;font-size:.82rem}
.badge{
 position:absolute;top:10px;right:10px;
 background:var(--surface);padding:3px 10px;
 border-radius:99px;font-size:.7rem;
}
#pagination{
 display:flex;align-items:center;justify-content:center;
 gap:13px;margin-top:24px;
}

/* Blog, FAQ, footer */
.blog-grid{
 display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px;
}
.blog-card{
 padding:0;overflow:hidden;text-align:right;border-radius:22px;
 background:var(--surface);box-shadow:var(--shadow);
}
.blog-cover{width:100%;aspect-ratio:1.8;object-fit:cover;background:var(--soft)}
.blog-info{padding:20px}
.blog-info h3{margin:0 0 10px;font-size:1.05rem;overflow-wrap:anywhere}
.blog-excerpt{
 font-size:.84rem;color:var(--muted);margin-bottom:16px;
 display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;
 overflow:hidden;overflow-wrap:anywhere;
}
.blog-read{color:var(--brand);font-size:.84rem}
.faq-list{display:grid;gap:10px}
details{
 padding:16px 20px;background:var(--surface);
 border:1px solid var(--line);border-radius:17px;
}
summary{cursor:pointer;font-weight:600;min-height:30px}
details p{margin:15px 0 0}
.contact-links{display:flex;flex-wrap:wrap;gap:9px;margin-top:15px}
.contact-links a{
 min-height:44px;display:inline-flex;align-items:center;
 border:1px solid var(--line);border-radius:13px;padding:8px 16px;
}
.site-footer{
 margin-top:32px;text-align:center;color:var(--muted);
 font-size:.82rem;padding:0 0 15px;
}
.bottom-nav{
 position:fixed;
 bottom:max(12px,env(safe-area-inset-bottom));
 left:50%;transform:translateX(-50%);
 width:min(560px,calc(100% - 24px));
 padding:8px;display:flex;gap:4px;
 background:var(--surface);
 border:1px solid var(--line);border-radius:23px;
 box-shadow:0 8px 40px #233e2520;z-index:30;
}
.bottom-nav button{
 flex:1;min-width:0;min-height:58px;border:0;
 display:flex;flex-direction:column;align-items:center;
 justify-content:center;gap:3px;padding:5px 3px;
 font-size:.7rem;border-radius:15px;background:transparent;
}
.bottom-nav button:hover{background:var(--soft)}
.bottom-nav button:first-child{color:var(--brand)}

/* Dialogs */
dialog{
 width:min(660px,calc(100% - 24px));
 max-height:90dvh;padding:0;
 border:1px solid var(--line);border-radius:25px;
 background:var(--surface);color:var(--text);
 box-shadow:0 22px 90px #0004;
 overscroll-behavior:contain;
}
dialog::backdrop{background:#101b15a6}
.dialog-head{
 display:flex;align-items:center;justify-content:space-between;
 gap:12px;padding:14px 20px;
 position:sticky;top:0;z-index:4;
 background:var(--surface);border-bottom:1px solid var(--line);
}
.dialog-head h2{font-size:1.05rem;margin:0}
.dialog-body{padding:22px}
.dialog-actions{
 padding:14px 22px;
 position:sticky;bottom:0;z-index:3;
 background:var(--surface);border-top:1px solid var(--line);
}
.detail-image{
 width:100%;aspect-ratio:1;object-fit:contain;
 background:var(--soft);border-radius:18px;
}
.thumbnails{display:flex;gap:8px;overflow-x:auto;margin:12px 0 20px}
.thumbnails button{width:65px;min-width:65px;padding:3px}
.thumbnails img{width:57px;height:57px;object-fit:cover;border-radius:9px}
.product-description{font-size:.9rem}
.attributes{display:grid;gap:8px;margin:18px 0}
.attributes div{padding:9px 13px;border-radius:11px;background:var(--soft);font-size:.86rem}
.option-group{margin:17px 0}
.option-group h3{font-size:.9rem;margin:0 0 9px}
.option-values{display:flex;flex-wrap:wrap;gap:8px}
.option-values button{border-radius:12px;font-size:.84rem}
.option-values button.selected{
 background:var(--brand);color:var(--brand-ink,#fff);
 border-color:transparent;
}
#detail-stock{font-size:.82rem}
.cart-line{
 display:grid;grid-template-columns:66px minmax(0,1fr);gap:13px;
 padding:16px 0;border-bottom:1px solid var(--line);
}
.cart-line-image{
 width:66px;height:77px;object-fit:cover;
 background:var(--soft);border-radius:12px;
}
.cart-line h3{margin:0 0 4px;overflow-wrap:anywhere}
.cart-line .selection{font-size:.76rem;color:var(--muted)}
.quantity{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin-top:10px}
.quantity button{min-width:40px;padding:5px 10px}
.totals{display:grid;gap:10px;margin:20px 0}
.totals>div{display:flex;justify-content:space-between;gap:15px}
.totals .grand{border-top:1px solid var(--line);padding-top:12px;font-weight:700}
.shipping-hint{
 font-size:.84rem;padding:12px 15px;
 border-radius:14px;background:var(--soft);margin-top:15px;
}
.form-grid{display:grid;gap:15px}
.form-two{display:grid;grid-template-columns:1fr 1fr;gap:12px}
fieldset{border:0;padding:0;margin:0;min-width:0}
legend{margin-bottom:10px;font-weight:600;font-size:.92rem}
.payment-option{
 display:flex;align-items:flex-start;gap:10px;
 border:1px solid var(--line);border-radius:15px;padding:14px;
 cursor:pointer;
}
.payment-option input{width:19px;min-height:19px;height:19px;margin-top:6px;flex-shrink:0}
.payment-option small{display:block;color:var(--muted);margin-top:3px}
#checkout-dialog{width:min(900px,calc(100% - 24px))}
.checkout-layout{display:grid;grid-template-columns:minmax(0,1fr) 260px;gap:24px}
.checkout-summary{
 align-self:start;padding:18px;border:1px solid var(--line);
 border-radius:18px;background:var(--soft);
}
.checkout-summary h3{margin-bottom:12px}
#turnstile-container{min-height:0;overflow:hidden}
.order-code{
 display:block;direction:ltr;text-align:center;user-select:all;
 padding:18px;border-radius:17px;background:var(--soft);
 font-size:1.45rem;letter-spacing:1.5px;margin:16px 0;
}
.order-status{
 display:inline-flex;align-items:center;
 border-radius:99px;background:var(--soft);
 padding:5px 13px;font-size:.82rem;
}
.bank-list{display:grid;gap:14px;margin:18px 0}
.bank-card{
 padding:22px;border:1px solid var(--line);border-radius:22px;
 background:linear-gradient(125deg,var(--soft),var(--surface));
 box-shadow:var(--shadow);
}
.bank-top{display:flex;align-items:center;justify-content:space-between;gap:10px}
.bank-label{font-size:.73rem;color:var(--muted)}
.bank-number{
 direction:ltr;text-align:center;font-size:clamp(1.12rem,4vw,1.6rem);
 letter-spacing:2px;font-variant-numeric:tabular-nums;
 margin:22px 0;white-space:nowrap;user-select:all;
}
.bank-bottom{display:flex;align-items:center;justify-content:space-between;gap:12px}
.bank-holder{font-size:.86rem;overflow-wrap:anywhere}
.receipt-upload{
 margin-top:20px;padding:18px;border:1px dashed var(--line);
 border-radius:18px;
}
.receipt-upload input{padding:8px;font-size:.82rem}
#receipt-count{margin-top:8px}
#post-dialog{width:min(760px,calc(100% - 24px))}
#post-image{width:100%;max-height:360px;object-fit:cover;border-radius:17px;margin-bottom:20px}
#post-title{font-size:1.55rem;overflow-wrap:anywhere}
#post-content{line-height:2.3;font-size:.98rem}
#popup-image{width:100%;max-height:380px;object-fit:contain;border-radius:17px;margin-bottom:18px}
#toast{
 position:fixed;top:0;right:0;bottom:0;left:0;
 margin:auto;margin-bottom:110px;
 width:max-content;max-width:calc(100% - 30px);
 z-index:100;background:var(--text);color:var(--bg);
 padding:12px 19px;border-radius:15px;
 text-align:center;font-size:.87rem;box-shadow:0 14px 44px #00000059;
 border:1px solid #ffffff2b;
 animation:toast-in .24s ease-out;
}
#toast.success{background:var(--brand);color:var(--brand-ink,#fff)}
#toast.success::before{content:"\2713\00a0";font-weight:800}
@keyframes toast-in{
 from{opacity:0}
 to{opacity:1}
}
#boot-error{margin-top:24px}
noscript{display:block;margin:20px;padding:20px}

@media(min-width:1000px){
 .bottom-nav{width:440px}
}
@media(max-width:800px){
 .product-grid{grid-template-columns:repeat(3,minmax(0,1fr));gap:13px}
 .category-grid{grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
 .blog-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
 .checkout-layout{grid-template-columns:1fr}
 .checkout-summary{order:-1}
 .slider-shell{aspect-ratio:2}
 .slide-content{right:22px;bottom:22px;left:55px}
}
@media(max-width:600px){
 .wrap{width:calc(100% - 28px)}
 .header-inner{min-height:82px;gap:6px}
 .header-actions{gap:4px}
 .header-actions .icon{width:40px;height:42px;padding:9px}
 #store-logo{width:115px;height:53px}
 #store-name{font-size:1rem}
 .hero{margin-top:22px}
 .slider-shell{aspect-ratio:1.7;border-radius:24px}
 .slide-content{right:20px;left:20px;bottom:18px}
 .slide-content h2{font-size:1.25rem;margin-bottom:7px}
 .slide-content p{font-size:.79rem;line-height:1.8;margin-bottom:10px}
 .slide-cta{padding:7px 19px;font-size:.84rem}
 .section{margin-top:29px}
 .section-heading h2{font-size:1.15rem}
 .category-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
 .category-card{padding:15px 6px}
 .category-image{width:115px}
 .category-name{font-size:.82rem}
 .tools{grid-template-columns:auto minmax(0,1fr);gap:8px}
 .tools select{font-size:.77rem;padding:10px 8px}
 .product-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:11px}
 .product-card{border-radius:18px}
 .product-info{padding:11px}
 .product-info h3{font-size:.85rem}
 .price{font-size:.85rem}
 .product-action{padding:0 9px 10px}
 .product-action button{padding:8px 5px;font-size:.77rem}
 .blog-grid{grid-template-columns:1fr}
 .dialog-body{padding:18px}
 .dialog-head{padding:12px 16px}
 .dialog-actions{padding:12px 18px}
 .form-two{grid-template-columns:1fr}
 .panel{padding:19px}
 .bank-card{padding:18px}
 #post-title{font-size:1.3rem}
}
@media(max-width:350px){
 .tools{grid-template-columns:1fr}
 #search-wrap{width:100%}
 .header-actions .icon{width:35px;padding:7px}
 .category-image{width:95px}
 .bank-number{letter-spacing:1px}
}
@media(prefers-reduced-motion:reduce){
 html{scroll-behavior:auto}
 *,*::before,*::after{transition:none!important;animation:none!important}
}
</style>
</head>

<body>
<a class="skip-link" href="#catalog">رفتن به محصولات</a>

<svg class="sr-only" aria-hidden="true" focusable="false">
 <symbol id="i-search" viewBox="0 0 24 24">
  <circle cx="10.5" cy="10.5" r="6.5"></circle>
  <path d="m16 16 5 5"></path>
 </symbol>
 <symbol id="i-cart" viewBox="0 0 24 24">
  <path d="M3 3h2l2.4 12h11.8L22 6H6"></path>
  <circle cx="9" cy="20" r="1"></circle>
  <circle cx="18" cy="20" r="1"></circle>
 </symbol>
 <symbol id="i-home" viewBox="0 0 24 24">
  <path d="m3 10 9-7 9 7M5 9v12h5v-7h4v7h5V9"></path>
 </symbol>
 <symbol id="i-grid" viewBox="0 0 24 24">
  <rect x="3" y="3" width="7" height="7" rx="2"></rect>
  <rect x="14" y="3" width="7" height="7" rx="2"></rect>
  <rect x="3" y="14" width="7" height="7" rx="2"></rect>
  <rect x="14" y="14" width="7" height="7" rx="2"></rect>
 </symbol>
 <symbol id="i-menu" viewBox="0 0 24 24">
  <path d="M4 6h16M4 12h16M4 18h16"></path>
 </symbol>
 <symbol id="i-theme" viewBox="0 0 24 24">
  <path d="M20.5 13A8.5 8.5 0 0 1 11 3.5 8.5 8.5 0 1 0 20.5 13Z"></path>
 </symbol>
 <symbol id="i-filter" viewBox="0 0 24 24">
  <path d="M3 5h18l-7 8v5l-4 2v-7L3 5Z"></path>
 </symbol>
 <symbol id="i-user" viewBox="0 0 24 24">
  <circle cx="12" cy="8" r="4"></circle>
  <path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"></path>
 </symbol>
</svg>

<div id="announcement" hidden></div>

<header class="site-header">
 <div class="wrap header-inner">
  <div class="header-actions">
   <button id="menu-button" class="icon" aria-label="بازکردن فهرست" aria-haspopup="dialog">
    <svg aria-hidden="true"><use href="#i-menu"></use></svg>
   </button>
   <button id="header-search" class="icon" aria-label="جست‌وجوی محصولات">
    <svg aria-hidden="true"><use href="#i-search"></use></svg>
   </button>
  </div>

  <a href="/" class="brand-home" aria-label="صفحه اصلی فروشگاه">
   <img id="store-logo" alt="لوگوی فروشگاه" hidden>
   <strong id="store-name">فروشگاه</strong>
   <small id="tagline"></small>
  </a>

  <div class="header-actions end">
   <button id="account-button" class="icon" aria-label="ورود یا حساب کاربری" hidden>
    <svg aria-hidden="true"><use href="#i-user"></use></svg>
   </button>
   <button id="header-cart" class="icon cart-trigger" aria-label="بازکردن سبد خرید" aria-haspopup="dialog">
    <svg aria-hidden="true"><use href="#i-cart"></use></svg>
    <span id="header-cart-count" class="cart-badge" hidden>۰</span>
   </button>
  </div>
 </div>
</header>

<noscript>
 برای مشاهده محصولات و ثبت سفارش، JavaScript مرورگر را فعال کنید.
</noscript>

<main class="wrap" id="main">
 <section id="boot-error" class="panel" hidden>
  <p id="boot-error-text" class="error" role="alert"></p>
  <button id="reload-button">تلاش دوباره</button>
 </section>

 <section id="hero" class="hero" aria-label="پیشنهادهای فروشگاه" hidden>
  <div id="slider" class="slider-shell" role="region" aria-roledescription="اسلایدر" aria-label="بنرهای فروشگاه">
   <div id="slides"></div>
  </div>
  <div id="slider-controls" class="slider-controls">
   <button id="slide-prev" class="icon" aria-label="اسلاید قبلی">‹</button>
   <div id="slider-dots" class="slider-dots"></div>
   <button id="slide-next" class="icon" aria-label="اسلاید بعدی">›</button>
   <button id="slide-pause" class="icon" aria-label="توقف حرکت خودکار" aria-pressed="false">Ⅱ</button>
  </div>
 </section>

 <section id="categories-section" class="section" hidden>
  <div class="section-heading">
   <h2>دسته‌بندی‌ها</h2>
   <button id="all-products-button" class="small">همه محصولات</button>
  </div>
  <div id="category-grid" class="category-grid"></div>
 </section>

 <section id="catalog" class="section" aria-labelledby="catalog-title">
  <div class="section-heading">
   <h1 id="catalog-title" style="font-size:1.3rem;margin:0">ویترین فروشگاه</h1>
   <span id="product-count" class="muted"></span>
  </div>

  <div class="tools">
   <div id="search-wrap">
    <label class="sr-only" for="search">جست‌وجوی محصولات</label>
    <svg class="search-glass" aria-hidden="true"><use href="#i-search"></use></svg>
    <input id="search" type="search" maxlength="100" autocomplete="off">
   </div>
   <div id="sort-wrap">
    <label class="sr-only" for="sort">مرتب‌سازی محصولات</label>
    <select id="sort">
     <option value="new">جدیدترین</option>
     <option value="pop">محبوب‌ترین</option>
     <option value="cheap">ارزان‌ترین</option>
     <option value="expensive">گران‌ترین</option>
    </select>
    <button id="filter-button" type="button" aria-haspopup="dialog"
     aria-label="فیلتر قیمت و موجودی">
     <svg class="icon" aria-hidden="true"><use href="#i-filter"></use></svg>
    </button>
   </div>
  </div>

  <div id="category-chips" class="filter-chips" aria-label="فیلتر دسته‌بندی"></div>

  <div id="products" class="product-grid" aria-live="polite" aria-busy="true">
   <div class="empty">در حال آماده‌سازی ویترین…</div>
  </div>

  <div id="pagination" aria-label="صفحه‌بندی محصولات"></div>
 </section>

 <section id="blog-section" class="section" hidden>
  <div class="section-heading"><h2>مجله فروشگاه</h2></div>
  <div id="posts" class="blog-grid"></div>
 </section>

 <section id="faq-section" class="section" hidden>
  <div class="section-heading"><h2>سؤالات متداول</h2></div>
  <div id="faqs" class="faq-list"></div>
 </section>

 <section id="contact-section" class="section panel" hidden>
  <h2>با ما در ارتباط باشید</h2>
  <p id="contact-text" class="pre muted"></p>
  <div id="contact-links" class="contact-links"></div>
 </section>

 <footer class="site-footer">
  <p id="footer-text" class="pre"></p>
  <a id="account-link" href="/account" class="small" hidden>حساب کاربری من</a>
  <button id="last-order-button" class="small" hidden>مشاهده آخرین سفارش این دستگاه</button>
 </footer>
</main>

<nav class="bottom-nav" aria-label="دسترسی سریع">
 <button id="nav-home">
  <svg class="nav-icon" aria-hidden="true"><use href="#i-home"></use></svg>
  <span>خانه</span>
 </button>
 <button id="nav-categories">
  <svg class="nav-icon" aria-hidden="true"><use href="#i-grid"></use></svg>
  <span>دسته‌ها</span>
 </button>
 <button id="nav-search">
  <svg class="nav-icon" aria-hidden="true"><use href="#i-search"></use></svg>
  <span>جست‌وجو</span>
 </button>
 <button id="nav-cart" aria-haspopup="dialog">
  <svg class="nav-icon" aria-hidden="true"><use href="#i-cart"></use></svg>
  <span>سبد <span id="nav-cart-count"></span></span>
 </button>
</nav>

<dialog id="menu-dialog" aria-labelledby="menu-title">
 <div class="dialog-head">
  <h2 id="menu-title">دسترسی سریع</h2>
  <button class="icon" data-close aria-label="بستن فهرست">×</button>
 </div>
 <div class="dialog-body form-grid">
  <button data-jump="catalog">محصولات</button>
  <button id="menu-categories" data-jump="categories-section">دسته‌بندی‌ها</button>
  <button id="menu-blog" data-jump="blog-section">مجله فروشگاه</button>
  <button id="menu-faq" data-jump="faq-section">سؤالات متداول</button>
  <button id="menu-contact" data-jump="contact-section">تماس با مدیر</button>
  <button id="menu-account" hidden>ورود / ثبت‌نام</button>
  <button id="menu-theme" hidden>تغییر تم روشن / تاریک</button>
 </div>
</dialog>

<dialog id="product-dialog" aria-labelledby="detail-name">
 <div class="dialog-head">
  <h2>جزئیات محصول</h2>
  <button class="icon" data-close aria-label="بستن محصول">×</button>
 </div>

 <div class="dialog-body">
  <div id="detail-loading" class="muted" hidden>در حال دریافت اطلاعات…</div>
  <div id="detail-error" class="error" role="alert"></div>

  <div id="detail-content" hidden>
   <img id="detail-image" class="detail-image" alt="" hidden>
   <div id="detail-thumbnails" class="thumbnails"></div>
   <p id="detail-category" class="muted small"></p>
   <h2 id="detail-name"></h2>
   <p id="detail-description" class="pre product-description"></p>
   <div id="detail-attributes" class="attributes"></div>
   <div id="detail-options"></div>
   <p id="detail-selection-message" class="small muted"></p>
   <p id="detail-stock" class="muted"></p>
  </div>
 </div>

 <div id="detail-actions" class="dialog-actions" hidden>
  <div class="row between">
   <div id="detail-price" class="price"></div>
   <button id="detail-add" class="primary" disabled>افزودن به سبد</button>
  </div>
 </div>
</dialog>

<dialog id="filter-dialog" aria-labelledby="filter-title">
 <div class="dialog-head">
  <h2 id="filter-title">فیلتر محصولات</h2>
  <button class="icon" data-close aria-label="بستن فیلتر">×</button>
 </div>
 <div class="dialog-body">
  <div class="form-two">
   <label>حداقل قیمت (تومان)
    <input id="filter-min" inputmode="numeric" dir="ltr" maxlength="12"
     placeholder="مثلاً ۱۰۰۰۰۰" autocomplete="off">
   </label>
   <label>حداکثر قیمت (تومان)
    <input id="filter-max" inputmode="numeric" dir="ltr" maxlength="12"
     placeholder="مثلاً ۵۰۰۰۰۰۰" autocomplete="off">
   </label>
  </div>
  <div id="filter-cats-wrap">
   <label class="small muted" style="display:block;margin-bottom:6px">محدود به دسته‌بندی‌ها (اختیاری)</label>
   <div id="filter-cats" class="filter-chips" style="margin:0"></div>
  </div>
  <label class="row" style="gap:10px">
   <input id="filter-avail" type="checkbox" style="width:22px;min-height:22px;flex-shrink:0">
   <span>فقط کالاهای موجود</span>
  </label>
  <p id="active-filter-note" class="small muted" hidden></p>
  <div class="row">
   <button id="filter-apply" class="primary" style="flex:1">اعمال فیلتر</button>
   <button id="filter-clear" type="button">حذف فیلترها</button>
  </div>
 </div>
</dialog>

<dialog id="cart-dialog" aria-labelledby="cart-title">
 <div class="dialog-head">
  <h2 id="cart-title">سبد خرید شما</h2>
  <button class="icon" data-close aria-label="بستن سبد">×</button>
 </div>
 <div class="dialog-body">
  <div id="cart-items"></div>
  <div id="shipping-hint" class="shipping-hint" hidden></div>
  <div id="cart-totals" class="totals"></div>
  <div id="cart-error" class="error" role="alert"></div>
  <p class="small muted">قیمت و موجودی پیش از ثبت سفارش دوباره بررسی می‌شوند.</p>
 </div>
 <div class="dialog-actions">
  <button id="begin-checkout" class="primary wide">ادامه و ثبت سفارش</button>
 </div>
</dialog>

<dialog id="checkout-dialog" aria-labelledby="checkout-title">
 <div class="dialog-head">
  <h2 id="checkout-title">تکمیل سفارش</h2>
  <button class="icon" data-close aria-label="بستن فرم سفارش">×</button>
 </div>

 <div class="dialog-body checkout-layout">
  <form id="checkout-form" class="form-grid">
   <div class="form-two">
    <label>نام و نام خانوادگی
     <input name="name" required minlength="2" maxlength="100" autocomplete="name">
    </label>
    <label>شماره موبایل
     <input name="phone" required maxlength="20" type="tel"
      inputmode="tel" autocomplete="tel" dir="ltr" placeholder="09123456789">
    </label>
   </div>

   <label>نشانی کامل
    <textarea name="address" required minlength="10" maxlength="1500"
     autocomplete="street-address" placeholder="استان، شهر، خیابان، پلاک و واحد"></textarea>
   </label>

   <label>کد پستی، اختیاری
    <input name="postal" maxlength="10" inputmode="numeric" autocomplete="postal-code" dir="ltr">
   </label>

   <label id="note-field">توضیحات سفارش، اختیاری
    <textarea name="note" maxlength="2000"
     placeholder="مثلاً سفارش هدیه است؛ لطفاً قیمت داخل بسته قرار نگیرد."></textarea>
   </label>

   <label id="coupon-field">کد تخفیف، اختیاری
    <input name="coupon" maxlength="32" dir="ltr"
     autocapitalize="characters" autocomplete="off" placeholder="WELCOME">
    <span class="small muted">اعتبار کد و مبلغ تخفیف هنگام ثبت در سرور محاسبه می‌شود.</span>
   </label>

   <fieldset>
    <legend>روش پرداخت و هماهنگی</legend>
    <div id="payment-methods" class="form-grid"></div>
   </fieldset>

   <p class="small muted">
    نام، شماره و نشانی شما برای پردازش سفارش در اختیار مدیر فروشگاه قرار می‌گیرد.
    اطلاعات ورود بانک، رمز یا CVV2 وارد نکنید.
   </p>

   <div id="turnstile-container"></div>
   <div id="checkout-error" class="error" role="alert"></div>
   <button id="discard-pending" type="button" class="wide" hidden>لغو این درخواست و ثبت سفارش جدید</button>
   <button id="submit-order" type="submit" class="primary wide">ثبت اولیه سفارش</button>
  </form>

  <aside class="checkout-summary">
   <h3>خلاصه سفارش</h3>
   <div id="checkout-summary-items" class="small"></div>
   <div id="checkout-totals" class="totals"></div>
   <p class="small muted">مبلغ این بخش پیش از اعمال کد تخفیف است.</p>
  </aside>
 </div>
</dialog>

<dialog id="order-dialog" aria-labelledby="order-title">
 <div class="dialog-head">
  <h2 id="order-title">اطلاعات سفارش</h2>
  <button class="icon" data-close aria-label="بستن اطلاعات سفارش">×</button>
 </div>
 <div class="dialog-body">
  <div id="order-loading" class="muted" hidden>در حال دریافت وضعیت سفارش…</div>
  <div id="order-error" class="error" role="alert"></div>

  <div id="order-content" hidden>
   <p id="order-message" class="pre"></p>
   <strong id="order-code" class="order-code"></strong>

   <div class="row">
    <button id="copy-order-code">کپی کد</button>
    <button id="refresh-order">تازه‌سازی وضعیت</button>
   </div>

   <p style="margin-top:18px">
    <span id="order-status" class="order-status"></span>
   </p>
   <p id="order-payment-status"></p>

   <div id="order-totals" class="totals"></div>
   <div id="order-lines" class="small"></div>

   <section id="bank-section" hidden>
    <h3 style="margin-top:24px">کارت‌به‌کارت</h3>
    <p id="payment-deadline" class="pre small"></p>
    <p class="small muted">
     فقط مبلغ نهایی همین سفارش را واریز کنید. پیش از واریز وضعیت و مهلت سفارش را بررسی کنید.
    </p>
    <div id="bank-cards" class="bank-list"></div>
   </section>

   <section id="gateway-section" hidden>
    <h3 style="margin-top:24px">پرداخت آنلاین</h3>
    <p class="small muted">
     با زدن دکمه زیر به درگاه پرداخت منتقل می‌شوید؛ پس از پرداخت به‌صورت خودکار به فروشگاه بازمی‌گردید.
    </p>
    <button id="pay-online" class="primary wide">ادامه پرداخت آنلاین</button>
    <div id="gateway-error" class="error" role="alert" style="margin-top:10px"></div>
   </section>

   <section id="receipt-section" class="receipt-upload" hidden>
    <h3>ارسال تصویر رسید</h3>
    <p class="small muted">
     تصویر JPEG، PNG یا WebP، حداکثر ۴ مگابایت.
     رسید برای بررسی خصوصی مدیر ارسال می‌شود و به معنی تأیید پرداخت نیست.
    </p>
    <label>انتخاب تصویر
     <input id="receipt-file" type="file" accept="image/jpeg,image/png,image/webp">
    </label>
    <button id="send-receipt" class="primary wide" style="margin-top:12px">ارسال رسید برای بررسی</button>
    <div id="receipt-error" class="error" role="alert"></div>
    <p id="receipt-count" class="small muted"></p>
   </section>

   <section style="margin-top:24px">
    <h3>هماهنگی با مدیر</h3>
    <p id="order-contact-text" class="pre muted"></p>
    <div id="order-contact-links" class="contact-links"></div>
   </section>

   <p class="small muted" style="margin-top:20px">
    کد سفارش را نگه دارید. وضعیت پرداخت فقط پس از بررسی مدیر تغییر می‌کند.
   </p>
  </div>
 </div>
</dialog>

<dialog id="post-dialog" aria-labelledby="post-title">
 <div class="dialog-head">
  <h2>مجله فروشگاه</h2>
  <button class="icon" data-close aria-label="بستن نوشته">×</button>
 </div>
 <article class="dialog-body">
  <img id="post-image" alt="" hidden>
  <h1 id="post-title"></h1>
  <div id="post-content" class="pre"></div>
 </article>
</dialog>

<dialog id="popup-dialog" aria-labelledby="popup-title">
 <div class="dialog-head">
  <h2 id="popup-title">اطلاعیه فروشگاه</h2>
  <button class="icon" data-close aria-label="بستن اطلاعیه">×</button>
 </div>
 <div class="dialog-body">
  <img id="popup-image" alt="تصویر اطلاعیه" hidden>
  <p id="popup-text" class="pre"></p>
  <a id="popup-link" class="slide-cta" target="_blank" rel="noopener noreferrer" hidden></a>
 </div>
</dialog>

<div id="toast" popover="manual" role="status" aria-live="polite" hidden></div>

<script>
// PART 2 starts here.

(function () {
"use strict";

const $ = id => document.getElementById(id);
const money = value => Number(value || 0).toLocaleString("fa-IR") + " تومان";
const fa = value => Number(value || 0).toLocaleString("fa-IR");
const mediaURL = id => "/media/" + encodeURIComponent(id);
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

const STORAGE = {
  cart: "ps-v2:cart",
  theme: "ps-v2:theme",
  popup: "ps-v2:popup",
  pending: "ps-v2:pending-checkout",
  lastOrder: "ps-v2:last-order"
};

let S = {};
let bootstrapData = null;
let productsController = null;
let detailController = null;
let productMap = new Map();
let postMap = new Map();
let currentProduct = null;
let selectedOptions = {};
let page = 1;
let category = "";
let searchTimer;
let toastTimer;
let cart = [];
let lastFocus = null;

let sliderIndex = 0;
let sliderTimer = null;
let sliderPaused = false;
let sliderHover = false;
let sliderFocused = false;
let sliderVisible = true;
let sliderItems = [];
let sliderObserver = null;

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function storageRead(key, fallback = null) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

function storageWrite(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function storageRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Storage may be unavailable in a restricted browser.
  }
}

function safeURL(value) {
  if (!value) return "";

  try {
    const url = new URL(value);
    if (!["https:", "http:", "tel:"].includes(url.protocol)) return "";
    if (url.username || url.password) return "";
    return url.href;
  } catch {
    return "";
  }
}

function contactHTML(links) {
  return (Array.isArray(links) ? links : []).slice(0, 8).map(link => {
    const url = safeURL(link.url);
    if (!url) return "";

    return '<a href="' + escapeHTML(url) +
      '" target="_blank" rel="noopener noreferrer">' +
      escapeHTML(link.label) + "</a>";
  }).join("");
}

async function api(path, options = {}) {
  let response;

  try {
    response = await fetch(path, options);
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new Error("Network request failed. Check your connection.");
  }

  let data;

  try {
    data = await response.json();
  } catch {
    throw new Error("The server returned an invalid response.");
  }

  if (!response.ok) {
    const error = new Error(data.error || "Request failed.");
    error.status = response.status;
    throw error;
  }

  return data;
}

function toast(message, type) {
  const element = $("toast");
  clearTimeout(toastTimer);
  element.className = type === "success" ? "success" : "";
  element.textContent = message;
  element.hidden = false;
  // Lift the toast into the top layer so it renders above modal dialogs
  // (e.g. the product dialog opened with showModal()); otherwise it would
  // be hidden behind them regardless of z-index.
  if (typeof element.showPopover === "function") {
    try { element.showPopover(); } catch (_) { /* already shown */ }
  }
  toastTimer = setTimeout(hideToast, 4200);
}

function hideToast() {
  const element = $("toast");
  if (typeof element.hidePopover === "function") {
    try { element.hidePopover(); } catch (_) { /* not shown */ }
  }
  element.hidden = true;
}

function setTheme(theme, remember = false) {
  const value = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = value;

  const toggle = $("menu-theme");
  if (toggle) {
    toggle.hidden = !S.theme_switch_enabled;
    toggle.textContent = value === "dark"
      ? "☀️ رفتن به تم روشن"
      : "🌙 رفتن به تم تاریک";
  }

  if (remember) storageWrite(STORAGE.theme, value);
}

/*
 * Selected-category chip colors. Both follow the brand color unless the
 * owner overrides them (category_active_bg / category_active_color).
 * Without an override the text ink is derived from the background
 * luminance so a dark brand always gets readable white text.
 */
function applyChipColors(settings) {
  const root = document.documentElement.style;
  const brand = /^#[a-f0-9]{6}$/i.test(settings.brand_color || "")
    ? settings.brand_color.toLowerCase()
    : "#637c68";
  const bg = /^#[a-f0-9]{6}$/i.test(settings.category_active_bg || "")
    ? settings.category_active_bg.toLowerCase()
    : brand;

  let ink = /^#[a-f0-9]{6}$/i.test(settings.category_active_color || "")
    ? settings.category_active_color.toLowerCase()
    : "";

  if (!ink) {
    const rgb = [1, 3, 5].map(start => {
      const channel = parseInt(bg.slice(start, start + 2), 16) / 255;

      return channel <= 0.04045
        ? channel / 12.92
        : Math.pow((channel + 0.055) / 1.055, 2.4);
    });

    const luminance = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
    ink = luminance > 0.179 ? "#101912" : "#ffffff";
  }

  root.setProperty("--chip-active-bg", bg);
  root.setProperty("--chip-active-ink", ink);
}

function applyBrand(color) {
  const value = /^#[a-f0-9]{6}$/i.test(color || "") ? color : "#637c68";
  document.documentElement.style.setProperty("--brand", value);

  const rgb = [1, 3, 5].map(start => {
    const channel = parseInt(value.slice(start, start + 2), 16) / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : Math.pow((channel + 0.055) / 1.055, 2.4);
  });

  const luminance = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  document.documentElement.style.setProperty(
    "--brand-ink",
    luminance > 0.179 ? "#101912" : "#ffffff"
  );
  document.querySelector('meta[name="theme-color"]').content = value;
}

setTheme(storageRead(STORAGE.theme, "light"));

function showDialog(dialog) {
  const active = document.querySelector("dialog[open]");
  if (!active) lastFocus = document.activeElement;

  document.querySelectorAll("dialog[open]").forEach(other => {
    if (other !== dialog) other.close();
  });

  if (!dialog.open) dialog.showModal();
  document.body.classList.add("modal-open");
  updateSliderTimer();
}

function closeDialogs() {
  document.querySelectorAll("dialog[open]").forEach(dialog => dialog.close());
}

function scrollToSection(id) {
  closeDialogs();
  const target = $(id);

  if (target && !target.hidden) {
    target.scrollIntoView({
      behavior: reducedMotion.matches ? "auto" : "smooth",
      block: "start"
    });
  }
}

document.querySelectorAll("dialog").forEach(dialog => {
  dialog.addEventListener("click", event => {
    if (event.target.closest("[data-close]")) {
      dialog.close();
      return;
    }

    if (event.target === dialog) {
      const box = dialog.getBoundingClientRect();
      if (
        event.clientX < box.left || event.clientX > box.right ||
        event.clientY < box.top || event.clientY > box.bottom
      ) dialog.close();
    }
  });

  dialog.addEventListener("close", () => {
    queueMicrotask(() => {
      if (!document.querySelector("dialog[open]")) {
        document.body.classList.remove("modal-open");
        if (lastFocus?.isConnected) lastFocus.focus({ preventScroll: true });
        updateSliderTimer();
      }
    });
  });
});

function selectionText(selection) {
  return Object.entries(selection || {})
    .map(([name, value]) => name + ": " + value)
    .join(" / ");
}

function canonicalSelection(selection) {
  return Object.fromEntries(
    Object.entries(selection || {}).sort(([a], [b]) => a.localeCompare(b))
  );
}

function cartIdentity(item) {
  return JSON.stringify([
    item.productId,
    item.variantId || "",
    canonicalSelection(item.selection)
  ]);
}

function readCart() {
  const saved = storageRead(STORAGE.cart, []);
  if (!Array.isArray(saved)) return [];

  const result = [];
  const seen = new Set();

  for (const item of saved.slice(0, 40)) {
    if (
      !item || typeof item.productId !== "string" ||
      item.productId.length > 64 ||
      typeof item.name !== "string" || item.name.length > 200 ||
      !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99 ||
      !Number.isSafeInteger(item.price) || item.price < 0 || item.price > 1e12 ||
      !item.selection || typeof item.selection !== "object" ||
      Array.isArray(item.selection) || Object.keys(item.selection).length > 4 ||
      Object.entries(item.selection).some(([key, value]) =>
        key.length > 60 || typeof value !== "string" || value.length > 80
      )
    ) continue;

    const clean = {
      productId: item.productId,
      variantId: typeof item.variantId === "string" ? item.variantId : "",
      name: item.name,
      selection: canonicalSelection(item.selection),
      quantity: item.quantity,
      price: item.price,
      image: typeof item.image === "string" && /^[a-f0-9]{32}$/.test(item.image)
        ? item.image : ""
    };

    const identity = cartIdentity(clean);
    if (seen.has(identity)) continue;

    seen.add(identity);
    result.push(clean);
  }

  return result;
}

cart = readCart();

function updateCartBadge() {
  const count = cart.reduce((sum, item) => sum + item.quantity, 0);
  $("header-cart-count").textContent = fa(count);
  $("header-cart-count").hidden = count === 0;
  $("nav-cart-count").textContent = count ? "(" + fa(count) + ")" : "";
}

function saveCart() {
  const stored = storageWrite(STORAGE.cart, cart);
  updateCartBadge();
  refreshCheckoutSummary();
  return stored;
}

/*
 * Keep the open checkout dialog in sync with cart edits, whether they
 * happened in this tab or (via the storage event) in another one.
 * In pending-retry mode the frozen snapshot must stay visible.
 */
function refreshCheckoutSummary() {
  if (!pendingCheckout && !checkoutBusy && $("checkout-dialog").open) {
    fillCheckoutSummary();
  }
}

function subtotal() {
  return cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
}

function shippingFee(amount) {
  const freeOver = Number(S.free_shipping_over || 0);
  return freeOver > 0 && amount >= freeOver
    ? 0 : Number(S.shipping_fee || 0);
}

function totalsHTML(amount, shipping, discount = 0) {
  return '<div><span>کالاها</span><strong>' + money(amount) + "</strong></div>" +
    '<div><span>ارسال</span><strong>' + money(shipping) + "</strong></div>" +
    (discount ? '<div><span>تخفیف</span><strong>' + money(discount) + "</strong></div>" : "") +
    '<div class="grand"><span>جمع</span><strong>' +
    money(amount + shipping - discount) + "</strong></div>";
}

function renderCart() {
  $("cart-items").innerHTML = cart.length
    ? cart.map((item, index) => {
        const image = item.image
          ? '<img class="cart-line-image" src="' + mediaURL(item.image) +
            '" alt="" loading="lazy" width="66" height="77">'
          : '<div class="cart-line-image placeholder" aria-hidden="true">◇</div>';

        return '<article class="cart-line">' + image + "<div>" +
          "<h3>" + escapeHTML(item.name) + "</h3>" +
          '<div class="selection">' + escapeHTML(selectionText(item.selection)) + "</div>" +
          '<div class="small">' + money(item.price) + "</div>" +
          '<div class="quantity">' +
          '<button data-qty="' + index + '" data-step="-1" aria-label="کاهش تعداد">−</button>' +
          "<span>" + fa(item.quantity) + "</span>" +
          '<button data-qty="' + index + '" data-step="1" aria-label="افزایش تعداد">+</button>' +
          '<button data-remove="' + index + '">حذف</button>' +
          "</div></div></article>";
      }).join("")
    : '<div class="empty">سبد شما هنوز خالی است.</div>';

  const amount = subtotal();
  $("cart-totals").innerHTML = cart.length
    ? totalsHTML(amount, shippingFee(amount)) : "";

  const freeOver = Number(S.free_shipping_over || 0);
  $("shipping-hint").hidden = !cart.length || freeOver <= 0;

  if (freeOver > 0) {
    $("shipping-hint").textContent = amount >= freeOver
      ? "ارسال این سفارش رایگان است."
      : "با " + money(freeOver - amount) + " خرید بیشتر، ارسال رایگان می‌شود.";
  }

  $("begin-checkout").disabled =
  !pendingCheckout && (!cart.length || !S.orders_enabled);
  $("begin-checkout").textContent = S.orders_enabled
    ? "ادامه و ثبت سفارش"
    : "ثبت سفارش موقتاً غیرفعال است";

  updateCartBadge();
}

function openCart() {
  if (!S.cart_enabled) return;
  $("cart-error").textContent = "";
  renderCart();
  showDialog($("cart-dialog"));
}

$("cart-items").addEventListener("click", event => {
  const remove = event.target.closest("[data-remove]");
  const quantity = event.target.closest("[data-qty]");

  if (remove) {
    const index = Number(remove.dataset.remove);
    if (!Number.isInteger(index) || !cart[index]) return;
    cart.splice(index, 1);
  } else if (quantity) {
    const index = Number(quantity.dataset.qty);
    const item = cart[index];
    if (!item) return;

    const next = item.quantity + Number(quantity.dataset.step);
    if (next > 99) return;
    if (next <= 0) cart.splice(index, 1);
    else item.quantity = next;
  } else return;

  $("cart-error").textContent = "";
  saveCart();
  renderCart();
});

function showSlide(index) {
  if (!sliderItems.length) return;
  sliderIndex = (index + sliderItems.length) % sliderItems.length;

  $("slides").querySelectorAll(".slide").forEach((element, at) => {
    element.hidden = at !== sliderIndex;
    if (at === sliderIndex) {
      const image = element.querySelector("img[data-src]");
      if (image) {
        image.src = image.dataset.src;
        delete image.dataset.src;
      }
    }
  });

  $("slider-dots").querySelectorAll("button").forEach((button, at) => {
    button.setAttribute("aria-current", String(at === sliderIndex));
  });

  updateSliderTimer();
}

function updateSliderTimer() {
  clearTimeout(sliderTimer);
  sliderTimer = null;

  const autoAllowed = S.slider_autoplay && !reducedMotion.matches;
  $("slide-pause").hidden = !autoAllowed || sliderItems.length < 2;
  $("slide-pause").textContent = sliderPaused ? "▶" : "Ⅱ";
  $("slide-pause").setAttribute(
    "aria-label", sliderPaused ? "ادامه حرکت خودکار" : "توقف حرکت خودکار"
  );
  $("slide-pause").setAttribute("aria-pressed", String(sliderPaused));

  if (
    !autoAllowed || sliderPaused || sliderHover || sliderFocused ||
    !sliderVisible || document.hidden || sliderItems.length < 2 ||
    document.querySelector("dialog[open]")
  ) return;

  const seconds = Math.max(4, Math.min(30, Number(S.slider_seconds) || 6));
  sliderTimer = setTimeout(() => showSlide(sliderIndex + 1), seconds * 1000);
}

function renderSlider(slides) {
  sliderItems = (Array.isArray(slides) ? slides : [])
    .filter(slide => slide.image_id).slice(0, 5);

  $("hero").hidden = !S.slider_enabled || !sliderItems.length;

  $("slides").innerHTML = sliderItems.map((slide, index) => {
    const caption = slide.title || slide.description || slide.button_text;
    const url = slide.target_type === "url" ? safeURL(slide.target_url) : "";
    const categoryTarget = slide.target_type === "category" && slide.target_category_id;

    let action = "";
    const actionText = escapeHTML(slide.button_text || "مشاهده محصولات");

    if (categoryTarget) {
      action = '<button class="slide-cta" data-slide-category="' +
        escapeHTML(slide.target_category_id) + '">' + actionText + " ←</button>";
    } else if (url) {
      action = '<a class="slide-cta" href="' + escapeHTML(url) +
        '" target="_blank" rel="noopener noreferrer">' + actionText + " ←</a>";
    }

    return '<div class="slide" role="group" aria-roledescription="اسلاید" aria-label="' +
      fa(index + 1) + " از " + fa(sliderItems.length) + '"' +
      (index ? " hidden" : "") + ">" +
      '<img class="slide-image" ' + (index ? "data-src" : "src") + '="' +
      mediaURL(slide.image_id) + '" alt="' + escapeHTML(slide.title || "بنر فروشگاه") +
      '" decoding="async"' + (index ? "" : ' fetchpriority="high"') + ">" +
      (caption || action ? '<div class="slide-shade"></div><div class="slide-content">' +
        (slide.title ? "<h2>" + escapeHTML(slide.title) + "</h2>" : "") +
        (slide.description ? "<p>" + escapeHTML(slide.description) + "</p>" : "") +
        action + "</div>" : "") + "</div>";
  }).join("");

  $("slider-dots").innerHTML = sliderItems.map((slide, index) =>
    '<button class="slider-dot" data-slide="' + index +
    '" aria-label="رفتن به اسلاید ' + fa(index + 1) +
    '" aria-current="' + String(index === 0) + '"></button>'
  ).join("");

  $("slider-controls").hidden = sliderItems.length < 2;
  showSlide(0);

  if ("IntersectionObserver" in window) {
    if (sliderObserver) sliderObserver.disconnect();

    sliderObserver = new IntersectionObserver(entries => {
      sliderVisible = entries[0].isIntersecting;
      updateSliderTimer();
    }, { threshold: 0.15 });

    sliderObserver.observe($("hero"));
  }
}

$("slide-prev").onclick = () => {
  sliderPaused = true;
  showSlide(sliderIndex - 1);
};
$("slide-next").onclick = () => {
  sliderPaused = true;
  showSlide(sliderIndex + 1);
};
$("slide-pause").onclick = () => {
  sliderPaused = !sliderPaused;
  updateSliderTimer();
};
$("slider-dots").onclick = event => {
  const button = event.target.closest("[data-slide]");
  if (!button) return;
  sliderPaused = true;
  showSlide(Number(button.dataset.slide));
};
$("slider").style.touchAction = "pan-y";
let swipeStart = null;

$("slider").addEventListener("pointerdown", event => {
  if (!event.isPrimary || event.pointerType === "mouse") return;
  swipeStart = { x: event.clientX, y: event.clientY };
}, { passive: true });

$("slider").addEventListener("pointerup", event => {
  if (!swipeStart) return;
  const dx = event.clientX - swipeStart.x;
  const dy = event.clientY - swipeStart.y;
  swipeStart = null;

  if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.5) {
    sliderPaused = true;
    showSlide(sliderIndex + (dx > 0 ? 1 : -1));
  }
}, { passive: true });

$("slider").addEventListener("pointercancel", () => { swipeStart = null; });
$("hero").addEventListener("mouseenter", () => {
  sliderHover = true;
  updateSliderTimer();
});
$("hero").addEventListener("mouseleave", () => {
  sliderHover = false;
  updateSliderTimer();
});
$("hero").addEventListener("focusin", () => {
  sliderFocused = true;
  updateSliderTimer();
});
$("hero").addEventListener("focusout", () => {
  queueMicrotask(() => {
    sliderFocused = $("hero").contains(document.activeElement);
    updateSliderTimer();
  });
});
document.addEventListener("visibilitychange", updateSliderTimer);
reducedMotion.addEventListener("change", updateSliderTimer);

function renderCategories(categories) {
  const enabled = Boolean(S.categories_enabled && categories.length);
  $("categories-section").hidden = !enabled;
  $("category-chips").hidden = !enabled;
  $("nav-categories").hidden = !enabled;
  $("menu-categories").hidden = !enabled;

  $("category-grid").innerHTML = categories.map(item => {
    const image = item.image_id
      ? '<img class="category-image" src="' + mediaURL(item.image_id) +
        '" alt="" loading="lazy" decoding="async" width="145" height="145">'
      : '<div class="category-image category-placeholder" aria-hidden="true">◇</div>';

    return '<button class="category-card" data-category="' + escapeHTML(item.id) +
      '">' + image + '<span class="category-name">' +
      escapeHTML(item.name) + "</span></button>";
  }).join("");

  $("category-chips").innerHTML =
    '<button class="active" data-category="">همه</button>' +
    categories.map(item =>
      '<button data-category="' + escapeHTML(item.id) + '">' +
      escapeHTML(item.name) + "</button>"
    ).join("");
}

function chooseCategory(id) {
  category = id || "";
  page = 1;

  document.querySelectorAll("[data-category]").forEach(button => {
    button.classList.toggle("active", button.dataset.category === category);
  });

  const found = bootstrapData?.categories.find(item => item.id === category);
  $("catalog-title").textContent = found ? found.name : "ویترین فروشگاه";
  loadProducts();
  scrollToSection("catalog");
}

for (const id of ["category-grid", "category-chips"]) {
  $(id).onclick = event => {
    const button = event.target.closest("[data-category]");
    if (button) chooseCategory(button.dataset.category);
  };
}

$("slides").onclick = event => {
  const button = event.target.closest("[data-slide-category]");
  if (button) chooseCategory(button.dataset.slideCategory);
};
$("all-products-button").onclick = () => chooseCategory("");

async function loadProducts() {
  if (productsController) productsController.abort();
  const controller = new AbortController();
  productsController = controller;

  $("products").setAttribute("aria-busy", "true");

  const query = new URLSearchParams({
    page: String(page),
    q: S.search_enabled ? $("search").value.trim() : "",
    category,
    sort: S.sorting_enabled ? $("sort").value : "new"
  });

  if (filterState.min) query.set("min", filterState.min);
  if (filterState.max) query.set("max", filterState.max);
  if (filterState.avail) query.set("avail", "1");
  if (filterState.cats.length) query.set("cats", filterState.cats.join(","));

  try {
    const data = await api("/api/products?" + query, { signal: controller.signal });
    if (controller !== productsController) return;

    if (page > data.pages && data.total > 0) {
      page = data.pages;
      return loadProducts();
    }

    productMap = new Map(data.products.map(product => [product.id, product]));
    $("product-count").textContent = fa(data.total) + " محصول";

    $("products").innerHTML = data.products.length
      ? data.products.map(product => {
          // The current list API returns base stock for variant products.
          // Never treat that base stock as the availability of its variants.
          const configurable = product.inventory_mode !== "simple";
          const unavailable = product.inventory_mode !== "variants" && product.stock <= 0;
          const image = product.primary_image
            ? '<img src="' + mediaURL(product.primary_image) + '" alt="' +
              escapeHTML(product.name) + '" loading="lazy" decoding="async" width="400" height="400">'
            : '<div class="placeholder" aria-hidden="true">◇</div>';

          const categoryName = bootstrapData.categories
            .find(item => item.id === product.category_id)?.name || "";

          return '<article class="product-card">' +
            '<button class="product-open" data-product="' + escapeHTML(product.id) +
            '" aria-haspopup="dialog" aria-label="' + escapeHTML("مشاهده " + product.name) + '">' +
            '<div class="product-cover">' + image +
            (unavailable ? '<span class="badge">ناموجود</span>' : "") + "</div>" +
            '<div class="product-info"><div class="product-category">' +
            escapeHTML(categoryName) + "</div><h3>" + escapeHTML(product.name) + "</h3>" +
            '<div class="price">' +
            (product.inventory_mode === "variants" ? '<small>قیمت پایه: </small>' : "") +
            fa(product.price) + " <small>تومان</small></div></div></button>" +
            (S.cart_enabled ? '<div class="product-action"><button class="primary" data-product="' +
              escapeHTML(product.id) + '" aria-haspopup="dialog"' +
              (unavailable ? " disabled" : "") + ">" +
              (unavailable ? "ناموجود" : configurable ? "انتخاب گزینه‌ها" : "مشاهده و خرید") +
              "</button></div>" : "") + "</article>";
        }).join("")
      : '<div class="empty">محصولی با این مشخصات پیدا نشد.</div>';

    $("pagination").innerHTML = data.total
      ? '<button data-page="' + (page - 1) + '"' + (page <= 1 ? " disabled" : "") +
        '>قبلی</button><span class="small muted">' + fa(page) + " از " + fa(data.pages) +
        '</span><button data-page="' + (page + 1) + '"' +
        (page >= data.pages ? " disabled" : "") + ">بعدی</button>"
      : "";
  } catch (error) {
    if (error.name === "AbortError") return;

    $("products").innerHTML = '<div class="empty"><p class="error">' +
      escapeHTML(error.message) + '</p><button id="retry-products">تلاش دوباره</button></div>';
    $("pagination").innerHTML = "";
  } finally {
    if (controller === productsController) {
      $("products").setAttribute("aria-busy", "false");
    }
  }
}

$("search").addEventListener("input", () => {
  clearTimeout(searchTimer);
  if (productsController) productsController.abort();
  page = 1;
  searchTimer = setTimeout(loadProducts, 300);
});

// Class fallback keeps the compact box expanding even when the
// browser does not propagate :focus-within (older WebViews).
$("search").addEventListener("focus", () => $("search-wrap").classList.add("open"));
$("search").addEventListener("blur", () => $("search-wrap").classList.remove("open"));

$("sort").onchange = () => {
  page = 1;
  loadProducts();
};

// ---- price/availability/category filter (bottom sheet on phones) ----
let filterState = { min: "", max: "", avail: false, cats: [] };

function filterActive() {
  return Boolean(
    filterState.min || filterState.max || filterState.avail || filterState.cats.length
  );
}

/* Multi-select category picker inside the filter dialog. */
function renderFilterCategories() {
  const wrap = $("filter-cats");
  if (!wrap) return;

  const enabled = S.categories_enabled &&
    Array.isArray(bootstrapData?.categories) &&
    bootstrapData.categories.length > 0;

  $("filter-cats-wrap").hidden = !enabled;

  if (!enabled) {
    wrap.innerHTML = "";
    return;
  }

  wrap.innerHTML = bootstrapData.categories.map(item =>
    '<button type="button" data-fcat="' + escapeHTML(item.id) + '" class="' +
    (filterState.cats.includes(item.id) ? "active" : "") + '">' +
    escapeHTML(item.name) + "</button>"
  ).join("");

  wrap.querySelectorAll("[data-fcat]").forEach(button => {
    button.onclick = () => {
      const id = button.dataset.fcat;
      const index = filterState.cats.indexOf(id);

      if (index === -1) filterState.cats.push(id);
      else filterState.cats.splice(index, 1);

      button.classList.toggle("active");
    };
  });
}

function syncFilterButton() {
  $("filter-button").classList.toggle("active", filterActive());

  const note = $("active-filter-note");
  const parts = [];

  if (filterState.min) parts.push("از " + fa(filterState.min) + " تومان");
  if (filterState.max) parts.push("تا " + fa(filterState.max) + " تومان");
  if (filterState.avail) parts.push("فقط کالاهای موجود");

  if (filterState.cats.length) {
    const names = filterState.cats
      .map(id => bootstrapData?.categories.find(item => item.id === id)?.name || "")
      .filter(Boolean);

    if (names.length) parts.push("دسته‌ها: " + names.join("، "));
  }

  note.hidden = !parts.length;
  note.textContent = parts.length ? "فیلترهای فعال: " + parts.join("؛ ") : "";
}

/* Accepts Persian/Arabic digits and strips everything non-numeric. */
function normalizeDigits(value) {
  return String(value || "")
    .replace(/[۰-۹]/g, ch => "۰۱۲۳۴۵۶۷۸۹".indexOf(ch))
    .replace(/[٠-٩]/g, ch => "٠١٢٣٤٥٦٧٨٩".indexOf(ch))
    .replace(/\D/g, "")
    .slice(0, 12);
}

$("filter-button").onclick = () => {
  $("filter-min").value = filterState.min;
  $("filter-max").value = filterState.max;
  $("filter-avail").checked = filterState.avail;
  renderFilterCategories();
  syncFilterButton();
  showDialog($("filter-dialog"));
};

$("filter-apply").onclick = () => {
  const min = normalizeDigits($("filter-min").value);
  const max = normalizeDigits($("filter-max").value);
  const note = $("active-filter-note");

  if (min && max && Number(min) > Number(max)) {
    note.hidden = false;
    note.textContent = "حداکثر قیمت باید بیشتر از حداقل باشد.";
    return;
  }

  filterState = {
    min,
    max,
    avail: $("filter-avail").checked,
    cats: [...filterState.cats]
  };
  syncFilterButton();
  page = 1;
  $("filter-dialog").close();
  loadProducts();
};

$("filter-clear").onclick = () => {
  filterState = { min: "", max: "", avail: false, cats: [] };
  $("filter-min").value = "";
  $("filter-max").value = "";
  $("filter-avail").checked = false;
  renderFilterCategories();
  syncFilterButton();
  page = 1;
  $("filter-dialog").close();
  loadProducts();
};

$("pagination").onclick = event => {
  const button = event.target.closest("[data-page]");
  if (!button || button.disabled) return;
  page = Number(button.dataset.page);
  loadProducts();
  scrollToSection("catalog");
};

$("products").onclick = event => {
  if (event.target.closest("#retry-products")) {
    loadProducts();
    return;
  }

  const button = event.target.closest("[data-product]");
  if (button && !button.disabled) openProduct(button.dataset.product);
};

function resolveProductSelection(product, selection) {
  const schema = product.optionSchema || [];
  const complete = product.inventoryMode === "simple" ||
    schema.every(group => group.values.includes(selection[group.name]));

  if (!complete) return null;

  if (product.inventoryMode === "variants") {
    const variant = product.variants.find(item =>
      schema.every(group => item.options[group.name] === selection[group.name])
    );

    if (!variant) return null;

    return {
      variantId: variant.id,
      selection: canonicalSelection(variant.options),
      price: variant.price === null ? product.price : variant.price,
      stock: variant.stock
    };
  }

  return {
    variantId: "",
    selection: product.inventoryMode === "simple"
      ? {} : canonicalSelection(selection),
    price: product.price,
    stock: product.stock
  };
}

function renderDetailSelection() {
  const product = currentProduct;
  if (!product) return;

  const schema = product.inventoryMode === "simple" ? [] : product.optionSchema;

  $("detail-options").innerHTML = schema.map((group, groupIndex) =>
    '<div class="option-group"><h3 id="option-label-' + groupIndex + '">' +
    escapeHTML(group.name) + '</h3><div class="option-values" role="group" aria-labelledby="option-label-' +
    groupIndex + '">' +
    group.values.map((value, valueIndex) =>
      '<button data-option-group="' + groupIndex + '" data-option-value="' + valueIndex +
      '" class="' + (selectedOptions[group.name] === value ? "selected" : "") +
      '" aria-pressed="' + String(selectedOptions[group.name] === value) + '">' +
      escapeHTML(value) + "</button>"
    ).join("") + "</div></div>"
  ).join("");

  const selected = resolveProductSelection(product, selectedOptions);
  const complete = schema.every(group => selectedOptions[group.name] !== undefined);

  $("detail-price").textContent = selected
    ? money(selected.price)
    : "قیمت پایه: " + money(product.price);

  $("detail-selection-message").textContent = !complete
    ? "گزینه‌های موردنظر را انتخاب کنید تا قیمت و موجودی مشخص شود."
    : !selected
      ? "این ترکیب برای فروش تعریف نشده است؛ گزینه‌ها را تغییر دهید."
      : selected.stock <= 0
        ? "این انتخاب فعلاً ناموجود است."
        : "";

  $("detail-stock").hidden = !S.stock_visible || !selected;
  $("detail-stock").textContent = selected ? "موجودی: " + fa(selected.stock) : "";
  $("detail-add").hidden = !S.cart_enabled;
  $("detail-add").disabled = !selected || selected.stock <= 0;
  $("detail-add").textContent = selected && selected.stock <= 0 ? "ناموجود" : "افزودن به سبد";
}

async function openProduct(id) {
  if (detailController) detailController.abort();
  const controller = new AbortController();
  detailController = controller;
  currentProduct = null;
  selectedOptions = {};

  $("detail-loading").hidden = false;
  $("detail-error").textContent = "";
  $("detail-content").hidden = true;
  $("detail-actions").hidden = true;
  showDialog($("product-dialog"));

  try {
    const product = await api("/api/product/" + encodeURIComponent(id), {
      signal: controller.signal
    });

    if (controller !== detailController) return;
    currentProduct = product;

    $("detail-name").textContent = product.name;
    $("detail-category").textContent = product.categoryName || "";
    $("detail-description").textContent = product.description;
    $("detail-attributes").innerHTML = String(product.attributes || "")
      .split("\n").filter(line => line.trim())
      .map(line => "<div>" + escapeHTML(line) + "</div>").join("");

    $("detail-image").hidden = !product.images.length;
    if (product.images.length) {
      $("detail-image").src = mediaURL(product.images[0]);
      $("detail-image").alt = product.name;
    }

    $("detail-thumbnails").innerHTML = product.images.map((image, index) =>
      '<button data-detail-image="' + escapeHTML(image) + '" aria-label="عکس ' + fa(index + 1) +
      '"><img src="' + mediaURL(image) + '" alt="" loading="lazy" width="57" height="57"></button>'
    ).join("");

    for (const group of product.optionSchema || []) {
      if (group.values.length === 1) selectedOptions[group.name] = group.values[0];
    }

    $("detail-content").hidden = false;
    $("detail-actions").hidden = false;
    renderDetailSelection();
  } catch (error) {
    if (error.name !== "AbortError") $("detail-error").textContent = error.message;
  } finally {
    if (controller === detailController) $("detail-loading").hidden = true;
  }
}

$("detail-thumbnails").onclick = event => {
  const button = event.target.closest("[data-detail-image]");
  if (button) $("detail-image").src = mediaURL(button.dataset.detailImage);
};

$("detail-options").onclick = event => {
  const button = event.target.closest("[data-option-group]");
  if (!button || !currentProduct) return;

  const group = currentProduct.optionSchema[Number(button.dataset.optionGroup)];
  const value = group?.values[Number(button.dataset.optionValue)];
  if (value === undefined) return;

  selectedOptions[group.name] = value;
  const groupIndex = button.dataset.optionGroup;
  const valueIndex = button.dataset.optionValue;
  renderDetailSelection();

  $("detail-options").querySelector(
    '[data-option-group="' + groupIndex + '"][data-option-value="' + valueIndex + '"]'
  )?.focus({ preventScroll: true });
};

$("detail-add").onclick = () => {
  if (!currentProduct || !S.cart_enabled) return;
  const selected = resolveProductSelection(currentProduct, selectedOptions);
  if (!selected || selected.stock <= 0) return;

  const candidate = {
    productId: currentProduct.id,
    variantId: selected.variantId,
    name: currentProduct.name,
    selection: selected.selection,
    quantity: 1,
    price: selected.price,
    image: currentProduct.images[0] || ""
  };

  const identity = cartIdentity(candidate);
  const existing = cart.find(item => cartIdentity(item) === identity);
  const inPool = cart.filter(item =>
    item.productId === candidate.productId &&
    (currentProduct.inventoryMode !== "variants" || item.variantId === candidate.variantId)
  ).reduce((sum, item) => sum + item.quantity, 0);

  if (inPool >= selected.stock || (existing && existing.quantity >= 99)) {
    toast("تعداد انتخاب‌شده به سقف موجودی رسیده است.");
    return;
  }

  if (existing) {
    existing.quantity++;
    existing.price = selected.price;
  } else {
    if (cart.length >= 40) {
      toast("حداکثر ۴۰ ردیف کالا در هر سفارش.");
      return;
    }
    cart.push(candidate);
  }

  const persisted = saveCart();
  toast(persisted
    ? "به سبد خرید اضافه شد."
    : "به سبد اضافه شد؛ ذخیره‌سازی مرورگر در دسترس نیست.", "success");
};

// Refresh in small groups instead of sending up to 40 requests simultaneously.
async function refreshCart() {
  if (!cart.length) throw new Error("Your cart is empty.");

  const snapshot = cart.map(item => ({
    ...item, selection: { ...item.selection }
  }));
  const identitiesBefore = JSON.stringify(cart);
  const ids = [...new Set(snapshot.map(item => item.productId))];
  const fresh = new Map();

  for (let offset = 0; offset < ids.length; offset += 4) {
    const group = ids.slice(offset, offset + 4);
    const products = await Promise.all(
      group.map(id => api("/api/product/" + encodeURIComponent(id)))
    );
    for (const product of products) fresh.set(product.id, product);
  }

  const pools = new Map();
  const next = snapshot.map(item => {
    const product = fresh.get(item.productId);
    let selected;

    if (product.inventoryMode === "variants") {
      const variant = product.variants.find(value => value.id === item.variantId);
      if (!variant) throw new Error("A selected variant is no longer available: " + item.name);

      selected = {
        variantId: variant.id,
        selection: canonicalSelection(variant.options),
        price: variant.price === null ? product.price : variant.price,
        stock: variant.stock
      };
    } else {
      if (item.variantId) throw new Error("Product options changed. Remove and re-add: " + item.name);
      selected = resolveProductSelection(product, item.selection);
    }

    if (!selected) throw new Error("Product options changed. Remove and re-add: " + item.name);

    const poolKey = product.id + ":" + selected.variantId;
    const used = (pools.get(poolKey) || 0) + item.quantity;
    pools.set(poolKey, used);

    if (used > selected.stock) throw new Error("Insufficient stock: " + product.name);

    return {
      ...item,
      name: product.name,
      variantId: selected.variantId,
      selection: selected.selection,
      price: selected.price,
      image: product.images[0] || ""
    };
  });

  if (identitiesBefore !== JSON.stringify(cart)) {
    throw new Error("The cart changed while refreshing. Try again.");
  }

  const changed = next.some((item, index) => item.price !== snapshot[index].price);
  cart = next;
  saveCart();
  renderCart();
  return changed;
}

function renderEditorial(data) {
  postMap = new Map(data.posts.map(post => [post.id, post]));

  $("blog-section").hidden = !S.blog_enabled || !data.posts.length;
  $("menu-blog").hidden = $("blog-section").hidden;

  /*
   * Title-only magazine cards (framed): the full post (image + body)
   * opens in the dialog on tap, fetched from /api/post/:id — this keeps
   * the bootstrap payload small and the page tidy.
   */
  $("posts").innerHTML = data.posts.map(post =>
    '<button class="blog-card" data-post="' + escapeHTML(post.id) +
    '" aria-haspopup="dialog">' +
    '<div class="blog-info"><h3>' + escapeHTML(post.title) + "</h3>" +
    '<span class="blog-read">خواندن نوشته ←</span></div></button>'
  ).join("");

  $("faq-section").hidden = !S.faq_enabled || !data.faqs.length;
  $("menu-faq").hidden = $("faq-section").hidden;
  $("faqs").innerHTML = data.faqs.map(faq =>
    "<details><summary>" + escapeHTML(faq.question) +
    '</summary><p class="pre muted">' + escapeHTML(faq.answer) + "</p></details>"
  ).join("");

  $("contact-section").hidden = !S.contact_enabled;
  $("menu-contact").hidden = !S.contact_enabled;
  $("contact-text").textContent = S.contact_text;
  $("contact-links").innerHTML = contactHTML(S.contact_links);
  $("footer-text").textContent = S.footer_text;
}

$("posts").onclick = event => {
  const button = event.target.closest("[data-post]");
  const post = button ? postMap.get(button.dataset.post) : null;
  if (!post) return;

  openPost(post);
};

/* Title card -> full post dialog (body fetched on demand, edge-cached). */
async function openPost(post) {
  $("post-title").textContent = post.title;
  $("post-content").textContent = post.body || "در حال بارگذاری…";
  $("post-image").hidden = !post.image_id;

  if (post.image_id) {
    $("post-image").src = mediaURL(post.image_id);
    $("post-image").alt = post.title;
  }

  showDialog($("post-dialog"));
  $("post-dialog").scrollTop = 0;

  try {
    const data = await api("/api/post/" + encodeURIComponent(post.id));
    const full = data.post || post;

    $("post-title").textContent = full.title || post.title;
    $("post-content").textContent = full.body || "";
    $("post-image").hidden = !full.image_id;

    if (full.image_id) {
      $("post-image").src = mediaURL(full.image_id);
      $("post-image").alt = full.title || post.title;
    }

    $("post-dialog").scrollTop = 0;
  } catch (error) {
    if (!post.body) {
      $("post-content").textContent =
        "بارگذاری نوشته ناموفق بود؛ اتصال را بررسی کنید و دوباره تلاش کنید.";
    }
  }
}

function focusSearch() {
  if (!S.search_enabled) return;
  scrollToSection("catalog");
  $("search").focus({ preventScroll: true });
}

$("menu-theme").onclick = () => {
  const current = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  setTheme(current === "dark" ? "light" : "dark", true);
};
$("menu-button").onclick = () => showDialog($("menu-dialog"));
$("header-cart").onclick = openCart;
$("nav-cart").onclick = openCart;
$("header-search").onclick = focusSearch;
$("nav-search").onclick = focusSearch;

/* Login / register entries — visible only when the users module is on. */
function goAccount() {
  location.href = "/account";
}

$("account-button").onclick = goAccount;
$("menu-account").onclick = () => {
  closeDialogs();
  goAccount();
};
$("nav-home").onclick = () => {
  closeDialogs();
  window.scrollTo({ top: 0, behavior: reducedMotion.matches ? "auto" : "smooth" });
};
$("nav-categories").onclick = () => scrollToSection("categories-section");
$("menu-dialog").addEventListener("click", event => {
  const button = event.target.closest("[data-jump]");
  if (button) scrollToSection(button.dataset.jump);
});

// PART 3 continues below.
// Do not close the function, script tag or template literal yet.


// ============================================================
// Storefront — PART 3 OF 3
// Continue inside the function opened in PART 2.
// ============================================================

let checkoutBusy = false;
let receiptBusy = false;
let orderController = null;
let activeOrder = null;
let activeOrderCredentials = null;
let deadlineTimer = null;
let popupTimer = null;
let turnstilePromise = null;
let turnstileWidget = null;
/*
 * An unresolved checkout request (result unknown) stays retryable for a
 * limited time; afterwards it is dropped automatically so a stuck error
 * can never permanently block new orders.
 * Declared before readPendingCheckout() runs (no TDZ at script init).
 */
const PENDING_TTL = 15 * 60 * 1000;

function pendingExpired(pending) {
  return !pending || !Number.isFinite(pending.savedAt) ||
    Date.now() - pending.savedAt > PENDING_TTL;
}

let pendingCheckout = readPendingCheckout();

function randomAccessKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
}

function validCredentials(value) {
  return Boolean(
    value &&
    /^[a-f0-9]{32}$/.test(value.id || "") &&
    /^[a-f0-9]{64}$/i.test(value.accessKey || "")
  );
}

function readPendingCheckout() {
  try {
    const pending = JSON.parse(sessionStorage.getItem(STORAGE.pending) || "null");

    if (
      pending &&
      pending.payload &&
      typeof pending.snapshot === "string" &&
      /^[a-f0-9-]{36}$/i.test(pending.payload.requestId || "") &&
      /^[a-f0-9]{64}$/i.test(pending.payload.accessKey || "") &&
      Array.isArray(pending.payload.items)
    ) {
      // Requests saved before this fix carry no savedAt timestamp and are
      // treated as expired on purpose: they are exactly the ones that got
      // customers stuck behind an unresolvable retry.
      if (!pendingExpired(pending)) return pending;

      sessionStorage.removeItem(STORAGE.pending);
    }
  } catch {
    // A restricted browser may not provide sessionStorage.
  }

  return null;
}

function savePendingCheckout(value) {
  pendingCheckout = value;

  try {
    // Contact details are kept in this tab's session storage,
    // not in the long-lived localStorage order record.
    if (value) sessionStorage.setItem(STORAGE.pending, JSON.stringify(value));
    else sessionStorage.removeItem(STORAGE.pending);
  } catch {
    // The same-page retry still works using the in-memory value.
  }
}

function lastOrderCredentials() {
  const value = storageRead(STORAGE.lastOrder);
  return validCredentials(value) ? value : null;
}

function setCheckoutLocked(locked) {
  $("checkout-form").querySelectorAll("input,textarea,select").forEach(input => {
    input.disabled = locked;
  });

  $("submit-order").textContent = locked
    ? "بررسی و تلاش مجدد همان سفارش"
    : "ثبت اولیه سفارش";
}

const GATEWAY_FA = {
  zarinpal: "زرین‌پال",
  zibal: "زیبال",
  snapppay: "اسنپ‌پی"
};

/*
 * Gateways the customer can pick from. payment_gateways is the multi-select
 * list shipped by newer bootstraps; older ones fall back to the single pick.
 * The master switch still gates the whole online-payment method.
 */
function activeGatewayNames() {
  if (!S.payment_gateway_enabled) return [];

  if (Array.isArray(S.payment_gateways) && S.payment_gateways.length) {
    return S.payment_gateways.filter(name => GATEWAY_FA[name]);
  }

  return GATEWAY_FA[S.payment_gateway] ? [S.payment_gateway] : [];
}

function paymentMethodsHTML() {
  const methods = [];

  if (S.payment_contact_enabled) {
    methods.push({
      value: "contact",
      gateway: "",
      title: "هماهنگی با مدیر",
      description: "ثبت اولیه و هماهنگی پرداخت و ارسال با فروشگاه."
    });
  }

  if (S.payment_card_enabled && bootstrapData.cards.length) {
    methods.push({
      value: "card",
      gateway: "",
      title: "کارت‌به‌کارت",
      description: "پس از ثبت سفارش، کارت‌ها و مهلت پرداخت نمایش داده می‌شوند."
    });
  }

  for (const name of activeGatewayNames()) {
    methods.push({
      value: "gateway",
      gateway: name,
      title: "پرداخت آنلاین (" + GATEWAY_FA[name] + ")",
      description: "پرداخت امن با کارت بانکی از درگاه " + GATEWAY_FA[name] +
        "؛ پس از پرداخت به فروشگاه بازمی‌گردید."
    });
  }

  return methods.map((method, index) =>
    '<label class="payment-option"><input type="radio" name="paymentMethod" value="' +
    method.value + '" data-gateway="' + (method.gateway || "") + '"' +
    (index === 0 ? " checked" : "") + ' required>' +
    "<span>" + escapeHTML(method.title) + "<small>" +
    escapeHTML(method.description) + "</small></span></label>"
  ).join("");
}

function fillCheckoutSummary(items = cart) {
  $("checkout-summary-items").innerHTML = items.map(item =>
    '<p style="margin-bottom:10px">' + escapeHTML(item.name) +
    " × " + fa(item.quantity) +
    (selectionText(item.selection)
      ? '<br><span class="muted">' + escapeHTML(selectionText(item.selection)) + "</span>"
      : "") + "</p>"
  ).join("");

  const amount = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  $("checkout-totals").innerHTML = totalsHTML(amount, shippingFee(amount));
}

function fillPendingForm(pending) {
  const form = $("checkout-form");
  const payload = pending.payload;

  for (const key of ["name", "phone", "address", "postal", "note", "coupon"]) {
    const input = form.elements.namedItem(key);
    if (input) input.value = payload[key] || "";
  }

  const gatewayLabel = GATEWAY_FA[payload.gateway];
  const label = payload.paymentMethod === "card"
    ? "کارت‌به‌کارت"
    : payload.paymentMethod === "gateway"
      ? "پرداخت آنلاین" + (gatewayLabel ? " (" + gatewayLabel + ")" : "")
      : "هماهنگی با مدیر";

  $("payment-methods").innerHTML =
    '<label class="payment-option"><input type="radio" name="paymentMethod" value="' +
    escapeHTML(payload.paymentMethod) + '" checked>' +
    "<span>" + label +
    "<small>تلاش مجدد برای همان درخواست قبلی</small></span></label>";

  try {
    fillCheckoutSummary(JSON.parse(pending.snapshot));
  } catch {
    fillCheckoutSummary();
  }

  $("discard-pending").hidden = false;
  setCheckoutLocked(true);
}

async function ensureTurnstile() {
  if (!S.turnstile_enabled) return;

  if (!S.turnstile_site_key) {
    throw new Error("Turnstile site key is missing.");
  }

  if (!turnstilePromise) {
    turnstilePromise = new Promise((resolve, reject) => {
      if (window.turnstile) {
        window.turnstile.ready(resolve);
        return;
      }

      const script = document.createElement("script");
      const timeout = setTimeout(() => {
        turnstilePromise = null;
        script.remove();
        reject(new Error("Security verification failed to load. Try again."));
      }, 20000);

      script.src =
        "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;

      script.onload = () => {
        clearTimeout(timeout);

        if (!window.turnstile) {
          turnstilePromise = null;
          reject(new Error("Security verification is unavailable."));
          return;
        }

        window.turnstile.ready(resolve);
      };

      script.onerror = () => {
        clearTimeout(timeout);
        turnstilePromise = null;
        script.remove();
        reject(new Error("Security verification failed to load."));
      };

      document.head.appendChild(script);
    });
  }

  await turnstilePromise;

  if (turnstileWidget === null) {
    turnstileWidget = window.turnstile.render("#turnstile-container", {
      sitekey: S.turnstile_site_key,
      action: "checkout",
      theme: "auto",
      "response-field": false,
      "error-callback": function () {
        $("checkout-error").textContent =
          "Security verification failed. Refresh the verification and retry.";
      }
    });
  } else {
    window.turnstile.reset(turnstileWidget);
  }
}

function resetTurnstile() {
  if (window.turnstile && turnstileWidget !== null) {
    try {
      window.turnstile.reset(turnstileWidget);
    } catch {
      // The next form opening can initialize the verification again.
    }
  }
}

async function beginCheckout() {
  if (checkoutBusy) return;

  // A pending request older than its TTL no longer blocks new orders.
  if (pendingCheckout && pendingExpired(pendingCheckout)) {
    savePendingCheckout(null);
    $("retry-pending-order")?.remove();
  }

  if (!pendingCheckout && (!cart.length || !S.orders_enabled || !S.cart_enabled)) return;

  checkoutBusy = true;
  $("begin-checkout").disabled = true;
  $("cart-error").textContent = "";
  $("checkout-error").textContent = "";

  try {
    if (pendingCheckout) {
      fillPendingForm(pendingCheckout);
      showDialog($("checkout-dialog"));

      $("checkout-error").textContent =
        "این درخواست قبلاً ارسال شده اما نتیجه‌اش مشخص نشده است. " +
        "برای جلوگیری از ثبت تکراری، همین سفارش را دوباره ثبت کنید " +
        "یا با دکمهٔ پایین آن را لغو کنید.";

      // Retrying an already-saved order does not require a new Turnstile
      // token on the server. If loading fails, keep the retry available.
      try {
        await ensureTurnstile();
      } catch (error) {
        $("checkout-error").textContent += "\n" + error.message;
      }

      return;
    }

    const methods = paymentMethodsHTML();
    if (!methods) throw new Error("در حال حاضر هیچ روش پرداختی فعال نیست؛ با مدیر فروشگاه هماهنگ کنید.");

    const pricesChanged = await refreshCart();

    if (pricesChanged) {
      $("cart-error").textContent =
        "قیمت یا موجودی برخی کالاها تغییر کرده است؛ سبد را بازبینی کنید و دوباره ادامه دهید.";
      return;
    }

    setCheckoutLocked(false);
    $("discard-pending").hidden = true;
    $("payment-methods").innerHTML = methods;
    fillCheckoutSummary();
    showDialog($("checkout-dialog"));
    await ensureTurnstile();
  } catch (error) {
    if ($("checkout-dialog").open) {
      $("checkout-error").textContent = error.message;
    } else {
      $("cart-error").textContent = error.message;
    }
  } finally {
    checkoutBusy = false;
    $("begin-checkout").disabled = !pendingCheckout &&
      (!cart.length || !S.orders_enabled);
  }
}

$("begin-checkout").onclick = beginCheckout;

/*
 * Escape hatch for an unresolved previous request: the customer can
 * drop it and start a fresh order (e.g. when the cart changed since).
 */
$("discard-pending").onclick = () => {
  savePendingCheckout(null);
  $("retry-pending-order")?.remove();
  $("checkout-error").textContent = "";
  $("checkout-form").reset();
  setCheckoutLocked(false);

  const methods = paymentMethodsHTML();

  if (!methods) {
    $("checkout-dialog").close();
    return;
  }

  $("discard-pending").hidden = true;
  $("payment-methods").innerHTML = methods;
  fillCheckoutSummary();
  ensureTurnstile().catch(() => {});
};

let payBusy = false;

async function redirectToGateway(credentials) {
  const result = await api("/api/pay/start", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Order-Key": credentials.accessKey
    },
    body: JSON.stringify({ orderId: credentials.id }),
    signal: AbortSignal.timeout(30000)
  });

  if (!result || !/^https:\/\//i.test(String(result.redirect || ""))) {
    throw new Error("درگاه پرداخت در دسترس نیست؛ بعداً تلاش کنید.");
  }

  location.href = result.redirect;
}

$("checkout-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (checkoutBusy) return;

  checkoutBusy = true;
  $("submit-order").disabled = true;
  $("checkout-error").textContent = "";

  try {
    let pending = pendingCheckout;

    if (!pending) {
      const form = new FormData($("checkout-form"));
      const paymentMethod = form.get("paymentMethod");

      if (!["contact", "card", "gateway"].includes(paymentMethod)) {
        throw new Error("روش پرداخت را انتخاب کنید.");
      }

      if (!cart.length) throw new Error("سبد خرید شما خالی است.");

      const checkedMethod = $("payment-methods").querySelector(
        'input[name="paymentMethod"]:checked'
      );
      const chosenGateway = paymentMethod === "gateway"
        ? String(checkedMethod?.dataset.gateway || "")
        : "";

      if (paymentMethod === "gateway" && !chosenGateway) {
        throw new Error("درگاه پرداخت در دسترس نیست؛ صفحه را تازه‌سازی کنید.");
      }

      const payload = {
        requestId: crypto.randomUUID(),
        accessKey: randomAccessKey(),
        name: String(form.get("name") || ""),
        phone: String(form.get("phone") || ""),
        address: String(form.get("address") || ""),
        postal: String(form.get("postal") || ""),
        note: S.order_notes_enabled ? String(form.get("note") || "") : "",
        coupon: S.discounts_enabled ? String(form.get("coupon") || "") : "",
        paymentMethod,
        gateway: chosenGateway,
        items: cart.map(item => ({
          productId: item.productId,
          variantId: item.variantId || "",
          selection: item.selection,
          quantity: item.quantity
        }))
      };

      if (S.turnstile_enabled) {
        const token = window.turnstile && turnstileWidget !== null
          ? window.turnstile.getResponse(turnstileWidget)
          : "";

        if (!token) {
          throw new Error("Complete the security verification.");
        }
      }

      pending = { payload, snapshot: JSON.stringify(cart), savedAt: Date.now() };
      savePendingCheckout(pending);
    }

    const payload = { ...pending.payload };

    if (S.turnstile_enabled) {
      payload.turnstile = window.turnstile && turnstileWidget !== null
        ? window.turnstile.getResponse(turnstileWidget)
        : "";
    }

    setCheckoutLocked(true);

    const result = await api("/api/orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60000)
    });

    const credentials = {
      id: result.id,
      code: result.code,
      accessKey: payload.accessKey
    };

    if (!validCredentials(credentials)) {
      throw new Error("The server returned invalid order information.");
    }

    const remembered = storageWrite(STORAGE.lastOrder, credentials);
    activeOrderCredentials = credentials;
    $("last-order-button").hidden = false;

    // Do not erase cart changes made in the meantime.
    if (JSON.stringify(cart) === pending.snapshot) {
      cart = [];
      saveCart();
    }

    savePendingCheckout(null);
    $("retry-pending-order")?.remove();
    $("discard-pending").hidden = true;
    $("checkout-form").reset();
    setCheckoutLocked(false);

    if (payload.paymentMethod === "gateway") {
      // Credentials and the pending flag are already stored: if the gateway
      // hand-off fails, the customer can retry from the order dialog.
      toast("سفارش ثبت شد؛ در حال انتقال به درگاه پرداخت…");
      await redirectToGateway(credentials);
      return;
    }

    toast(remembered
      ? "سفارش ثبت شد؛ کد پیگیری را نگه دارید."
      : "سفارش ثبت شد؛ ذخیره مرورگر فعال نیست. کد پیگیری را یادداشت کنید.");

    await openOrder(credentials);
    loadProducts();
  } catch (error) {
    const definitiveRejection = error.status >= 400 &&
      error.status < 500 &&
      ![408, 429].includes(error.status);

    if (definitiveRejection) {
      savePendingCheckout(null);
      setCheckoutLocked(false);
      $("discard-pending").hidden = true;

      const methods = paymentMethodsHTML();
      if (methods) $("payment-methods").innerHTML = methods;
    }

    $("checkout-error").textContent = error.message +
      (pendingCheckout
        ? "\nنتیجهٔ درخواست نامشخص است؛ همان سفارش را دوباره ثبت کنید و پرداخت را تکرار نکنید."
        : "");

    if (pendingCheckout) setCheckoutLocked(true);
    resetTurnstile();
  } finally {
    checkoutBusy = false;
    $("submit-order").disabled = false;
  }
});

const ORDER_LABELS = {
  new: "ثبت اولیه",
  confirmed: "تأییدشده",
  sent: "ارسال‌شده",
  cancelled: "لغوشده"
};

const PAYMENT_LABELS = {
  unpaid: "پرداخت هنوز تأیید نشده است.",
  review: "رسید دریافت شده و در انتظار بررسی مدیر است.",
  paid: "پرداخت توسط مدیر تأیید شده است."
};

function orderIsActive(order) {
  return ["new", "confirmed"].includes(order.status);
}

function receiptAllowed(order) {
  return order.paymentMethod === "card" &&
    orderIsActive(order) &&
    order.paymentStatus !== "paid" &&
    (!order.expiresAt || order.expiresAt > Date.now()) &&
    order.receipts.length < 3;
}

function renderPrivateOrder(order) {
  activeOrder = order;
  clearTimeout(deadlineTimer);

  $("order-code").textContent = order.code;
  $("order-message").textContent = order.message || "";
  $("order-status").textContent = ORDER_LABELS[order.status] || order.status;
  $("order-payment-status").textContent =
    PAYMENT_LABELS[order.paymentStatus] || order.paymentStatus;

  $("order-totals").innerHTML = totalsHTML(
    order.subtotal,
    order.shipping,
    order.discount
  );

  $("order-lines").innerHTML = order.lines.map(line =>
    '<p style="margin-bottom:12px"><strong>' + escapeHTML(line.name) +
    "</strong> × " + fa(line.quantity) +
    (selectionText(line.selection)
      ? '<br><span class="muted">' + escapeHTML(selectionText(line.selection)) + "</span>"
      : "") +
    "<br>" + money(line.price * line.quantity) + "</p>"
  ).join("");

  const unexpired = !order.expiresAt || order.expiresAt > Date.now();
  const showCards = order.paymentMethod === "card" &&
    orderIsActive(order) &&
    order.paymentStatus === "unpaid" &&
    unexpired;

  $("bank-section").hidden = !showCards;
  $("bank-cards").innerHTML = showCards ? order.cards.map((card, index) => {
    const number = String(card.card_number || "")
      .replace(/(.{4})(?=.)/g, "$1 ");

    return '<article class="bank-card">' +
      '<div class="bank-top"><strong>' + escapeHTML(card.bank_name) +
      '</strong><span class="bank-label">' + escapeHTML(card.label) + "</span></div>" +
      '<div class="bank-number">' + escapeHTML(number) + "</div>" +
      '<div class="bank-bottom"><span class="bank-holder">' +
      escapeHTML(card.holder_name) + '</span><button data-copy-card="' +
      index + '">کپی شماره</button></div></article>';
  }).join("") : "";

  if (showCards) {
    $("payment-deadline").textContent = order.expiresAt
      ? "مهلت واریز: " + new Date(order.expiresAt).toLocaleString("fa-IR", {
          timeZone: "Asia/Tehran"
        })
      : "قبل از واریز با مدیر هماهنگ کنید.";

    if (!order.cards.length) {
      $("bank-cards").innerHTML =
        '<p class="error">No active bank card is available. Contact the manager.</p>';
    }
  }

  if (
    order.paymentMethod === "card" &&
    order.paymentStatus === "unpaid" &&
    !unexpired
  ) {
    $("order-payment-status").textContent =
      "مهلت پرداخت پایان یافته است. واریز نکنید؛ با مدیر هماهنگ کنید.";
  }

  $("gateway-section").hidden = !(order.paymentMethod === "gateway" &&
    orderIsActive(order) &&
    order.paymentStatus !== "paid");
  $("gateway-error").textContent = "";

  if (order.paymentMethod === "gateway" && order.paymentStatus === "paid") {
    $("order-payment-status").textContent =
      "پرداخت آنلاین با موفقیت انجام شد.";
  }

  $("receipt-section").hidden = !receiptAllowed(order);
  $("receipt-count").textContent =
    "تعداد رسیدهای ثبت‌شده: " + fa(order.receipts.length) + " از ۳";

  $("order-contact-text").textContent = order.contact || "";
  $("order-contact-links").innerHTML = contactHTML(order.links);

  if (order.expiresAt && order.expiresAt > Date.now()) {
    deadlineTimer = setTimeout(() => {
      if (activeOrder?.id === order.id) renderPrivateOrder(activeOrder);
    }, Math.min(order.expiresAt - Date.now() + 100, 2147483647));
  }

  $("order-content").hidden = false;
}

async function openOrder(credentials) {
  if (!validCredentials(credentials)) {
    toast("Order access information is unavailable.");
    return;
  }

  if (orderController) orderController.abort();
  const controller = new AbortController();
  orderController = controller;
  activeOrderCredentials = credentials;
  activeOrder = null;

  $("order-error").textContent = "";
  $("receipt-error").textContent = "";
  $("order-content").hidden = true;
  $("order-loading").hidden = false;
  $("receipt-file").value = "";

  showDialog($("order-dialog"));

  try {
    const order = await api(
      "/api/orders/" + encodeURIComponent(credentials.id),
      {
        headers: { "X-Order-Key": credentials.accessKey },
        signal: controller.signal
      }
    );

    if (controller !== orderController) return;
    renderPrivateOrder(order);
  } catch (error) {
    if (error.name === "AbortError") return;

    $("order-error").textContent = error.message +
      (credentials.code ? "\nOrder code: " + credentials.code : "");

    if (credentials.code) {
      $("order-error").textContent +=
        "\nKeep this code and contact the store if the problem continues.";
    }
  } finally {
    if (controller === orderController) $("order-loading").hidden = true;
  }
}

$("pay-online").onclick = async () => {
  if (payBusy || !activeOrderCredentials) return;

  payBusy = true;
  $("pay-online").disabled = true;
  $("gateway-error").textContent = "";

  try {
    await redirectToGateway(activeOrderCredentials);
  } catch (error) {
    $("gateway-error").textContent = error.message +
      "\nکد سفارش: " + (activeOrderCredentials.code || "—");
  } finally {
    payBusy = false;
    $("pay-online").disabled = false;
  }
};

async function copyText(value, successMessage) {
  try {
    await navigator.clipboard.writeText(String(value));
    toast(successMessage);
  } catch {
    toast("Copy failed. Select and copy the displayed value manually.");
  }
}

$("copy-order-code").onclick = () => {
  if (activeOrder) copyText(activeOrder.code, "کد سفارش کپی شد.");
};

$("refresh-order").onclick = () => {
  if (!receiptBusy && activeOrderCredentials) openOrder(activeOrderCredentials);
};

$("last-order-button").onclick = () => {
  const credentials = activeOrderCredentials || lastOrderCredentials();
  if (credentials) openOrder(credentials);
};

$("bank-cards").onclick = event => {
  const button = event.target.closest("[data-copy-card]");
  if (!button || !activeOrder) return;

  const card = activeOrder.cards[Number(button.dataset.copyCard)];
  if (card) copyText(card.card_number, "شماره کارت کپی شد.");
};

$("send-receipt").onclick = async () => {
  if (receiptBusy || !activeOrder || !activeOrderCredentials) return;

  $("receipt-error").textContent = "";

  if (!receiptAllowed(activeOrder)) {
    $("receipt-error").textContent =
      "This order cannot receive a receipt. Refresh its status.";
    return;
  }

  const file = $("receipt-file").files?.[0];

  if (!file) {
    $("receipt-error").textContent = "Select a receipt image.";
    return;
  }

  if (
    !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
    file.size <= 0 ||
    file.size > 4 * 1024 * 1024
  ) {
    $("receipt-error").textContent =
      "Use a JPEG, PNG or WebP image up to 4 MiB.";
    return;
  }

  receiptBusy = true;
  $("send-receipt").disabled = true;
  $("receipt-file").disabled = true;
  $("send-receipt").textContent = "در حال ارسال…";

  const credentials = { ...activeOrderCredentials };

  try {
    await api(
      "/api/orders/" + encodeURIComponent(credentials.id) + "/receipt",
      {
        method: "POST",
        headers: {
          "content-type": file.type,
          "X-Order-Key": credentials.accessKey
        },
        body: file,
        signal: AbortSignal.timeout(90000)
      }
    );

    toast("رسید برای بررسی مدیر دریافت شد؛ پرداخت هنوز تأیید نشده است.");
    await openOrder(credentials);
  } catch (error) {
    $("receipt-error").textContent = error.message +
      "\nBefore uploading again, refresh the order to check whether the receipt was received.";
  } finally {
    receiptBusy = false;
    $("send-receipt").disabled = false;
    $("receipt-file").disabled = false;
    $("send-receipt").textContent = "ارسال رسید برای بررسی";
  }
};

function configurePopup() {
  clearTimeout(popupTimer);

  if (!S.popup_enabled) return;
  if (!S.popup_title && !S.popup_text && !S.popup_image) return;

  const signature = JSON.stringify([
    S.popup_title,
    S.popup_text,
    S.popup_image,
    S.popup_url,
    S.popup_button
  ]);

  const previous = storageRead(STORAGE.popup);
  const shouldShow = S.popup_every_visit ||
    !previous ||
    previous.signature !== signature ||
    Date.now() - previous.time > 86400000;

  if (!shouldShow) return;

  $("popup-title").textContent = S.popup_title || "اطلاعیه فروشگاه";
  $("popup-text").textContent = S.popup_text || "";

  $("popup-image").hidden = !S.popup_image;
  if (S.popup_image) $("popup-image").src = mediaURL(S.popup_image);

  const url = safeURL(S.popup_url);
  $("popup-link").hidden = !url;

  if (url) {
    $("popup-link").href = url;
    $("popup-link").textContent = S.popup_button || "مشاهده";
  }

  popupTimer = setTimeout(() => {
    if (document.querySelector("dialog[open]")) return;

    showDialog($("popup-dialog"));
    storageWrite(STORAGE.popup, {
      signature,
      time: Date.now()
    });
  }, 1500);
}

function applyBootstrap(data) {
  if (
    !data ||
    typeof data.settings !== "object" ||
    !Array.isArray(data.categories) ||
    !Array.isArray(data.slides) ||
    !Array.isArray(data.posts) ||
    !Array.isArray(data.faqs)
  ) {
    throw new Error("Store configuration is invalid.");
  }

  data.cards = Array.isArray(data.cards) ? data.cards : [];
  bootstrapData = data;
  S = data.settings;

  document.title = S.store_name || "فروشگاه";
  $("store-name").textContent = S.store_name || "فروشگاه";
  $("tagline").textContent = S.tagline || "";
  applyBrand(S.brand_color);
  applyChipColors(S);

  $("store-logo").hidden = !S.logo;
  if (S.logo) $("store-logo").src = mediaURL(S.logo);

  $("uploaded-font").textContent =
    /^[a-f0-9]{32}$/.test(S.font || "")
      ? '@font-face{font-family:StoreFont;src:url("/media/' +
        S.font +
        '");font-display:swap;font-style:normal;font-weight:100 900;}'
      : "";

  const theme = S.theme_switch_enabled
    ? storageRead(STORAGE.theme, S.default_theme)
    : S.default_theme;

  setTheme(theme);

  $("announcement").hidden = !S.announcement_enabled || !S.announcement;
  $("announcement").textContent = S.announcement || "";

  $("search-wrap").hidden = !S.search_enabled;
  $("header-search").hidden = !S.search_enabled;
  $("nav-search").hidden = !S.search_enabled;
  $("sort-wrap").hidden = !S.sorting_enabled;

  /*
   * The admin's default sort (default_sort setting) is applied on every
   * fresh load; the customer can still switch it freely afterwards.
   */
  if (S.sorting_enabled && ["new", "pop", "cheap", "expensive"].includes(S.default_sort)) {
    $("sort").value = S.default_sort;
  }

  const tools = $("search-wrap").parentElement;
  tools.hidden = !S.search_enabled && !S.sorting_enabled;
  tools.style.gridTemplateColumns =
    S.search_enabled && S.sorting_enabled ? "" : "minmax(0,1fr)";

  // With sorting hidden the compact search takes the whole row.
  $("search-wrap").style.width =
    S.search_enabled && !S.sorting_enabled ? "100%" : "";

  $("header-cart").hidden = !S.cart_enabled;
  $("nav-cart").hidden = !S.cart_enabled;
  $("note-field").hidden = !S.order_notes_enabled;
  $("coupon-field").hidden = !S.discounts_enabled;

  renderSlider(data.slides);
  renderCategories(data.categories);
  renderEditorial(data);
  updateCartBadge();

  $("last-order-button").hidden = !lastOrderCredentials() &&
    !activeOrderCredentials;

  // Optional customer-accounts module (src/users.js).
  const usersOn = data.users_module === true;

  $("account-link").hidden = !usersOn;
  $("account-button").hidden = !usersOn;
  $("menu-account").hidden = !usersOn;

  renderFilterCategories();

  configurePopup();
}

async function initializeStore() {
  $("boot-error").hidden = true;
  $("products").setAttribute("aria-busy", "true");

  try {
    const data = await api("/api/bootstrap");
    applyBootstrap(data);
    await loadProducts();

    if (pendingCheckout) {
      // A separate control makes retry possible even if ordering was
      // disabled after the original request reached the server.
      let retry = $("retry-pending-order");

      if (!retry) {
        retry = document.createElement("button");
        retry.id = "retry-pending-order";
        retry.className = "wide";
        retry.style.marginTop = "18px";
        retry.textContent = "بررسی درخواست سفارش قبلی";
        $("main").prepend(retry);
      }

      retry.onclick = beginCheckout;

      toast("یک درخواست سفارش با نتیجه نامشخص دارید؛ قبل از سفارش جدید آن را بررسی کنید.");
    } else {
      // No unresolved request (or it expired): never keep a stale button.
      $("retry-pending-order")?.remove();
    }
  } catch (error) {
    $("boot-error").hidden = false;
    $("boot-error-text").textContent =
      "Store initialization failed: " + error.message;
    $("products").innerHTML =
      '<div class="empty">فروشگاه در حال حاضر بارگذاری نشد.</div>';
    $("products").setAttribute("aria-busy", "false");
  }
}

$("reload-button").onclick = () => location.reload();

window.addEventListener("storage", event => {
  if (event.key === STORAGE.cart && !checkoutBusy) {
    cart = readCart();
    updateCartBadge();
    if ($("cart-dialog").open) renderCart();
    refreshCheckoutSummary();
  }

  if (event.key === STORAGE.lastOrder) {
    $("last-order-button").hidden = !lastOrderCredentials() &&
      !activeOrderCredentials;
  }
});

updateCartBadge();
initializeStore();

})();
</script>
</body>
</html>`;