export type Page =
	| "resume"
	| "home"
	| "chat"
	| "jobs"
	| "interview"
	| "coding"
	| "learn"
	| "settings";
export interface Source {
	title: string;
	url: string;
	content: string;
	retrievedAt: string;
	publishedAt?: string;
	kind: "web" | "official" | "community";
	fullText?: boolean;
	searchEngine?: string;
	fallbackReasons?: string[];
}
export type JobType = "实习" | "校招" | "社招" | "未注明";
export interface ManualJobFields {
	company: string;
	city: string;
	role: string;
	responsibilities: string;
	requirements: string;
	jobType: JobType;
	education: string;
	experience: string;
	graduationYear: string;
	salary: string;
	sourceUrl: string;
	notes: string;
}
export interface ManualJobInput extends ManualJobFields {
	id: string;
	mode: "create" | "update";
}
export interface Job extends Source {
	origin?: "online" | "manual";
	manual?: ManualJobFields;
	createdAt?: string;
	updatedAt?: string;
	id: string;
	company: string;
	role: string;
	city: string;
	experience: string;
	score: number;
	verification?: "verified" | "summary";
	pageType?: "posting";
	evidence?: Partial<
		Record<"company" | "city" | "role" | "experience" | "publishedAt", string>
	>;
	match?: Record<
		keyof JobFilters,
		"matched" | "unknown" | "different" | "unused"
	>;
	matchReasons?: string[];
	jd?: string;
}
export interface JobFilters {
	city: string;
	company: string;
	role: string;
}
export interface JobSearchResult {
	requestId: string;
	filters: JobFilters;
	matched: Job[];
	related: Job[];
	portals: Source[];
	warnings: string[];
	retrievedAt: string;
	status: "complete" | "cancelled" | "timeout";
}
export interface JobJD {
	status: "ready" | "needs_input";
	text: string;
	message?: string;
	company: string;
	role: string;
	url: string;
}
export interface Message {
	role: "user" | "assistant";
	text: string;
}
export interface ChatEntry {
	id: string;
	turnId: string;
	role: "user" | "assistant" | "tool";
	text: string;
	toolCallId?: string;
	name?: string;
	status?: "running" | "complete" | "error" | "cancelled";
}
export interface ChatRun {
	turnId: string;
	status: "running" | "complete" | "cancelled" | "interrupted" | "error";
	error?: string;
	phase?: "preparing" | "thinking" | "tools" | "responding";
}
export interface FileIdentity {
	dev: number;
	ino: number;
	birthtimeMs: number;
}
export interface ArtifactTarget {
	root: string;
	rootIdentity: FileIdentity;
	path: string;
	identity: FileIdentity;
	kind: "file" | "directory";
	sha256?: string;
}
export interface DeletionFile {
	path: string;
	root: string;
	reason?: string;
}
export interface ChatDeletionPreview {
	id: string;
	title: string;
	token: string;
	files: DeletionFile[];
	skipped: DeletionFile[];
	undeclaredCommands: number;
}
export interface ChatDeletionResult {
	deleted: boolean;
	preview?: ChatDeletionPreview;
	errors?: string[];
}
export interface ChatTurn extends ChatRun {
	endedAt: string;
	model?: string;
	context?: {
		tokens: number | null;
		contextWindow: number;
		percent: number | null;
	};
}
export interface Chat {
	id: string;
	title: string;
	cwd?: string;
	messages: Message[];
	updatedAt: string;
	sessionFile?: string;
	entries?: ChatEntry[];
	run?: ChatRun;
	revision?: number;
	titleEdited?: boolean;
	turns?: ChatTurn[];
}
export interface Knowledge {
	id: string;
	category: string;
	question: string;
	answer: string;
	explanation: string;
	tags: string[];
	level: "基础" | "进阶";
	source: string;
	updatedAt: string;
	version: number;
}
export interface Quiz {
	id: string;
	from: number;
	to: number;
	itemIds: string[];
	answers?: Record<string, string>;
	feedback?: string;
	reviewIds?: string[];
	submitted: boolean;
}
export interface StudyPlan {
	id: string;
	jd: string;
	reason: string;
	items: Knowledge[];
	completed: number;
	batchToken: string;
	quizzes: Quiz[];
	status: "learning" | "quiz" | "complete";
	createdAt: string;
	sources?: Source[];
}
export interface Interview {
	id: string;
	company: string;
	role: string;
	jd: string;
	sources: Source[];
	warning?: string;
	questions: string[];
	current: number;
	followups: number;
	transcript: Message[];
	status: "active" | "complete";
	report?: string;
	createdAt: string;
}
export interface Case {
	input: unknown[];
	expected: unknown;
	note?: string;
}
export interface Problem {
	id: number;
	title: string;
	slug: string;
	category: string;
	difficulty: string;
	description: string;
	constraints: string;
	method: string;
	params: string;
	adapter: string;
	compare?: string;
	template: string;
	solution: string;
	hints: string[];
	complexity: string;
	cases: Case[];
	version: string;
}
export interface Settings {
	provider: string;
	model: string;
	baseUrl: string;
	api: string;
	hasKey?: boolean;
	hasSearchKey?: boolean;
}
export interface ModelOption {
	supportsImages?: boolean;
	id: string;
	provider: string;
	name: string;
}
export interface ProviderOption {
	id: string;
	name: string;
	subscription: boolean;
	credentialType?: "oauth" | "api_key";
}
export type LoginMethod = "browser" | "device_code";
export type AuthorizationStage =
	| "preparing"
	| "browser"
	| "exchanging"
	| "validating"
	| "saving"
	| "refreshing"
	| "complete";
export interface AuthorizationDiagnostic {
	id: string;
	stage: AuthorizationStage;
	category: string;
	httpStatus?: number;
}
export interface LoginInput {
	attemptId: string;
	provider: string;
	method: LoginMethod;
}
export interface AuthorizationState extends LoginInput {
	stage?: AuthorizationStage;
	diagnostic?: AuthorizationDiagnostic;
	modelsRefreshRequired?: boolean;
	status:
		| "starting"
		| "waiting"
		| "cancelling"
		| "succeeded"
		| "cancelled"
		| "failed";
	message: string;
	url?: string;
	userCode?: string;
	expiresAt?: number;
	prompt?: PromptEvent;
	details?: string;
	browser?: "opening" | "opened" | "failed";
}
export interface AppState {
	settings: Settings;
	chats: Chat[];
	interviews: Interview[];
	plans: StudyPlan[];
	favorites: Job[];
	solved: number[];
	failed: number[];
	drafts: Record<string, string>;
	codingAttempts: CodingAttempt[];
	legacyResults: { id: number; passed: boolean }[];
}
export interface RecruitmentPortal {
	company: string;
	url: string;
	verifiedAt: string;
	verificationSource: string;
}
export interface DashboardNews {
	id: string;
	title: string;
	originalTitle: string;
	summary: string;
	url: string;
	source: string;
	publishedAt: string;
	retrievedAt: string;
	evidence: string;
	dateEvidence: string;
}
export interface DashboardState {
	portals: RecruitmentPortal[];
	news: DashboardNews[];
	knowledge: Knowledge;
	knowledgeDate: string;
	requestId?: string;
	status: "idle" | "loading" | "ready" | "partial" | "failed";
	stage?: string;
	updatedAt?: string;
	attemptedAt?: string;
	warnings: string[];
}
export interface OfficialProblem {
	id: number;
	slug: string;
	title: string;
	category: string;
	difficulty: string;
	descriptionHtml: string;
	template: string;
	source: string;
	fetchedAt: string;
	sourceHash: string;
	descriptionHash: string;
	images: { source: string; path: string; sha256: string }[];
}
export interface CodingAttempt {
	id: string;
	problemId: number;
	number: number;
	correct: boolean;
	notes: string;
	created: string;
	updated: string;
}
export interface CodingAttemptInput {
	id: string;
	problemId: number;
	mode: "create" | "update";
	correct: boolean;
	notes: string;
}
export interface PromptEvent {
	id: string;
	title: string;
	detail: string;
	kind: "approval" | "text" | "secret" | "manual_code" | "select";
	options?: { id: string; label: string }[];
}
export type AppEvent =
	| { type: "resumeUpdate"; draft: import("./resume.ts").ResumeDraft }
	| { type: "dashboardUpdate"; state: DashboardState }
	| { type: "jobProgress"; requestId: string; stage: string }
	| { type: "authorization"; state: AuthorizationState }
	| { type: "chatUpdate"; chatId: string; turnId?: string; chat: Chat }
	| { type: "chatDeleted"; chatId: string }
	| { type: "backendExited"; message: string }
	| { type: "prompt"; prompt: PromptEvent }
	| { type: "promptClosed"; id: string }
	| { type: "notice"; text: string; url?: string };
export interface ApiMap {
	resumeList: {input: null; output: import("./resume.ts").ResumeDraft[]};
	restoreResumeVersion: {input: {id: string; at: string}; output: import("./resume.ts").ResumeDraft};
	createResume: {input: {mode: import("./resume.ts").ResumeMode}; output: import("./resume.ts").ResumeDraft};
	saveResume: {input: import("./resume.ts").ResumeEdit; output: import("./resume.ts").ResumeDraft};
	deleteResume: {input: {id: string}; output: boolean};
	chooseResumeMaterials: {input: {id: string; purpose: import("./resume.ts").MaterialPurpose; directory: boolean}; output: import("./resume.ts").ResumeDraft | undefined};
	removeResumeMaterial: {input: {id: string; materialId: string}; output: import("./resume.ts").ResumeDraft};
	analyzeResume: {input: {id: string; templateOnly?: boolean}; output: import("./resume.ts").ResumeDraft};
	generateResume: {input: {id: string}; output: import("./resume.ts").ResumeDraft};
	generateResumeExperience: {input: {id: string}; output: import("./resume.ts").ResumeDraft};
	cancelResume: {input: {id: string}; output: boolean};
	resumePreview: {input: {id: string}; output: {html: string; placeholders: boolean}};
	copyResume: {input: {id: string; experienceId?: string}; output: boolean};
	exportResume: {input: import("./resume.ts").ResumeExport; output: {path?: string; pages?: number; warning?: string}};
	dashboard: { input: null; output: DashboardState };
	ensureDashboardUpdated: { input: null; output: DashboardState };
	refreshDashboard: { input: null; output: DashboardState };
	nextDashboardKnowledge: { input: null; output: DashboardState };
	state: { input: null; output: AppState };
	settings: {
		input: Settings & { key?: string; searchKey?: string };
		output: Settings;
	};
	models: {
		input: null;
		output: { models: ModelOption[]; providers: ProviderOption[] };
	};
	refreshModels: { input: { provider: string }; output: boolean };
	login: { input: LoginInput; output: AuthorizationState };
	logout: { input: { provider: string }; output: boolean };
	cancelLogin: { input: { attemptId: string }; output: boolean };
	authReply: {
		input: { attemptId: string; promptId: string; value: string };
		output: boolean;
	};
	authLink: {
		input: { attemptId: string; action: "open" | "copy" };
		output: boolean;
	};
	testModel: { input: null; output: string };
	chooseDirectory: { input: null; output: string | undefined };
	chat: { input: { id?: string; text: string; cwd?: string }; output: Chat };
	createChat: { input: { cwd?: string }; output: Chat };
	renameChat: { input: { id: string; title: string }; output: Chat };
	previewDeleteChat: { input: { id: string }; output: ChatDeletionPreview };
	deleteChat: {
		input: { id: string; token?: string };
		output: ChatDeletionResult;
	};
	setChatDirectory: { input: { id: string; cwd: string }; output: Chat };
	chatSnapshot: { input: { id: string }; output: Chat };
	stopChat: { input: { id: string }; output: boolean };
	stop: { input: null; output: boolean };
	reply: { input: { id: string; value: string }; output: boolean };
	jobs: {
		input: JobFilters & { requestId: string };
		output: JobSearchResult;
	};
	cancelJobs: { input: { requestId: string }; output: boolean };
	prepareJobJD: { input: { job: Job }; output: JobJD };
	favorite: { input: Job; output: Job[] };
	saveManualJob: { input: ManualJobInput; output: Job[] };
	deleteManualJob: { input: { id: string }; output: Job[] };
	jd: { input: { text: string }; output: string };
	startInterview: {
		input: { company: string; role: string; jd: string };
		output: Interview;
	};
	answerInterview: {
		input: { id: string; answer: string; finish?: boolean };
		output: Interview;
	};
	startPlan: { input: { jd: string; company?: string }; output: StudyPlan };
	advancePlan: { input: { id: string; token: string }; output: StudyPlan };
	submitQuiz: {
		input: { id: string; quizId: string; answers: Record<string, string> };
		output: StudyPlan;
	};
	companySources: {
		input: { company: string; role: string };
		output: Source[];
	};
	draft: { input: { id: number; code: string }; output: boolean };
	saveCodingAttempt: { input: CodingAttemptInput; output: CodingAttempt[] };
	copyCodeAndOpenProblem: {
		input: { id: number; code: string };
		output: boolean;
	};
	solved: { input: { id: number; passed: boolean }; output: boolean };
	explain: {
		input: { id: number; code: string; level: number };
		output: string;
	};
	openExternal: { input: { url: string }; output: boolean };
}
export type Method = keyof ApiMap;
export interface Bridge {
	call<K extends Method>(
		method: K,
		input: ApiMap[K]["input"],
	): Promise<ApiMap[K]["output"]>;
	onEvent(fn: (event: AppEvent) => void): () => void;
}
declare global {
	interface Window {
		picareer: Bridge;
	}
}
