// Clean coin names before they reach any phone: strip invisible filler characters and
// drop launches whose name or ticker carries a slur. The word lists are base64 so the
// source stays readable; they decode once at load.

const SUB = Buffer.from('bmlnZyxuaWdnYSxuaWdsZXQsZmFnZ290LGZhZ2csdHJhbm55LHRyYW5uaWUsd2V0YmFjayx0b3dlbGhlYWQsc2FuZG5pZyxreWtlLGNoaW5nY2hvbmcscmFnaGVhZCxiZWFuZXIsZ29sbGl3b2cscG9yY2htb25rZXksamlnYWJvbyxoaXRsZXIsaGVpbGhpdCwxNDg4', 'base64').toString().split(',');
// sexual violence, child abuse and hate terms (2026-10-12: "The Rape Robot" reached the live phone). Whole words where a
// substring would hit innocent words (grape, therapist, torpedo, pedometer); substrings only where none exist.
const SUB_EXTRA = ['pedophil', 'paedophil', 'molest', 'holocaust', 'kkk', 'childporn'];
const WORD_EXTRA = ['rape', 'rapes', 'raped', 'raping', 'rapist', 'rapists', 'rapey', 'pedo', 'pedos', 'paedo', 'nazi', 'nazis', 'incest', 'cunny'];
const WORD = new Set(Buffer.from('bmlnLG5pZ2EsbmlncyxuaWdheixraWtlLGtpa2VzLGNoaW5rLGNoaW5rcyxzcGljLHNwaWNzLGNvb24sY29vbnMsZ29vayxnb29rcyxwYWtpLHBha2lzLGR5a2UsZHlrZXMsZmFnLGZhZ3M=', 'base64').toString().split(','));
SUB.push(...SUB_EXTRA);
for (const w of WORD_EXTRA) WORD.add(w);

// invisible / zero-width / bidi / filler code points (built from numbers, never typed as escapes)
const INVISIBLE = new Set();
const addRange = (a, b) => { for (let c = a; c <= b; c++) INVISIBLE.add(String.fromCharCode(c)); };
addRange(0x0000, 0x001f);
addRange(0x007f, 0x009f);
[0x00ad, 0x034f, 0x061c, 0x115f, 0x1160, 0x17b4, 0x17b5, 0x180e, 0x3164, 0xfeff, 0xffa0].forEach((c) => INVISIBLE.add(String.fromCharCode(c)));
addRange(0x200b, 0x200f);
addRange(0x202a, 0x202e);
addRange(0x2060, 0x206f);
addRange(0xfe00, 0xfe0f); // variation selectors
addRange(0xfff0, 0xfff8);

// a few Cyrillic / Greek lookalikes folded to Latin before matching
const LOOK = new Map([
  [0x0430, 'a'], [0x0435, 'e'], [0x043e, 'o'], [0x0456, 'i'], [0x0440, 'p'], [0x0441, 'c'], [0x0445, 'x'], [0x0443, 'y'],
  [0x0410, 'a'], [0x0415, 'e'], [0x041e, 'o'], [0x0406, 'i'], [0x0420, 'p'], [0x0421, 'c'], [0x041d, 'h'], [0x041a, 'k'],
  [0x03bf, 'o'], [0x03b1, 'a'], [0x03b9, 'i'], [0x0131, 'i'], [0x0261, 'g'],
].map(([c, l]) => [String.fromCharCode(c), l]));
const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 6: 'g', 7: 't', 9: 'g', '@': 'a', $: 's', '!': 'i', '|': 'i' };
const VOWELS = new Set(['a', 'e', 'i', 'o', 'u']);

export function clean(s, max = 40) {
  if (typeof s !== 'string') return '';
  let out = '';
  for (const ch of s) if (!INVISIBLE.has(ch)) out += ch;
  out = out.split(' ').filter(Boolean).join(' ').trim();
  // cut by code points so an emoji is never split in half
  const cps = Array.from(out);
  return cps.length > max ? cps.slice(0, max).join('') : out;
}

function fold(s) {
  // drop accents: NFKD then remove combining marks (U+0300..U+036F)
  let t = '';
  for (const ch of s.normalize('NFKD')) {
    const c = ch.codePointAt(0);
    if (c >= 0x0300 && c <= 0x036f) continue;
    t += LOOK.get(ch) || ch;
  }
  t = t.toLowerCase();
  let f = '';
  for (const ch of t) f += LEET[ch] !== undefined ? LEET[ch] : ch;
  return f;
}

// collapse vowel runs to one letter and other runs of 3+ to two ("niiiggga" -> "nigga")
function squash(s) {
  let out = '', run = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (i > 0 && ch === s[i - 1]) {
      run++;
      if (VOWELS.has(ch) || run >= 2) continue;
    } else run = 0;
    out += ch;
  }
  return out;
}

// runs of 3+ of the same letter down to 2 ("cooon" -> "coon"), vowels kept (so "con" never matches "coon")
function squash2(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) if (!(i >= 2 && s[i] === s[i - 1] && s[i] === s[i - 2])) out += s[i];
  return out;
}
const SUB_SQ = SUB.map(squash);
const WORD_SQ = new Set([...WORD].map(squash2));

const letters = (s) => { let o = ''; for (const ch of s) if ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')) o += ch; return o; };

export function isOffensive(...parts) {
  for (const raw of parts) {
    if (!raw) continue;
    const lower = String(raw).toLowerCase();
    const folded = fold(String(raw));
    const flatU = letters(folded);
    const flat = squash(flatU);
    const flatRaw = letters(lower);
    for (let i = 0; i < SUB.length; i++) {
      const w = SUB[i];
      if (flatU.includes(w) || flatRaw.includes(w) || flat.includes(SUB_SQ[i])) return true;
    }
    // whole-word checks for short roots that hide inside innocent words (spicy, raccoon)
    let word = '';
    const words = [];
    for (const ch of folded + ' ') {
      if (ch >= 'a' && ch <= 'z') word += ch;
      else { if (word) words.push(word); word = ''; }
    }
    for (const w of words) if (WORD.has(w) || WORD_SQ.has(squash2(w))) return true;
  }
  return false;
}
