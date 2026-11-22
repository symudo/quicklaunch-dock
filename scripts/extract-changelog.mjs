import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function extractVersionNotes(changelogText, tagName) {
  if (!changelogText || !tagName) return '';
  const normalizedTag = tagName.trim();
  const lines = changelogText.split(/\r?\n/);
  const headingPrefix = `## [${normalizedTag}]`;

  let capturing = false;
  const collected = [];

  for (const line of lines) {
    if (line.startsWith('## [')) {
      if (capturing) break;
      if (line.startsWith(headingPrefix)) {
        capturing = true;
      }
      continue;
    }
    if (capturing) {
      collected.push(line);
    }
  }

  return collected.join('\n').trim();
}

// 作为 CLI 运行：node scripts/extract-changelog.mjs <tag> <outFile>
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const tag = process.argv[2] || process.env.GITHUB_REF_NAME || '';
  const outFile = process.argv[3] || path.join('dist', 'release-notes.md');
  const changelogPath = path.resolve('CHANGELOG.md');
  const text = fs.existsSync(changelogPath) ? fs.readFileSync(changelogPath, 'utf8') : '';
  const notes = extractVersionNotes(text, tag);

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const content = notes || `### ${tag}\n\n本版本更新内容请查看提交记录与 CHANGELOG.md。`;
  fs.writeFileSync(outFile, content + '\n', 'utf8');
  console.log(`[changelog] ${tag} -> ${outFile} (${notes ? 'matched CHANGELOG.md' : 'fallback'})`);
}
