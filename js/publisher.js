// ------------------------------------------------------------
// Customer-facing data.
// Customers never read the internal database. After every save, the staff
// app publishes small, customer-safe documents (tracking pages, quotes,
// portal accounts, catalogue). Customers send things back through an
// "inbox" (quote requests, approvals, reorders, messages) which the staff
// app picks up and applies through the normal business rules.
// ------------------------------------------------------------
import * as S from './services.js';
import { db, CLOUD, PUBLIC_KEY, INBOX_KEY } from './db.js';

let last = null;          // key -> JSON string of what is currently published
let writer = null;        // cloud writer (set by cloud.js)
export function setPublicWriter(w, existing) { writer = w; last = existing; }

// Images are stored once per document; PDFs get them back via withMockups().
const noImages = d => (d ? { ...d, mockups: undefined } : d);
const images = r => (r.mockups || []).map(m => m.image);
function orderDoc(o) {
  const c = S.get('customers', o.customerId);
  return { kind: 'order', view: S.publicOrderView(o), invoice: noImages(S.invoiceDoc(o)), mockups: images(o), customerName: S.customerName(c), company: S.companyInfo() };
}
function quotePublic(q) {
  return { kind: 'quote', token: q.token, status: q.status, doc: noImages(S.quoteDoc(q)), mockups: images(q), changeRequests: q.changeRequests || [], orderNumber: q.orderId ? S.get('orders', q.orderId)?.number : null, company: S.companyInfo() };
}
export function catalogueProducts() {
  return db().products.filter(p => p.status === 'Active' && p.kind !== 'Made to order' && S.productVariants(p.id).length).map(p => ({
      id: p.id, name: p.name, sku: p.sku, category: p.category, description: p.description, material: p.material, moq: p.moq, price: p.wholesalePrice, image: p.image || '',
      variants: S.productVariants(p.id).map(v => ({ id: v.id, color: v.color, size: v.size, available: Math.max(0, S.variantStock(v.id).available), low: S.variantStock(v.id).available <= v.reorderLevel })),
    }));
}
const catalogue = () => ({ kind: 'catalogue', products: catalogueProducts() });
function portalDoc(c) {
  const d = db();
  const orders = d.orders.filter(o => o.customerId === c.id && (o.state !== 'Draft' || o.source === 'Portal')).sort((a, b) => (b.confirmedAt || b.createdAt).localeCompare(a.confirmedAt || a.createdAt));
  return {
    kind: 'portal',
    customer: { id: c.id, code: c.code, company: c.company, contact: c.contact, email: c.email, phone: c.phone, whatsapp: c.whatsapp, address: c.address, portalEmail: c.portal.email, name: S.customerName(c) },
    // mockup images only for work in progress, to keep the portal fast
    orders: orders.map(o => ({ id: o.id, number: o.number, view: S.publicOrderView(o), invoice: noImages(S.invoiceDoc(o)), mockups: o.state === 'Confirmed' ? images(o) : [], trackingToken: S.activeToken(o.id)?.token || null })),
    quotes: d.quotes.filter(q => q.customerId === c.id && q.status !== 'Draft').map(q => ({ id: q.id, number: q.number, token: q.token, status: q.status, validUntil: q.validUntil, createdAt: q.sentAt || q.createdAt, total: S.docTotals(q).total, doc: noImages(S.quoteDoc(q)), mockups: ['Sent', 'Viewed', 'Approved'].includes(q.status) ? images(q) : [], changeRequests: q.changeRequests || [] })),
    library: d.customerProducts.filter(p => p.customerId === c.id).map(p => {
      const st = p.fulfilment === 'stock' && p.variantId ? S.variantStock(p.variantId) : null;
      return { id: p.id, name: p.name, specs: p.specs, material: p.material, printMethod: p.printMethod, sizeChart: p.sizeChart || '', design: p.design || '', lastOrderNumber: p.lastOrderNumber, lastQty: p.lastQty, lastPrice: p.lastPrice, timesOrdered: p.timesOrdered, fulfilment: p.fulfilment, availableNow: st ? Math.max(0, st.available) : null };
    }),
    requests: d.leads.filter(l => l.customerId === c.id).slice(0, 30).map(l => ({ number: l.number, ref: l.clientRef || '', createdAt: l.createdAt, productType: l.productType, quantity: l.quantity, status: leadStatus(l) })),
    reorders: d.reorders.filter(r => r.customerId === c.id).map(r => ({ number: r.number, status: r.status, createdAt: r.createdAt, lines: r.lines.map(l => ({ name: l.name, qty: l.qty })), orderNumber: r.orderId ? S.get('orders', r.orderId)?.number : null })),
    payments: d.payments.filter(p => p.customerId === c.id && !p.void).map(p => ({ number: p.number, at: p.at, orderNumber: S.get('orders', p.orderId)?.number, method: p.method, amount: p.amount })),
    notifications: d.notifications.filter(n => n.audience === 'customer' && n.customerId === c.id).slice(0, 30).map(n => ({ at: n.at, text: n.text })),
    company: S.companyInfo(),
  };
}

function leadStatus(l) {
  if (l.lost) return 'Closed';
  const i = S.LEAD_STAGES.indexOf(l.stage);
  if (i >= S.LEAD_STAGES.indexOf('Approved')) return 'Accepted';
  if (i >= S.LEAD_STAGES.indexOf('Quote Sent')) return 'Quote sent';
  if (i >= S.LEAD_STAGES.indexOf('Quote Created')) return 'Preparing quote';
  return 'Received';
}
export function computeDocs() {
  const d = db();
  const docs = {};
  const em = S.emailSettings();
  // Only what the customer pages need to notify the team. The customer-email template ID stays private.
  const publicEmail = em.publicKey && em.serviceId && em.teamTemplate ? { publicKey: em.publicKey, serviceId: em.serviceId, teamTemplate: em.teamTemplate, notify: em.notify } : null;
  docs['settings:main'] = { kind: 'settings', owner: null, data: { kind: 'settings', company: S.companyInfo(), email: publicEmail, ready: !!d.meta.setup } };
  docs['catalogue:main'] = { kind: 'catalogue', owner: null, data: catalogue() };
  for (const t of d.tracking.filter(x => x.active)) {
    const o = S.get('orders', t.orderId);
    if (o && o.state !== 'Draft') docs[`order:${t.token}`] = { kind: 'order', owner: null, data: orderDoc(o) };
  }
  for (const q of d.quotes.filter(x => x.status !== 'Draft' && x.token)) docs[`quote:${q.token}`] = { kind: 'quote', owner: null, data: quotePublic(q) };
  for (const c of d.customers.filter(x => x.portal?.email && x.status !== 'Inactive')) docs[`portal:${c.portal.email}`] = { kind: 'portal', owner: c.portal.email, data: portalDoc(c) };
  return docs;
}

// Publish only what changed since last time.
export async function publish() {
  const docs = computeDocs();
  const next = Object.fromEntries(Object.entries(docs).map(([k, v]) => [k, JSON.stringify(v.data)]));
  if (!CLOUD) {
    const map = Object.fromEntries(Object.entries(docs).map(([k, v]) => [k, v.data]));
    const str = JSON.stringify(map);
    if (localStorage.getItem(PUBLIC_KEY) !== str) { try { localStorage.setItem(PUBLIC_KEY, str); } catch (e) { console.warn('Public docs not saved', e); } }
    last = next;
    return;
  }
  if (!writer || !last) return;
  const upserts = Object.entries(docs).filter(([k]) => last[k] !== next[k]).map(([k, v]) => ({ key: k, kind: v.kind, owner_email: v.owner, data: v.data }));
  const removals = Object.keys(last).filter(k => !(k in next));
  if (!upserts.length && !removals.length) return;
  const prev = last;
  last = next;
  try { await writer(upserts, removals); }
  catch (e) { last = prev; throw e; }
}

// ---------- inbox: things customers send to Seamline ----------
const INBOX_KINDS = ['quote_request', 'quote_response', 'reorder', 'bulk_request', 'support', 'profile'];
function customerFor(item) {
  const d = db();
  if (item.sender_email) return d.customers.find(c => c.portal?.email === String(item.sender_email).toLowerCase()) || null;
  if (!CLOUD && item.payload?.customerId) return S.get('customers', item.payload.customerId) || null;
  return null;
}
// Applies one inbox item. Returns a short description for the activity log.
export function applyInboxItem(item) {
  const p = item.payload || {};
  if (!INBOX_KINDS.includes(item.kind)) throw new Error(`Unknown request type ${item.kind}`);
  if (item.kind === 'quote_request') {
    const l = S.createLead({ ...p, customerId: null, items: [] }, 'Website form');
    return `Quote request ${l.number}`;
  }
  if (item.kind === 'quote_response') {
    const q = S.findQuoteByTokenOnly(p.token);
    if (!q) throw new Error('A customer responded to a quote that no longer exists.');
    if (p.action === 'viewed') { S.markQuoteViewed(q.id); return `Quote ${q.number} viewed`; }
    if (!['approve', 'reject', 'changes'].includes(p.action)) throw new Error('Unknown quote response');
    try { S.respondToQuote(q.id, p.action, p.message || ''); }
    catch (e) { S.notify('quote.error', `Customer response to ${q.number} could not be applied: ${e.message}`, { link: `#/quotes/${q.id}` }); throw e; }
    return `Quote ${q.number}: ${p.action}`;
  }
  const c = customerFor(item);
  if (!c) throw new Error('A portal request came from an account that is no longer linked to a customer.');
  if (item.kind === 'reorder') {
    const r = S.createReorder({ customerId: c.id, lines: p.lines || [], note: p.note || '', source: 'Portal' });
    return `Reorder ${r.number}`;
  }
  if (item.kind === 'bulk_request' && p.mode === 'order') {
    // New order placed in the portal: ready-stock lines at current catalogue prices, plus custom lines
    // that Seamline prices before confirming. Arrives as a draft for staff to check.
    const lines = (p.items || []).slice(0, 40);
    const custom = [];
    const items = lines.map(x => {
      if (x.custom) {
        const name = String(x.name || x.productType || 'Custom item').trim().slice(0, 160);
        const method = String(x.customization || '').slice(0, 60);
        custom.push({ ...x, name });
        return { productId: null, description: method && method !== 'No customization' ? `${name} (${method})` : name, qty: Math.max(1, Math.round(+x.qty || 0)),
          unitPrice: 0, unitCost: 0, fulfilment: 'make', businessType: method && !['No customization', 'Not sure yet'].includes(method) ? 'Customization' : 'Manufacturing' };
      }
      const v = db().variants.find(y => y.id === x.variantId);
      const prod = v && S.get('products', v.productId);
      if (!v || !prod || prod.status !== 'Active') throw new Error('A product in a portal order is no longer available.');
      return { productId: prod.id, variantId: v.id, qty: Math.max(1, Math.round(+x.qty || 0)), unitPrice: prod.wholesalePrice, fulfilment: 'stock' };
    });
    const customNotes = custom.map((x, i) => `Custom item ${i + 1} — ${x.name}, ${Math.round(+x.qty || 0)} units${x.productType ? `, ${x.productType}` : ''}${x.customization ? `, ${x.customization}` : ''}${x.sizes ? `\n  Colours / sizes: ${String(x.sizes).slice(0, 400)}` : ''}${x.details ? `\n  Details: ${String(x.details).slice(0, 800)}` : ''}`);
    const notes = [p.reference && `Customer PO / reference: ${p.reference}`, p.address && `Deliver to: ${p.address}`, p.note, ...customNotes].filter(Boolean).map(x => String(x).slice(0, 1400)).join('\n');
    const o = S.createOrder({ customerId: c.id, items, expectedAt: p.requiredDate || '', customerNotes: notes, internalNotes: `Placed by the customer in the portal — ${custom.length ? 'set prices for the custom items, ' : ''}check stock and confirm.` });
    o.source = 'Portal';
    o.items.forEach(it => { if (it.fulfilment === 'make') it.priceTbc = true; });
    o.attachments = (p.attachments || []).filter(f => f && f.dataUrl).slice(0, 8).map(f => ({ name: String(f.name || 'image').slice(0, 80), dataUrl: f.dataUrl, item: String(f.item || '').slice(0, 160) }));
    S.addOrderNote(o.id, custom.length ? 'Order received — we’ll price your custom items, check stock and confirm it shortly.' : 'Order received — we’ll check stock and confirm it shortly.', true);
    S.notify('order.portal', `New portal order ${o.number} from ${S.customerName(c)}${custom.length ? ` (${custom.length} custom item${custom.length === 1 ? '' : 's'} to price)` : ''} — review and confirm`, { link: `#/orders/${o.id}` });
    return `Portal order ${o.number}`;
  }
  if (item.kind === 'bulk_request' && p.mode === 'quote') {
    const l = S.createLead({ name: c.contact || S.customerName(c), company: c.company, email: c.email || c.portal?.email, phone: c.phone || c.whatsapp,
      productType: p.productType, quantity: p.quantity, requiredDate: p.requiredDate, customization: p.customization, reference: p.reference,
      requirements: p.requirements, attachments: (p.attachments || []).slice(0, 5), customerId: c.id, clientRef: p.clientRef }, 'Portal');
    return `Portal quote request ${l.number}`;
  }
  if (item.kind === 'bulk_request') {
    const l = S.createLead({ name: c.contact || S.customerName(c), company: c.company, email: c.email || c.portal?.email, phone: c.phone || c.whatsapp,
      productType: 'Wholesale ready stock', quantity: (p.items || []).reduce((t, x) => t + (+x.qty || 0), 0), requirements: p.note || '',
      items: (p.items || []).map(x => ({ name: x.name, qty: +x.qty || 0, variantId: x.variantId })), customerId: c.id }, 'Portal');
    return `Bulk order request ${l.number}`;
  }
  if (item.kind === 'support') {
    const msg = String(p.message || '').trim().slice(0, 4000);
    if (!msg) return 'Empty message ignored';
    S.notify('support.message', `Message from ${S.customerName(c)}${p.about ? ` about ${p.about}` : ''}: ${msg.slice(0, 120)}`, { link: `#/customers/${c.id}` });
    S.addCustomerNote(c.id, `Portal message${p.about ? ` (${p.about})` : ''}: ${msg}`);
    return 'Support message';
  }
  if (item.kind === 'profile') {
    const allowed = ['contact', 'email', 'phone', 'whatsapp', 'address'];
    S.saveCustomer({ id: c.id, ...Object.fromEntries(allowed.filter(k => p[k] !== undefined).map(k => [k, String(p[k]).slice(0, 300)])) });
    S.notify('customer.profile', `${S.customerName(c)} updated their contact details`, { link: `#/customers/${c.id}` });
    return 'Profile update';
  }
  return '';
}

// Runs all pending items with a neutral actor, then restores the staff actor.
export async function processInbox(items, removeFn) {
  if (!items.length) return 0;
  const staff = S.getActor();
  let done = 0;
  const handled = [];
  const meta = db().meta;
  meta.inboxSeen = Array.isArray(meta.inboxSeen) ? meta.inboxSeen : [];
  for (const it of items) {
    // Safety net: never apply the same customer request twice.
    const key = String(it.id);
    if (meta.inboxSeen.includes(key)) { handled.push(it.id); continue; }
    meta.inboxSeen.push(key);
    if (meta.inboxSeen.length > 500) meta.inboxSeen.splice(0, meta.inboxSeen.length - 500);
    S.setActor({ id: 'portal', name: it.kind === 'quote_request' ? 'Website form' : 'Customer', role: 'customer', kind: 'customer' });
    try { applyInboxItem(it); done++; }
    catch (e) { console.warn('Inbox item failed', it, e); }
    finally { handled.push(it.id); }
  }
  S.setActor(staff);
  await removeFn(handled);
  return done;
}

// Local mode inbox (same browser).
export function localInboxItems() {
  try { return JSON.parse(localStorage.getItem(INBOX_KEY)) || []; } catch { return []; }
}
export function localInboxRemove(ids) {
  const rest = localInboxItems().filter(x => !ids.includes(x.id));
  localStorage.setItem(INBOX_KEY, JSON.stringify(rest));
}
