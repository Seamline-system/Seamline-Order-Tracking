// Customer portal. Customers only ever see their own published document.
import { CLOUD } from './db.js';
import { getDoc, getPortalDoc, sendInbox, watch, customerClient } from './publicstore.js';
import { friendly } from './cloud.js';
import { esc, money, int, fmtDate, fmtDateTime, badge, table, toast, formModal, modal, initials, fieldHtml, readForm, readImage } from './ui.js';
import { trackingHtml, quoteCustomerHtml, quoteRespond, catalogueCard, openMockup, withMockups } from './shared.js';
import { downloadPdf } from './pdf.js';
import { notifyTeam } from './email.js';

const SESSION = 'seamline.customer';
const BASKET = 'seamline.basket';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
let doc = null, catalogue = null, actions = {}, lastJson = '', company = {}, teamCfg = null;

const NAV = [['dashboard', 'Dashboard'], ['new-order', 'New order'], ['request-quote', 'Request a quote'], ['orders', 'Orders'], ['quotes', 'Quotes'], ['products', 'My products'], ['reorder', 'Reorder'], ['invoices', 'Invoices'], ['payments', 'Payments'], ['profile', 'Company profile'], ['support', 'Support']];
const TYPES = ['T-shirt', 'Polo', 'Hoodie', 'Cap', 'Bottle', 'Bag', 'Uniform', 'Promotional merchandise', 'Custom product', 'Other'];
const METHODS = ['Screen printing', 'Embroidery', 'DTF print', 'Sublimation', 'Woven label / tags', 'Not sure yet', 'No customization'];
const isDraft = o => o.view.state === 'Draft';
const orderBadge = o => (isDraft(o) ? badge('Awaiting confirmation', 'warn') : ['Cancelled', 'Completed'].includes(o.view.state) ? badge(o.view.state) : esc(o.view.headline));
const basket = () => { try { return JSON.parse(sessionStorage.getItem(BASKET)) || []; } catch { return []; } };
const setBasket = b => sessionStorage.setItem(BASKET, JSON.stringify(b));
const head = (title, sub = '') => `<div class="page-head"><div><h1>${esc(title)}</h1>${sub ? `<p class="sub">${sub}</p>` : ''}</div></div>`;
const panel = (title, body, extra = '') => `<section class="panel">${title ? `<header><h2>${esc(title)}</h2>${extra ? `<div class="panel-actions">${extra}</div>` : ''}</header>` : ''}${body}</section>`;
const hideLoader = () => { const l = document.getElementById('loader'); if (l && !l.classList.contains('done')) { l.classList.add('done'); setTimeout(() => l.remove(), 700); } };
const wa = () => String(company.whatsapp || '').replace(/\D/g, '');
async function send(kind, payload) {
  await sendInbox(kind, CLOUD ? payload : { ...payload, customerId: doc.customer.id });
  teamEmail(kind, payload);
}
// Email the team about what the customer just did (if EmailJS is set up).
function teamEmail(kind, p) {
  const who = doc.customer.name, staff = new URL('index.html', location.href).href;
  const lines = arr => arr.filter(Boolean).join('\n');
  let ev = null, subject = '', body = '';
  if (kind === 'bulk_request' && p.mode === 'order') {
    ev = 'portalOrders'; subject = `New portal order from ${who}`;
    body = lines([`${who} placed a new order in the customer portal.`, '', ...p.items.map(i => `• ${i.qty} × ${i.name}${i.custom ? ' (custom — needs pricing)' : ''}`), p.requiredDate && `\nNeeded by: ${p.requiredDate}`, p.reference && `PO / reference: ${p.reference}`, p.note && `Note: ${p.note}`, '', `Review and confirm it in Seamline → Orders: ${staff}#/orders`]);
  } else if (kind === 'bulk_request' && p.mode === 'quote') {
    ev = 'quoteRequests'; subject = `New quote request ${p.clientRef} from ${who}`;
    body = lines([`${who} requested a quote in the customer portal.`, '', `Product: ${p.productType}${p.quantity ? ` · ${p.quantity} units` : ''}`, p.requiredDate && `Needed by: ${p.requiredDate}`, p.customization && `Customization: ${p.customization}`, p.reference && `Reference: ${p.reference}`, p.requirements && `\nRequirements:\n${p.requirements}`, '', `Open Seamline → Leads: ${staff}#/leads`]);
  } else if (kind === 'reorder') {
    ev = 'portalOrders'; subject = `Reorder request from ${who}`;
    body = lines([`${who} sent a reorder request.`, '', ...p.lines.map(l => `• ${l.qty} × ${(doc.library.find(x => x.id === l.customerProductId) || {}).name || 'product'}`), p.note && `\nNote: ${p.note}`, '', `Open Seamline → Reorders: ${staff}#/reorders`]);
  } else if (kind === 'support') {
    ev = 'messages'; subject = `Message from ${who}${p.about ? ` about ${p.about}` : ''}`;
    body = lines([`${who} sent a message from the customer portal:`, '', p.message, '', `Reply by email or WhatsApp. Customer: ${doc.customer.email || doc.customer.portalEmail}${doc.customer.whatsapp || doc.customer.phone ? `, ${doc.customer.whatsapp || doc.customer.phone}` : ''}`]);
  } else if (kind === 'profile') {
    ev = 'messages'; subject = `${who} updated their contact details`;
    body = lines([`${who} updated their contact details in the portal:`, '', ...Object.entries(p).map(([k, v]) => `${k}: ${v}`)]);
  }
  const where = { portalOrders: kind === 'reorder' ? 'reorders' : 'orders', quoteRequests: 'leads', messages: 'customers' }[ev];
  if (ev) notifyTeam(teamCfg, ev, subject, body, `${staff}#/${where}`);
}

// ---------- sign in ----------
function authCard(inner) {
  document.body.className = 'auth-body';
  document.getElementById('app').innerHTML = `<main class="auth"><section class="auth-card"><img class="auth-logo" src="assets/logo-black.png" alt="Seamline">${inner}
    <p class="small muted auth-links">No login yet? <a href="quote-request.html">Request a quote</a> · every order also has its own tracking link.</p></section></main>`;
  hideLoader();
}
function loginScreen(message = '') {
  authCard(`<h1>Customer portal</h1><p class="muted">Track orders, approve quotes, reorder and download invoices.</p>
    ${message ? `<p class="callout info small">${esc(message)}</p>` : ''}
    <form id="login" class="form-grid one" novalidate>
      <div class="field full"><label for="ce">Email</label><input id="ce" name="email" type="email" autocomplete="username" required></div>
      <div class="field full"><label for="cp">Password</label><input id="cp" name="password" type="password" autocomplete="current-password" required></div>
      <p class="form-error full" role="alert" hidden></p>
      <button class="btn primary full" type="submit">Sign in</button>
    </form>${CLOUD ? '<p class="small"><a href="#" id="forgot">Forgot password?</a></p>' : ''}`);
  const f = $('#login'), err = $('.form-error');
  $('#forgot')?.addEventListener('click', e => { e.preventDefault(); formModal({ title: 'Reset password', intro: 'We will email you a link to choose a new password.', fields: [{ name: 'email', label: 'Email', type: 'email', required: true }], submitLabel: 'Send link', onSubmit: async v => { const { error } = await customerClient().auth.resetPasswordForEmail(v.email.trim(), { redirectTo: location.href.split('#')[0] }); if (error) throw new Error(friendly(error)); toast('Check your email for the reset link'); } }); });
  f.addEventListener('submit', async e => {
    e.preventDefault(); err.hidden = true;
    const b = f.querySelector('button'); b.disabled = true;
    try {
      const email = f.elements.email.value.trim().toLowerCase(), pw = f.elements.password.value;
      if (CLOUD) { const { error } = await customerClient().auth.signInWithPassword({ email, password: pw }); if (error) throw new Error(friendly(error)); }
      else { const S = await import('./services.js'); await S.customerLogin(email, pw); sessionStorage.setItem(SESSION, email); }
      await enter();
    } catch (ex) { err.textContent = ex.message; err.hidden = false; b.disabled = false; }
  });
  f.elements.email.focus();
}
function recoveryScreen() {
  authCard(`<h1>Choose a new password</h1><form id="rec" class="form-grid one" novalidate><div class="field full"><label for="np">New password (min 8 characters)</label><input id="np" type="password" autocomplete="new-password" required></div><p class="form-error full" role="alert" hidden></p><button class="btn primary full" type="submit">Save password</button></form>`);
  $('#rec').addEventListener('submit', async e => {
    e.preventDefault();
    const pw = $('#np').value, err = $('.form-error');
    if (pw.length < 8) { err.textContent = 'Passwords need at least 8 characters.'; err.hidden = false; return; }
    const { error } = await customerClient().auth.updateUser({ password: pw });
    if (error) { err.textContent = friendly(error); err.hidden = false; return; }
    toast('Password saved'); history.replaceState(null, '', location.pathname); enter();
  });
}
async function signOut() {
  sessionStorage.removeItem(SESSION); doc = null; location.hash = '';
  if (CLOUD) await customerClient().auth.signOut();
  loginScreen();
}
async function loadDoc() {
  if (CLOUD) return getPortalDoc();
  const email = sessionStorage.getItem(SESSION);
  return email ? getPortalDoc(email) : null;
}
async function enter() {
  const d = await loadDoc();
  if (!d) {
    if (CLOUD) await customerClient().auth.signOut();
    sessionStorage.removeItem(SESSION);
    return loginScreen('Your login works, but it is not linked to a customer account yet. Please contact Seamline.');
  }
  doc = d; lastJson = JSON.stringify(d); company = d.company || company;
  shell();
  if (!location.hash || location.hash === '#/' || /access_token/.test(location.hash)) location.hash = '#/dashboard'; else route();
}

// ---------- shell ----------
function shell() {
  document.body.className = 'portal-body';
  document.getElementById('app').innerHTML = `
  <a class="skip" href="#pmain">Skip to content</a>
  <header class="portal-top">
    <img class="portal-logo" src="assets/logo-white.png" alt="${esc(company.company || 'Seamline')}">
    <div class="portal-me"><span class="avatar" aria-hidden="true">${esc(initials(doc.customer.name))}</span><span class="hide-sm">${esc(doc.customer.name)}</span><button type="button" class="btn outline-light sm" id="out">Sign out</button></div>
  </header>
  <nav class="portal-nav" aria-label="Portal">${NAV.map(([k, l]) => `<a href="#/${k}" data-nav="${k}">${l}</a>`).join('')}</nav>
  <main id="pmain" class="portal-main" tabindex="-1"></main>`;
  $('#out').addEventListener('click', signOut);
  hideLoader();
}
function render(html, acts = {}) { const m = $('#pmain'); m.innerHTML = html; actions = acts; m.classList.remove('enter'); void m.offsetWidth; m.classList.add('enter'); }
const pendingNote = '<p class="callout info small">Sent. It appears here as soon as Seamline receives it.</p>';

// ---------- views ----------
function vDashboard() {
  const active = doc.orders.filter(o => ['Confirmed', 'Draft'].includes(o.view.state));
  const waiting = doc.quotes.filter(q => ['Sent', 'Viewed'].includes(q.status));
  const owed = active.reduce((t, o) => t + o.view.balance, 0);
  render(`${head(`Welcome, ${esc((doc.customer.contact || doc.customer.name).split(' ')[0])}`, esc(doc.customer.name))}
    <div class="quick-actions"><a class="btn primary" href="#/new-order">Place a new order</a><a class="btn ghost" href="#/request-quote">Request a quote</a>${doc.library.length ? '<a class="btn ghost" href="#/reorder">Reorder</a>' : ''}</div>
    <div class="stat-row">
      <a class="stat" href="#/orders"><span class="stat-label">Active orders</span><strong class="stat-value">${int(active.length)}</strong></a>
      <a class="stat" href="#/quotes"><span class="stat-label">Quotes to review</span><strong class="stat-value">${int(waiting.length)}</strong></a>
      <a class="stat" href="#/invoices"><span class="stat-label">Balance due</span><strong class="stat-value">${money(owed)}</strong></a>
    </div>
    ${waiting.length ? `<div class="callout info"><strong>You have ${waiting.length} quote${waiting.length === 1 ? '' : 's'} waiting for approval.</strong> <a href="#/quotes/${waiting[0].id}">Review ${esc(waiting[0].number)}</a></div>` : ''}
    <div class="grid-2-1">
      ${panel('Active orders', active.length ? `<ul class="order-cards">${active.map(o => `<li><a href="#/orders/${o.id}"><div><strong>${esc(o.number)}</strong><span>${isDraft(o) ? 'Awaiting confirmation' : esc(o.view.headline)}</span></div><div class="progress sm" aria-hidden="true"><span style="--w:${o.view.percent}%"></span></div><small class="muted">${o.view.expectedAt ? `Expected ${fmtDate(o.view.expectedAt)}` : 'Date to be confirmed'} · ${esc(o.view.paymentStatus)}</small></a></li>`).join('')}</ul>` : '<div class="empty">No active orders right now.</div>')}
      ${panel('Updates', doc.notifications.length ? `<ul class="notif-list">${doc.notifications.map(n => `<li><span>${esc(n.text)}</span><small>${fmtDateTime(n.at)}</small></li>`).join('')}</ul>` : '<div class="empty">No updates yet.</div>')}
    </div>`);
}
function vOrders() {
  render(`${head('Orders', 'Every order with its live status.')}<div class="quick-actions"><a class="btn primary sm" href="#/new-order">New order</a></div>${table([
    { label: 'Order', render: o => `<strong>${esc(o.number)}</strong><br><small class="muted">${fmtDate(o.view.orderDate)}</small>` },
    { label: 'Status', render: orderBadge },
    { label: 'Payment', render: o => badge(o.view.paymentStatus) },
    { label: 'Total', cls: 'num', render: o => (o.view.priceTbc ? '<small class="muted">To be confirmed</small>' : money(o.view.total)) },
  ], doc.orders, { href: o => `#/orders/${o.id}`, empty: 'No orders yet.' })}`);
}
function vOrder(id) {
  const o = doc.orders.find(x => x.id === id);
  if (!o) return render('<div class="empty big">Order not found.</div>');
  render(`<p><a href="#/orders">← All orders</a></p>${isDraft(o) ? `<p class="callout info">Thanks — we received this order. ${o.view.priceTbc ? 'We’ll price your custom items and confirm everything with you shortly.' : 'We’ll check stock and confirm it shortly.'} You’ll see it update here.</p>` : ''}${trackingHtml({ view: o.view, invoice: o.invoice, mockups: o.mockups, company }, { compact: true })}
    ${o.trackingToken && !isDraft(o) ? `<p class="small muted">Share this order’s live tracking page: <a href="track.html?t=${esc(o.trackingToken)}" target="_blank" rel="noopener">open link</a></p>` : ''}`,
  { invoice: () => downloadPdf(withMockups(o.invoice, o.mockups)) });
  bindPdf({ invoice: withMockups(o.invoice, o.mockups) });
  bindMockups(o.mockups);
}
function vQuotes() {
  render(`${head('Quotes', 'Review, download, approve or ask for changes.')}${table([
    { label: 'Quote', render: q => `<strong>${esc(q.number)}</strong><br><small class="muted">${fmtDate(q.createdAt)}</small>` },
    { label: 'Status', render: q => badge(q.status) },
    { label: 'Valid until', render: q => fmtDate(q.validUntil) },
    { label: 'Total', cls: 'num', render: q => money(q.total) },
  ], doc.quotes, { href: q => `#/quotes/${q.id}`, empty: 'No quotes yet.' })}`);
}
function vQuote(id) {
  const q = doc.quotes.find(x => x.id === id);
  if (!q) return render('<div class="empty big">Quote not found.</div>');
  const sent = sessionStorage.getItem(`sl.responded.${q.token}`);
  const view = { ...q, company, pending: !!sent && sent === q.status && ['Sent', 'Viewed'].includes(q.status) };
  render(`<p><a href="#/quotes">← All quotes</a></p>${quoteCustomerHtml(view)}`);
  bindPdf({ quote: withMockups(q.doc, q.mockups) });
  bindMockups(q.mockups);
  $$('[data-quote]').forEach(b => b.addEventListener('click', () => quoteRespond(b.dataset.quote, async (action, message) => {
    await sendInbox('quote_response', { token: q.token, action, message: message || '' });
    sessionStorage.setItem(`sl.responded.${q.token}`, q.status);
    const what = { approve: 'APPROVED', reject: 'declined', changes: 'asked for changes to' }[action];
    notifyTeam(teamCfg, 'quoteResponses', `${doc.customer.name} ${what} quote ${q.number}`, `${doc.customer.name} ${what} quote ${q.number} in the customer portal.${message ? `\n\nTheir message:\n${message}` : ''}`, new URL('index.html#/quotes', location.href).href);
  }, route)));
  if (q.status === 'Sent' && !sessionStorage.getItem(`sl.viewed.${q.token}`)) { sessionStorage.setItem(`sl.viewed.${q.token}`, '1'); sendInbox('quote_response', { token: q.token, action: 'viewed' }).catch(() => {}); }
}
function bindMockups(list) {
  $$('[data-mockup]').forEach(b => b.addEventListener('click', () => openMockup(list[+b.dataset.mockup])));
}
function bindPdf(docs) {
  $$('[data-pdf]').forEach(b => b.addEventListener('click', async () => {
    b.disabled = true;
    try { await downloadPdf(docs[b.dataset.pdf]); toast('PDF downloaded'); } catch (e) { toast(e.message, 'error'); } finally { b.disabled = false; }
  }));
}
function vProducts() {
  render(`${head('My products', 'Products we have made or supplied for you, with your approved specifications.')}
    ${doc.library.length ? `<div class="lib-grid">${doc.library.map(p => `<article class="lib-card">
      ${p.design ? `<img src="${p.design}" alt="Approved design for ${esc(p.name)}">` : `<div class="lib-ph" aria-hidden="true">${esc(initials(p.name))}</div>`}
      <h3>${esc(p.name)}</h3>
      <dl class="kv small">${[['Material', p.material], ['Print method', p.printMethod], ['Specifications', p.specs], ['Size breakdown', p.sizeChart], ['Last order', `${p.lastOrderNumber} · ${int(p.lastQty)} units`], ['Last price', `${money(p.lastPrice)} per unit`], ['Times ordered', p.timesOrdered]].filter(([, v]) => v).map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
    </article>`).join('')}</div><p><a class="btn primary" href="#/reorder">Reorder</a></p>` : '<div class="empty big">Products appear here after your first delivery.</div>'}`);
}
function vReorder() {
  const lib = doc.library;
  render(`${head('Reorder', 'Your previous quantities are filled in. Change what you need and send — we’ll confirm price and timing.')}
    ${lib.length ? panel('New reorder', `<form id="ro" class="reorder-form">${lib.map(p => `<div class="ro-line">
      <div><strong>${esc(p.name)}</strong><small class="muted">Last time ${int(p.lastQty)} at ${money(p.lastPrice)} · ${p.availableNow != null ? (p.availableNow > 0 ? `${int(p.availableNow)} in stock now` : 'Currently out of stock') : 'Made to order'}</small></div>
      <label><span class="sr-only">Quantity for ${esc(p.name)}</span><input type="number" min="0" name="q_${esc(p.id)}" value="${p.lastQty}" inputmode="numeric"></label></div>`).join('')}
      <div class="field full"><label for="ronote">Note</label><textarea id="ronote" name="note" rows="2" placeholder="Changes to sizes, colours or delivery date"></textarea></div>
      <button type="button" class="btn primary" data-act="send">Send reorder request</button></form>`) : '<div class="empty">You can reorder once your first order has been delivered. Meanwhile, <a href="#/new-order">place a new order</a> or <a href="#/request-quote">request a quote</a>.</div>'}
    ${doc.reorders.length ? panel('Previous requests', table([
      { label: 'Request', render: r => `<strong>${esc(r.number)}</strong><br><small class="muted">${fmtDate(r.createdAt)}</small>` },
      { label: 'Items', render: r => `<small>${r.lines.map(l => `${int(l.qty)} × ${esc(l.name)}`).join('<br>')}</small>` },
      { label: 'Status', render: r => r.status === 'Converted' ? badge(`Order ${r.orderNumber || 'created'}`, 'good') : badge(r.status === 'New' ? 'Received' : r.status, r.status === 'New' ? 'info' : undefined) },
    ], doc.reorders)) : ''}`,
  {
    send: async () => {
      const f = $('#ro');
      const lines = lib.map(p => ({ customerProductId: p.id, qty: +f.elements[`q_${p.id}`].value || 0 })).filter(l => l.qty > 0);
      if (!lines.length) throw new Error('Enter a quantity for at least one product.');
      await send('reorder', { lines, note: f.elements.note.value });
      toast('Reorder request sent'); $('#pmain').insertAdjacentHTML('afterbegin', pendingNote);
    },
  });
}
async function vNewOrder() {
  if (!catalogue) { try { catalogue = (await getDoc('catalogue', 'main'))?.products || []; } catch { catalogue = []; } }
  const b = basket();
  const stockTotal = b.filter(x => !x.custom).reduce((t, x) => t + x.qty * x.price, 0);
  const customCount = b.filter(x => x.custom).length;
  const c = doc.customer;
  render(`${head('New order', 'Order ready-stock products at your wholesale price, or custom and branded items made for you — or both in one order.')}
    <div class="order-choice">
      <a class="choice" href="#stock-list"><strong>Ready stock</strong><span>Blank or in-stock products, available now at your wholesale price.</span></a>
      <button type="button" class="choice" data-act="custom"><strong>Custom item</strong><span>Printed, embroidered or made to order. Describe it and add your artwork — we price it before confirming.</span></button>
    </div>
    ${b.length ? panel('Your order', `<ul class="basket">${b.map((x, i) => `<li><span>${int(x.qty)} × ${esc(x.name)}${x.custom ? `<small class="muted"> · custom${x.customization ? `, ${esc(x.customization)}` : ''}${x.images?.length ? ` · ${x.images.length} image${x.images.length === 1 ? '' : 's'}` : ''}</small>` : ''}</span><span>${x.custom ? '<small class="muted">Priced by us</small>' : money(x.qty * x.price)}</span><button type="button" class="icon-btn" data-act="remove" data-i="${i}" aria-label="Remove">×</button></li>`).join('')}</ul>
      <p class="basket-total">${stockTotal ? `Ready stock <strong>${money(stockTotal)}</strong>` : ''}${stockTotal && customCount ? ' + ' : ''}${customCount ? `<strong>${customCount} custom item${customCount === 1 ? '' : 's'}</strong> priced by us` : ''}<small class="muted"> · before delivery and tax</small></p>
      <form id="checkout" class="form-grid">
        ${fieldHtml({ name: 'requiredDate', label: 'Needed by', type: 'date' })}
        ${fieldHtml({ name: 'reference', label: 'Your PO / reference', placeholder: 'Optional' })}
        ${fieldHtml({ name: 'address', label: 'Delivery address', type: 'textarea', rows: 2, full: true }, c.address)}
        ${fieldHtml({ name: 'note', label: 'Note', type: 'textarea', rows: 2, full: true, placeholder: 'Anything we should know' })}
      </form>
      <div class="btn-row"><button type="button" class="btn primary" data-act="place">Place order</button><button type="button" class="btn ghost" data-act="custom">Add a custom item</button><button type="button" class="btn ghost" data-act="clear">Clear</button></div>
      <p class="small muted">${customCount ? 'We’ll price your custom items, check stock and confirm the order with you before anything is made or charged.' : 'We’ll confirm stock, delivery and payment details. Nothing is charged until we confirm.'}</p>`) : ''}
    <h2 class="section-h" id="stock-list">Ready stock</h2>
    <div class="cat-list">${catalogue.map(p => catalogueCard(p, `<button type="button" class="btn primary sm" data-act="add" data-id="${esc(p.id)}">Add to order</button>`)).join('') || '<div class="empty">No ready-stock products are available right now — add a custom item instead.</div>'}</div>`,
  {
    add: el => addModal(catalogue.find(p => p.id === el.dataset.id)),
    custom: () => customModal(),
    remove: el => { const x = basket(); x.splice(+el.dataset.i, 1); setBasket(x); route(); },
    clear: () => { setBasket([]); route(); },
    place: async () => {
      const v = Object.fromEntries(new FormData($('#checkout')));
      const bk = basket();
      if (!bk.length) throw new Error('Add at least one item.');
      const items = bk.map(x => (x.custom
        ? { custom: true, name: x.name, productType: x.productType, qty: x.qty, customization: x.customization, sizes: x.sizes, details: x.details }
        : { variantId: x.variantId, qty: x.qty, name: x.name }));
      const attachments = bk.filter(x => x.custom).flatMap(x => (x.images || []).map(im => ({ ...im, item: x.name })));
      await send('bulk_request', { mode: 'order', items, attachments, requiredDate: v.requiredDate || '', reference: v.reference || '', address: v.address || '', note: v.note || '' });
      setBasket([]);
      const units = bk.reduce((t, x) => t + x.qty, 0);
      render(`<article class="req-card done enter">
        <div class="done-mark" aria-hidden="true"><svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="24"/><path d="M15 27l7 7 15-16"/></svg></div>
        <p class="track-no">Order sent</p><h1>Thank you!</h1>
        <p>We received your order for ${int(units)} units. ${customCount ? 'We’ll price your custom items and confirm everything with you shortly.' : 'We’ll check stock and confirm it shortly.'} It will appear under <a href="#/orders">Orders</a>.</p>
        <div class="btn-row center-row"><a class="btn primary" href="#/orders">View orders</a><a class="btn ghost" href="#/new-order">Order more</a></div></article>`);
      window.scrollTo(0, 0);
    },
  });
}
function customModal() {
  modal({
    title: 'Add a custom item', wide: true,
    body: `<form id="cform" class="form-grid">
      ${fieldHtml({ name: 'productType', label: 'Product type', type: 'select', options: TYPES, required: true, blank: 'Choose' })}
      ${fieldHtml({ name: 'qty', label: 'Quantity', type: 'number', min: 1, required: true, placeholder: 'e.g. 100' })}
      ${fieldHtml({ name: 'name', label: 'Item', full: true, placeholder: 'e.g. Staff polo, navy, logo on left chest', required: true })}
      ${fieldHtml({ name: 'customization', label: 'Customization', type: 'select', options: METHODS, blank: 'Choose' })}
      ${fieldHtml({ name: 'sizes', label: 'Colours & sizes', placeholder: 'e.g. Navy — S 10, M 40, L 40, XL 10' })}
      ${fieldHtml({ name: 'details', label: 'Details', type: 'textarea', rows: 3, full: true, placeholder: 'Fabric, print size and placement, labels, packaging…' })}
      ${fieldHtml({ name: 'files', label: 'Logo, design or reference images', type: 'file', accept: 'image/*', multiple: true, full: true, hint: 'Up to 3 images' })}
    </form><p class="form-error" role="alert" hidden></p>`,
    footer: '<button type="button" class="btn ghost" data-close>Cancel</button><button type="button" class="btn primary" id="cGo">Add to order</button>',
    onMount(el, close) {
      el.querySelector('#cGo').addEventListener('click', async () => {
        const err = el.querySelector('.form-error');
        const v = readForm(el.querySelector('#cform'));
        const fail = m => { err.textContent = m; err.hidden = false; };
        if (!v.productType) return fail('Choose a product type.');
        if (!String(v.name || '').trim()) return fail('Describe the item.');
        const qty = Math.round(+v.qty || 0);
        if (qty < 1) return fail('Enter a quantity.');
        const images = [];
        try { for (const f of (v.files || []).slice(0, 3)) if (f.type.startsWith('image/') && f.type !== 'image/svg+xml') images.push({ name: f.name, dataUrl: await readImage(f, 900) }); }
        catch { return fail('One of the images could not be read. Try a JPG or PNG.'); }
        const b = basket();
        b.push({ custom: true, name: String(v.name).trim(), productType: v.productType, qty, customization: v.customization || '', sizes: v.sizes || '', details: v.details || '', images });
        try { setBasket(b); } catch { return fail('Those images are too large. Try fewer or smaller images.'); }
        close(); toast('Custom item added to your order'); route();
      });
    },
  });
}
function vRequestQuote() {
  const c = doc.customer;
  render(`${head('Request a quote', 'Custom, branded or made-to-order products. We usually reply within one working day.')}
    ${panel('', `<form id="rq" class="form-grid">
      ${fieldHtml({ name: 'productType', label: 'Product type', type: 'select', options: TYPES, required: true, blank: 'Choose' })}
      ${fieldHtml({ name: 'quantity', label: 'Quantity', type: 'number', min: 1, placeholder: 'e.g. 150' })}
      ${fieldHtml({ name: 'requiredDate', label: 'Needed by', type: 'date' })}
      ${fieldHtml({ name: 'customization', label: 'Customization', type: 'select', options: METHODS, blank: 'Choose' })}
      ${fieldHtml({ name: 'reference', label: 'Product reference or link', full: true, placeholder: 'A link, a product you liked, or a previous order number' })}
      ${fieldHtml({ name: 'requirements', label: 'Requirements', type: 'textarea', full: true, rows: 5, placeholder: 'Fabric, colours, sizes and size breakdown, logo placement, packaging, delivery location…' })}
      ${fieldHtml({ name: 'files', label: 'Logos, designs or reference images', type: 'file', accept: 'image/*', multiple: true, full: true, hint: 'Up to 5 images' })}
      <div class="full"><button type="button" class="btn primary" data-act="send">Send request</button></div>
    </form>
    <p class="small muted">We’ll reply to ${esc(c.email || c.portalEmail)}${c.whatsapp || c.phone ? ` or ${esc(c.whatsapp || c.phone)}` : ''}. Your quote will appear under <a href="#/quotes">Quotes</a> for you to approve.</p>`)}
    ${doc.requests?.length ? panel('Your requests', table([
      { label: 'Request', render: r => `<strong>${esc(r.ref || r.number)}</strong><br><small class="muted">${fmtDate(r.createdAt)}</small>` },
      { label: 'What', render: r => `${esc(r.productType || '—')}${r.quantity ? ` · ${int(r.quantity)} units` : ''}` },
      { label: 'Status', render: r => badge(r.status, { Received: 'info', 'Preparing quote': 'warn', 'Quote sent': 'good', Accepted: 'good', Closed: undefined }[r.status]) },
    ], doc.requests)) : ''}`,
  {
    send: async () => {
      const v = readForm($('#rq'));
      if (!v.productType) throw new Error('Choose a product type.');
      const attachments = [];
      for (const f of (v.files || []).slice(0, 5)) if (f.type.startsWith('image/') && f.type !== 'image/svg+xml') attachments.push({ name: f.name, dataUrl: await readImage(f, 900) });
      delete v.files;
      const clientRef = `RQ-${Date.now().toString(36).toUpperCase().slice(-4)}${Math.random().toString(36).slice(2, 4).toUpperCase()}`;
      await send('bulk_request', { mode: 'quote', ...v, attachments, clientRef });
      render(`<article class="req-card done enter">
        <div class="done-mark" aria-hidden="true"><svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="24"/><path d="M15 27l7 7 15-16"/></svg></div>
        <p class="track-no">Request received</p><h1>Thank you!</h1><p>Your reference is</p><p class="big-number">${esc(clientRef)}</p>
        <p>We’ll prepare your quote and it will appear under <a href="#/quotes">Quotes</a>, where you can download the PDF and approve it.</p>
        <div class="btn-row center-row"><a class="btn primary" href="#/dashboard">Back to dashboard</a><a class="btn ghost" href="#/request-quote">Send another request</a></div></article>`);
      window.scrollTo(0, 0);
    },
  });
}
function addModal(p) {
  modal({
    title: `Add ${p.name}`, wide: true,
    body: `<p class="small muted">MOQ ${int(p.moq || 1)} units in total · ${money(p.price)} per unit. Enter quantities per colour and size.</p>
      <div class="table-wrap"><table class="matrix entry"><thead><tr><th>Colour / size</th><th>Available</th><th>Quantity</th></tr></thead><tbody>
      ${p.variants.map(v => `<tr><th scope="row">${esc(v.color)} / ${esc(v.size)}</th><td>${int(v.available)}</td><td><input type="number" min="0" max="${v.available}" data-v="${esc(v.id)}" aria-label="Quantity ${esc(v.color)} ${esc(v.size)}" ${v.available ? '' : 'disabled'}></td></tr>`).join('')}
      </tbody></table></div><p class="form-error" role="alert" hidden></p>`,
    footer: '<button type="button" class="btn ghost" data-close>Cancel</button><button type="button" class="btn primary" id="addGo">Add to request</button>',
    onMount(el, close) {
      el.querySelector('#addGo').addEventListener('click', () => {
        const err = el.querySelector('.form-error');
        const picks = [...el.querySelectorAll('[data-v]')].map(i => ({ v: p.variants.find(x => x.id === i.dataset.v), qty: Math.round(+i.value || 0) })).filter(x => x.qty > 0);
        const sum = picks.reduce((t, x) => t + x.qty, 0);
        const over = picks.find(x => x.qty > x.v.available);
        const already = basket().filter(x => x.productId === p.id).reduce((t, x) => t + x.qty, 0);
        const fail = m => { err.textContent = m; err.hidden = false; };
        if (!sum) return fail('Enter at least one quantity.');
        if (over) return fail(`Only ${over.v.available} available in ${over.v.color} / ${over.v.size}.`);
        if (sum + already < (p.moq || 1)) return fail(`The minimum order for this product is ${p.moq} units in total.`);
        const b = basket();
        picks.forEach(x => { const e = b.find(y => y.variantId === x.v.id); if (e) e.qty += x.qty; else b.push({ productId: p.id, variantId: x.v.id, name: `${p.name} — ${x.v.color} / ${x.v.size}`, qty: x.qty, price: p.price }); });
        setBasket(b); close(); toast(`${sum} units added to your order`); route();
      });
    },
  });
}
function vInvoices() {
  const list = doc.orders.filter(o => o.invoice);
  render(`${head('Invoices')}${table([
    { label: 'Invoice', render: o => `<strong>${esc(o.invoice.number)}</strong><br><small class="muted">${esc(o.number)}</small>` },
    { label: 'Issued', render: o => fmtDate(o.invoice.date) },
    { label: 'Due', render: o => fmtDate(o.invoice.dueAt) },
    { label: 'Total', cls: 'num', render: o => money(o.invoice.totals.total) },
    { label: 'Balance', cls: 'num', render: o => money(o.invoice.totals.balance) },
    { label: 'Status', render: o => badge(o.invoice.status) },
    { label: '', render: o => `<button type="button" class="link-btn" data-act="pdf" data-id="${esc(o.id)}">Download PDF</button>` },
  ], list, { empty: 'No invoices yet.' })}`,
  { pdf: async el => { const o = doc.orders.find(x => x.id === el.dataset.id); await downloadPdf(withMockups(o.invoice, o.mockups)); toast('PDF downloaded'); } });
}
function vPayments() {
  render(`${head('Payments', company.bankDetails ? `Pay by bank transfer: ${esc(company.bankDetails)}` : '')}${table([
    { label: 'Date', render: p => fmtDate(p.at) },
    { label: 'Receipt', render: p => esc(p.number) },
    { label: 'Order', render: p => esc(p.orderNumber) },
    { label: 'Method', render: p => esc(p.method) },
    { label: 'Amount', cls: 'num', render: p => `<strong>${money(p.amount)}</strong>` },
  ], doc.payments, { empty: 'No payments recorded yet.' })}
  <p class="small muted">Paid by bank transfer? Send the slip ${company.email ? `to ${esc(company.email)} ` : ''}${wa() ? 'or on WhatsApp ' : ''}and we’ll update your balance.</p>`);
}
function vProfile() {
  const c = doc.customer;
  render(`${head('Company profile', 'Keep your contact details up to date so deliveries and invoices reach the right person.')}
    ${panel('', `<form id="prof" class="form-grid">
      <div class="field"><label>Company</label><input value="${esc(c.company)}" disabled></div>
      <div class="field"><label>Customer code</label><input value="${esc(c.code)}" disabled></div>
      ${[['contact', 'Contact person'], ['email', 'Email'], ['phone', 'Phone'], ['whatsapp', 'WhatsApp'], ['address', 'Delivery / billing address']].map(([k, l]) => `<div class="field ${k === 'address' ? 'full' : ''}"><label for="p_${k}">${l}</label><input id="p_${k}" name="${k}" value="${esc(c[k])}"></div>`).join('')}
      <div class="full"><button type="button" class="btn primary" data-act="save">Save changes</button></div></form>`)}
    <p class="small muted">Portal login: ${esc(c.portalEmail)}. To change your company name, contact us.${CLOUD ? ' To change your password, sign out and use “Forgot password”.' : ''}</p>`,
  { save: async () => { await send('profile', Object.fromEntries(new FormData($('#prof')))); toast('Changes sent — they appear here once confirmed'); } });
}
function vSupport() {
  render(`${head('Support', 'We’re here to help with orders, artwork, sizing and delivery.')}
    <div class="grid-2">
      ${panel('Contact us', `<ul class="link-list">
        ${wa() ? `<li><div><strong>WhatsApp</strong><p class="muted small">Fastest for quick questions</p></div><a class="btn sm primary" href="https://wa.me/${esc(wa())}" target="_blank" rel="noopener">Chat</a></li>` : ''}
        ${company.email ? `<li><div><strong>Email</strong><p class="muted small">${esc(company.email)}</p></div><a class="btn sm ghost" href="mailto:${esc(company.email)}">Email</a></li>` : ''}
        ${company.phone ? `<li><div><strong>Phone</strong><p class="muted small">${esc(company.phone)}</p></div><a class="btn sm ghost" href="tel:${esc(String(company.phone).replace(/\s/g, ''))}">Call</a></li>` : ''}</ul>`)}
      ${panel('Send a message', `<form id="sup" class="form-grid one">
        <div class="field full"><label for="sorder">About</label><select id="sorder" name="about"><option value="">General question</option>${doc.orders.map(o => `<option>${esc(o.number)}</option>`).join('')}</select></div>
        <div class="field full"><label for="smsg">Message</label><textarea id="smsg" name="msg" rows="4" required></textarea></div>
        <div class="full"><button type="button" class="btn primary" data-act="send">Send message</button></div></form>`)}
    </div>`,
  {
    send: async () => {
      const f = $('#sup'); const msg = f.elements.msg.value.trim();
      if (!msg) throw new Error('Write your message first.');
      await send('support', { about: f.elements.about.value, message: msg });
      toast('Message sent — we’ll get back to you soon'); f.reset();
    },
  });
}

// ---------- router ----------
function route() {
  if (!doc) return;
  const [path] = location.hash.replace(/^#\/?/, '').split('?');
  const [key, id] = (path || 'dashboard').split('/');
  const views = { dashboard: vDashboard, 'new-order': vNewOrder, catalogue: vNewOrder, 'request-quote': vRequestQuote, orders: () => (id ? vOrder(id) : vOrders()), quotes: () => (id ? vQuote(id) : vQuotes()), products: vProducts, reorder: vReorder, invoices: vInvoices, payments: vPayments, profile: vProfile, support: vSupport };
  actions = {};
  try { (views[key] || vDashboard)(); } catch (e) { console.error(e); render(`<div class="empty big">${esc(e.message)}</div>`); }
  const navKey = key === 'catalogue' ? 'new-order' : views[key] ? key : 'dashboard';
  $$('[data-nav]').forEach(a => a.classList.toggle('on', a.dataset.nav === navKey));
  window.scrollTo(0, 0);
  document.title = `${$('#pmain h1')?.textContent || 'Portal'} · ${company.company || 'Seamline'}`;
}
async function refresh() {
  if (!doc || document.querySelector('.modal-backdrop') || document.activeElement?.closest?.('#pmain input, #pmain textarea, #pmain select')) return;
  try {
    const d = await loadDoc(); if (!d) return;
    const j = JSON.stringify(d);
    if (j !== lastJson) { lastJson = j; doc = d; company = d.company || company; catalogue = null; route(); }
  } catch (e) { console.warn(e); }
}

(async () => {
  const app = document.getElementById('app');
  app.addEventListener('click', async e => {
    const el = e.target.closest('[data-act]');
    if (el && actions[el.dataset.act]) {
      e.preventDefault();
      el.disabled = true;
      try { await actions[el.dataset.act](el, e); } catch (ex) { toast(ex.message, 'error'); } finally { el.disabled = false; }
      return;
    }
    const row = e.target.closest('tr[data-href]');
    if (row && !e.target.closest('a, button, input, select')) location.hash = row.dataset.href;
  });
  app.addEventListener('keydown', e => { const row = e.target.closest?.('tr[data-href]'); if (row && e.key === 'Enter') location.hash = row.dataset.href; });
  window.addEventListener('hashchange', route);
  watch(refresh, 20);
  try {
    try { const st = await getDoc('settings', 'main'); company = st?.company || {}; teamCfg = st?.email || null; } catch { company = {}; }
    if (CLOUD) {
      customerClient().auth.onAuthStateChange(ev => { if (ev === 'PASSWORD_RECOVERY') recoveryScreen(); });
      if (/type=recovery/.test(location.hash)) return hideLoader();
      const { data } = await customerClient().auth.getSession();
      if (data.session) await enter(); else loginScreen();
    } else if (sessionStorage.getItem(SESSION)) await enter(); else loginScreen();
  } catch (e) { console.error(e); loginScreen(e.message); }
})();
