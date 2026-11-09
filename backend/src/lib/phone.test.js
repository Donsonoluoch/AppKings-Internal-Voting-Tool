const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizePhone } = require('./phone');
const { parseCsv } = require('./csv');

test('normalizes Kenyan numbers to +2547XXXXXXXX', () => {
  assert.equal(normalizePhone('0712345678'), '+254712345678');
  assert.equal(normalizePhone('712345678'), '+254712345678');
  assert.equal(normalizePhone('+254712345678'), '+254712345678');
  assert.equal(normalizePhone('254 712 345 678'), '+254712345678');
  assert.equal(normalizePhone('0112345678'), '+254112345678');
  assert.equal(normalizePhone('12345'), null);
  assert.equal(normalizePhone(''), null);
});

test('parses a CSV with quoted fields and CRLF, mapping header aliases', () => {
  const csv = 'Name,Phone Number,Department,Role\r\n"Otieno, Peter",0712345678,Engineering,COMMITTEE\r\nMary,+254712345679,,EMPLOYEE\r\n';
  const rows = parseCsv(csv);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].fullName, 'Otieno, Peter');
  assert.equal(rows[0].phone, '0712345678');
  assert.equal(rows[0].role, 'COMMITTEE');
  assert.equal(rows[1].phone, '+254712345679');
});
