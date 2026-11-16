const {test,expect}=require('@playwright/test');const fs=require('node:fs');const path=require('node:path');const {Client}=require('pg');
const state=process.env.NB_BASELINE_STATE;const settings=JSON.parse(fs.readFileSync(path.join(state,'settings.json')));const fixture=JSON.parse(fs.readFileSync(path.join(state,'fixture.json')));fixture.apiOrigin=process.env.NB_TEST_API_ORIGIN || fixture.apiOrigin;const proof=JSON.parse(fs.readFileSync(path.join(state,'workflow-book-pointer2.json')));const outsider=JSON.parse(fs.readFileSync(path.join(state,'outsider.json')));
test('out-of-course mutations are denied before any discussion rows change',async({request})=>{
 const db=new Client({connectionString:settings.databaseUrl});await db.connect();
 const snapshot=async()=>{const result={};for(const table of ['annotations','threads','locations','html_locations','tags','user_seen','user_replied','stars','bookmarks','reply_requests','user_tags']){try{const q=await db.query(`SELECT count(*)::int AS n, md5(coalesce(json_agg(t ORDER BY row_to_json(t)::text)::text,'[]')) AS digest FROM "${table}" t`);result[table]=q.rows[0];}catch(e){if(e.code!=='42P01')throw e;}}return result;};
 const login=await request.post(fixture.apiOrigin+'/api/users/login',{data:{username:outsider.username,password:outsider.password}});expect(login.status()).toBe(200);const token=(await login.json()).token;
 const headers={Accept:'application/json',Authorization:'Bearer '+token};const body={class:fixture.courseId,url:fixture.url,content:'LT577 denied outsider mutation',visibility:'EVERYONE',anonymity:'IDENTIFIED',tags:[],userTags:[],range:{start:'/html/body/main/p/text()',end:'/html/body/main/p/text()',startOffset:0,endOffset:1}};
 const thread=(await db.query('SELECT thread_id FROM annotations WHERE id=$1',[proof.annotationId])).rows[0].thread_id;
 const forbiddenRead=await request.get(fixture.apiOrigin+'/api/annotations/specific_thread?'+new URLSearchParams({class_id:fixture.courseId,source_url:fixture.url,thread_id:thread}),{headers});
 expect(forbiddenRead.status()).toBe(403);
 const before=await snapshot();const outcomes=[];
 try{
  for(const [method,route] of [['post','/reply/'+proof.annotationId],['post','/annotation'],['put','/annotation/'+proof.annotationId],['delete','/annotation/'+proof.annotationId],['post','/seen/'+proof.annotationId],['post','/star/'+proof.annotationId],['post','/replyRequest/'+proof.annotationId],['post','/bookmark/'+proof.annotationId]]){
   const response=await request[method](fixture.apiOrigin+'/api/annotations'+route,{headers,data:body});const text=await response.text();outcomes.push({method,route,status:response.status()});expect([403,404]).toContain(response.status());expect(text).not.toContain('How does this passage');expect(await snapshot()).toEqual(before);
  }
  fs.writeFileSync(path.join(process.env.NB_BASELINE_RESULTS,'access.json'),JSON.stringify({outcomes,before,after:await snapshot(),noDiscussionRowChange:true},null,2));
 }finally{await db.end();}
});
