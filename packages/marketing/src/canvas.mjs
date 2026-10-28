function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

const baseStyles = `
  * { box-sizing: border-box; }
  html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; }
  body {
    font-family: "Avenir Next", Avenir, ui-sans-serif, -apple-system, BlinkMacSystemFont,
      "Segoe UI", "Noto Sans CJK SC", "Hiragino Sans", sans-serif;
    color: #202321;
    -webkit-font-smoothing: antialiased;
  }
  .grain {
    position: absolute; inset: 0; pointer-events: none; opacity: .11;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 180 180' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' seed='7' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.2'/%3E%3C/svg%3E");
    mix-blend-mode: multiply;
  }
`;

export function screenshotCanvas({ locale, copy, productImage, logoImage, index = 0 }) {
  return `<!doctype html>
  <html lang="${escapeHtml(locale)}">
    <head><meta charset="utf-8"><style>
      ${baseStyles}
      body {
        background:
          radial-gradient(circle at 92% 3%, rgba(128, 143, 119, .11), transparent 27%),
          radial-gradient(circle at 5% 94%, rgba(198, 189, 167, .15), transparent 31%),
          #f5f4ef;
      }
      .brand { position: absolute; left: 50px; top: 31px; display: flex; align-items: center; gap: 11px; font-size: 16px; font-weight: 650; letter-spacing: -.015em; }
      .brand img { width: 34px; height: 34px; border-radius: 9px; box-shadow: 0 8px 20px rgba(25,28,25,.12); }
      .copy { position: absolute; left: 50px; top: 78px; width: 1030px; z-index: 2; }
      h1 { margin: 0; max-width: 1040px; font-family: ${locale === 'zh-CN' ? '"Songti SC", STSong, serif' : '"Iowan Old Style", "Palatino Linotype", Palatino, serif'}; font-size: ${locale === 'zh-CN' ? '47px' : '48px'}; line-height: 1.01; letter-spacing: ${locale === 'zh-CN' ? '-.045em' : '-.04em'}; font-weight: 600; text-wrap: balance; }
      p { margin: 9px 0 0; max-width: 940px; color: #6f756f; font-size: 17px; line-height: 1.4; letter-spacing: -.012em; }
      .copy::after { content: ""; display: block; width: 76px; height: 3px; margin-top: 13px; border-radius: 999px; background: #879481; transform: rotate(-1.2deg); opacity: .7; }
      .folio { position: absolute; right: 52px; top: 38px; color: #8a8f89; font-size: 13px; font-weight: 600; letter-spacing: .13em; }
      .frame { position: absolute; left: 48px; top: 230px; width: 1184px; height: 640px; overflow: hidden; background: #fff; border: 1px solid rgba(92,96,89,.18); border-radius: 20px 20px 0 0; box-shadow: 0 24px 68px rgba(42,43,39,.14); }
      .browser { height: 31px; display: flex; align-items: center; padding: 0 13px; background: #eeede8; border-bottom: 1px solid #deddd7; }
      .dots { display: flex; gap: 6px; }
      .dots i { width: 7px; height: 7px; border-radius: 50%; background: #c4c4bd; }
      .browser-title { position: absolute; left: 50%; transform: translateX(-50%); color: #8b8b84; font-size: 10px; letter-spacing: .01em; }
      .product { display: block; width: 100%; height: auto; min-height: 609px; object-fit: cover; object-position: top center; }
    </style></head>
    <body>
      <div class="brand"><img src="${logoImage}" alt=""><span>${escapeHtml(copy.productName)}</span></div>
      <section class="copy"><h1>${escapeHtml(copy.headline)}</h1><p>${escapeHtml(copy.body)}</p></section>
      <div class="folio">${String(index + 1).padStart(2, '0')} / 05</div>
      <div class="frame"><div class="browser"><span class="dots"><i></i><i></i><i></i></span><span class="browser-title">Bookmark Assistant</span></div><img class="product" src="${productImage}" alt=""></div>
      <div class="grain"></div>
    </body>
  </html>`;
}

export function globalOverviewCanvas({
  productImage,
  logoImage,
  productName = 'Bookmark Assistant',
}) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
    ${baseStyles}
    body { background: radial-gradient(ellipse at 85% 0%, #e7e9e1 0%, transparent 48%), radial-gradient(ellipse at 5% 100%, #e8e3d9 0%, transparent 55%), #f5f4ef; }
    header { position:absolute; inset:28px 48px auto; height:56px; display:flex; align-items:center; justify-content:space-between; }
    .brand { display:flex; align-items:center; gap:14px; font-size:27px; font-weight:650; letter-spacing:-1px; }
    .brand img { width:48px; height:48px; border-radius:12px; box-shadow:0 7px 18px #25292218; }
    .capabilities { display:flex; gap:22px; align-items:center; font-size:15px; color:#697067; letter-spacing:.015em; }
    .capabilities span + span { border-left:1px solid #cbcfc6; padding-left:22px; }
    .frame { position:absolute; left:48px; top:112px; width:1184px; overflow:hidden; border:1px solid #d5d6d0; border-radius:16px; background:white; box-shadow:0 16px 35px #30332a19; }
    .browser { position:relative; height:30px; display:flex; align-items:center; gap:6px; padding:0 13px; background:#eeede8; border-bottom:1px solid #deddd7; }
    .browser i { width:7px; height:7px; background:#c4c4bd; border-radius:50%; }
    .browser span { position:absolute; left:50%; transform:translateX(-50%); font-size:10px; color:#878a82; }
    .product { display:block; width:100%; height:auto; }
  </style></head><body>
    <header><div class="brand"><img src="${logoImage}" alt="">${escapeHtml(productName)}</div><div class="capabilities"><span>Local library</span><span>AI folder suggestions</span></div></header>
    <div class="frame"><div class="browser"><i></i><i></i><i></i><span>${escapeHtml(productName)}</span></div><img class="product" src="${productImage}" alt="Bookmark library with folders, search, descriptions and tags"></div>
    <div class="grain"></div>
  </body></html>`;
}

export function marqueeCanvas({ copy, productImage, logoImage }) {
  const headline = escapeHtml(copy.headline).replace(/\. /, '.<br>');
  return `<!doctype html>
  <html lang="en">
    <head><meta charset="utf-8"><style>
      ${baseStyles}
      body {
        background:
          radial-gradient(circle at 88% 8%, rgba(124, 139, 116, .12), transparent 28%),
          radial-gradient(circle at 8% 92%, rgba(207, 197, 176, .17), transparent 34%),
          #f5f4ef;
      }
      .brand { position: absolute; left: 52px; top: 45px; display: flex; align-items: center; gap: 11px; font-size: 17px; font-weight: 650; letter-spacing: -.018em; }
      .brand img { width: 36px; height: 36px; border-radius: 10px; box-shadow: 0 8px 20px rgba(28,30,27,.12); }
      .copy { position: absolute; left: 52px; top: 116px; width: 380px; }
      h1 { margin: 0; font-family: "Iowan Old Style", "Palatino Linotype", Palatino, serif; font-size: 60px; line-height: .95; letter-spacing: -.052em; font-weight: 600; }
      p { margin: 20px 0 0; width: 355px; color: #656b66; font-size: 18px; line-height: 1.4; letter-spacing: -.015em; }
      .meta { position: fixed; left: 52px; bottom: 101px; color: #858984; font-size: 14px; letter-spacing: .015em; }
      .badge { position: absolute; left: 52px; bottom: 43px; display: inline-flex; align-items: center; gap: 9px; height: 40px; padding: 0 13px; border: 1px solid #d7d7d1; border-radius: 8px; background: rgba(255,255,255,.78); color: #424542; font-size: 12px; font-weight: 600; box-shadow: 0 6px 18px rgba(37,38,35,.05); }
      .badge-mark { display: grid; width: 22px; height: 22px; place-items: center; border-radius: 50%; background: #555955; color: #fff; font-size: 13px; font-weight: 700; }
      .frame { position: absolute; left: 455px; top: 45px; width: 900px; height: 472px; overflow: hidden; background: #fff; border: 1px solid rgba(93,96,89,.17); border-radius: 17px; box-shadow: 0 26px 72px rgba(42,43,39,.14); }
      .browser { height: 30px; display: flex; align-items: center; padding: 0 12px; background: #eeede8; border-bottom: 1px solid #deddd7; }
      .dots { display: flex; gap: 6px; }
      .dots i { width: 7px; height: 7px; border-radius: 50%; background: #c4c4bd; }
      .browser-title { position: absolute; left: 50%; transform: translateX(-50%); color: #8b8b84; font-size: 10px; }
      .product { display: block; width: 100%; height: auto; object-fit: cover; object-position: top center; }
      .thread { position: absolute; right: 45px; top: 25px; width: 94px; height: 1px; background: #7e8b79; transform: rotate(-5deg); opacity: .55; }
    </style></head>
    <body>
      <div class="brand"><img src="${logoImage}" alt=""><span>${escapeHtml(copy.productName)}</span></div>
      <section class="copy"><h1>${headline}</h1><p>${escapeHtml(copy.body)}</p><div class="meta">${escapeHtml(copy.meta)}</div></section>
      <div class="badge"><span class="badge-mark">P</span><span>${escapeHtml(copy.productHunt)}</span></div>
      <div class="frame"><div class="browser"><span class="dots"><i></i><i></i><i></i></span><span class="browser-title">Bookmark Assistant</span></div><img class="product" src="${productImage}" alt=""></div>
      <div class="thread"></div><div class="grain"></div>
    </body>
  </html>`;
}
