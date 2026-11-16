// Add native NB source records to the existing demo course; never seed users or posts.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
async function register({operatorDir, manifestPath, origin, port}) {
  const {parseOrigin} = require('./demo-config.cjs'); parseOrigin(origin);
  const body = fs.readFileSync(manifestPath);
  const manifest = JSON.parse(body);
  if (manifest.book !== 'social_psychology' || !Array.isArray(manifest.pages) || !manifest.pages.length) throw Error('Invalid book manifest');
  for (const p of manifest.pages) {
    if (!/^\/books\/social_psychology\/(?:[A-Za-z0-9_:/.%-]*\/)?$/.test(p.path) || p.path.includes('..') || !/^[a-f0-9]{64}$/.test(p.sha256)) throw Error('Invalid chapter');
  }
  const digest = crypto.createHash('sha256').update(body).digest('hex');
  const receiptPath = path.join(operatorDir,'textbook-registration.json');
  if (fs.existsSync(receiptPath)) {
    const prior=JSON.parse(fs.readFileSync(receiptPath));
    if(prior.digest !== digest || prior.origin !== origin) throw Error('Registered content changed: preserve prior version');
    return {reused:true,count:prior.sources.length};
  }
  const settings=JSON.parse(fs.readFileSync(path.join(operatorDir,'settings.json')));
  const fixture=JSON.parse(fs.readFileSync(path.join(operatorDir,'fixture.json')));
  const call = (method, pathname, data, token) => new Promise((resolve,reject)=>{
    const req=http.request({hostname:'127.0.0.1',port,path:pathname,method,headers:{accept:'application/json','content-type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})}},res=>{
      let result='';res.on('data',x=>result+=x);res.on('end',()=>{if(res.statusCode!==200)return reject(Error(`Native API status ${res.statusCode}`));try{resolve(JSON.parse(result));}catch{reject(Error('Native JSON required'));}});
    });req.setTimeout(15000,()=>req.destroy(Error('Timeout')));req.on('error',reject);req.end(data?JSON.stringify(data):undefined);
  });
  const login=await call('POST','/api/users/login',{username:settings.users[0].username,password:settings.users[0].password});
  const folder=await call('GET',`/api/files/class/${fixture.courseId}`,null,login.token);
  const existing=await call('GET',`/api/files/folder/${folder.id}`,null,login.token);
  const sources=[];
  for(const page of manifest.pages){
    const url=origin+page.path;
    const file=existing.find(x=>x.Source?.filepath===url) || await call('POST',`/api/files/file/${folder.id}`,{name:page.title,url},login.token);
    if(!file.id)throw Error('Native source creation failed');
    sources.push({url,id:file.id,sha256:page.sha256});
  }
  fs.writeFileSync(receiptPath,JSON.stringify({origin,digest,courseId:fixture.courseId,sources},null,2)+'\n',{flag:'wx',mode:0o600});
  return {reused:false,count:sources.length};
}
module.exports={register};
if(require.main===module)register({operatorDir:process.env.NB_DEMO_OPERATOR_DIR,manifestPath:process.env.NB_TEXTBOOK_MANIFEST,origin:process.env.NB_DEMO_ORIGIN,port:Number(process.env.NB_DEMO_PORT)}).then(x=>console.log(JSON.stringify(x))).catch(()=>{console.error('Textbook registration failed; preserve state and inspect native API status without exposing credentials.');process.exitCode=1;});
