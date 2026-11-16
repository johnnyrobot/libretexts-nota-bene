const {test,expect}=require('@playwright/test');const fs=require('node:fs');const path=require('node:path');const {Client}=require('pg');
const state=process.env.NB_BASELINE_STATE, settings=JSON.parse(fs.readFileSync(path.join(state,'settings.json'))),fixture=JSON.parse(fs.readFileSync(path.join(state,'fixture.json'))),proof=JSON.parse(fs.readFileSync(path.join(state,`workflow-${process.env.NB_BOOK_PROOF_RUN || 'book-pointer2'}.json`)));
fixture.apiOrigin=process.env.NB_TEST_API_ORIGIN || fixture.apiOrigin;
test('course students cannot read another author private replies through specific thread',async({request})=>{
 const sign=async account=>{const r=await request.post(fixture.apiOrigin+'/api/users/login',{data:{username:account.username,password:account.password}});expect(r.status()).toBe(200);return {Accept:'application/json',Authorization:'Bearer '+(await r.json()).token};};const alice=await sign(settings.users[0]),bob=await sign(settings.users[1]);
 const marker='LT577 owner-private reply fixture';const record=path.join(state,'private-reply-fixture.json');
 if(!fs.existsSync(record)){const r=await request.post(fixture.apiOrigin+'/api/annotations/reply/'+proof.annotationId,{headers:alice,data:{class:fixture.courseId,url:fixture.url,content:marker,visibility:'MYSELF',anonymity:'IDENTIFIED',tags:[],userTags:[]}});expect(r.status()).toBe(200);fs.writeFileSync(record,JSON.stringify(await r.json()),{mode:0o600,flag:'wx'});}
 const db=new Client({connectionString:settings.databaseUrl});await db.connect();let thread;try{thread=(await db.query('SELECT thread_id FROM annotations WHERE id=$1',[proof.annotationId])).rows[0].thread_id;}finally{await db.end();}
 const nestedMarker='LT577 public descendant under owner-private reply';
 const nestedRecord=path.join(state,'nested-private-reply-fixture.json');
 const privateIdForNested=JSON.parse(fs.readFileSync(record)).id;
 if(!fs.existsSync(nestedRecord)){const r=await request.post(fixture.apiOrigin+'/api/annotations/reply/'+privateIdForNested,{headers:alice,data:{class:fixture.courseId,url:fixture.url,content:nestedMarker,visibility:'EVERYONE',anonymity:'IDENTIFIED',tags:[],userTags:[]}});expect(r.status()).toBe(200);fs.writeFileSync(nestedRecord,JSON.stringify(await r.json()),{mode:0o600,flag:'wx'});}
 const endpoint=fixture.apiOrigin+'/api/annotations/specific_thread?'+new URLSearchParams({class_id:fixture.courseId,source_url:fixture.url,thread_id:thread});
 const owner=await request.get(endpoint,{headers:alice});expect(owner.status()).toBe(200);expect(await owner.text()).toContain(marker);
 const peer=await request.get(endpoint,{headers:bob});expect(peer.status()).toBe(200);expect(await peer.text()).not.toContain(marker);
 const listed=await request.get(fixture.apiOrigin+'/api/annotations/annotation?'+new URLSearchParams({class:fixture.courseId,url:fixture.url}),{headers:bob});expect(listed.status()).toBe(200);const visibleList=await listed.text();expect(visibleList).not.toContain(marker);expect(visibleList).not.toContain(nestedMarker);
 const children=await request.get(fixture.apiOrigin+'/api/annotations/reply/'+proof.annotationId,{headers:bob});expect(children.status()).toBe(200);expect(await children.text()).not.toContain(marker);
 const descendant=JSON.parse(fs.readFileSync(nestedRecord)).id;
 const descendantRead=await request.get(fixture.apiOrigin+'/api/annotations/reply/'+descendant,{headers:bob});expect(descendantRead.status()).toBe(403);
 const descendantWrite=await request.post(fixture.apiOrigin+'/api/annotations/reply/'+descendant,{headers:bob,data:{class:fixture.courseId,url:fixture.url,content:'denied nested reply',visibility:'EVERYONE',anonymity:'IDENTIFIED',tags:[],userTags:[]}});expect(descendantWrite.status()).toBe(403);
 const privateId=JSON.parse(fs.readFileSync(record)).id;
 for(const method of ['post','put','delete']){
  const route=method==='post'?'/reply/':'/annotation/';
  const denied=await request[method](fixture.apiOrigin+'/api/annotations'+route+privateId,{headers:bob,data:{class:fixture.courseId,url:fixture.url,content:'denied private target',visibility:'EVERYONE',anonymity:'IDENTIFIED',tags:[],userTags:[]}});expect(denied.status()).toBe(403);
 }

});
