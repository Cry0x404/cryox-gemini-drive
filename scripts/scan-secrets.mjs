import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SKIP = new Set(['.git', 'node_modules', 'data', 'gemini-threads', 'dist', 'coverage']);
const TEXT_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.json', '.md', '.yml', '.yaml', '.toml', '.txt', '.html', '.css', '.bat', '.cmd', '.ps1']);

const rules = [
  ['Google PSID cookie assignment', /__Secure-[13]PSID(?:TS|CC|RTS)?\s*[=:]\s*["']?[A-Za-z0-9._-]{24,}/i],
  ['Google session cookie object', /["'](?:SID|SSID|APISID|SAPISID|HSID)["']\s*:\s*["'][^"']{12,}["']/i],
  ['hard-coded 256-bit vault key', /(?:VAULT_KEY|vault[_-]?key)[^\n]{0,40}["'][0-9a-f]{64}["']/i],
  ['private key material', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
];

const findings = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      const text = fs.readFileSync(file, 'utf8');
      for (const [name, pattern] of rules) {
        if (pattern.test(text)) findings.push(`${path.relative(ROOT, file)}: ${name}`);
      }
    }
  }
}
walk(ROOT);

if (findings.length) {
  console.error('Potential committed secrets detected:');
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}
console.log('Secret scan passed.');
