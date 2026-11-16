// Read-only guard: compare the candidate before activation, never after changing served content.
const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');
function checkBinding(manifestPath,operatorDir,origin){
 if(!fs.existsSync(manifestPath))return; // Code-only rollback to the sample does not reanchor book records.
 const digest=crypto.createHash('sha256').update(fs.readFileSync(manifestPath)).digest('hex');
 for(const name of ['textbook-registration.json','textbook-registration.json.intent']){
  const file=path.join(operatorDir,name);if(!fs.existsSync(file))continue;
  const saved=JSON.parse(fs.readFileSync(file));
  if(saved.digest!==digest || saved.origin!==origin)throw Error('Textbook content binding differs; activation refused before switching releases.');
 }
}
module.exports={checkBinding};
if(require.main===module){try{checkBinding(process.argv[2],process.argv[3],process.argv[4]);}catch{console.error('Textbook binding mismatch; preserve the current release and registration state.');process.exitCode=1;}}
