import {_electron as electron} from "playwright";
import {createServer} from "node:http";
import {join,resolve} from "node:path";
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,existsSync} from "node:fs";
import assert from "node:assert/strict";
const root=resolve(import.meta.dirname,".."),version=JSON.parse(readFileSync(join(root,"package.json"))).version,scale=process.env.PICAREER_SCALE??"1.25";
const fixtures=join(root,".test-data/resume-fixtures"),out=join(root,`.test-data/resume-${version}-${process.env.PICAREER_EXE?"packaged":"dev"}-${scale}`);mkdirSync(out,{recursive:true});const data=mkdtempSync(join(out,"data-"));
let requests=0;
const server=createServer(async(req,res)=>{
 let body="";for await(const chunk of req)body+=chunk;requests++;
 const value=JSON.parse(body),last=value.messages.at(-1),raw=typeof last.content==="string"?last.content:last.content.filter(x=>x.type==="text").map(x=>x.text).join("\n");let content;
 const input=JSON.parse(raw);
 if(input.units){const u=input.units.find(u=>u.purpose!=="template");content=JSON.stringify({facts:u?[{text:"材料包含检索与工具调用",evidence:[{unitId:u.id,quote:u.text.slice(0,Math.min(80,u.text.length))}]}]:[],questions:[{question:"你在这个项目中负责什么？"}],templateSuggestion:"参考模板突出科研成果，建议采用科研重点单栏版式。",templateProposal:{template:"research",order:["education","research","projects","skills","work","awards"]}});}
 else content=JSON.stringify([{kind:"project",name:"检索与工具调用项目",time:"",role:"",bullets:[{text:"实现检索函数与工具调用编排，组织基于材料的回答流程。",factIds:[input.facts.find(f=>f.id.startsWith("answer:"))?.id??"input:projects"]},{text:"编写检索单元测试，处理无结果情况。",factIds:[input.facts.find(f=>f.id.startsWith("answer:"))?.id??"input:projects"]}]}]);
 res.writeHead(200,{"Content-Type":"text/event-stream"});const event=(delta,finish_reason=null)=>res.write(`data: ${JSON.stringify({id:"resume-check",object:"chat.completion.chunk",created:1,model:"mock-resume",choices:[{index:0,delta,finish_reason}]})}\n\n`);
 event({role:"assistant"});event({content});event({},"stop");res.end("data: [DONE]\n\n");
});await new Promise(ok=>server.listen(0,"127.0.0.1",ok));
let app,page;const errors=[];
const launch=async()=>{app=await electron.launch({executablePath:process.env.PICAREER_EXE??join(root,"node_modules/electron/dist/electron.exe"),args:[...(process.env.PICAREER_EXE?[]:[root]),`--force-device-scale-factor=${scale}`],env:{...process.env,PICAREER_TEST_DATA:data,PICAREER_DASHBOARD_AUTOSTART:"0"},timeout:60000});page=await app.firstWindow();page.on("pageerror",e=>errors.push(e.message));await page.getByRole("heading",{name:"PiCareer工作台"}).waitFor({timeout:60000});await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.setSize(1080,800);w.showInactive();});};
const call=(method,input=null)=>page.evaluate(({method,input})=>window.picareer.call(method,input),{method,input});
const edit=(d)=>({id:d.id,revision:d.revision,title:d.title,mode:d.mode,step:d.step,jd:d.jd,fields:d.fields,layout:d.layout,facts:d.facts,questions:d.questions,experiences:d.experiences,selections:Object.fromEntries(d.materials.flatMap(m=>m.units.map(u=>[u.id,u.selected])))});
const importPath=async(id,purpose,path)=>{await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},path);return call("chooseResumeMaterials",{id,purpose,directory:false});};
try{
 await launch();assert.equal(await page.locator(".side-note").count(),0);await page.getByRole("button",{name:"简历优化",exact:true}).click();
 await page.getByRole("button",{name:/^经历优化/}).click();await page.getByLabel("草稿名称").fill("离线草稿");await page.getByRole("button",{name:"保存",exact:true}).click();assert.equal(requests,0);
 let d=(await call("resumeList"))[0];assert.equal(d.title,"离线草稿");await assert.rejects(call("exportResume",{id:d.id,format:"pdf",allowPlaceholders:true}),/填写简历栏目|生成经历/);
 await call("settings",{provider:"custom",model:"mock-resume",baseUrl:`http://127.0.0.1:${server.address().port}/v1`,api:"openai-completions",key:"fixture-only"});
 for(const [purpose,path] of [["project","中文 Agent 项目"],["research","研究记录.pdf"],["research","科研说明.docx"],["research","扫描材料.pdf"],["template","科研模板.png"]]){d=await importPath(d.id,purpose,join(fixtures,path));assert.equal(d.run.status,"complete",d.run.stage);}
 assert.ok(d.materials.some(m=>m.units.some(u=>u.image&&u.location.includes("扫描"))));assert.ok(d.materials.some(m=>m.units.some(u=>u.location.includes("段落"))));assert.ok(!d.materials.flatMap(m=>m.units).some(u=>u.text.includes("not-a-real-key")));
 const noVision=await call("analyzeResume",{id:d.id});assert.equal(noVision.run.status,"failed");assert.match(noVision.run.stage,/不支持图片/);d=noVision;
 let e=edit(d);for(const m of d.materials)for(const u of m.units)if(u.image)e.selections[u.id]=false;d=await call("saveResume",e);
 await page.getByRole("button",{name:"分析材料与岗位",exact:true}).click();await page.getByRole("dialog",{name:"确认发送材料"}).waitFor();assert.ok((await page.locator(".resume-send-list").textContent()).includes("研究记录.pdf"));await page.getByRole("button",{name:"确认并分析",exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll(".resume-question").length>0);
 d=(await call("resumeList")).find(x=>x.id===d.id);e=edit(d);e.facts.forEach(f=>f.confirmed=true);e.questions.forEach(q=>q.answer="本人负责检索函数、工具调用编排与单元测试；没有性能增益指标。");d=await call("saveResume",e);await page.getByRole("button",{name:"依据确认内容生成经历",exact:true}).click();await page.getByRole("heading",{name:"经历文稿",exact:true}).waitFor();d=(await call("resumeList")).find(x=>x.id===d.id);assert.equal(d.run.status,"complete",d.run.stage);
 await page.getByRole("button",{name:"复制全部经历",exact:true}).click();const clipboard=await app.evaluate(({clipboard})=>clipboard.readText());assert.match(clipboard,/检索函数/);assert.ok(!clipboard.includes("factIds"));
 await page.getByRole("button",{name:"生成预览",exact:true}).click();await page.locator(".resume-preview").waitFor();await page.frameLocator(".resume-preview").locator("h1").waitFor();assert.match(await page.frameLocator(".resume-preview").locator("body").textContent(),/检索/);
 const exportDraft=async(d,name)=>{for(const format of ["pdf","docx"]){const target=join(out,`${name}.${format}`);await app.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path});},target);const result=await call("exportResume",{id:d.id,format,allowPlaceholders:true});assert.ok(result.path,result.warning);assert.ok(readFileSync(target).length>1000);}};
 await exportDraft(d,"experience");
 let full=await call("createResume",{mode:"full"});e=edit(full);e.fields.education="测试大学 · 计算机科学硕士\n研究方向：智能体与检索系统";e.fields.skills="Python、TypeScript、RAG、工具调用、单元测试";e.fields.projects="本人负责检索函数、工具编排与单元测试，没有已测量性能增益。";e.fields.research="检索与工具调用研究记录，未投稿、未录用、未发表。";e.fields.awards="";e.step=8;full=await call("saveResume",e);full=await call("generateResume",{id:full.id});assert.equal(full.run.status,"complete",full.run.stage);
 full=await importPath(full.id,"photo",join(fixtures,"测试照片.png"));e=edit(full);e.step=9;e.layout.template="research";full=await call("saveResume",e);
 await page.locator(".resume-drafts button").filter({hasText:"完整简历"}).first().click();await page.getByRole("button",{name:"生成预览",exact:true}).click();await page.frameLocator(".resume-preview").locator(".photo").waitFor();await exportDraft(full,"full-research");
 const over=edit(full);over.fields.work="长文本分页检验：实现项目测试与资料整理。\n".repeat(160);full=await call("saveResume",over);const overflow=await call("exportResume",{id:full.id,format:"pdf",allowPlaceholders:true});assert.ok(overflow.warning&&overflow.pages>1);
 const restore=edit(full);restore.fields.work="";full=await call("saveResume",restore);
 const geometry=await page.evaluate(()=>({width:innerWidth,scroll:document.querySelector(".main").scrollWidth,viewport:document.querySelector(".main").clientWidth}));assert.ok(geometry.scroll<=geometry.viewport+1);await page.screenshot({path:join(out,"resume.png")});
 await app.close();await launch();await page.getByRole("button",{name:"简历优化",exact:true}).click();const recovered=await call("resumeList");assert.ok(recovered.some(x=>x.id===full.id&&x.fields.education.includes("测试大学")));assert.ok(recovered.some(x=>x.id===d.id&&x.experiences.length));
 await call("deleteResume",{id:d.id});await call("deleteResume",{id:full.id});assert.ok(existsSync(join(fixtures,"中文 Agent 项目/agent.py")));assert.equal((await call("resumeList")).length,0);assert.deepEqual(errors,[]);
 const result={version,scale,passed:true,requests,offlineDraft:true,textPDFDOCXAndScannedPDFParsed:true,credentialExclusion:true,visionCapabilityGuard:true,actualPiWithMockModel:true,evidenceAndQuestions:true,clipboard:true,preview:true,docxAndPDFExport:true,photoAndResearchTemplate:true,overflowBlocked:true,restartRecovery:true,deletePreservesOriginal:true,geometry,errors};writeFileSync(join(out,"result.json"),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await app?.close();server.close();}
