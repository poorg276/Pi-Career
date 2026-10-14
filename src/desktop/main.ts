import {
	app,
	BrowserWindow,
	ipcMain,
	protocol,
	net,
	dialog,
	shell,
	safeStorage,
	utilityProcess,
	session,
	clipboard,
} from "electron";
import { join, resolve, relative, isAbsolute, extname } from "node:path";
import {
	readFileSync,
	existsSync,
	mkdirSync,
	writeFileSync,
	copyFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import type { AppEvent, LoginInput } from "../shared/types.ts";
import { AuthorizationBrowser } from "./authorization-browser.ts";
import { allowedProxyOrigin } from "../shared/network-origins.ts";
import { sourceExtensions } from "../shared/resume-limits.ts";
import { PublicWeb } from "./public-web.ts";
import problemCatalog from "../../content/problems.json";
protocol.registerSchemesAsPrivileged([
	{
		scheme: "picareer",
		privileges: {
			standard: true,
			secure: true,
			supportFetchAPI: true,
			stream: true,
			codeCache: true,
		},
	},
	{
		scheme: "practice",
		privileges: {
			standard: true,
			secure: true,
			supportFetchAPI: true,
			stream: true,
		},
	},
]);
app.setName("PiCareer");
app.setPath("userData", join(app.getPath("appData"), "PiCareer"));
if (process.env.PICAREER_TEST_DATA)
	app.setPath("userData", resolve(process.env.PICAREER_TEST_DATA));
const single = app.requestSingleInstanceLock();
if (!single) app.quit();
let win: BrowserWindow;
let backend: ReturnType<typeof utilityProcess.fork>;
let fatal = "";
const publicWeb = new PublicWeb();
const authorizationBrowser = new AuthorizationBrowser(
	(url) => shell.openExternal(url),
	(url) => clipboard.writeText(url),
	(state) => {
		if (win && !win.isDestroyed())
			win.webContents.send("event", { type: "authorization", state });
	},
);
const pending = new Map<
	string,
	{ resolve: (v: unknown) => void; reject: (e: Error) => void }
>();
const base = app.isPackaged
	? join(process.resourcesPath, "resources")
	: join(app.getAppPath(), "resources");
const ui = join(app.getAppPath(), "dist", "ui");
function allowedExternal(raw: string) {
	const u = new URL(raw);
	if (!["https:", "http:"].includes(u.protocol) || u.username || u.password)
		throw new Error("仅允许 HTTP/HTTPS 链接");
	return u.href;
}
const methods = new Set([
	"resumeList", "restoreResumeVersion", "createResume", "saveResume", "deleteResume", "removeResumeMaterial", "analyzeResume", "generateResume", "generateResumeExperience", "cancelResume", "resumePreview",
	"dashboard",
	"ensureDashboardUpdated",
	"refreshDashboard",
	"nextDashboardKnowledge",
	"previewDeleteChat",
	"state",
	"settings",
	"models",
	"refreshModels",
	"login",
	"logout",
	"cancelLogin",
	"authReply",
	"testModel",
	"chat",
	"createChat",
	"renameChat",
	"deleteChat",
	"setChatDirectory",
	"chatSnapshot",
	"stopChat",
	"stop",
	"jobs",
	"cancelJobs",
	"prepareJobJD",
	"saveManualJob",
	"deleteManualJob",
	"favorite",
	"jd",
	"startInterview",
	"answerInterview",
	"startPlan",
	"advancePlan",
	"submitQuiz",
	"companySources",
	"draft",
	"saveCodingAttempt",
	"solved",
	"explain",
]);
function backendCall(method:string,input:unknown):Promise<any>{
	if(fatal) return Promise.reject(new Error(fatal));
	const id=randomUUID();return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});backend.postMessage({type:"call",id,method,input});});
}
app.whenReady().then(async () => {
	const csp =
		"default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-src 'self' about: practice://runner; object-src 'none'; base-uri 'none'";
	for (const scheme of ["picareer", "practice"])
		protocol.handle(scheme, async (request) => {
			try {
				const url = new URL(request.url),
					raw = decodeURIComponent(url.pathname),
					root = scheme === "practice" ? join(base, "runner") : ui;
				const path = resolve(root, "." + (raw === "/" ? "/index.html" : raw)),
					rel = relative(root, path);
				if (rel.startsWith("..") || isAbsolute(rel) || !existsSync(path))
					return new Response("Not found", { status: 404 });
				const types: Record<string, string> = {
					".html": "text/html; charset=utf-8",
					".js": "text/javascript",
					".mjs": "text/javascript",
					".css": "text/css",
					".json": "application/json",
					".wasm": "application/wasm",
					".svg": "image/svg+xml",
					".png": "image/png",
					".jpg": "image/jpeg",
					".jpeg": "image/jpeg",
					".gif": "image/gif",
					".webp": "image/webp",
					".ttf": "font/ttf",
					".zip": "application/zip",
					".py": "text/plain",
				};
				const body = readFileSync(path);
				return new Response(body, {
					headers: {
						"Content-Type": types[extname(path)] ?? "application/octet-stream",
						"Content-Security-Policy":
							scheme === "practice"
								? "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'; style-src 'self'"
								: csp,
					},
				});
			} catch {
				return new Response("Bad request", { status: 400 });
			}
		});
	session.defaultSession.setPermissionRequestHandler((_wc, _permission, cb) =>
		cb(false),
	);
	// Both the application UI and the Python runner are offline surfaces. Network is backend-only.
	session.defaultSession.webRequest.onBeforeRequest(
		{ urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"] },
		(_d, cb) => cb({ cancel: true }),
	);
	win = new BrowserWindow({
		width: 1440,
		height: 940,
		minWidth: 1024,
		minHeight: 700,
		backgroundColor: "#f7f8f5",
		titleBarStyle: "hidden",
		titleBarOverlay: {
			color: "#f7f8f5",
			symbolColor: "#202020",
			height: 36,
		},
		title: "PiCareer·辅助求职Agent",
		icon: join(base, "icon.png"),
		show: false,
		autoHideMenuBar: true,
		webPreferences: {
			preload: join(app.getAppPath(), "dist", "preload.cjs"),
			contextIsolation: true,
			nodeIntegration: false,
			nodeIntegrationInWorker: false,
			sandbox: true,
			webSecurity: true,
		},
	});
	win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
	win.webContents.on("will-navigate", (event, url) => {
		if (!url.startsWith("picareer://app/")) event.preventDefault();
	});
	win.webContents.on("will-attach-webview", (event) => event.preventDefault());
	const nativeBin = join(app.getPath("userData"), "agent", "bin");
	mkdirSync(nativeBin, { recursive: true });
	copyFileSync(join(base, "bin", "rg.exe"), join(nativeBin, "rg.exe"));
	backend = utilityProcess.fork(
		join(base, "pi", "worker.mjs"),
		[app.getPath("userData")],
		{
			serviceName: "PiCareer Agent",
			stdio: "pipe",
			env: {
				...process.env,
				PI_CODING_AGENT_DIR: join(app.getPath("userData"), "agent"),
				PI_OFFLINE: "1",
			},
		},
	);
	backend.on("message", async (m: Record<string, unknown>) => {
		if (m.type === "trashArtifact") {
			let error: string | undefined;
			try {
				const target = m.target as ArtifactTarget;
				if (!target || !["file", "directory"].includes(target.kind))
					throw new Error("清理请求无效。");
				validateArtifact(target);
				await shell.trashItem(target.path);
			} catch {
				error =
					"无法将文件移入回收站，文件可能被修改、占用或路径已改变。请检查后重试。";
			}
			try {
				if (backend.pid)
					backend.postMessage({ type: "reply", id: m.id, value: "", error });
			} catch {
				/* Process exited; persistent cleanup state will be checked on retry. */
			}
			return;
		}
		if (m.type === "webCancel") {
			publicWeb.cancel(String(m.id));
			return;
		}
		if (m.type === "webRead") {
			const reply = (value: Record<string, unknown>) => {
				if (!backend.pid) return;
				try {
					backend.postMessage({ type: "webReply", id: m.id, ...value });
				} catch {
					/* Backend exit already has its own UI event. */
				}
			};
			try {
				if (typeof m.id !== "string" || typeof m.url !== "string")
					throw new Error("网页请求无效。");
				const value = await publicWeb.read(m.id, m.url, m.recruitment);
				reply({ value });
			} catch (error) {
				reply({
					error: error instanceof Error ? error.message : "网页读取失败。",
					code: error && typeof error === "object" && "code" in error ? String(error.code) : "NETWORK",
				});
			}
			return;
		}
		if (m.type === "resolveProxy") {
			try {
				if (!allowedProxyOrigin(m.origin)) throw new Error();
				const value = await session.defaultSession.resolveProxy(
					String(m.origin),
				);
				backend.postMessage({ type: "reply", id: m.id, value });
			} catch {
				backend.postMessage({
					type: "reply",
					id: m.id,
					error: "AUTH_PROXY_RESOLUTION",
				});
			}
			return;
		}
		if (m.type === "event") {
			const event = m.event as AppEvent;
			if (event.type === "authorization")
				authorizationBrowser.receive(event.state);
			else if (!win.isDestroyed()) win.webContents.send("event", event);
		}
		if (m.type === "crypt") {
			try {
				let result: string;
				if (m.op === "encrypt") {
					if (!(await safeStorage.isAsyncEncryptionAvailable()))
						throw new Error("系统安全存储不可用，未保存密钥");
					result = (
						await safeStorage.encryptStringAsync(String(m.value))
					).toString("base64");
				} else
					result = (
						await safeStorage.decryptStringAsync(
							Buffer.from(String(m.value), "base64"),
						)
					).result;
				backend.postMessage({ type: "reply", id: m.id, value: result });
			} catch (e) {
				backend.postMessage({
					type: "reply",
					id: m.id,
					error: (e as Error).message,
				});
			}
		}
		if (m.type === "result") {
			const p = pending.get(String(m.id));
			pending.delete(String(m.id));
			if (m.error) p?.reject(new Error(String(m.error)));
			else p?.resolve(m.result);
		}
		if (m.type === "fatal") {
			fatal = String(m.error);
			authorizationBrowser.fail("授权后台不可用，请重新打开应用。");
			for (const p of pending.values()) p.reject(new Error(fatal));
			pending.clear();
		}
	});
	backend.on("exit", (code) => {
		publicWeb.close();
		fatal = `后台进程已退出（${code}），请重新打开应用。`;
		authorizationBrowser.fail("授权后台已退出，请重新打开应用后重新连接。");
		for (const p of pending.values()) p.reject(new Error(fatal));
		pending.clear();
		if (!win.isDestroyed()) {
			win.webContents.send("event", { type: "notice", text: fatal });
			win.webContents.send("event", { type: "backendExited", message: fatal });
		}
	});
	ipcMain.handle("call", async (event, method: unknown, input: unknown) => {
		if (
			event.sender !== win.webContents ||
			event.senderFrame !== win.webContents.mainFrame ||
			!event.senderFrame.url.startsWith("picareer://app/")
		)
			throw new Error("拒绝非主界面请求");
		if (
			typeof method !== "string" ||
			JSON.stringify(input ?? null).length > 1000000
		)
			throw new Error("无效请求");
		const arg = input as Record<string, unknown> | null;
		if(method==="chooseResumeMaterials") {
			const id=String(arg?.id),purpose=String(arg?.purpose);
			await backendCall("resumePreview",{id});
			if(!["project","research","template","photo"].includes(purpose)|| (arg?.directory&&purpose!=="project"))throw new Error("材料用途无效");
			const chosen=await dialog.showOpenDialog(win,{title:arg?.directory?"选择项目源码目录":"导入简历材料",properties:arg?.directory?["openDirectory"]:["openFile","multiSelections"],filters:arg?.directory?undefined:[{name:"材料",extensions:purpose==="photo"?["png","jpg","jpeg"]:["pdf","docx","png","jpg","jpeg","zip",...sourceExtensions]}]});
			if(chosen.canceled)return undefined;
			return backendCall("importResumeMaterials",{id,purpose,paths:chosen.filePaths});
		}
		if(method==="copyResume") {await clipboard.writeText(await backendCall("resumeCopyText",arg));return true;}
		if(method==="exportResume") {
			if(!["docx","pdf"].includes(String(arg?.format)))throw new Error("导出格式无效");
			const data=await backendCall("resumeExportData",arg);
			const renderSession=session.fromPartition("resume-export");
			renderSession.webRequest.onBeforeRequest((details,done)=>done({cancel:!details.url.startsWith("data:")}));
			const render=new BrowserWindow({show:false,webPreferences:{session:renderSession,nodeIntegration:false,contextIsolation:true,sandbox:true}});
			try {
				await render.loadURL(`data:text/html;base64,${Buffer.from(data.html).toString("base64")}`);
				await render.webContents.executeJavaScript("Promise.all([document.fonts.ready,...Array.from(document.images).map(i=>i.decode().catch(()=>{}))])");
				const pdf=await render.webContents.printToPDF({printBackground:true,preferCSSPageSize:true});
				const pages=(pdf.toString("latin1").match(/\/Type\s*\/Page\b/g)??[]).length;
				if(pages>data.pages)return {pages,warning:`当前内容需要${pages}页，超过设置的${data.pages}页。请精简内容、隐藏栏目或切换两页后再导出。`};
				const result=await dialog.showSaveDialog(win,{title:"导出简历",defaultPath:`PiCareer简历.${arg?.format}`,filters:[{name:String(arg?.format).toUpperCase(),extensions:[String(arg?.format)]}]});
				if(result.canceled||!result.filePath)return {};
				await import("node:fs/promises").then(fs=>fs.writeFile(result.filePath!,arg?.format==="pdf"?pdf:Buffer.from(data.docx)));
				return {path:result.filePath,pages};
			}finally{render.destroy();}
		}
		if (method === "authLink")
			return authorizationBrowser.link(
				String(arg?.attemptId),
				String(arg?.action),
			);
		if (method === "chooseDirectory") {
			const r = await dialog.showOpenDialog(win, {
				properties: ["openDirectory"],
				title: "选择 Agent 工作目录",
			});
			return r.canceled ? undefined : r.filePaths[0];
		}
		if (method === "openExternal") {
			await shell.openExternal(allowedExternal(String(arg?.url)));
			return true;
		}
		if (method === "copyCodeAndOpenProblem") {
			const problem = problemCatalog.find((p) => p.id === arg?.id);
			if (!problem || typeof arg?.code !== "string" || arg.code.length > 200000)
				throw new Error("题目或代码无效。");
			if (fatal) throw new Error(fatal);
			await new Promise((resolve, reject) => {
				const id = randomUUID();
				pending.set(id, { resolve, reject });
				backend.postMessage({
					type: "call",
					id,
					method: "draft",
					input: { id: problem.id, code: arg.code },
				});
			});
			try {
				await clipboard.writeText(arg.code);
			} catch {
				throw new Error("代码已保存，但复制失败，请重试。");
			}
			try {
				await shell.openExternal(
					`https://leetcode.cn/problems/${problem.slug}/description/`,
				);
			} catch {
				throw new Error("代码已保存并复制，但打开力扣失败，请重试。");
			}
			return true;
		}
		if (method === "reply") {
			backend.postMessage({
				type: "reply",
				id: String(arg?.id),
				value: String(arg?.value),
			});
			return true;
		}
		if (!methods.has(method)) throw new Error("未知接口");
		if (fatal) throw new Error(fatal);
		if (method === "login") authorizationBrowser.arm(input as LoginInput);
		const id = randomUUID();
		return new Promise((resolve, reject) => {
			pending.set(id, { resolve, reject });
			backend.postMessage({ type: "call", id, method, input });
		}).catch((error) => {
			if (method === "login")
				authorizationBrowser.fail("无法启动授权，请重新连接。");
			throw error;
		});
	});
	await win.loadURL("picareer://app/");
	if (!process.env.PICAREER_TEST_DATA) win.show();
	app.on("second-instance", () => {
		if (win.isMinimized()) win.restore();
		win.show();
		win.focus();
	});
});
app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => {
	publicWeb.close();
	backend?.kill();
});
import { validateArtifact } from "../core/artifact-paths.ts";
import type { ArtifactTarget } from "../shared/types.ts";
