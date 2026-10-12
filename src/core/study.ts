import { randomUUID } from "node:crypto";
import type { Knowledge, StudyPlan } from "../shared/types.ts";
export function createPlan(
	jd: string,
	items: Knowledge[],
	reason: string,
): StudyPlan {
	const unique = [...new Map(items.map((i) => [i.id, i])).values()];
	if (!jd.trim() || !unique.length)
		throw new Error("请提供 JD，并选择至少一个匹配知识点。");
	return {
		id: randomUUID(),
		jd,
		reason,
		items: structuredClone(unique),
		completed: 0,
		batchToken: randomUUID(),
		quizzes: [],
		status: "learning",
		createdAt: new Date().toISOString(),
	};
}
export function advance(plan: StudyPlan, token: string): StudyPlan {
	if (plan.status !== "learning" || token !== plan.batchToken) return plan;
	const p = structuredClone(plan);
	p.completed = Math.min(p.completed + 10, p.items.length);
	p.batchToken = randomUUID();
	if (p.completed % 50 === 0 || p.completed === p.items.length) {
		const from = p.quizzes.at(-1)?.to ?? 0;
		const block = p.items.slice(from, p.completed);
		const n = Math.min(10, block.length);
		const itemIds = Array.from(
			{ length: n },
			(_, i) => block[Math.floor((i * block.length) / n)].id,
		);
		p.quizzes.push({
			id: randomUUID(),
			from,
			to: p.completed,
			itemIds,
			submitted: false,
		});
		p.status = "quiz";
	}
	return p;
}
export function finishQuiz(
	plan: StudyPlan,
	quizId: string,
	answers: Record<string, string>,
	feedback: string,
	reviewIds: string[] = [],
): StudyPlan {
	const quiz = plan.quizzes.at(-1);
	if (plan.status !== "quiz" || !quiz || quiz.id !== quizId || quiz.submitted)
		return plan;
	if (quiz.itemIds.some((id) => !answers[id]?.trim()))
		throw new Error("请完成每道题后提交，可填写“不会”。");
	const p = structuredClone(plan),
		q = p.quizzes.at(-1)!;
	q.answers = answers;
	q.feedback = feedback;
	q.reviewIds = [...new Set(reviewIds.filter((id) => q.itemIds.includes(id)))];
	q.submitted = true;
	p.status = p.completed === p.items.length ? "complete" : "learning";
	return p;
}
export function rankKnowledge(jd: string, items: Knowledge[]): Knowledge[] {
	const text = jd.toLowerCase();
	const terms = [
		...new Set(text.match(/[a-z][a-z0-9_+-]{2,}|[\u4e00-\u9fff]{2,}/g) ?? []),
	];
	const scores = items.map((item) => ({
		item,
		score:
			item.tags.reduce(
				(n, t) => n + (text.includes(t.toLowerCase()) ? 3 : 0),
				0,
			) +
			(text.includes(item.category.toLowerCase()) ? 2 : 0) +
			terms.reduce(
				(n, term) =>
					n +
					(`${item.question} ${item.answer} ${item.explanation}`
						.toLowerCase()
						.includes(term)
						? 1
						: 0),
				0,
			),
	}));
	const relevant = scores
		.filter((i) => i.score > 0)
		.sort((a, b) => b.score - a.score);
	return (
		relevant.length
			? relevant
			: scores.filter((i) =>
					["Agent", "Python", "LLM"].includes(i.item.category),
				)
	).map((i) => i.item);
}
