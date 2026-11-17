// Local synthetic verification only. Never included as a host activation step.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
async function setup(){
 if(process.env.NB_ALLOW_SYNTHETIC_FIXTURES!=='1')throw Error('Explicit local fixture opt-in required');
 const dir=process.env.NB_BASELINE_STATE,origin=new URL(process.env.NB_DEMO_ORIGIN),port=Number(process.env.NB_DEMO_PORT);
 if(!dir || !path.isAbsolute(dir) || !origin.hostname.endsWith('.localhost') || origin.protocol!=='https:' || !Number.isInteger(port) || port<1024 || port>65535)throw Error('Use isolated localhost state and port');
 const settings=JSON.parse(fs.readFileSync(path.join(dir,'settings.json')));
 if(settings.users.length!==2 || settings.users.some(u=>!u.email.endsWith('@demo.invalid')))throw Error('Synthetic accounts required');
 const fixturePath=path.join(dir,'fixture.json'),fixture=JSON.parse(fs.readFileSync(fixturePath));
 const registration=JSON.parse(fs.readFileSync(path.join(dir,'textbook-registration.json')));
 const entry=registration.sources.find(s=>s.url.includes('/13.01:_Conflict_Cooperation_Morality_and_Fairness/'));
 if(!entry || registration.origin!==origin.origin || registration.courseId!==fixture.courseId)throw Error('Register the native book first');
 const sample=path.join(dir,'sample-fixture.json');if(!fs.existsSync(sample))fs.writeFileSync(sample,JSON.stringify(fixture),{mode:0o600,flag:'wx'});
 fixture.url=entry.url;fixture.apiOrigin=origin.origin;fs.writeFileSync(fixturePath,JSON.stringify(fixture),{mode:0o600});
 const file=path.join(dir,'outsider.json');let user;
 if(fs.existsSync(file))user=JSON.parse(fs.readFileSync(file));else{user={username:'outside_'+crypto.randomBytes(8).toString('hex'),first:'Outside',last:'Synthetic',email:'outside@demo.invalid',password:crypto.randomBytes(16).toString('hex')};fs.writeFileSync(file,JSON.stringify(user),{flag:'wx',mode:0o600});}
 const call=(method,uri,body,token)=>new Promise((resolve,reject)=>{const q=http.request({hostname:'127.0.0.1',port,path:uri,method,headers:{accept:'application/json','content-type':'application/json',...(token?{Authorization:'Bearer '+token}:{})}},r=>{let s='';r.on('data',x=>s+=x);r.on('error',()=>reject(Error('Local fixture response failed')));r.on('end',()=>{try{resolve({status:r.statusCode,data:JSON.parse(s)});}catch{reject(Error('Local fixture JSON required'));}});});q.setTimeout(15000,()=>q.destroy(Error('Local fixture timeout')));q.on('error',reject);q.end(body?JSON.stringify(body):undefined);});
 let login=await call('POST','/api/users/login',{username:user.username,password:user.password});if(login.status===401){const made=await call('POST','/api/users/register',user);if(made.status!==200)throw Error('Local fixture registration failed');login=await call('POST','/api/users/login',{username:user.username,password:user.password});}if(login.status!==200)throw Error('Local fixture login failed');
 const courses=await call('GET','/api/annotations/myClasses?'+new URLSearchParams({url:entry.url}),null,login.data.token);if(courses.status!==200 || !Array.isArray(courses.data) || courses.data.length)throw Error('Refusal actor must be outside the course');
 console.log('Local book fixture and nonmember ready. No posts created.');
}
setup().catch(()=>{console.error('Local fixture setup refused; preserve state and check synthetic configuration.');process.exitCode=1;});
