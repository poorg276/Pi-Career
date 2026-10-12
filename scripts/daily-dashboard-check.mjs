// Actual Electron lifecycle/UI acceptance; only public network responses are fixtures.
import { _electron as electron } from "playwright";
import { resolve, join } from "node:path";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { Store } from "../src/core/store.ts";
const root = resolve(import.meta.dirname, "..");
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const scale = process.env.PICAREER_SCALE ?? "1.25", packaged = process.env.PICAREER_PACKAGED === "1";
const out = join(root, ".test-data", `daily-dashboard-${version}-${packaged ? "packaged" : "dev"}-${scale}`);
mkdirSync(out, { recursive: true });
const data = mkdtempSync(join(out, "profile-"));
const localDay = (date) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
const today = localDay(new Date());
const mutate = (fn) => { const store = new Store(data); try { return fn(store); } finally { store.close(); } };
mutate(store => {
  store.put("dashboard", "refresh-day", { date: today });
  store.put("dashboard", "news", { news: [], status: "ready", attemptedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), warnings: [] });
  store.put("plan", "preserved", { completed: 50 });
});
const options = {
  executablePath: join(root, packaged ? "release/win-unpacked/PiCareer.exe" : "node_modules/electron/dist/electron.exe"),
  args: [...(packaged ? [] : [root]), `--force-device-scale-factor=${scale}`],
  env: { ...process.env, PICAREER_TEST_DATA: data, PICAREER_DASHBOARD_AUTOSTART: "1" }, timeout: 60000,
};
let app;
const errors = [];
const readyPage = async () => {
  const page = await app.firstWindow();
  page.on("pageerror", e => errors.push(e.message));
  await page.getByRole("heading", {name:"PiCareer工作台",exact:true}).waitFor({timeout:60000});
  await app.evaluate(({BrowserWindow}) => { const w=BrowserWindow.getAllWindows()[0]; w.setSize(1024,700); w.showInactive(); });
  return page;
};
const dashboard = page => page.evaluate(() => window.picareer.call("dashboard",null));
const waitDashboard = async (page, predicate) => {
  const deadline=Date.now()+20000;
  while(Date.now()<deadline) {
    const state=await dashboard(page);
    if(predicate(state)) return state;
    await page.waitForTimeout(50);
  }
  throw new Error("Dashboard condition timed out: "+JSON.stringify(await dashboard(page)));
};
const waitIdle = page => waitDashboard(page,state=>state.status!=="loading");
try {
  app = await electron.launch(options);
  let page = await readyPage();
  assert.equal(await page.title(), "PiCareer·辅助求职Agent");
  assert.equal(await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].getTitle()), "PiCareer·辅助求职Agent");
  assert.equal(await page.locator(".window-titlebar-content span").last().textContent(), "PiCareer·辅助求职Agent");
  assert.equal((await dashboard(page)).status,"ready");
  assert.equal((await dashboard(page)).requestId,undefined);
  assert.ok((await page.locator(".news-panel .dashboard-muted").first().textContent()).includes("每日自动更新"));
  assert.deepEqual(await page.locator(".feature h3").allTextContents(),["模拟面试","企业岗位检索","LeetCode Hot100","八股知识背诵","简历优化"]);
  assert.deepEqual(await page.locator(".feature-number").allTextContents(),["01","02","03","04","05"]);
  const resumeIcon=await page.getByRole("button",{name:"简历优化",exact:true}).locator("svg").innerHTML();
  assert.notEqual(resumeIcon,await page.getByRole("button",{name:"知识背诵",exact:true}).locator("svg").innerHTML());
  assert.equal(resumeIcon,await page.locator(".feature").last().locator("svg").first().innerHTML());
  await app.evaluate(({app}) => {
    globalThis.__dailyReads=0;
    app.on("session-created",s => {
      s.resolveHost=async () => ({endpoints:[{address:"8.8.8.8"}]});
      s.fetch=async url => {
        globalThis.__dailyReads++;
        const match=/ui-day-(\d)/.exec(String(url));
        const body=match
          ? `<html><head><title>New Agent memory model ${match[1]}</title><meta property="article:published_time" content="${new Date(Date.now()-3600000).toISOString()}"></head><body><article><h1>New Agent memory model ${match[1]}</h1><p>We are releasing new Agent memory and evaluation capabilities. The framework update introduces tool calling improvements for reliable agents. ${"Agent memory supports reliable workflows. ".repeat(8)}</p></article></body></html>`
          : [1,2,3].map(i=>`<a href="https://www.langchain.com/blog/ui-day-${i}">New Agent tool ${i}</a>`).join("");
        return new Response(body,{headers:{"content-type":"text/html"}});
      };
    });
  });
  const due = () => mutate(store => store.put("dashboard","refresh-day",{date:"2000-01-01"}));
  // Returning to the workbench triggers the shared due check; same-day focus does not.
  await page.getByRole("button",{name:"企业岗位",exact:true}).click();
  due();
  await page.getByRole("button",{name:"工作台",exact:true}).click();
  await waitDashboard(page,state=>!!state.requestId);
  const first=await waitIdle(page);
  assert.equal(first.news.length,3,JSON.stringify(first));
  const reads=await app.evaluate(()=>globalThis.__dailyReads);
  assert.ok(reads>0);
  await page.evaluate(()=>{window.dispatchEvent(new Event("focus"));document.dispatchEvent(new Event("visibilitychange"));});
  await page.getByRole("button",{name:"Hot100 练习",exact:true}).click();
  await page.getByRole("button",{name:"工作台",exact:true}).click();
  assert.equal((await dashboard(page)).requestId,first.requestId);
  assert.equal(await app.evaluate(()=>globalThis.__dailyReads),reads);
  // Simulate a new day's persisted scheduling condition without changing the system clock.
  due();
  await page.evaluate(()=>window.dispatchEvent(new Event("focus")));
  await waitDashboard(page,state=>state.requestId!==first.requestId);
  const focused=await waitIdle(page);
  assert.notEqual(focused.requestId,first.requestId);
  await page.getByRole("button",{name:"刷新",exact:true}).click();
  await waitDashboard(page,state=>state.requestId!==focused.requestId);
  const manual=await waitIdle(page);
  assert.notEqual(manual.requestId,focused.requestId);
  const selected=(await dashboard(page)).knowledge.id;
  await page.getByRole("button",{name:"换一条",exact:true}).click();
  await waitDashboard(page,state=>state.knowledge.id!==selected);
  const knowledge=(await dashboard(page)).knowledge.id;
  await page.locator(".feature").last().click();
  await page.getByRole("heading",{name:"简历优化",exact:true}).waitFor();
  await page.getByRole("button",{name:"工作台",exact:true}).click();
  await page.locator(".feature").last().scrollIntoViewIfNeeded();
  await page.screenshot({path:join(out,"cards.png")});
  await page.locator(".recruitment-panel").scrollIntoViewIfNeeded();
  await page.screenshot({path:join(out,"home.png")});
  const layout=await page.evaluate(()=>({scale:devicePixelRatio,overflow:document.documentElement.scrollWidth>innerWidth,sidebarBottom:document.querySelector(".sidebar-bottom").getBoundingClientRect().bottom,height:innerHeight}));
  assert.equal(layout.overflow,false);
  assert.ok(layout.sidebarBottom<=layout.height);
  await app.close(); app=undefined;
  app=await electron.launch(options);
  page=await readyPage();
  const restored=await dashboard(page);
  assert.equal(restored.requestId,undefined);
  assert.equal(restored.attemptedAt,manual.attemptedAt);
  assert.equal(restored.news.length,3);
  assert.equal(restored.knowledge.id,knowledge);
  assert.deepEqual(mutate(store=>store.get("plan","preserved")),{completed:50});
  assert.deepEqual(errors,[]);
  const result={version,packaged,scale,passed:true,title:"PiCareer·辅助求职Agent",distinctResumeIcon:true,cardOrder:true,dailyReturnAndFocus:true,sameDayNoRepeat:true,manualRefresh:true,restartNoRefresh:true,knowledgePreserved:true,layout,network:"simulated public-page responses in actual Electron",errors};
  writeFileSync(join(out,"result.json"),JSON.stringify(result,null,2));
  writeFileSync(join(root,`docs/evidence/daily-dashboard-${version}-${packaged?"packaged":"dev"}-${scale}.json`),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
} finally { if(app) await app.close(); }
