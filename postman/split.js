#!/usr/bin/env node
// postman/split.js
//
// Splits a Postman collection into folder JSON files
// Usage: node postman/split.js

const fs = require('fs');
const path = require('path');

const COLLECTION_FILE = path.join(__dirname, '..', 'postman-collection.json');
const OUTPUT_DIR = path.join(__dirname, 'folders');

if (!fs.existsSync(COLLECTION_FILE)) {
  console.error('❌ postman-collection.json not found');
  process.exit(1);
}

const collection = JSON.parse(fs.readFileSync(COLLECTION_FILE, 'utf8'));

if (!collection.item || !Array.isArray(collection.item)) {
  console.error('❌ Invalid Postman collection structure');
  process.exit(1);
}

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

console.log('\n📂 Splitting Postman collection...\n');

collection.item.forEach((folder, index) => {
  const num = String(index + 1).padStart(2, '0');

  const safeName = folder.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  const filename = `${num}-${safeName}.json`;
  const filepath = path.join(OUTPUT_DIR, filename);

  const folderContent = {
    name: folder.name,
    item: folder.item || [],
  };

  fs.writeFileSync(filepath, JSON.stringify(folderContent, null, 2));

  const count = folder.item?.length || 0;

  console.log(`✓ ${filename.padEnd(35)} (${count} requests)`);
});

console.log('\n✅ Split complete.\n');
console.log('Now run:\n');
console.log('node postman/merge.js\n');
