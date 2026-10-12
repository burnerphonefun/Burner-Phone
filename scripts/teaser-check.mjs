// node scripts/teaser-check.mjs video.mp4 out.png [n=12] — pull n evenly spaced frames out of a rendered video into a contact sheet
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpeg from 'ffmpeg-static';

const [video, out, nArg = '12'] = process.argv.slice(2);
const n = +nArg;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const tmp = join(ROOT, 'node_modules/.teaser/check');
rmSync(tmp, { recursive: true, force: true }); mkdirSync(tmp, { recursive: true });
const probe = spawnSync(ffmpeg, ['-i', video], { encoding: 'utf8' }).stderr;
const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(probe);
const durS = +m[1] * 3600 + +m[2] * 60 + +m[3];
console.log('duration', durS.toFixed(2), 's |', (/Stream.*Video: ([^\n]+)/.exec(probe) || [])[1]?.slice(0, 90), '|', (/Stream.*Audio: ([^\n]+)/.exec(probe) || [])[1]?.slice(0, 60));
for (let i = 0; i < n; i++) {
  const t = ((i + 0.5) / n) * durS;
  execFileSync(ffmpeg, ['-y', '-ss', t.toFixed(3), '-i', video, '-frames:v', '1', '-vf', 'scale=640:-2', join(tmp, `f${String(i).padStart(2, '0')}-${t.toFixed(2)}s.jpg`)], { stdio: 'ignore' });
}
const files = readdirSync(tmp).sort().map((f) => join(tmp, f));
execFileSync(process.execPath, [join(ROOT, 'scripts/sheet.mjs'), out, '4', '2000', ...files], { stdio: 'inherit' });
