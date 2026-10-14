export type ResumeMode = "experience" | "full";
export type MaterialPurpose = "project" | "research" | "template" | "photo";
export interface MaterialUnit {
	id: string;
	location: string;
	text: string;
	image?: string;
	mimeType?: string;
	selected: boolean;
}
export interface ResumeMaterial {
	id: string;
	name: string;
	purpose: MaterialPurpose;
	units: MaterialUnit[];
	skipped: string[];
	createdAt: string;
}
export interface ResumeFact {
	id: string;
	text: string;
	evidence: { unitId: string; quote: string }[];
	confirmed: boolean;
}
export interface ResumeQuestion {
	id: string;
	question: string;
	answer: string;
	skipped: boolean;
}
export interface ResumeExperience {
	id: string;
	kind: "project" | "research";
	name: string;
	time: string;
	role: string;
	bullets: { text: string; factIds: string[] }[];
}
export interface ResumeExperienceSource {
	id: string;
	text: string;
	origin: "overview" | "material";
	evidence: { unitId: string; quote: string }[];
}
export interface ResumeFields {
	name: string;
	phone: string;
	email: string;
	location: string;
	education: string;
	skills: string;
	work: string;
	projects: string;
	research: string;
	awards: string;
}
export type ResumeSection =
	| "education"
	| "skills"
	| "work"
	| "projects"
	| "research"
	| "awards";
export interface ResumeLayout {
	template: "simple" | "research";
	pages: 1 | 2;
	order: ResumeSection[];
	hidden: ResumeSection[];
}
export interface ResumeDraft {
	id: string;
	revision: number;
	title: string;
	mode: ResumeMode;
	step: number;
	jd: string;
	overview?: string;
	inputIssues?: string[];
	generationWarnings?: string[];
	experienceSources?: ResumeExperienceSource[];
	fields: ResumeFields;
	materials: ResumeMaterial[];
	facts: ResumeFact[];
	questions: ResumeQuestion[];
	experiences: ResumeExperience[];
	layout: ResumeLayout;
	templateSuggestion?: string;
	templateProposal?: ResumeLayout;
	versions: {
		at: string;
		experiences: ResumeExperience[];
		sources?: ResumeExperienceSource[];
	}[];
	createdAt: string;
	updatedAt: string;
	run?: {
		requestId: string;
		status: "running" | "complete" | "failed" | "cancelled";
		stage: string;
		batch?: { current: number; total: number };
	};
}
export type ResumeEdit = Pick<
	ResumeDraft,
	| "id"
	| "revision"
	| "title"
	| "mode"
	| "step"
	| "jd"
	| "overview"
	| "fields"
	| "layout"
	| "facts"
	| "questions"
	| "experiences"
> & { selections: Record<string, boolean> };
export interface ResumeExport {
	format: "docx" | "pdf";
	id: string;
	allowPlaceholders: boolean;
}
export const resumeLabels: Record<ResumeSection, string> = {
	education: "教育背景",
	skills: "专业技能",
	work: "实习与工作经历",
	projects: "项目经历",
	research: "科研成果",
	awards: "奖项与其他",
};
export const resumeOrder: ResumeSection[] = [
	"education",
	"skills",
	"work",
	"projects",
	"research",
	"awards",
];
