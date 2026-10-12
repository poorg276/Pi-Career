import { loadPyodide } from "./pyodide/pyodide.mjs";
const py = await loadPyodide({
	indexURL: new URL("./pyodide/", import.meta.url).href,
});
const judge = await (await fetch("./judge.py")).text();
py.runPython(judge);
postMessage({ type: "ready" });
onmessage = async ({ data }) => {
	try {
		py.globals.set(
			"_input_json",
			JSON.stringify({
				problem: data.problem,
				code: data.code,
				cases: data.cases,
			}),
		);
		const result = py.runPython(
			`_payload=json.loads(_input_json)\njson.dumps(judge(_payload['problem'],_payload['code'],_payload['cases']),ensure_ascii=False)`,
		);
		postMessage({ type: "result", result: JSON.parse(result) });
	} catch (e) {
		postMessage({ type: "result", error: String(e) });
	}
};
