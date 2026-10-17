'use strict';
// Explicit delivery allowlist. Never copy the workspace root wholesale.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { loadLocalEnv } = require('../lib/local-env');
const root = path.resolve(__dirname, '..');
const label = process.argv[2] || 'w14-delivery';
if (!/^[a-z0-9-]+$/.test(label)) throw Error('Use a simple output label');
const out = path.join(root, 'output', label);
if (fs.existsSync(out)) throw Error('Output already exists; use a new label (nothing overwritten)');
const top = ['server.js', 'package.json', 'package-lock.json', '.env.example', '.dockerignore', '.gitignore',
  'Dockerfile', 'render.yaml', 'Start-Citywalk.cmd', 'README.md', 'DEPLOY.md', 'AGENTS.md'];
const directories = ['lib', 'public', 'test', 'scripts', 'docs'];
const extensions = new Set(['.js','.mjs','.cjs','.json','.html','.css','.md','.jpg','.png','.svg','.txt']);
const blocked = /(^|\/)(?:node_modules|output|\.git|\.playwright-cli|cache|tmp)(\/|$)|\.(?:log|err|zip|pem|key|pfx)$/i;
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir,e.name);
    if(e.isSymbolicLink()) throw Error('Symlinks are not permitted in delivery');
    return e.isDirectory() ? walk(p) : [p];
  });
}
const files = [...top, ...directories.flatMap(dir => walk(path.join(root,dir)).map(p=>path.relative(root,p).replace(/\\/g,'/')))].sort();
const privateEnv = {};
// Values are used only for in-memory matching, never logged or put in reports.
loadLocalEnv(path.join(root,'.env'), privateEnv);
const secretKeys = /(?:TOKEN|API_KEY|SECRET|PASSWORD)$/i;
const secrets = [...Object.entries(privateEnv), ...Object.entries(process.env)]
  .filter(([k,v])=>secretKeys.test(k) && typeof v==='string' && v.trim().length>=8).map(([,v])=>Buffer.from(v.trim()));
const credentialPattern = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bsk-[A-Za-z0-9_-]{24,}\b/;
for (const file of files) {
  if (blocked.test(file) || (path.basename(file).startsWith('.env') && file!=='.env.example')) throw Error('Forbidden file: '+file);
  if (!top.includes(file) && !extensions.has(path.extname(file)) && !/^(?:LUCIDE-)?LICENSE(?:[.-].*)?$/i.test(path.basename(file))) throw Error('Unreviewed file type: '+file);
  const content = fs.readFileSync(path.join(root,file));
  if(secrets.some(s=>content.includes(s)) || credentialPattern.test(content.toString('utf8'))) throw Error('Credential check failed in '+file+' (value suppressed)');
}
const example = {};
loadLocalEnv(path.join(root,'.env.example'), example);
if (Object.entries(example).some(([k,v])=>secretKeys.test(k)&&v)) throw Error('Template contains a credential value');
const stage = path.join(out,'stage','CitywalkScope');
fs.mkdirSync(stage,{recursive:true});
const entries = files.map(file=>{
  const dest=path.join(stage,file), data=fs.readFileSync(path.join(root,file));
  fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,data);
  return {path:file,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')};
});
const manifest = {format:'citywalk-release',version:1,release:'W14',builtAt:new Date().toISOString(),
  files:entries,excludes:['real .env and credentials','node_modules','output/history','logs','temporary browser/cache files'],
  credentialCheck:'Configured local/environment secrets and recognizable private-key/API-key patterns; values never emitted. Not a universal secret detector.'};
fs.writeFileSync(path.join(stage,'RELEASE-MANIFEST.json'),JSON.stringify(manifest,null,2)+'\n');
const zip=path.join(out,'CitywalkScope-W14.zip'), extracted=path.join(out,'verified');
const quote=s=>"'"+s.replace(/'/g,"''")+"'";
execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',
  `Add-Type -AssemblyName System.IO.Compression.FileSystem\n[IO.Compression.ZipFile]::CreateFromDirectory(${quote(path.dirname(stage))},${quote(zip)})\n[IO.Compression.ZipFile]::ExtractToDirectory(${quote(zip)},${quote(extracted)})`],{stdio:'pipe'});
const unpacked=path.join(extracted,'CitywalkScope');
const actual=walk(unpacked).map(p=>path.relative(unpacked,p).replace(/\\/g,'/')).sort();
if(JSON.stringify(actual)!==JSON.stringify([...files,'RELEASE-MANIFEST.json'].sort())) throw Error('Archive inventory mismatch');
for(const file of [...files,'RELEASE-MANIFEST.json']) {
  if(!fs.readFileSync(path.join(stage,file)).equals(fs.readFileSync(path.join(unpacked,file)))) throw Error('Archive bytes mismatch: '+file);
}
const hash=createHash('sha256').update(fs.readFileSync(zip)).digest('hex');
fs.writeFileSync(zip+'.sha256',hash+'  '+path.basename(zip)+'\n');
fs.copyFileSync(path.join(stage,'RELEASE-MANIFEST.json'),path.join(out,'RELEASE-MANIFEST.json'));
const report={ok:true,fileCount:entries.length+1,zipBytes:fs.statSync(zip).size,zipSha256:hash,
  inventoryAndBytes:'Exact ZIP extraction comparison passed, including dotfiles',
  credentialCheck:'passed; real .env excluded; configured secret values not found; values suppressed',
  zip,unpacked};
fs.writeFileSync(path.join(out,'package-check.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
