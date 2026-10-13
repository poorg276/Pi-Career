// Real public endpoints; all application writes go to an isolated test profile.
import { _electron as electron } from "playwright";
import { join, resolve } from "node:path";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
const root=resolve(import.meta.dirname,".."), version=JSON.parse(readFileSync(join(root,"package.json"),"utf8")).version;
const out=join(root, ".test-data", `recruitment-${version}-${process.env.PICAREER_EXE ? "packaged" : "dev"}`);
mkdirSync(out,{recursive:true});
const data=mkdtempSync(join(out,"profile-"));
if(process.argv.includes("--real-account")) {
	const state=join(process.env.APPDATA,"PiCareer","Local State");
	if(existsSync(state)) copyFileSync(state,join(data,"Local State"));
	const source=new DatabaseSync(join(process.env.APPDATA,"PiCareer","picareer.sqlite"),{readOnly:true}), target=new DatabaseSync(join(data,"picareer.sqlite"));
	try {
		target.exec("CREATE TABLE records (kind TEXT NOT NULL,id TEXT NOT NULL,value TEXT NOT NULL,updated TEXT NOT NULL,PRIMARY KEY(kind,id)); PRAGMA user_version=1;");
		for(const row of source.prepare("SELECT * FROM records WHERE kind IN ('config','secrets','secret-index')").all()) target.prepare("INSERT INTO records VALUES(?,?,?,?)").run(row.kind,row.id,row.value,row.updated);
	}finally{source.close();target.close();}
}
const app=await electron.launch({executablePath:process.env.PICAREER_EXE ?? join(root,"node_modules/electron/dist/electron.exe"),args:process.env.PICAREER_EXE ? [] : [root],env:{...process.env,PICAREER_TEST_DATA:data,PICAREER_DASHBOARD_AUTOSTART:"0"},timeout:60000});
const evidence={version,realNetwork:true,packaged:!!process.env.PICAREER_EXE,at:new Date().toISOString(),cases:[],passed:false};
try{
	const page=await app.firstWindow();await page.getByRole("heading",{name:"PiCareer工作台"}).waitFor({timeout:60000});
	await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].showInactive());
	const call=(method,input={})=>page.evaluate(({method,input})=>window.picareer.call(method,input),{method,input});
	assert.equal((await call("state")).settings.hasSearchKey,false,"Must verify keyless search");
	page.on("console",m=>{if(m.text().startsWith("RECRUITMENT_CHECK"))console.log(m.text());});
	await page.evaluate(()=>window.picareer.onEvent(e=>{if(e.type==="jobProgress")console.log("RECRUITMENT_CHECK "+e.stage);}));
	for(const filters of [{city:"",company:"万兴科技",role:""},{city:"长沙",company:"万兴科技",role:"Agent开发"}]){
		const result=await call("jobs",{...filters,requestId:crypto.randomUUID()});
		evidence.cases.push(result);console.log(JSON.stringify({filters,matched:result.matched.length,status:result.status,warnings:result.warnings}));
		assert.ok(result.portals.length>=2);assert.ok(result.matched.length>0);
		assert.ok(result.matched.every(j=>j.verification==="verified" && j.match.company==="matched" && /任职要求|任职资格/.test(j.jd)));
		if(!filters.role)assert.equal(result.matched.length,10);
		else{
			assert.ok(result.matched.some(j=>/Agent/i.test(j.role) && /长沙/.test(j.city)));
			const jd=await call("prepareJobJD",{job:result.matched[0]});assert.equal(jd.status,"ready");assert.match(jd.text,/任职要求/);evidence.jd=jd;
			// Verify the generated original URL is an actual, readable official detail page.
			evidence.original=await app.evaluate(async({session,BrowserWindow},url)=>{
				const s=session.fromPartition("accept-original-"+Date.now(),{cache:false});await s.setProxy({mode:"system"});s.setPermissionRequestHandler((_w,_p,done)=>done(false));
				const w=new BrowserWindow({show:false,webPreferences:{session:s,nodeIntegration:false,contextIsolation:true,sandbox:true}});w.webContents.setWindowOpenHandler(()=>({action:"deny"}));
				try{await w.loadURL(url);await new Promise(r=>setTimeout(r,5000));return{url:w.webContents.getURL(),text:(await w.webContents.executeJavaScript("document.body.innerText")).slice(0,8000)};}finally{w.destroy();}
			},result.matched[0].url);assert.match(evidence.original.text,/Agent/);assert.match(evidence.original.text,/职责|要求/);
		}
	}
	await page.getByRole("button",{name:"企业岗位",exact:true}).click();await page.getByLabel("目标企业",{exact:true}).fill("万兴科技");await page.getByRole("button",{name:"搜索岗位",exact:true}).click();
	await page.getByRole("heading",{name:"严格匹配 · 10",exact:true}).waitFor({timeout:60000});
	const portalBox=await page.getByRole("heading",{name:"官方招聘入口",exact:true}).boundingBox(), jobBox=await page.locator(".job").first().boundingBox();assert.ok(portalBox.y<jobBox.y);
	await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].showInactive());
	await page.screenshot({path:join(out,"official-results.png")});
	const first=page.locator(".job").first();
	for(const [button,heading] of [["匹配知识点","八股知识背诵"],["准备面试","模拟面试"]]){
		await first.getByRole("button",{name:button,exact:true}).click();await page.getByRole("heading",{name:heading,exact:true}).waitFor({timeout:45000});
		assert.match(await page.getByLabel(/目标岗位 JD|岗位 JD/).inputValue(),/岗位职责/);
		await page.getByRole("button",{name:"← 返回岗位检索",exact:true}).click();await page.getByRole("heading",{name:"严格匹配 · 10",exact:true}).waitFor();
	}
	if(process.argv.includes("--real-account")){
		assert.match(await call("testModel"),/连接成功/);evidence.modelConnection=true;
		const chat=await call("createChat",{});const reply=await call("chat",{id:chat.id,text:"请调用 web_fetch 读取 https://www.wondershare.cn/about/join-us.html ，根据实际网页用一句中文说明其招聘入口，附该网页链接。"});
		assert.equal(reply.run.status,"complete");assert.ok(reply.entries.some(e=>e.role==="tool" && e.name==="web_fetch" && e.status==="complete"));assert.ok(reply.turns.at(-1).context.tokens>0);evidence.chatNetworkAndContext=true;
	}
	await app.evaluate(({shell})=>{shell.openExternal=async()=>{};});
	evidence.navigationAndOfficialLinks=true;evidence.passed=true;
}catch(error){
	const page=await app.firstWindow();console.log((await page.locator("body").textContent()).slice(0,2200));throw error;
}finally{
	writeFileSync(join(root,"docs/evidence",`recruitment-live-${version}-${evidence.packaged?"packaged":"dev"}.json`),JSON.stringify(evidence,null,2));await app.close();
}
