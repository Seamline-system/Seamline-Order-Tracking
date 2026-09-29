// The two EmailJS templates Seamline expects. Paste each into EmailJS → Email Templates →
// (template) → Content → Code editor (<>). Settings → Email shows them with copy buttons.

export const CUSTOMER_TEMPLATE_SETTINGS = [
  ['Subject', '{{subject}}'],
  ['To Email', '{{to_email}}'],
  ['From Name', '{{from_name}}'],
  ['Reply To', '{{reply_to}}'],
  ['Attachments (optional, paid EmailJS plans)', 'Variable Attachment · parameter name: pdf · filename: {{pdf_name}} · content type: PDF'],
];
export const TEAM_TEMPLATE_SETTINGS = [
  ['Subject', '{{subject}}'],
  ['To Email', 'your own email address (typed in — not a variable)'],
  ['From Name', 'Seamline'],
];

export const CUSTOMER_TEMPLATE = `<div style="margin:0;padding:28px 12px;background:#f4f4f2;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e6e6e3;font-family:Arial,Helvetica,sans-serif;color:#0a0a0a;">
    <tr>
      <td style="background:#0a0a0a;padding:28px 32px 22px;">
        <img src="{{logo_url}}" alt="{{from_name}}" width="170" style="display:block;width:170px;max-width:60%;height:auto;border:0;color:#ffffff;font-size:24px;font-weight:bold;font-style:italic;letter-spacing:1px;">
        <div style="margin-top:18px;border-top:2px dashed #5c5c5a;font-size:0;line-height:0;">&nbsp;</div>
      </td>
    </tr>
    <tr>
      <td style="padding:32px 32px 8px;font-size:15px;line-height:1.65;color:#0a0a0a;">{{{message_html}}}</td>
    </tr>
    {{#link}}
    <tr>
      <td style="padding:18px 32px 6px;">
        <a href="{{link}}" target="_blank" style="display:inline-block;background:#0a0a0a;color:#ffffff;text-decoration:none;font-weight:bold;font-size:15px;padding:14px 26px;border-radius:8px;">{{link_label}} &rarr;</a>
      </td>
    </tr>
    {{/link}}
    {{#pdf_name}}
    <tr>
      <td style="padding:12px 32px 0;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="background:#f4f4f2;border-radius:8px;">
          <tr><td style="padding:10px 14px;font-size:13px;color:#0a0a0a;"><strong>PDF attached:</strong> {{pdf_name}}</td></tr>
        </table>
      </td>
    </tr>
    {{/pdf_name}}
    <tr>
      <td style="padding:30px 32px 0;"><div style="border-top:2px dashed #d4d4d0;font-size:0;line-height:0;">&nbsp;</div></td>
    </tr>
    <tr>
      <td style="padding:18px 32px 30px;font-size:12px;line-height:1.7;color:#6b6b68;">
        <strong style="color:#0a0a0a;font-size:13px;">{{from_name}}</strong><br>
        {{#company_phone}}{{company_phone}}<br>{{/company_phone}}
        {{#reply_to}}<a href="mailto:{{reply_to}}" style="color:#6b6b68;">{{reply_to}}</a><br>{{/reply_to}}
        Questions? Just reply to this email.
      </td>
    </tr>
  </table>
  <p style="margin:16px 0 0;text-align:center;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:1px;color:#9a9a96;">SOURCING &middot; MANUFACTURING &middot; WHOLESALE MERCHANDISE</p>
</div>`;

export const TEAM_TEMPLATE = `<div style="margin:0;padding:24px 12px;background:#f4f4f2;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e6e6e3;font-family:Arial,Helvetica,sans-serif;color:#0a0a0a;">
    <tr>
      <td style="background:#0a0a0a;padding:16px 24px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td><img src="{{logo_url}}" alt="Seamline" width="110" style="display:block;width:110px;height:auto;border:0;color:#ffffff;font-weight:bold;font-style:italic;"></td>
          <td align="right" style="font-size:11px;letter-spacing:1px;color:#bdbdb8;">TEAM NOTIFICATION</td>
        </tr></table>
      </td>
    </tr>
    <tr>
      <td style="padding:24px 24px 6px;font-size:18px;font-weight:bold;line-height:1.35;">{{subject}}</td>
    </tr>
    <tr>
      <td style="padding:10px 24px 8px;font-size:14px;line-height:1.65;color:#1a1a1a;">{{{message_html}}}</td>
    </tr>
    {{#link}}
    <tr>
      <td style="padding:16px 24px 26px;">
        <a href="{{link}}" target="_blank" style="display:inline-block;background:#0a0a0a;color:#ffffff;text-decoration:none;font-weight:bold;font-size:14px;padding:12px 22px;border-radius:8px;">{{link_label}} &rarr;</a>
      </td>
    </tr>
    {{/link}}
    <tr>
      <td style="padding:14px 24px;border-top:2px dashed #e6e6e3;font-size:11px;color:#9a9a96;">Sent automatically by Seamline. Change which notifications you get in Settings &rarr; Email.</td>
    </tr>
  </table>
</div>`;
