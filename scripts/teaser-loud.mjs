// node scripts/teaser-loud.mjs file.wav|mp4 [out.png] — judge a mix by numbers: momentary loudness every 0.5 s,
// integrated loudness, true peak, plus a spectrogram + waveform picture (LESSONS: music you can't listen to).
import { spawnSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';

const [file, png] = process.argv.slice(2);
const r = spawnSync(ffmpeg, ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8' });
const lines = r.stderr.split('\n');
const mom = [];
for (const l of lines) { const m = /t:\s*([\d.]+)\s+TARGET.*?M:\s*(-?[\d.]+|-inf)/.exec(l); if (m) mom.push([+m[1], m[2] === '-inf' ? -70 : +m[2]]); }
const half = [];
for (const [t, v] of mom) { const k = Math.floor(t * 2); if (!half[k] || v > half[k]) half[k] = v; }
console.log('momentary max per 0.5 s (LUFS):');
console.log(half.map((v, i) => `${(i / 2).toFixed(1)}:${v == null ? '-' : v.toFixed(0)}`).join(' '));
const I = /I:\s*(-?[\d.]+) LUFS/.exec(r.stderr.split('Summary:').pop()), TP = /Peak:\s*(-?[\d.]+) dBFS/.exec(r.stderr.split('True peak:')[1] || '');
console.log('integrated', I?.[1], 'LUFS · true peak', TP?.[1], 'dBFS');
if (png) {
  spawnSync(ffmpeg, ['-y', '-i', file, '-filter_complex', '[0:a]showspectrumpic=s=1200x360:legend=0:color=intensity:scale=log[s];[0:a]showwavespic=s=1200x160:colors=#ffc23d[w];[s][w]vstack', '-frames:v', '1', png], { encoding: 'utf8' });
  console.log('picture', png);
}
