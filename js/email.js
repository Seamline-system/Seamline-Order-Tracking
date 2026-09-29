// Email through EmailJS (https://www.emailjs.com) — sends from the browser, no server needed.
// Two EmailJS templates are used:
//   customer template → emails to customers (quotes, invoices, order updates), with an optional PDF
//   team template     → notifications to Seamline (new quote requests, approvals, portal orders…)
import { buildPdf, pdfName } from './pdf.js';
import { baseUrl } from './db.js';

const logoUrl = () => baseUrl() + 'assets/logo-white.png';
const escHtml = t => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// Plain text → safe HTML with line breaks and clickable links (works in Gmail, Outlook and phones).
export const textToHtml = t => escHtml(t).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#0a0a0a;">$1</a>').replace(/\n/g, '<br>');

const API = 'https://api.emailjs.com/api/v1.0/email/send';
export const TEAM_EVENTS = [
  ['quoteRequests', 'New quote requests (website form and portal)'],
  ['quoteResponses', 'Customers approving, declining or asking to change a quote'],
  ['portalOrders', 'New orders and reorders from the customer portal'],
  ['messages', 'Messages and profile changes from the customer portal'],
];

export function emailReady(cfg) { return !!(cfg && cfg.publicKey && cfg.serviceId && cfg.customerTemplate); }
export function teamReady(cfg, event) { return !!(cfg && cfg.publicKey && cfg.serviceId && cfg.teamTemplate && (!event || cfg.notify?.[event] !== false)); }

async function send(cfg, templateId, params) {
  let res;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000); // never leave the app waiting on EmailJS
  try {
    res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ service_id: cfg.serviceId, template_id: templateId, user_id: cfg.publicKey, template_params: params }), signal: ctl.signal });
  } catch (e) { throw new Error(e.name === 'AbortError' ? 'EmailJS did not respond in time. Try again in a moment.' : 'Could not reach EmailJS. Check your internet connection.'); }
  finally { clearTimeout(timer); }
  if (!res.ok) {
    const raw = ((await res.text().catch(() => '')) || `error ${res.status}`).trim();
    const err = m => Object.assign(new Error(m), { raw, status: res.status });
    if (/recipients? address is (empty|corrupted)|recipient/i.test(raw)) throw err(templateId === cfg.teamTemplate
      ? 'EmailJS says the team template has no recipient. In EmailJS, open the team template and type your own email address in the “To Email” field, then save.'
      : 'EmailJS says the customer template has no recipient. In EmailJS, open the customer template and set the “To Email” field to exactly {{to_email}}, then save.');
    if (/variables size|size limit|too large|payload/i.test(raw)) throw err(`EmailJS says the email is too large (“${raw}”). This usually means the customer template has no Variable Attachment named “pdf”, so the PDF is counted as text. Check the template’s Attachments tab (see Settings → Email).`);
    if (/public key|user id|account not found/i.test(raw)) throw err(`EmailJS rejected the public key (“${raw}”). Check Settings → Email.`);
    if (/template/i.test(raw)) throw err(`EmailJS could not use that template (“${raw}”). Check the template ID in Settings → Email.`);
    if (/service/i.test(raw)) throw err(`EmailJS could not use that email service (“${raw}”). Check the service ID, and that the Gmail/Outlook connection is still active in EmailJS.`);
    if (res.status === 429) throw err('EmailJS is limiting how fast emails are sent. Wait a moment and try again.');
    if (/quota|monthly|requests limit|reached the limit/i.test(raw)) throw err(`EmailJS says your monthly limit is reached (“${raw}”). Check your usage in the EmailJS dashboard.`);
    throw err(`EmailJS error: ${raw}`);
  }
  return true;
}

// Email a customer. `doc` (optional) is a quote/invoice document to attach as a PDF.
// Returns { attached: boolean } — the PDF is skipped (the link still works) if it is larger than the plan allows.
export async function emailCustomer(cfg, { to, toName = '', subject, message, doc = null, attach = true, company = {}, link = '', linkLabel = '' }) {
  if (!emailReady(cfg)) throw new Error('Email is not set up yet. Add your EmailJS details in Settings → Email.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(to || '').trim())) throw new Error('Enter a valid email address.');
  const params = {
    to_email: String(to).trim(), email: String(to).trim(), to: String(to).trim(), recipient: String(to).trim(), user_email: String(to).trim(),
    to_name: toName, subject, message, message_html: textToHtml(message),
    from_name: company.company || 'Seamline', reply_to: company.email || '', company_phone: company.phone || '',
    logo_url: logoUrl(), link: link || '', link_label: link ? (linkLabel || 'Open') : '',
    pdf: '', pdf_name: '',
  };
  let attached = false;
  if (doc && attach && cfg.attachPdfs) {
    const pdf = await buildPdf(doc);
    const dataUrl = pdf.output('datauristring');
    const kb = Math.round((dataUrl.length * 3) / 4 / 1024);
    if (kb <= (+cfg.maxAttachKb || 450)) { params.pdf = dataUrl.replace(/^data:application\/pdf;[^,]*,/, 'data:application/pdf;base64,'); params.pdf_name = pdfName(doc); attached = true; }
  }
  try { await send(cfg, cfg.customerTemplate, params); }
  catch (e) {
    // If the PDF is the problem (template not set up for attachments, or too big), send without it — the link still works.
    if (!attached || !/size|limit|attachment|too large|payload/i.test(e.raw || '')) throw e;
    await send(cfg, cfg.customerTemplate, { ...params, pdf: '', pdf_name: '' });
    return { attached: false, attachProblem: e.raw };
  }
  return { attached };
}

// Notify the Seamline team (recipient is fixed inside the EmailJS team template).
export async function notifyTeam(cfg, event, subject, message, link = '') {
  if (!teamReady(cfg, event)) return false;
  try { await send(cfg, cfg.teamTemplate, { subject, message, message_html: textToHtml(message), from_name: 'Seamline', to_name: 'Seamline team', logo_url: logoUrl(), link, link_label: link ? 'Open in Seamline' : '' }); return true; }
  catch (e) { console.warn('Team email not sent', e); return false; }
}

// Tests each template separately and reports exactly which one fails and why.
export async function testEmail(cfg, to) {
  if (!emailReady(cfg)) throw new Error('Fill in the public key, service ID and customer template ID first, then Save.');
  const results = [];
  const m1 = 'Hi,\n\nThis is a test from Seamline. If you can read this, customer emails are working.\n\nQuotes and invoices will arrive like this, with a button to view and download the PDF online.';
  try {
    await send(cfg, cfg.customerTemplate, { to_email: to, email: to, to, recipient: to, user_email: to, to_name: '', subject: 'Seamline test email', message: m1, message_html: textToHtml(m1), from_name: 'Seamline', reply_to: to, company_phone: '', logo_url: logoUrl(), link: baseUrl(), link_label: 'Open Seamline', pdf: '', pdf_name: '' });
    results.push({ name: 'Customer template', id: cfg.customerTemplate, ok: true, note: `Sent to ${to}` });
  } catch (e) { results.push({ name: 'Customer template', id: cfg.customerTemplate, ok: false, note: e.message, raw: e.raw || '' }); }
  if (cfg.teamTemplate) {
    const m2 = 'This is a test team notification from Seamline.\n\nNew quote requests, quote approvals, portal orders and customer messages will arrive like this.';
    try {
      await send(cfg, cfg.teamTemplate, { subject: 'Seamline test notification', message: m2, message_html: textToHtml(m2), from_name: 'Seamline', to_name: 'Seamline team', logo_url: logoUrl(), link: baseUrl() + 'index.html', link_label: 'Open in Seamline' });
      results.push({ name: 'Team template', id: cfg.teamTemplate, ok: true, note: 'Sent to the address typed in the team template' });
    } catch (e) { results.push({ name: 'Team template', id: cfg.teamTemplate, ok: false, note: e.message, raw: e.raw || '' }); }
  }
  if (cfg.teamTemplate && cfg.teamTemplate === cfg.customerTemplate) results.push({ name: 'Template IDs', ok: false, note: 'The customer and team template IDs are the same. They must be two different templates.' });
  return results;
}
