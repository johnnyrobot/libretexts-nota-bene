const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const http=require('node:http');
const {register}=require('../scripts/textbook-register.cjs');
test('interrupted source creation pins intent before writes and rejects changed resume',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nb-register-'));const manifest=path.join(dir,'book.json');
 const data={book:'social_psychology',pages:[{path:'/books/social_psychology/a/',title:'A',sha256:'a'.repeat(64)},{path:'/books/social_psychology/b/',title:'B',sha256:'b'.repeat(64)}]};
 fs.writeFileSync(manifest,JSON.stringify(data));fs.writeFileSync(path.join(dir,'settings.json'),JSON.stringify({users:[{username:'synthetic',password:'task-only'}]}));fs.writeFileSync(path.join(dir,'fixture.json'),JSON.stringify({courseId:'course'}));let writes=0;
 const server=http.createServer((req,res)=>{res.setHeader('content-type','application/json');if(req.url==='/api/users/login')return res.end('{"token":"synthetic"}');if(req.url==='/api/files/class/course')return res.end('{"id":"folder"}');if(req.method==='GET')return res.end('[]');writes++;if(writes===2){res.statusCode=503;return res.end('{}');}res.end('{"id":"source-a"}');}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const args={operatorDir:dir,manifestPath:manifest,origin:'https://nb.example',port:server.address().port};
 try{await assert.rejects(register(args));assert.equal(writes,2);data.pages[0].sha256='c'.repeat(64);fs.writeFileSync(manifest,JSON.stringify(data));await assert.rejects(register(args));assert.equal(writes,2,'changed retry must not create another source');}finally{await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true});}
});
