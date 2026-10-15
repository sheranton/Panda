// Minimal Valve KeyValues (VDF) parser. Handles libraryfolders.vdf and appmanifest_*.acf.
// Unescapes \\ and \" inside quoted strings so stored Windows paths come out clean.
function parseVDF(text) {
  let i = 0;
  const n = text.length;

  function skipWs() {
    while (i < n) {
      const c = text[i];
      if (c === ' ' || c === '\t' || c === '\r' || c === '\n') { i++; continue; }
      if (c === '/' && text[i + 1] === '/') { while (i < n && text[i] !== '\n') i++; continue; }
      break;
    }
  }

  function readString() {
    i++; // skip opening quote
    let s = '';
    while (i < n && text[i] !== '"') {
      if (text[i] === '\\') {
        i++;
        const e = text[i];
        s += e === 'n' ? '\n' : e === 't' ? '\t' : e; // \\ -> \ , \" -> "
        i++;
        continue;
      }
      s += text[i++];
    }
    i++; // skip closing quote
    return s;
  }

  function parseObject() {
    const obj = {};
    skipWs();
    while (i < n && text[i] !== '}') {
      if (text[i] !== '"') { i++; continue; }
      const key = readString();
      skipWs();
      if (text[i] === '{') { i++; obj[key] = parseObject(); }
      else if (text[i] === '"') { obj[key] = readString(); }
      skipWs();
    }
    i++; // skip closing brace
    return obj;
  }

  const root = {};
  skipWs();
  while (i < n) {
    skipWs();
    if (i >= n || text[i] !== '"') { if (i < n) { i++; continue; } break; }
    const key = readString();
    skipWs();
    if (text[i] === '{') { i++; root[key] = parseObject(); }
    else if (text[i] === '"') { root[key] = readString(); }
    else break;
    skipWs();
  }
  return root;
}

module.exports = { parseVDF };
