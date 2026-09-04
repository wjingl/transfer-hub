import { readFileSync, writeFileSync } from 'node:fs';

const targets = process.argv.slice(2);
const A = 'fetch(binaryFile,{credentials:"same-origin"})';
const B = 'fetch(url,{credentials:"same-origin"})';
const HELPER = `function secureFetchSameOrigin(u){var b=(typeof self!=='undefined'&&self.location)?self.location:location;var a=new URL(u,b.href);if(!a||a.origin!==b.origin){throw new Error('Transfer Hub blocked cross-origin resource: '+u)}return fetch(a,{credentials:'same-origin'})}`;

for (const file of targets) {
  let source = readFileSync(file, 'utf8');
  let changed = false;
  if (source.includes(A)) {
    source = source.split(A).join('secureFetchSameOrigin(binaryFile)');
    changed = true;
  }
  if (source.includes(B)) {
    source = source.split(B).join('secureFetchSameOrigin(url)');
    changed = true;
  }
  if (changed && !source.includes('function secureFetchSameOrigin')) {
    source = source.trimEnd() + ';' + HELPER + '\n';
  }
  writeFileSync(file, source);
  console.log('patched', changed, file);
}
