// Minimal RFC-4180-ish CSV parser (quoted fields, embedded commas, CRLF).
// No dependency needed for a 60-row import.

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  const input = String(text).replace(/^\uFEFF/, ''); // strip BOM from Excel exports

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char === '\r') {
      // skip, handled by \n
    } else {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const cleaned = rows
    .map((cells) => cells.map((cell) => cell.trim()))
    .filter((cells) => cells.some((cell) => cell.length > 0));

  if (cleaned.length === 0) return [];

  const header = cleaned[0].map((h) => h.toLowerCase().replace(/[^a-z]/g, ''));
  const alias = {
    fullname: 'fullName',
    name: 'fullName',
    names: 'fullName',
    phone: 'phone',
    phonenumber: 'phone',
    msisdn: 'phone',
    department: 'department',
    team: 'department',
    role: 'role',
  };
  const keys = header.map((h) => alias[h] || h);

  return cleaned.slice(1).map((cells) => {
    const record = {};
    keys.forEach((key, index) => {
      record[key] = cells[index] ?? '';
    });
    return record;
  });
}

module.exports = { parseCsv };
