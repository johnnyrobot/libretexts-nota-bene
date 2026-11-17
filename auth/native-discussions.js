// Native NB authorization at the existing discussion router boundary (LT-577).
// Derive source/course from the stored annotation for ID-based operations; never trust a caller's class.
const db = require('../models');
const courseInclude = { association:'Class', include:[
 {association:'Instructors',attributes:['id']}, {association:'ClassTAs',attributes:['id']},
 {association:'GlobalSection',include:[{association:'MemberStudents',attributes:['id']}]}
]};
function membership(course,id){
 const staff=[...(course.Instructors||[]),...(course.ClassTAs||[])].some(x=>x.id===id);
 return {staff, member:staff || (course.GlobalSection?.MemberStudents||[]).some(x=>x.id===id)};
}
function visible(annotation,id,staff){
 return (annotation.author_id || annotation.Author?.id)===id || annotation.visibility==='EVERYONE' || (staff && annotation.visibility==='INSTRUCTORS');
}
function threadReader(family,head,id,staff){
 const byId=new Map(family.map(annotation=>[annotation.id,annotation]));
 if(head)byId.set(head.id,head);
 return annotation=>{
  const seen=new Set();let current=annotation;
  while(current){
   if(seen.has(current.id) || !visible(current,id,staff))return false;
   seen.add(current.id);
   if(current.id===head?.id)return true;
   const parentId=current.Parent?.id || current.parent_id;
   if(!parentId)return false;
   current=byId.get(parentId);
  }
  return false;
 };
}
module.exports = async function authorizeDiscussion(req,res,next){
 if(/^\/myClasses\/?$/i.test(req.path))return next();
 try {
  const suppliedClasses=[req.query.class,req.query.class_id,req.body?.class].filter(x=>x!==undefined);
  const suppliedUrls=[req.query.url,req.query.source_url,req.body?.url].filter(x=>x!==undefined);
  if(suppliedClasses.some(x=>typeof x!=='string' || x!==suppliedClasses[0]) || suppliedUrls.some(x=>typeof x!=='string' || x!==suppliedUrls[0]))return res.sendStatus(403);
  const match=req.path.match(/^\/(?:media\/)?(annotation|reply|seen|star|replyRequest|bookmark)\/([^/]+)\/?$/i);
  let course,source,target,thread;
  if(/^\/specific_thread\/?$/i.test(req.path)) {
   thread=await db.Thread.findByPk(req.query.thread_id,{include:[{association:'HeadAnnotation'},{association:'Location',include:[{association:'Source',include:[courseInclude]}]}]});
   target=thread?.HeadAnnotation;source=thread?.Location?.Source;course=source?.Class;
   if(!target || !course)return res.sendStatus(404);
  }else if(match){
   target=await db.Annotation.findByPk(decodeURIComponent(match[2]),{include:[{association:'Thread',include:[{association:'HeadAnnotation'},{association:'Location',include:[{association:'Source',include:[courseInclude]}]}]}]});
   thread=target?.Thread;source=thread?.Location?.Source;course=source?.Class;
   if(!target || !course)return res.sendStatus(404);

  }else{
   const classId=req.query.class || req.query.class_id || req.body?.class;
   if(!classId)return res.sendStatus(400);
   course=await db.Class.findByPk(classId,{include:courseInclude.include});
   if(!course)return res.sendStatus(404);
  }
  if(source){
   const requestedClass=req.query.class || req.query.class_id || req.body?.class;
   const requestedUrl=req.query.url || req.query.source_url || req.body?.url;
   if((requestedClass && requestedClass!==course.id) || (requestedUrl && requestedUrl!==source.filepath))return res.sendStatus(403);
  }
  const access=membership(course,req.user.id);
  if(!access.member)return res.sendStatus(403);
  if(target){
   const family=await db.Annotation.findAll({where:{thread_id:thread.id},attributes:['id','author_id','visibility','parent_id']});
   if(!threadReader(family,thread.HeadAnnotation,req.user.id,access.staff)(target))return res.sendStatus(403);
   if(['PUT','PATCH','DELETE'].includes(req.method) && target.author_id!==req.user.id && !access.staff)return res.sendStatus(403);
  }
  return next();
 }catch{return res.sendStatus(400);}
};

module.exports.canRead=visible;

module.exports.threadReader=threadReader;
