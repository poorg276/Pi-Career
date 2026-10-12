// This cross-origin frame has no preload or Electron APIs. User Python only runs in its worker.
let worker, timer;
function stop() {
	if (worker) worker.terminate();
	worker = undefined;
	clearTimeout(timer);
}
window.addEventListener("message", (event) => {
	if (event.source !== parent || event.origin !== "picareer://app") return;
	const m = event.data;
	if (m?.type === "cancel") {
		stop();
		parent.postMessage(
			{ type: "judge", id: m.id, error: "运行已停止" },
			"picareer://app",
		);
		return;
	}
	if (m?.type !== "run") return;
	stop();
	worker = new Worker("./python.worker.js", { type: "module" });
	timer = setTimeout(() => {
		stop();
		parent.postMessage(
			{ type: "judge", id: m.id, error: "Python 初始化超时，请重试" },
			"picareer://app",
		);
	}, 30000);
	worker.onmessage = ({ data }) => {
		if (data.type === "ready") {
			clearTimeout(timer);
			timer = setTimeout(() => {
				stop();
				parent.postMessage(
					{ type: "judge", id: m.id, error: "运行超过8秒，执行环境已终止" },
					"picareer://app",
				);
			}, 8000);
			worker.postMessage(m);
			return;
		}
		if (data.type === "result") {
			parent.postMessage(
				{ ...data, type: "judge", id: m.id },
				"picareer://app",
			);
			stop();
		}
	};
	worker.onerror = (e) => {
		parent.postMessage(
			{ type: "judge", id: m.id, error: e.message },
			"picareer://app",
		);
		stop();
	};
});
parent.postMessage({ type: "runner-ready" }, "picareer://app");
