export const DEFAULT_ANALYSIS_MODEL = "gpt-5.6";
export const DEFAULT_REASONING_EFFORT = "medium" as const;
export const ANALYSIS_RESPONSE_FORMAT_NAME = "kea_session_analysis";

export type AnalysisProviderConfig = {
  model: string;
  reasoningEffort: "none" | "low" | "medium" | "high" | "xhigh" | "max";
  store: false;
};

export const DEFAULT_ANALYSIS_PROVIDER_CONFIG: AnalysisProviderConfig = {
  model: DEFAULT_ANALYSIS_MODEL,
  reasoningEffort: DEFAULT_REASONING_EFFORT,
  store: false
};
