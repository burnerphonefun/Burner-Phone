// one-off: turn `x.textContent = y;` into `setText(x, y);` in the phone's hot paths (function replacer, no $ patterns)
import { readFileSync, writeFileSync } from 'node:fs';

const files = ['shared/phone/phone.js', 'shared/phone/apps/pump.js', 'shared/phone/apps/chart.js', 'shared/phone/apps/bags.js', 'shared/phone/apps/wallet.js', 'shared/phone/apps/camera.js'];
const re = /([A-Za-z_][\w.]*(?:\.querySelector\('[^']+'\))?)\.textContent = ([^;\n]+);/g;
for (const f of files) {
  let s = readFileSync(f, 'utf8');
  let n = 0;
  s = s.replace(re, (all, lhs, rhs) => { n++; return 'setText(' + lhs + ', ' + rhs + ');'; });
  // import setText from fmt.js
  if (n && !/\bsetText\b[^(]*from '\.\.?\/?(\.\.\/)?fmt\.js'/.test(s)) {
    s = s.replace(/import \{([^}]*)\} from '(\.\.?\/(?:\.\.\/)?fmt\.js)';/, (all, names, path) => 'import {' + names.replace(/\s*$/, '') + ', setText } from \'' + path + '\';');
  }
  writeFileSync(f, s);
  console.log(f, n);
}
