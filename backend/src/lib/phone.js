// Normalizes Kenyan phone numbers to +2547XXXXXXXX (§7 rule 2).
// Accepts: +2547XXXXXXXX, 2547XXXXXXXX, 07XXXXXXXX, 7XXXXXXXX,
// and the same for 2541XXXXXXXX (mobile 1xx ranges).
function normalizePhone(input) {
  if (!input) return null;
  const digits = String(input).replace(/[^\d+]/g, '');
  const plain = digits.startsWith('+') ? digits.slice(1) : digits;

  if (/^254[17]\d{8}$/.test(plain)) return `+${plain}`;
  if (/^0[17]\d{8}$/.test(plain)) return `+254${plain.slice(1)}`;
  if (/^[17]\d{8}$/.test(plain)) return `+254${plain}`;
  return null;
}

function formatDisplay(phone) {
  if (!phone || !phone.startsWith('+254')) return phone;
  const rest = phone.slice(4);
  return `+254 ${rest.slice(0, 3)} ${rest.slice(3, 6)} ${rest.slice(6)}`;
}

module.exports = { normalizePhone, formatDisplay };
