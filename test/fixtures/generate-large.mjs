// Generates test/fixtures/array-of-objects.json (5,000 rows) for table/perf testing: node test/fixtures/generate-large.mjs [rows]
import { writeFileSync } from 'fs';

const rows = Number(process.argv[2] ?? 5000);
const cats = ['tools', 'toys', 'books', 'garden', 'food'];
const out = [];
for (let i = 1; i <= rows; i++) {
  out.push({
    id: i,
    sku: 'SKU-' + String(i).padStart(5, '0'),
    name: 'Item ' + i,
    category: cats[i % 5],
    price: Math.round(((i * 7.3) % 500) * 100) / 100,
    inStock: i % 3 !== 0,
    tags: i % 4 ? ['a', 'b'] : [],
    dimensions: { w: i % 50, h: (i * 3) % 40, unit: 'cm' },
    supplier: i % 7 ? { name: 'Supplier ' + (i % 13), country: ['DE', 'US', 'IN', 'JP'][i % 4] } : null,
  });
}
writeFileSync(new URL('./array-of-objects.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
console.log(`wrote ${rows} rows`);
