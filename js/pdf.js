// Quote and invoice PDFs in the Seamline template (jsPDF + autotable, bundled in /vendor).
// Built from a plain document object (S.quoteDoc / S.invoiceDoc), so the staff app,
// the customer portal and the public links all produce the same PDF.

const cache = {};
async function asset(name) {
  if (cache[name] !== undefined) return cache[name];
  try {
    const url = new URL(`assets/${name}`, document.baseURI).href;
    const blob = await (await fetch(url)).blob();
    const dataUrl = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = dataUrl; });
    cache[name] = { dataUrl, ratio: img.naturalHeight / img.naturalWidth };
  } catch { cache[name] = false; }
  return cache[name];
}

// Standard PDF fonts only cover Latin-1; replace typographic characters.
const clean = s => String(s ?? '').replace(/[—–−]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[·•]/g, '-').replace(/×/g, 'x').replace(/…/g, '...').replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '');
const rs = n => `Rs. ${Math.round(Number(n) || 0).toLocaleString('en-US')}`;
const dt = d => (d ? new Date(String(d).length === 10 ? `${d}T12:00:00` : d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '-');
const imgFormat = src => (/^data:image\/png/i.test(src) ? 'PNG' : 'JPEG');

// Page geometry (mm, A4) taken from the Seamline template.
const W = 210, H = 297, M = 13.6, R = W - M;
const COL = { desc: 21.4, qty: 111.5, priceR: 160, totalR: R - 6, label: 137.5 };
const INK = [10, 10, 10], GREY = [110, 110, 110];

export async function buildPdf(doc) {
  const JsPDF = window.jspdf?.jsPDF;
  if (!JsPDF) throw new Error('The PDF library did not load. Check that the vendor folder is present.');
  const pdf = new JsPDF({ unit: 'mm', format: 'a4' });
  if (typeof pdf.autoTable !== 'function') throw new Error('The PDF table plugin did not load.');
  const isQuote = doc.type === 'quote';
  const c = doc.company || {}, cu = doc.customer || {}, t = doc.totals || {};
  const [logo, mark] = await Promise.all([asset('logo-black.png'), asset('watermark.png')]);
  const watermark = () => { if (mark) pdf.addImage(mark.dataUrl, 'PNG', W / 2 - 52, 85, 104, 104, 'wm', 'FAST'); };
  const newPage = () => { pdf.addPage(); return 22; };
  const LIMIT = H - 18; // footer starts below this
  pdf.setTextColor(...INK);
  watermark();

  // ---- logo in a box ----
  pdf.setDrawColor(...INK); pdf.setLineWidth(0.9);
  pdf.rect(10.5, 13.4, 87, 26.2);
  if (logo) pdf.addImage(logo.dataUrl, 'PNG', 16.8, 26.5 - (74.6 * logo.ratio) / 2, 74.6, 74.6 * logo.ratio, 'logo', 'FAST');
  else { pdf.setFont('helvetica', 'bolditalic'); pdf.setFontSize(28); pdf.text(clean(c.company || 'SEAMLINE').toUpperCase(), 54, 30, { align: 'center' }); }

  // ---- billed to / date / numbers ----
  const X = 128, maxW = R - X;
  let y = 20;
  const field = (label, value, bold = false) => {
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(10.5); pdf.setTextColor(...INK);
    pdf.text(label, X, y);
    const lw = pdf.getTextWidth(label) + 2;
    pdf.setFont('helvetica', bold ? 'bold' : 'normal');
    const lines = pdf.splitTextToSize(clean(value || '-'), maxW - lw);
    pdf.text(lines, X + lw, y);
    y += 5 * lines.length;
  };
  field('Billed To:', cu.name);
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.5); pdf.setTextColor(...GREY);
  [cu.contact, [cu.phone, cu.email].filter(Boolean).join('  '), cu.address].filter(Boolean).forEach(line => {
    const l = pdf.splitTextToSize(clean(line), maxW); pdf.text(l, X, y); y += 3.8 * l.length;
  });
  y += 4;
  field('Date:', dt(doc.date));
  if (isQuote) { field('Quote No:', doc.number); field('Valid until:', dt(doc.validUntil)); }
  else { field('Invoice No:', doc.number); if (doc.orderNumber) field('Order No:', doc.orderNumber); field('Due:', dt(doc.dueAt)); }

  // ---- title ----
  const titleY = Math.max(61, y + 12);
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(27); pdf.setTextColor(...INK);
  pdf.text(`${doc.isSample ? 'SAMPLE ' : ''}${isQuote ? 'QUOTATION' : 'INVOICE'}`, W / 2, titleY, { align: 'center', charSpace: 0.6 });
  if (!isQuote && doc.status) {
    const st = doc.status.toUpperCase();
    pdf.setFontSize(9); const tw = pdf.getTextWidth(st) + 8;
    pdf.setLineWidth(0.5);
    if (st === 'PAID') { pdf.setFillColor(...INK); pdf.roundedRect(W / 2 - tw / 2, titleY + 3, tw, 6.5, 1.2, 1.2, 'F'); pdf.setTextColor(255, 255, 255); }
    else { pdf.roundedRect(W / 2 - tw / 2, titleY + 3, tw, 6.5, 1.2, 1.2, 'S'); }
    pdf.text(st, W / 2, titleY + 7.6, { align: 'center' }); pdf.setTextColor(...INK);
  }

  // ---- black header bar ----
  const barY = titleY + (isQuote ? 15 : 17), barH = 17;
  pdf.setFillColor(...INK); pdf.rect(M, barY, R - M, barH, 'F');
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11.5); pdf.setTextColor(255, 255, 255);
  const hy = barY + barH / 2 + 1.5;
  const cs = 0.4, right = (txt, x) => pdf.text(txt, x - pdf.getTextWidth(txt) - cs * (txt.length - 1), hy, { charSpace: cs });
  pdf.text('QTY', COL.qty, hy, { charSpace: cs }); right('PRICE (RS)', COL.priceR); right('TOTAL', COL.totalR);

  // ---- items box ----
  const boxTop = barY + barH + 7;
  const startPage = pdf.getNumberOfPages();
  pdf.autoTable({
    startY: boxTop + 6,
    margin: { left: COL.desc - 2, right: W - (COL.totalR + 2), top: 22, bottom: 24 },
    body: (doc.items || []).map(i => [clean(i.name) + (i.detail ? `\n${clean(i.detail)}` : ''), Number(i.qty).toLocaleString('en-US'), rs(i.unitPrice), rs(i.amount)]),
    theme: 'plain', showHead: 'never',
    styles: { font: 'helvetica', fontSize: 11, textColor: INK, cellPadding: { top: 2.2, bottom: 2.2, left: 2, right: 2 }, overflow: 'linebreak' },
    columnStyles: { 0: { cellWidth: COL.qty - COL.desc }, 1: { cellWidth: 26 }, 2: { cellWidth: COL.priceR + 2 - (COL.qty - 2 + 26), halign: 'right' }, 3: { cellWidth: 'auto', halign: 'right' } },
    willDrawPage: d => { if (d.pageNumber > 1) watermark(); },
    didParseCell: h => { if (h.column.index === 0 && h.cell.raw.includes('\n')) h.cell.styles.fontSize = 11; },
  });
  let ty = pdf.lastAutoTable.finalY + 10;
  const rows = [];
  if (t.discount || t.deliveryCharge || t.tax || t.sampleCredit) rows.push(['Subtotal', rs(t.subtotal)]);
  if (t.discount) rows.push(['Discount', `- ${rs(t.discount)}`]);
  if (t.sampleCredit) rows.push([`Less sample fee${doc.sampleRef ? ` (${doc.sampleRef})` : ''}`, `- ${rs(t.sampleCredit)}`]);
  if (t.deliveryCharge) rows.push(['Delivery', rs(t.deliveryCharge)]);
  if (t.tax) rows.push([`Tax (${t.taxRate}%)`, rs(t.tax)]);
  const need = 16 + rows.length * 6.5 + (isQuote ? 0 : 14);
  let samePage = pdf.getNumberOfPages() === startPage;
  if (ty + need > H - 30) { ty = newPage(); samePage = false; }
  pdf.setDrawColor(...INK); pdf.setLineWidth(0.3); pdf.line(COL.desc, ty, R - 6, ty);
  ty += 8;
  pdf.setFontSize(10.5);
  const R2 = { align: 'right' };
  rows.forEach(([k, v]) => {
    pdf.setFont('helvetica', 'normal'); pdf.setTextColor(...GREY);
    const lx = Math.min(COL.label, COL.totalR - 30 - pdf.getTextWidth(k)); // long labels move left instead of overlapping the amount
    pdf.text(k, lx, ty); pdf.setTextColor(...INK); pdf.text(v, COL.totalR, ty, R2); ty += 6.5;
  });
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(13); pdf.setTextColor(...INK);
  pdf.text('TOTAL', COL.label, ty + 1); pdf.text(rs(t.total), COL.totalR, ty + 1, R2);
  ty += 8;
  if (!isQuote) {
    pdf.setFontSize(10.5); pdf.setFont('helvetica', 'normal'); pdf.setTextColor(...GREY); pdf.text('Paid', COL.label, ty); pdf.setTextColor(...INK); pdf.text(rs(t.paid), COL.totalR, ty, R2); ty += 6.5;
    pdf.setFont('helvetica', 'bold'); pdf.text('Balance due', COL.label, ty); pdf.text(rs(t.balance), COL.totalR, ty, R2); ty += 6;
  }
  const boxBottom = ty + 4;
  pdf.setLineWidth(0.35);
  pdf.rect(M, samePage ? boxTop : 18, R - M, boxBottom - (samePage ? boxTop : 18));

  // ---- note line ----
  y = boxBottom + 10;
  let note = isQuote ? (doc.note || '') : (t.balance > 0 ? `Please settle the balance of ${rs(t.balance)} by ${dt(doc.dueAt)}.` : 'Paid in full - thank you!');
  if (doc.isSample) note = `${isQuote ? 'This is a quotation for a sample.' : 'This invoice is for a sample.'} Once the sample is approved, this sample fee is deducted from your bulk order.${isQuote ? '' : ` ${note}`}`;
  else if (t.sampleCredit) note = `Your sample fee of ${rs(t.sampleCredit)}${doc.sampleRef ? ` (${doc.sampleRef})` : ''} has been deducted from this total. ${note}`.trim();
  if (note) {
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11);
    const l = pdf.splitTextToSize(`*${clean(note)}*`, R - M - 10);
    if (y + l.length * 5 > H - 26) y = newPage();
    pdf.text(l, W / 2, y, { align: 'center' }); y += l.length * 5 + 2;
  }

  // ---- terms & bank details ----
  const blocks = [];
  if (isQuote) {
    if (doc.productionDays) blocks.push(['Production time', `${doc.productionDays} days after approval`]);
    if (doc.paymentTerms) blocks.push(['Payment terms', doc.paymentTerms]);
  } else if (c.bankDetails) blocks.push(['Bank details', c.bankDetails]);
  if (doc.notes) blocks.push(['Notes', doc.notes]);
  if (blocks.length) {
    y += 3;
    pdf.setFontSize(9.5);
    for (const [k, v] of blocks) {
      const l = pdf.splitTextToSize(clean(v), R - M - 42);
      if (y + l.length * 4.4 > H - 26) y = newPage();
      pdf.setFont('helvetica', 'bold'); pdf.setTextColor(...INK); pdf.text(`${k}:`, M, y);
      pdf.setFont('helvetica', 'normal'); pdf.setTextColor(60, 60, 60); pdf.text(l, M + 40, y);
      y += Math.max(1, l.length) * 4.4 + 1.5;
    }
  }

  // ---- design / drafts ----
  const imgs = (doc.mockups || []).filter(Boolean);
  if (imgs.length) {
    const cols = imgs.length === 1 ? 1 : 2, rowsN = Math.ceil(imgs.length / cols);
    y += 8;
    const ideal = imgs.length === 1 ? 90 : rowsN === 1 ? 80 : 130;
    let boxH = Math.min(ideal, LIMIT - (y + 4));
    const minH = imgs.length <= 2 ? 45 : 90;
    if (boxH < minH) { y = newPage() + 4; boxH = imgs.length <= 2 ? 120 : 200; }
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(13); pdf.setTextColor(...INK);
    pdf.text('Design/Drafts', M, y, { charSpace: 0.5 });
    const bx = M, by = y + 4, bw = R - M;
    boxH = Math.min(boxH, LIMIT - by);
    pdf.setLineWidth(0.35); pdf.setFillColor(255, 255, 255); pdf.rect(bx, by, bw, boxH, 'FD');
    const pad = 4, gap = 4;
    const cw = (bw - 2 * pad - (cols - 1) * gap) / cols, ch = (boxH - 2 * pad - (rowsN - 1) * gap) / rowsN;
    imgs.forEach((src, i) => {
      try {
        const p = pdf.getImageProperties(src);
        const k = Math.min(cw / p.width, ch / p.height);
        const w = p.width * k, h = p.height * k;
        const cx = bx + pad + (i % cols) * (cw + gap) + (cw - w) / 2, cy = by + pad + Math.floor(i / cols) * (ch + gap) + (ch - h) / 2;
        pdf.addImage(src, imgFormat(src), cx, cy, w, h, undefined, 'MEDIUM');
      } catch (e) { console.warn('Mockup image skipped', e); }
    });
  }

  // ---- footer on every page ----
  const pages = pdf.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    pdf.setPage(p);
    pdf.setDrawColor(...INK); pdf.setLineWidth(0.6); pdf.line(0, H - 12, W, H - 12);
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7.5); pdf.setTextColor(...GREY);
    pdf.text(clean([c.legalName || c.company, c.phone, c.email].filter(Boolean).join('   ')), M, H - 6.5);
    pdf.text(`${clean(doc.number)}  -  Page ${p} of ${pages}`, R, H - 6.5, { align: 'right' });
  }
  return pdf;
}

export const pdfName = doc => `${doc.type === 'quote' ? 'Quotation' : 'Invoice'}-${doc.number}.pdf`;

export async function downloadPdf(doc) {
  const pdf = await buildPdf(doc);
  pdf.save(pdfName(doc));
}

// Shares the PDF file itself where the device supports it (phones: WhatsApp, Mail…).
export async function sharePdf(doc, text = '') {
  const pdf = await buildPdf(doc);
  const file = new File([pdf.output('blob')], pdfName(doc), { type: 'application/pdf' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: pdfName(doc), text }); return 'shared'; }
    catch (e) { if (e.name === 'AbortError') return 'cancelled'; }
  }
  pdf.save(pdfName(doc));
  return 'downloaded';
}
export const canShareFiles = () => { try { return !!navigator.canShare?.({ files: [new File(['x'], 'x.pdf', { type: 'application/pdf' })] }); } catch { return false; } };
