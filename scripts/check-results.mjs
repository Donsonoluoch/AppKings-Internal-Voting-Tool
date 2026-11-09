const BASE = 'http://localhost:3300';
const res = await fetch(`${BASE}/api/results`);
console.log('status:', res.status);
const body = await res.json().catch(() => ({}));
console.log('top-level keys:', Object.keys(body));
console.log(JSON.stringify(body, null, 2).slice(0, 1200));
