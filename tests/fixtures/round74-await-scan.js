// Round-74 scanner: await-in-non-async-function WITH arrow-fn
// boundary tracking. Brace-counts non-async function bodies and
// flags every await that lives in the non-async outer (NOT inside
// an inner async arrow).
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..', 'extension');

function walk(d, out) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const f = path.join(d, e.name);
    if (e.isDirectory()) walk(f, out);
    else if (f.endsWith('.js')) out.push(f);
  }
  return out;
}

const files = walk(ROOT, []);
let total = 0;
for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const lines = src.split('\n');
  const ranges = [];
  let i = 0;
  while (i < lines.length) {
    // function-style decl: ^function NAME(  OR  ^async function NAME(
    let m = lines[i].match(/^async\s+function\s+([a-zA-Z_$][\w$]*)\s*\(/);
    if (m) {
      const name = m[1];
      const isAsync = true;
      const startLine = i;
      // Find matching closing brace
      let braceStart = -1;
      let j = i;
      while (j < Math.min(i + 12, lines.length) && braceStart < 0) {
        const idx = lines[j].indexOf('{');
        if (idx >= 0) braceStart = j;
        j += 1;
      }
      if (braceStart >= 0) {
        let depth = 0;
        let k = braceStart;
        let inS = 0, inD = 0, inB = 0, inC = 0, inLC = 0;
        for (; k < lines.length; k += 1) {
          const L = lines[k];
          for (let c = 0; c < L.length; c += 1) {
            const ch = L[c];
            const nx = L[c + 1];
            if (inLC) break;
            if (inS) { if (ch === '\\') { c += 1; continue; } if (ch === "'") inS = 0; continue; }
            if (inD) { if (ch === '\\') { c += 1; continue; } if (ch === '"') inD = 0; continue; }
            if (inB) { if (ch === '\\') { c += 1; continue; } if (ch === '`') inB = 0; continue; }
            if (inC) { if (ch === '*' && nx === '/') { inC = 0; c += 1; continue; } continue; }
            if (ch === '/' && nx === '/') { inLC = 1; break; }
            if (ch === "'") { inS = 1; continue; }
            if (ch === '"') { inD = 1; continue; }
            if (ch === '`') { inB = 1; continue; }
            if (ch === '/' && nx === '*') { inC = 1; c += 1; continue; }
            if (ch === '{') depth += 1;
            if (ch === '}') {
              depth -= 1;
              if (depth === 0) {
                ranges.push({ startLine, endLine: k, name, isAsync });
                break;
              }
            }
          }
          inLC = 0;
          if (depth === 0) break;
        }
        if (depth === 0) { i = k + 1; continue; }
      }
    }
    // non-async function decl
    m = lines[i].match(/^function\s+([a-zA-Z_$][\w$]*)\s*\(/);
    if (m) {
      const name = m[1];
      const isAsync = false;
      const startLine = i;
      let braceStart = -1;
      let j = i;
      while (j < Math.min(i + 12, lines.length) && braceStart < 0) {
        const idx = lines[j].indexOf('{');
        if (idx >= 0) braceStart = j;
        j += 1;
      }
      if (braceStart >= 0) {
        let depth = 0;
        let k = braceStart;
        let inS = 0, inD = 0, inB = 0, inC = 0, inLC = 0;
        for (; k < lines.length; k += 1) {
          const L = lines[k];
          for (let c = 0; c < L.length; c += 1) {
            const ch = L[c];
            const nx = L[c + 1];
            if (inLC) break;
            if (inS) { if (ch === '\\') { c += 1; continue; } if (ch === "'") inS = 0; continue; }
            if (inD) { if (ch === '\\') { c += 1; continue; } if (ch === '"') inD = 0; continue; }
            if (inB) { if (ch === '\\') { c += 1; continue; } if (ch === '`') inB = 0; continue; }
            if (inC) { if (ch === '*' && nx === '/') { inC = 0; c += 1; continue; } continue; }
            if (ch === '/' && nx === '/') { inLC = 1; break; }
            if (ch === "'") { inS = 1; continue; }
            if (ch === '"') { inD = 1; continue; }
            if (ch === '`') { inB = 1; continue; }
            if (ch === '/' && nx === '*') { inC = 1; c += 1; continue; }
            if (ch === '{') depth += 1;
            if (ch === '}') {
              depth -= 1;
              if (depth === 0) {
                // Push a list of NESTED ranges: the outer fn body
                // PLUS each inner *async* arrow function body.
                // Awaits inside async arrow are LEGAL — DON'T flag.
                // Awaits at the OUTER level are BUGS — flag.
                ranges.push({ startLine, endLine: k, name, isAsync });
                break;
              }
            }
          }
          inLC = 0;
          if (depth === 0) break;
        }
        if (depth === 0) { i = k + 1; continue; }
      }
    }
    i += 1;
  }

  // Now: for each non-async range, find INNER async arrow ranges.
  // Innermost range wins for await attribution.
  for (const r of ranges) {
    if (r.isAsync) continue;
    // Find inner async arrows: const X = async () => { ... } OR async (args) => { ... }
    const innerAsy = [];
    let depth = 0;
    let relStart = r.startLine;
    for (let li = r.startLine; li <= r.endLine; li += 1) {
      const ln = lines[li];
      // Detect async arrow body start
      const am = ln.match(/async\s*(\([^)]*\))?\s*=>\s*\{/) ||
                 ln.match(/(?:const|let|var)\s+[a-zA-Z_$][\w$]*\s*=\s*async\s+(?:\([^)]*\))?\s*=>\s*\{/);
      if (am) {
        // Walk to matching close to record range
        let d2 = 0;
        let k = li;
        let inS = 0, inD = 0, inB = 0, inC = 0, inLC = 0;
        for (; k <= r.endLine; k += 1) {
          const L = lines[k];
          for (let c = 0; c < L.length; c += 1) {
            const ch = L[c];
            const nx = L[c + 1];
            if (inLC) break;
            if (inS) { if (ch === '\\') { c += 1; continue; } if (ch === "'") inS = 0; continue; }
            if (inD) { if (ch === '\\') { c += 1; continue; } if (ch === '"') inD = 0; continue; }
            if (inB) { if (ch === '\\') { c += 1; continue; } if (ch === '`') inB = 0; continue; }
            if (inC) { if (ch === '*' && nx === '/') { inC = 0; c += 1; continue; } continue; }
            if (ch === '/' && nx === '/') { inLC = 1; break; }
            if (ch === "'") { inS = 1; continue; }
            if (ch === '"') { inD = 1; continue; }
            if (ch === '`') { inB = 1; continue; }
            if (ch === '/' && nx === '*') { inC = 1; c += 1; continue; }
            if (ch === '{') d2 += 1;
            if (ch === '}') {
              d2 -= 1;
              if (d2 === 0) {
                innerAsy.push({ startLine: li, endLine: k });
                break;
              }
            }
          }
          inLC = 0;
          if (d2 === 0) break;
        }
      }
    }
    // Walk every line in [r.startLine, r.endLine]. If line has 'await'
    // AND line is NOT inside any innerAsy range, flag.
    for (let li = r.startLine; li <= r.endLine; li += 1) {
      const ln = lines[li];
      if (!/await/.test(ln)) continue;
      // Skip comments (lines starting with whitespace + //)
      if (/^\s*\/\//.test(ln)) continue;
      const inArrow = innerAsy.some((a) => li >= a.startLine && li <= a.endLine);
      if (!inArrow) {
        console.log(`${file}:${li + 1}: REAL BUG (in non-async "${r.name}" @ L${r.startLine + 1}): ${ln.trim().slice(0, 140)}`);
        total += 1;
      }
    }
  }
}
console.log(`\nTOTAL REAL OFFENDING SITES: ${total}\n`);
