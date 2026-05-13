export type ResearchMode = "deep_topic" | "opportunity_discovery";
export type Depth = "quick" | "standard" | "deep";

export interface ResearchRun {
	id: string;
	mode: ResearchMode;
	query: string;
	depth: Depth;
	startedAt: string;
	status: "planning" | "searching" | "synthesizing" | "done" | "failed";
	artifactDir: string;
}

export interface SearchTask {
	id: string;
	query: string;
	purpose: string;
}

export interface ResearchPlan {
	mode: ResearchMode;
	query: string;
	depth: Depth;
	tasks: SearchTask[];
}

export interface Evidence {
	id: string;
	title: string;
	url?: string;
	sourceType: "web" | "docs" | "repo" | "file" | "mcp" | "paper" | "preprint" | "dataset";
	snippet: string;
	fullTextPath?: string;
	retrievalQuery: string;
	fetchedAt: string;
	confidence: "low" | "medium" | "high";
	tags: string[];
	canonicalKey?: string;
	provider?: "memory" | "openalex" | "semantic_scholar" | "arxiv" | "crossref" | "pubmed" | "tavily" | "duckduckgo";
	publishedAt?: string;
	sourceUpdatedAt?: string;
	citationCount?: number;
}

export interface CanonicalPaper {
	key: string;
	title: string;
	abstract?: string;
	year?: number;
	authors: string[];
	doi?: string;
	arxivId?: string;
	semanticScholarId?: string;
	openAlexId?: string;
	urls: string[];
	pdfUrl?: string;
	citationCount?: number;
	providers: string[];
	firstSeenAt: string;
	lastSeenAt: string;
}

export interface ResearchChunk {
	id: string;
	sourceKind: "run" | "evidence" | "paper" | "report";
	sourceId: string;
	text: string;
	title?: string;
	url?: string;
	tags: string[];
	createdAt: string;
	score?: number;
}

export interface ResearchResult {
	run: ResearchRun;
	plan: ResearchPlan;
	evidence: Evidence[];
	reportPath: string;
	summaryPath: string;
}
