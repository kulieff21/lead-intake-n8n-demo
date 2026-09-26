// Validate and normalize a raw web-form submission.
// Plain script (no imports): tools/build.mjs inlines it into an n8n Code node,
// tests load it with node:vm.

const BUDGETS = ['<1k', '1k-5k', '5k-20k', '20k+', 'unknown'];
const TIMELINES = ['asap', '1-3 months', '3+ months', 'exploring', 'unknown'];
const FREE_MAIL = ['gmail.com', 'googlemail.com', 'yahoo.com', 'outlook.com', 'hotmail.com',
  'live.com', 'icloud.com', 'aol.com', 'proton.me', 'protonmail.com', 'mail.ru', 'yandex.ru', 'gmx.com'];
// Conservative on purpose: the address is shown in HTML pages and used in mail headers.
const EMAIL_RE = /^[a-z0-9._%+-]{1,64}@([a-z0-9-]+\.)+[a-z]{2,}$/;
const MAX = { name: 120, company: 160, message: 4000, source: 60, website: 200 };

function clean(v, max) {
  if (v === undefined || v === null) return '';
  const s = String(v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return max ? s.slice(0, max) : s;
}

// Canonical mailbox for de-duplication: case-insensitive; for Gmail, dots and +tags are ignored.
function leadKey(email) {
  const [local, domain] = email.split('@');
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    return `${local.split('+')[0].replace(/\./g, '')}@gmail.com`;
  }
  return `${local.split('+')[0]}@${domain}`;
}

function pickEnum(v, allowed) {
  const s = clean(v).toLowerCase();
  return allowed.includes(s) ? s : 'unknown';
}

function normalizeLead(raw, nowIso) {
  const body = raw && typeof raw === 'object' ? raw : {};
  const errors = [];

  // Honeypot: a hidden field humans never fill. Spam is acknowledged but not processed.
  if (clean(body.company_fax) !== '') {
    return { ok: false, spam: true, errors: ['honeypot'], lead: null };
  }

  const email = clean(body.email, 254).toLowerCase();
  const name = clean(body.name, MAX.name);
  const message = clean(body.message, MAX.message);
  if (!EMAIL_RE.test(email)) errors.push('email: invalid');
  if (name.length < 2) errors.push('name: required');
  if (message.length < 10) errors.push('message: at least 10 characters');
  if (body.consent !== true && body.consent !== 'true' && body.consent !== 'on') {
    errors.push('consent: required');
  }
  if (errors.length) return { ok: false, spam: false, errors, lead: null };

  let website = clean(body.website, MAX.website).toLowerCase();
  if (website && !/^https?:\/\//.test(website)) website = `https://${website}`;
  const phone = clean(body.phone).replace(/[^\d+]/g, '');
  const domain = email.split('@')[1];

  return {
    ok: true,
    spam: false,
    errors: [],
    lead: {
      lead_key: leadKey(email),
      received_at: nowIso,
      name,
      email,
      email_domain: domain,
      free_mail: FREE_MAIL.includes(domain),
      company: clean(body.company, MAX.company),
      website,
      phone: phone.length >= 7 ? phone : '',
      budget: pickEnum(body.budget, BUDGETS),
      timeline: pickEnum(body.timeline, TIMELINES),
      source: clean(body.source, MAX.source) || 'web-form',
      message,
    },
  };
}
