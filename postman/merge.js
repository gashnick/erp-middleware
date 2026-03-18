#!/usr/bin/env node
// postman/merge.js
//
// Merges all folder files into a single importable Postman collection.
//
// ── HOW TO RUN ────────────────────────────────────────────────────────────────
//
//   node postman/merge.js
//
//   Output: postman-collection.json  (import this into Postman)
//
// ── HOW TO ADD A NEW ENDPOINT ────────────────────────────────────────────────
//
//   1. Create a new file in postman/folders/
//      Name it with the next number prefix, e.g.:
//        19-hr-dashboard.json
//
//   2. Use this template:
//      {
//        "name": "HR Dashboard",
//        "item": [
//          {
//            "name": "Get Headcount",
//            "request": {
//              "method": "GET",
//              "header": [{ "key": "Authorization", "value": "Bearer {{tenantToken}}" }],
//              "url": {
//                "raw": "{{baseUrl}}/hr/headcount",
//                "host": ["{{baseUrl}}"],
//                "path": ["hr", "headcount"]
//              }
//            }
//          }
//        ]
//      }
//
//   3. Run: node postman/merge.js
//
//   4. In Postman: Import → postman-collection.json
//      (or use "Update Collection" if already imported)
//
// ── FOLDER ORDER ─────────────────────────────────────────────────────────────
//   Files are merged in alphabetical order — the numeric prefix controls
//   the order folders appear in Postman.

const fs = require('fs');
const path = require('path');

const FOLDERS_DIR = path.join(__dirname, 'folders');
const VARS_FILE = path.join(__dirname, 'variables.json');
const OUTPUT_FILE = path.join(__dirname, '..', 'postman-collection.json');

const base = JSON.parse(fs.readFileSync(VARS_FILE, 'utf8'));

const folderFiles = fs
  .readdirSync(FOLDERS_DIR)
  .filter((f) => f.endsWith('.json'))
  .sort();

console.log('\n📂 Merging Postman collection...\n');

const items = folderFiles.map((file) => {
  const filePath = path.join(FOLDERS_DIR, file);
  const raw = fs.readFileSync(filePath, 'utf8');

  if (!raw.trim()) {
    console.error(`❌ EMPTY FILE: ${file}`);
    process.exit(1);
  }

  try {
    const content = JSON.parse(raw);
    const count = content.item?.length ?? 0;
    console.log(`✓ ${file.padEnd(40)} (${count} requests)`);
    return content;
  } catch (err) {
    console.error(`❌ INVALID JSON: ${file}`);
    throw err;
  }
});

const collection = {
  info: base.info,
  variable: base.variable,
  item: items,
};

fs.writeFileSync(OUTPUT_FILE, JSON.stringify(collection, null, 2));

const totalRequests = items.reduce((sum, f) => sum + (f.item?.length ?? 0), 0);
console.log(`\n✅  Merged ${items.length} folders  |  ${totalRequests} total requests`);
console.log(`📄  Output: ${OUTPUT_FILE}\n`);
console.log('👉  Import postman-collection.json into Postman to use.\n');
