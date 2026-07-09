import { writeFileSync } from 'node:fs';

/* ── Shared isometric construction system ─────────────────────────────
   True 2:1 isometric. One projection, one light source (top-left), flat
   3-tone shading per solid. Token palette only. viewBox 640×480 (4:3, the
   card render ratio), scene centered at (320,248). Everything transparent. */

const U = 30;                  // tile unit → controls scale
const CX = 320, CY = 250;

function P(x, y, z = 0) {
  return [ (x - y) * U, (x + y) * U * 0.5 - z * U ];
}
const f = (n) => Math.round(n * 100) / 100;
const poly = (pts, fill, stroke = 'none', sw = 0, extra = '') =>
  `<polygon points="${pts.map(p => `${f(p[0])},${f(p[1])}`).join(' ')}" fill="${fill}"${stroke !== 'none' ? ` stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"` : ''}${extra}/>`;

// Token tones — {top(lit), left(mid, down-left), right(dark, down-right)}
const T = {
  teal:   { t: '#83B7C2', l: '#5C9EAD', r: '#4B8391' },
  slate:  { t: '#4E7E8F', l: '#326273', r: '#284E5B' },
  ink:    { t: '#2E5866', l: '#1F4452', r: '#15323B' },
  coral:  { t: '#EDAB8E', l: '#E39774', r: '#CC7C5A' },
  gold:   { t: '#E7BA5D', l: '#D9A441', r: '#BC8930' },
  paper:  { t: '#FFFFFF', l: '#FBF7F5', r: '#EDE7E2' },
};
const INK = '#1F4452';
const LINE = '#E5DCD6';
const edge = (o = 0.55) => `rgba(31,68,82,${o})`;

/* A cuboid footprint [x..x+w]×[y..y+d], base z0, height h. Draws right,
   left, then top so overlap is correct. */
function box(x, y, w, d, h, tone, z0 = 0, ew = 1.2) {
  const z1 = z0 + h;
  const top = [P(x, y, z1), P(x + w, y, z1), P(x + w, y + d, z1), P(x, y + d, z1)];
  const left = [P(x, y + d, z1), P(x + w, y + d, z1), P(x + w, y + d, z0), P(x, y + d, z0)];
  const right = [P(x + w, y, z1), P(x + w, y + d, z1), P(x + w, y + d, z0), P(x + w, y, z0)];
  return (
    poly(left, tone.l, edge(0.5), ew) +
    poly(right, tone.r, edge(0.5), ew) +
    poly(top, tone.t, edge(0.6), ew)
  );
}

/* Flat document/card lying on a surface: a thin box whose top face carries
   ruled lines. Good for invoices/receipts. */
function sheet(x, y, w, d, tone, z0 = 0, opts = {}) {
  const th = opts.th ?? 0.12;
  let s = box(x, y, w, d, th, tone, z0, 1);
  const z = z0 + th;
  const rules = opts.rules ?? 3;
  const inset = 0.28;
  for (let i = 1; i <= rules; i++) {
    const yy = y + (d * i) / (rules + 1);
    const a = P(x + inset, yy, z), b = P(x + w - inset, yy, z);
    const len = opts.short && i === rules ? 0.5 : 1;
    const bx = P(x + inset + (w - 2 * inset) * len, yy, z);
    s += `<line x1="${f(a[0])}" y1="${f(a[1])}" x2="${f((opts.short && i === rules ? bx : b)[0])}" y2="${f((opts.short && i === rules ? bx : b)[1])}" stroke="${edge(0.32)}" stroke-width="1.4" stroke-linecap="round"/>`;
  }
  if (opts.corner) { // coral corner tab (focal)
    const c = [P(x + w - 0.6, y, z), P(x + w, y, z), P(x + w, y + 0.6, z)];
    s += poly(c, T.coral.l, 'none', 0);
  }
  return s;
}

/* Iso disc (ellipse) for coins / node platforms. */
function disc(cx, cy, r, fill, stroke = edge(0.5), sw = 1.2) {
  const c = P(cx, cy, 0);
  return `<ellipse cx="${f(c[0])}" cy="${f(c[1])}" rx="${f(r * U)}" ry="${f(r * U * 0.5)}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
}

/* Coin stack at grid (x,y), n coins, gold by default. */
function coins(x, y, n, tone = T.gold) {
  let s = '';
  const r = 0.62, th = 0.14;
  for (let i = 0; i < n; i++) {
    const z = i * th;
    const cTop = P(x, y, z + th), cBot = P(x, y, z);
    // side band
    s += `<path d="M ${f(cTop[0] - r * U)} ${f(cTop[1])} A ${f(r * U)} ${f(r * U * 0.5)} 0 0 0 ${f(cTop[0] + r * U)} ${f(cTop[1])} L ${f(cBot[0] + r * U)} ${f(cBot[1])} A ${f(r * U)} ${f(r * U * 0.5)} 0 0 1 ${f(cBot[0] - r * U)} ${f(cBot[1])} Z" fill="${tone.r}" stroke="${edge(0.4)}" stroke-width="1"/>`;
    s += `<ellipse cx="${f(cTop[0])}" cy="${f(cTop[1])}" rx="${f(r * U)}" ry="${f(r * U * 0.5)}" fill="${tone.t}" stroke="${edge(0.5)}" stroke-width="1.1"/>`;
  }
  return s;
}

/* Business node: hex-ish pedestal (small box) + teal disc cap. */
function node(x, y, tone = T.slate, opts = {}) {
  const w = opts.w ?? 1, h = opts.h ?? 0.9;
  let s = box(x, y, w, w, h, tone, 0, 1.2);
  const capTone = opts.cap ?? T.teal;
  const cx = x + w / 2, cy = y + w / 2;
  s += disc(cx, cy, w * 0.42, capTone.t);
  if (opts.tick) { // verified ✓
    const p = P(cx, cy, h + 0.02);
    s += `<path d="M ${f(p[0] - 5)} ${f(p[1])} l 3 3 l 6 -7" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  return { svg: s, top: P(cx, cy, h), mid: P(cx, cy, h * 0.5) };
}

/* Floating chip/tag (small iso diamond plate) with text — coral focal. */
function tag(x, y, z, text, tone = T.coral) {
  const w = 1.5, d = 0.9;
  const top = [P(x, y, z), P(x + w, y, z), P(x + w, y + d, z), P(x, y + d, z)];
  const c = P(x + w / 2, y + d / 2, z);
  return (
    poly([P(x, y + d, z), P(x + w, y + d, z), P(x + w, y + d, z - 0.14), P(x, y + d, z - 0.14)], tone.r) +
    poly([P(x + w, y, z), P(x + w, y + d, z), P(x + w, y + d, z - 0.14), P(x + w, y, z - 0.14)], tone.r) +
    poly(top, tone.t, edge(0.4), 1) +
    `<text x="${f(c[0])}" y="${f(c[1] + 3)}" text-anchor="middle" font-family="Geist, system-ui, sans-serif" font-size="12" font-weight="800" fill="${INK}" transform="skewX(-26.57) scale(1,0.92)" transform-origin="${f(c[0])} ${f(c[1])}">${text}</text>`
  );
}

/* Iso connector line p1→p2 (screen points), dashed, optional coral + arrow. */
function link(p1, p2, { coral = false, dash = true, arrow = true } = {}) {
  const col = coral ? T.coral.l : edge(0.5);
  let s = `<line x1="${f(p1[0])}" y1="${f(p1[1])}" x2="${f(p2[0])}" y2="${f(p2[1])}" stroke="${col}" stroke-width="${coral ? 2.6 : 2}"${dash ? ' stroke-dasharray="2 5"' : ''} stroke-linecap="round"/>`;
  if (arrow) {
    const ang = Math.atan2(p2[1] - p1[1], p2[0] - p1[0]);
    const a = 8;
    const a1 = [p2[0] - a * Math.cos(ang - 0.4), p2[1] - a * Math.sin(ang - 0.4)];
    const a2 = [p2[0] - a * Math.cos(ang + 0.4), p2[1] - a * Math.sin(ang + 0.4)];
    s += poly([p2, a1, a2], col);
  }
  return s;
}

/* Soft ground shadow ellipse under the composition. */
function shadow(cx, cy, rx, ry = null) {
  const c = P(cx, cy, 0);
  return `<ellipse cx="${f(c[0])}" cy="${f(c[1] + 6)}" rx="${rx}" ry="${ry ?? rx * 0.34}" fill="rgba(31,68,82,0.08)"/>`;
}

function svg(body, title) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 480" width="640" height="480" fill="none" role="img" aria-label="${title}">
<title>${title}</title>
<g transform="translate(${CX},${CY})">
${body}
</g>
</svg>
`;
}

/* ── The 9 illustrations ─────────────────────────────────────────────── */
const OUT = 'D:/phase1-main/public/isometric';
const scenes = {};

// 1. loop-supply — invoice hero flowing into an early-payment node and back
scenes['loop-supply'] = () => {
  let s = shadow(0.2, 0.4, 150);
  // base platform
  s += box(-2.4, -2.4, 4.8, 4.8, 0.3, T.paper, -0.3, 1);
  // invoice hero centered-left
  s += sheet(-1.9, -1.4, 1.9, 2.4, T.paper, 0.02, { rules: 4, short: true, corner: true });
  // coral early-pay node (right)
  const n = node(1.0, 0.2, T.slate, { cap: T.coral });
  s += n.svg;
  s += coins(1.15, -1.5, 3);
  // loop arrows: invoice → node → back
  s += link(P(-0.1, -0.3, 0.3), P(1.0, 0.1, 0.9), { coral: true });
  s += link(P(1.5, 1.2, 0.9), P(-0.9, 1.0, 0.3), { coral: false });
  s += tag(-1.3, 1.6, 0.5, 'EARLY', T.coral);
  return svg(s, 'Supply loop: an invoice financed early and returned as working capital');
};

// 2. supply-receivable — invoice that remembers how it's paid (docked proofs)
scenes['supply-receivable'] = () => {
  let s = shadow(0, 0.3, 150);
  s += box(-2.2, -2.2, 4.4, 4.4, 0.3, T.paper, -0.3, 1);
  // invoice hero
  s += sheet(-1.6, -1.7, 2.2, 2.8, T.paper, 0.02, { rules: 5, short: true });
  // docked proof tokens climbing up-right: quote, approval(✓ coral), receipt
  const q = node(1.2, -1.2, T.teal, { w: 0.7, h: 0.5 });
  const a = node(1.2, 0.0, T.slate, { w: 0.7, h: 0.5, cap: T.coral, tick: true });
  const r = node(1.2, 1.2, T.teal, { w: 0.7, h: 0.5 });
  s += q.svg + a.svg + r.svg;
  s += link(P(0.6, -0.9, 0.3), P(1.2, -1.0, 0.5), { dash: true, arrow: false });
  s += link(P(0.6, 0.2, 0.3), P(1.2, 0.2, 0.5), { dash: true, arrow: false });
  s += link(P(0.6, 1.1, 0.3), P(1.2, 1.2, 0.5), { dash: true, arrow: false });
  return svg(s, 'A receivable: an invoice that carries its own settlement history');
};

// 3. supply-early-offer — buyer offers early payment at a discount
scenes['supply-early-offer'] = () => {
  let s = shadow(0, 0.3, 155);
  s += box(-2.6, -2.6, 5.2, 5.2, 0.3, T.paper, -0.3, 1);
  const buyer = node(-2.0, -0.5, T.slate);
  const supplier = node(1.6, 0.6, T.teal);
  s += buyer.svg;
  // invoice between them
  s += sheet(-0.7, -0.7, 1.5, 1.9, T.paper, 0.02, { rules: 3, short: true, corner: true });
  s += supplier.svg;
  s += link(buyer.top, P(-0.3, -0.5, 0.4), { coral: true });
  s += link(P(0.9, 1.0, 0.4), supplier.mid, { coral: false });
  s += tag(-0.2, 1.7, 0.5, '−2%', T.coral);
  return svg(s, 'Early offer: a buyer offers early payment at a discount');
};

// 4. wc-receivable-1 — KYB-verified counterparty pair
scenes['wc-receivable-1'] = () => {
  let s = shadow(0, 0.3, 150);
  s += box(-2.4, -2.4, 4.8, 4.8, 0.3, T.paper, -0.3, 1);
  const a = node(-1.7, -0.2, T.slate, { tick: true, cap: T.teal });
  const b = node(1.0, 0.2, T.slate, { tick: true, cap: T.teal });
  s += a.svg + b.svg;
  s += link(a.top, b.top, { coral: true, dash: false, arrow: false });
  // both verified badges
  s += tag(-0.4, -1.9, 0.6, 'KYB', T.coral);
  return svg(s, 'Two KYB-verified businesses linked on Splash');
};

// 5. wc-receivable-2 — invoice accumulating settlement history (stacked evidence)
scenes['wc-receivable-2'] = () => {
  let s = shadow(0, 0.4, 150);
  s += box(-2.2, -2.2, 4.4, 4.4, 0.3, T.paper, -0.3, 1);
  // stacked evidence layers rising
  s += sheet(-1.2, -1.2, 2.2, 2.6, T.teal, 0.0, { rules: 2 });
  s += sheet(-1.0, -1.0, 2.2, 2.6, T.paper, 0.5, { rules: 3 });
  s += sheet(-0.8, -0.8, 2.2, 2.6, T.paper, 1.0, { rules: 4, short: true, corner: true });
  s += tag(0.6, 1.5, 1.2, 'PROOF', T.coral);
  return svg(s, 'An invoice accumulating its own settlement history');
};

// 6. wc-receivable-3 — buyer reads the history directly, no lender
scenes['wc-receivable-3'] = () => {
  let s = shadow(0, 0.3, 150);
  s += box(-2.4, -2.4, 4.8, 4.8, 0.3, T.paper, -0.3, 1);
  // invoice with proof
  s += sheet(-1.9, -1.2, 1.9, 2.4, T.paper, 0.02, { rules: 4, short: true, corner: true });
  // buyer node with a "lens" disc reading it
  const buyer = node(1.2, 0.2, T.slate, { cap: T.teal });
  s += buyer.svg;
  s += disc(0.2, -0.2, 0.5, 'rgba(92,158,173,0.22)', T.teal.l, 1.4); // reading lens
  s += link(buyer.mid, P(0.2, -0.2, 0.3), { coral: true, dash: true, arrow: true });
  return svg(s, 'The buyer reads the invoice history directly — no lender between');
};

// 7. wc-discount-1 — buyer offers early payment ("early" coral tag)
scenes['wc-discount-1'] = () => {
  let s = shadow(0, 0.3, 150);
  s += box(-2.4, -2.4, 4.8, 4.8, 0.3, T.paper, -0.3, 1);
  const buyer = node(-1.8, -0.3, T.slate);
  s += buyer.svg;
  s += sheet(0.2, -0.7, 1.6, 2.0, T.paper, 0.02, { rules: 3, short: true, corner: true });
  s += link(buyer.top, P(0.4, -0.4, 0.4), { coral: true });
  s += tag(-0.7, 1.6, 0.5, 'EARLY', T.coral);
  return svg(s, 'Buyer offers early payment on the invoice');
};

// 8. wc-discount-2 — supplier accepts a discount (slider/tag on invoice)
scenes['wc-discount-2'] = () => {
  let s = shadow(0, 0.3, 150);
  s += box(-2.4, -2.4, 4.8, 4.8, 0.3, T.paper, -0.3, 1);
  s += sheet(-1.6, -1.0, 2.2, 2.6, T.paper, 0.02, { rules: 4, short: true });
  const supplier = node(1.5, 0.7, T.teal, { tick: true });
  s += supplier.svg;
  // discount slider on the invoice (coral knob)
  const a = P(-1.2, 1.3, 0.16), b = P(0.3, 1.3, 0.16), knob = P(-0.4, 1.3, 0.16);
  s += `<line x1="${f(a[0])}" y1="${f(a[1])}" x2="${f(b[0])}" y2="${f(b[1])}" stroke="${edge(0.4)}" stroke-width="3" stroke-linecap="round"/>`;
  s += `<circle cx="${f(knob[0])}" cy="${f(knob[1])}" r="6" fill="${T.coral.l}" stroke="#fff" stroke-width="1.6"/>`;
  s += tag(0.7, -1.7, 0.6, 'ACCEPT', T.coral);
  return svg(s, 'Supplier accepts a discount on the invoice');
};

// 9. wc-discount-3 — both settle directly, absent-lender space shown
scenes['wc-discount-3'] = () => {
  let s = shadow(0, 0.3, 158);
  s += box(-2.7, -2.7, 5.4, 5.4, 0.3, T.paper, -0.3, 1);
  const buyer = node(-2.0, -0.3, T.slate);
  const supplier = node(1.7, 0.6, T.teal);
  s += buyer.svg + supplier.svg;
  // direct settlement coins flowing
  s += coins(-0.3, 0.1, 3);
  s += link(buyer.top, P(-0.3, -0.2, 0.5), { coral: true, dash: false });
  s += link(P(0.3, 0.6, 0.5), supplier.mid, { coral: true, dash: false });
  // absent-lender: a dashed empty ring above the middle
  const mid = P(-0.15, 0.15, 2.0);
  s += `<circle cx="${f(mid[0])}" cy="${f(mid[1])}" r="15" fill="none" stroke="${edge(0.32)}" stroke-width="1.6" stroke-dasharray="3 5"/>`;
  s += `<line x1="${f(mid[0] - 9)}" y1="${f(mid[1] - 9)}" x2="${f(mid[0] + 9)}" y2="${f(mid[1] + 9)}" stroke="${edge(0.3)}" stroke-width="1.6"/>`;
  s += tag(-1.0, 1.8, 0.5, 'DIRECT', T.coral);
  return svg(s, 'Both sides settle directly — no third-party lender');
};

let count = 0;
for (const [name, gen] of Object.entries(scenes)) {
  const out = gen();
  writeFileSync(`${OUT}/${name}.svg`, out);
  count++;
}
console.log(`wrote ${count} isometric SVGs to ${OUT}`);
