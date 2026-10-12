import { _electron as electron } from "playwright";
import { resolve, join } from "node:path";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
const root = resolve(import.meta.dirname, ".."),
	out = join(
		root,
		".test-data",
		`appearance-${process.env.PICAREER_EXE ? "packaged" : "dev"}-${process.env.PICAREER_SCALE ?? "system"}`,
	);
mkdirSync(out, { recursive: true });
const app = await electron.launch({
	executablePath:
		process.env.PICAREER_EXE ??
		join(root, "node_modules/electron/dist/electron.exe"),
	args: [
		...(process.env.PICAREER_EXE ? [] : [root]),
		...(process.env.PICAREER_SCALE
			? [`--force-device-scale-factor=${process.env.PICAREER_SCALE}`]
			: []),
	],
	env: { ...process.env, PICAREER_TEST_DATA: mkdtempSync(join(out, "data-")) },
	timeout: 60000,
});
try {
	const page = await app.firstWindow();
	const errors = [];
	page.on("pageerror", (e) => errors.push(e.message));
	await page
		.getByRole("heading", { name: "PiCareer工作台" })
		.waitFor({ timeout: 60000 });
	await app.evaluate(({ BrowserWindow, nativeTheme }) => {
		nativeTheme.themeSource = "dark";
		const w = BrowserWindow.getAllWindows()[0];
		w.showInactive();
		w.setSize(1024, 700);
	});
	await page.waitForFunction(
		() => navigator.windowControlsOverlay?.visible === true,
	);
	const inspect = () =>
		page.evaluate(() => {
			const main = document.querySelector(".main"),
				sidebar = document.querySelector(".sidebar"),
				scroll = document.querySelector(".sidebar-scroll"),
				bottom = document.querySelector(".sidebar-bottom"),
				bar = document.querySelector(".window-titlebar");
			const r = bottom.getBoundingClientRect(),
				style = getComputedStyle(main, "::-webkit-scrollbar"),
				thumb = getComputedStyle(main, "::-webkit-scrollbar-thumb");
			const coloredText = [...document.querySelectorAll(".main *, .sidebar *")]
				.filter(
					(el) =>
						[...el.childNodes].some(
							(n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim(),
						) &&
						!el.closest(
							".new-chat, .correct-text, .incorrect-text, .monaco-editor, .brand-mark, .art-core, .feature-icon, .solved-indicator, .unsolved-indicator, .alert.error",
						),
				)
				.map((el) => ({
					text: el.textContent.slice(0, 45),
					color: getComputedStyle(el).color,
				}))
				.filter((v) => {
					const [r, g, b] = v.color.match(/[\d.]+/g).map(Number);
					return r !== g || g !== b;
				});
			return {
				width: innerWidth,
				height: innerHeight,
				scale: devicePixelRatio,
				mainWidth: main.clientWidth,
				mainScrollWidth: main.scrollWidth,
				mainScrollTop: main.scrollTop,
				sidebarScrollTop: scroll.scrollTop,
				sidebarHeight: sidebar.clientHeight,
				sidebarScrollHeight: scroll.scrollHeight,
				sidebarViewport: scroll.clientHeight,
				bottomTop: r.top,
				bottomBottom: r.bottom,
				titleHeight: bar.getBoundingClientRect().height,
				titleColor: getComputedStyle(bar).backgroundColor,
				scrollbarWidth: style.width,
				scrollbarThumb: thumb.backgroundColor,
				font: getComputedStyle(document.body).fontFamily,
				coloredText,
			};
		});
	await page.mouse.move(5, 5);
	await page.waitForTimeout(250);
	const initial = await inspect();
	assert.equal(initial.titleColor, "rgb(247, 248, 245)");
	assert.equal(initial.titleHeight, 36);
	assert.equal(initial.scrollbarWidth, "6px");
	assert.equal(initial.scrollbarThumb, "rgba(32, 32, 32, 0.22)");
	assert.ok(
		initial.bottomBottom <= initial.height &&
			initial.bottomTop >= initial.titleHeight,
		"Settings/profile clipped at minimum window size",
	);
	assert.ok(
		initial.sidebarScrollHeight > initial.sidebarViewport,
		"Minimum height must exercise overflowing sidebar content",
	);
	await page.locator(".sidebar-scroll").hover();
	await page.mouse.wheel(0, 900);
	await page.waitForFunction(
		() => document.querySelector(".sidebar-scroll").scrollTop > 0,
	);
	const scrolled = await inspect();
	assert.equal(
		scrolled.mainScrollTop,
		initial.mainScrollTop,
		"Sidebar wheel scrolled main content",
	);
	assert.equal(
		scrolled.bottomBottom,
		initial.bottomBottom,
		"Pinned footer moved",
	);
	await page.screenshot({ path: join(out, "sidebar-scrolled.png") });
	await page.locator(".main").hover();
	await page.mouse.wheel(0, 1600);
	await page.waitForFunction(
		() => document.querySelector(".main").scrollTop > 0,
	);
	assert.equal((await inspect()).bottomBottom, initial.bottomBottom);
	await page.getByRole("button", { name: "模型与设置", exact: true }).click();
	await page.waitForFunction(
		() => document.querySelector(".main").scrollTop === 0,
	);
	const pages = [];
	for (const [label, name] of [
		["工作台", "home"],
		["通用 Agent", "chat"],
		["模拟面试", "interview"],
		["企业岗位", "jobs"],
		["Hot100 练习", "coding"],
		["知识背诵", "learn"],
		["简历优化", "resume"],
		["模型与设置", "settings"],
	]) {
		await page
			.getByRole("button", {
				name: label === "通用 Agent" ? /^通用 Agent/ : label,
				exact: label !== "通用 Agent",
			})
			.click();
		await page.screenshot({
			path: join(out, `${name}-1024.png`),
			fullPage: true,
		});
		const size = await inspect();
		assert.ok(
			size.mainScrollWidth <= size.mainWidth + 1,
			`${name}: horizontal overflow ${JSON.stringify(size)}`,
		);
		// Accent colors are intentional in newer chat/attempt UI; retain them as diagnostics.
		assert.ok(
			size.bottomBottom <= size.height,
			`${name}: clipped sidebar footer`,
		);
		pages.push({ name, ...size });
	}
	await page.getByRole("button", { name: "工作台", exact: true }).click();
	await app.evaluate(({ BrowserWindow }) =>
		BrowserWindow.getAllWindows()[0].setSize(1360, 820),
	);
	await page.screenshot({ path: join(out, "home-wide.png") });
	// Capture the app's own native window, including the real caption controls.
	const native = await app.evaluate(
		async ({ BrowserWindow, desktopCapturer }) => {
			const win = BrowserWindow.getAllWindows()[0];
			const sources = await desktopCapturer.getSources({
				types: ["window"],
				thumbnailSize: { width: 2040, height: 1230 },
			});
			const source = sources.find((s) => s.id === win.getMediaSourceId());
			if (!source || source.thumbnail.isEmpty())
				throw new Error("Native title bar capture unavailable");
			return source.thumbnail.toPNG().toString("base64");
		},
	);
	writeFileSync(join(out, "native-window.png"), Buffer.from(native, "base64"));
	assert.deepEqual(errors, []);
	writeFileSync(
		join(out, "result.json"),
		JSON.stringify(
			{
				passed: true,
				initial,
				pages,
				sidebarWheel: true,
				pinnedFooter: true,
				routeResetsScroll: true,
				nativeControlsVisible: true,
				darkSystemTheme: true,
				errors,
			},
			null,
			2,
		),
	);
	console.log(
		`PASS: 7 screens, minimum window sidebar wheel/pinned footer, translucent 6px scrollbars, native light title bar under dark system theme. Scale ${initial.scale}. Evidence: ${out}`,
	);
} finally {
	await app.close();
}
