import { loadPyodide } from "pyodide";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
const py = await loadPyodide();
py.runPython(
	readFileSync(new URL("../content/judge.py", import.meta.url), "utf8"),
);
const problems = JSON.parse(
	readFileSync(new URL("../content/problems.json", import.meta.url), "utf8"),
);
let cases = 0;
for (const problem of problems) {
	py.globals.set("_data", JSON.stringify(problem));
	const result = JSON.parse(
		py.runPython(
			"_p=json.loads(_data)\njson.dumps(judge(_p,_p['solution'],_p['cases']))",
		),
	);
	assert.equal(result.passed, true, `${problem.id}: ${JSON.stringify(result)}`);
	cases += problem.cases.length;
}
console.log(
	`PASS: packaged Python ${py.runPython('__import__("sys").version.split()[0]')} WebAssembly runtime: ${problems.length} reference solutions / ${cases} cases.`,
);
