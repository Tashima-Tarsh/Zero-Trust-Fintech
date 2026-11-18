'use strict';
/* Fail build/release when one of the three deployment roots lags behind
 * the canonical frontend assets in public/. Includes images and binary files. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
function listFiles(dir,base=''){
 return fs.readdirSync(dir,{withFileTypes:true}).flatMap(ent=>{
  const rel=path.join(base,ent.name),full=path.join(dir,ent.name);
  return ent.isDirectory()?listFiles(full,rel):[rel];
 }).sort();
}
const source=path.join(root,'public'),files=listFiles(source);
assert.ok(files.length>=65,'Canonical frontend appears incomplete');
for(const output of ['dist','disha-cinematic/public','disha-cinematic/dist']){
 const dir=path.join(root,output);
 for(const file of files){
  const target=path.join(dir,file),origin=path.join(source,file);
  assert.ok(fs.existsSync(target),output+'/'+file+' is missing: run npm run build');
  assert.ok(fs.readFileSync(target).equals(fs.readFileSync(origin)),output+'/'+file+' differs from public/: run npm run build');
 }
}
const manifest=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
assert.equal(manifest.scripts.build,'node scripts/build.js','Root build must not silently skip asset synchronization');
console.log('FRONTEND_PARITY_PASS: '+files.length+' canonical assets synchronized across three deployment directories');
