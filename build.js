'use strict';
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');
// Ordre topologique (dépendances avant dépendants).
const ORDER = [
  'theory.js',
  'harmony.js',
  'global-timeline.js',
  'subject-generator.js',
  'validation.js',
  'answer.js',
  'voice-generator.js',
  'voice-round.js',
  'validate-exposition.js',
  'exposition.js',
  'development.js',
  'pedal.js',
  'stretto.js',
  'cadence.js',
];

let out = "'use strict';\n(function (global) {\n  const Lib = {};\n\n";

for (const file of ORDER) {
  let code = fs.readFileSync(path.join(SRC, file), 'utf8');
  code = code.replace(/^'use strict';\n/, '');
  // require('./xxx') -> Lib (toutes les exportations vivent dans le même espace de noms)
  code = code.replace(/require\(['"]\.\/[\w-]+['"]\)/g, 'Lib');
  // module.exports = { ... }; -> Object.assign(Lib, { ... });
  code = code.replace(/module\.exports\s*=\s*(\{[\s\S]*?\});?\s*$/m, 'Object.assign(Lib, $1);');
  out += `  // ---- ${file} ----\n`;
  out += '  {\n';
  out += code.split('\n').map(l => (l ? '    ' + l : l)).join('\n');
  out += '\n  }\n\n';
}

out += '  global.FugueLib = Lib;\n})(typeof window !== "undefined" ? window : globalThis);\n';

fs.writeFileSync(path.join(__dirname, 'fugue-lib.js'), out);
console.log('Bundle écrit :', path.join(__dirname, 'fugue-lib.js'), `(${out.length} octets)`);
