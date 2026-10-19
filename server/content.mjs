import fs from 'node:fs';
import path from 'node:path';

export function loadContent(root) {
  const js = fs.readFileSync(path.join(root, 'app', 'shared', 'content.js'), 'utf8');
  return JSON.parse(js.replace(/^[\s\S]*?window\.TCW_CONTENT = /, '').replace(/;\s*$/, ''));
}
