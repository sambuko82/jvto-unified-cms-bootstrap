import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const ignored = new Set(['node_modules', '.git', 'dist', 'coverage']);
const patterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/,
  /\bghp_[A-Za-z0-9]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /(?:password|secret|token|api[_-]?key)\s*[:=]\s*["'][^"']{8,}["']/i,
];

const findings = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else {
      const relative = path.relative(root, full);
      if (relative === '.env.example') continue;
      const stat = fs.statSync(full);
      if (stat.size > 1_000_000) continue;
      let text;
      try { text = fs.readFileSync(full, 'utf8'); } catch { continue; }
      patterns.forEach((pattern) => {
        if (pattern.test(text)) findings.push(`${relative}: ${pattern}`);
      });
    }
  }
}
walk(root);
if (findings.length) {
  console.error('Potential secrets detected:\n' + findings.join('\n'));
  process.exit(1);
}
console.log('No common plaintext secret patterns detected.');
