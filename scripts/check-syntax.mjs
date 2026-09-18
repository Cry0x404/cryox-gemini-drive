import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const roots = ['server.js', 'src', 'lib', 'public', 'scripts', 'test'];
const files = [];
for (const item of roots) {
  const full = path.resolve(item);
  if (!fs.existsSync(full)) continue;
  const stat = fs.statSync(full);
  if (stat.isFile()) files.push(full);
  else {
    const stack = [full];
    while (stack.length) {
      const dir = stack.pop();
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const next = path.join(dir, entry.name);
        if (entry.isDirectory()) stack.push(next);
        else if (/\.(?:js|mjs|cjs)$/.test(entry.name)) files.push(next);
      }
    }
  }
}

for (const file of files.sort()) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`Syntax check passed for ${files.length} JavaScript files.`);
