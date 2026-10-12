import { Document, Paragraph, TextRun, Packer, ImageRun } from "docx";
import { resumeLabels, type ResumeDraft } from "../shared/resume.ts";
import { experienceText } from "./resume.ts";
const escape = (s: string) =>
	s.replace(
		/[&<>"']/g,
		(c) =>
			({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
				c
			]!,
	);
export const hasPlaceholders = (d: ResumeDraft) =>
	d.fields.name === "张三" ||
	d.fields.phone === "13333333333" ||
	d.fields.email === "example@example.com";
function parts(d: ResumeDraft) {
	return d.mode === "experience"
		? [
				{
					label: "项目经历与科研成果",
					text: d.experiences.map(experienceText).join("\n\n"),
				},
			]
		: d.layout.order
				.filter((k) => !d.layout.hidden.includes(k) && d.fields[k].trim())
				.map((k) => ({ label: resumeLabels[k], text: d.fields[k] }));
}
function photo(d: ResumeDraft) {
	return d.materials
		.findLast((m) => m.purpose === "photo")
		?.units.find((u) => u.image)?.image;
}
export function resumeHTML(d: ResumeDraft) {
	const picture = photo(d);
	return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><style>
@page{size:A4;margin:14mm}*{box-sizing:border-box}body{margin:0;color:#202622;font-family:'Microsoft YaHei','Noto Sans CJK SC',sans-serif;font-size:10.5pt;line-height:1.5}.sheet{width:182mm;margin:0 auto}.identity{min-height:${picture ? "31mm" : "auto"};margin-bottom:5mm}h1{font-size:22pt;line-height:1.25;margin:0 0 2mm;color:#202622;font-weight:700}header p{font-size:9.5pt;margin:0;color:#424d47}h2{font-size:11.5pt;color:${d.layout.template === "research" ? "#253a49" : "#315b49"};margin:4mm 0 2mm;border-bottom:1px solid #d9e0da;padding-bottom:1mm;break-after:avoid}p.entry{margin:0 0 1.3mm;white-space:pre-wrap;overflow-wrap:anywhere;orphans:2;widows:2}.photo{float:right;width:23mm;height:30mm;object-fit:cover;margin-left:5mm}section{margin:0}img{max-width:100%}
</style></head><body><article class="sheet"><header class="identity">${picture ? `<img class="photo" alt="照片" src="data:image/png;base64,${picture}">` : ""}<h1>${escape(d.mode === "full" ? d.fields.name || "简历" : d.title)}</h1>${d.mode === "full" ? `<p>${[d.fields.phone, d.fields.email, d.fields.location].filter(Boolean).map(escape).join("　|　")}</p>` : ""}</header>${parts(
		d,
	)
		.map(
			(s) =>
				`<section><h2>${escape(s.label)}</h2>${s.text
					.split("\n")
					.map((p) => `<p class="entry">${escape(p) || "&nbsp;"}</p>`)
					.join("")}</section>`,
		)
		.join("")}</article></body></html>`;
}
export async function resumeDOCX(d: ResumeDraft) {
	const picture = photo(d);
	const body: Paragraph[] = [];
	if (picture)
		body.push(
			new Paragraph({
				children: [
					new ImageRun({
						type: "png",
						data: Buffer.from(picture, "base64"),
						transformation: { width: 87, height: 113 },
						floating: {
							horizontalPosition: { relative: "margin", align: "right" },
							verticalPosition: { relative: "paragraph", offset: 0 },
							wrap: { type: 1 },
						},
					}),
				],
			}),
		);
	body.push(
		new Paragraph({
			style: "Title",
			children: [
				new TextRun({
					text: d.mode === "full" ? d.fields.name || "简历" : d.title,
					bold: true,
					size: 44,
					color: "202622",
				}),
			],
		}),
	);
	if (d.mode === "full")
		body.push(
			new Paragraph({
				children: [
					new TextRun({
						text: [d.fields.phone, d.fields.email, d.fields.location]
							.filter(Boolean)
							.join("　|　"),
						size: 19,
						color: "424D47",
					}),
				],
				spacing: { after: 180 },
			}),
		);
	for (const p of parts(d)) {
		body.push(
			new Paragraph({
				keepNext: true,
				spacing: { before: 200, after: 100 },
				children: [
					new TextRun({
						text: p.label,
						bold: true,
						size: 23,
						color: d.layout.template === "research" ? "253A49" : "315B49",
					}),
				],
			}),
		);
		for (const line of p.text.split("\n"))
			body.push(
				new Paragraph({
					children: [new TextRun({ text: line, size: 21 })],
					spacing: { after: 65, line: 300 },
					widowControl: true,
				}),
			);
	}
	const document = new Document({
		styles: {
			default: {
				document: {
					run: { font: "Microsoft YaHei", size: 21, color: "202622" },
					paragraph: { spacing: { line: 300 } },
				},
			},
		},
		sections: [
			{
				properties: {
					page: {
						size: { width: 11906, height: 16838 },
						margin: { top: 794, right: 794, bottom: 794, left: 794 },
					},
				},
				children: body,
			},
		],
	});
	return new Uint8Array(await Packer.toBuffer(document));
}
