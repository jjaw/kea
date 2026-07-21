export const SESSION_ELIGIBILITY_THRESHOLDS = {
  minimumMatchedResultsBetweenChangedSnapshots: 1,
  minimumHumanMessagesForInvestigation: 2,
  minimumDistinctTurnsForInvestigation: 2,
  minimumMatchedToolResultsForInvestigation: 4,
  minimumObservableErrorResultsForInvestigation: 1
} as const;

export const DEFAULT_AUTOMATIC_QUIET_INTERVAL_MS = 60_000;
export const AUTOMATIC_QUIET_INTERVAL_ENV =
  "KEA_AUTOMATIC_QUIET_INTERVAL_MS";
export const AUTOMATIC_ANALYSIS_ENABLED_ENV =
  "KEA_AUTOMATIC_ANALYSIS_ENABLED";

export function automaticQuietIntervalMs(
  environment: NodeJS.ProcessEnv
): number {
  const raw = environment[AUTOMATIC_QUIET_INTERVAL_ENV];
  if (raw === undefined || !/^\d+$/.test(raw)) {
    return DEFAULT_AUTOMATIC_QUIET_INTERVAL_MS;
  }
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed)
    ? parsed
    : DEFAULT_AUTOMATIC_QUIET_INTERVAL_MS;
}

export function automaticAnalysisEnabled(
  environment: NodeJS.ProcessEnv
): boolean {
  return environment[AUTOMATIC_ANALYSIS_ENABLED_ENV] === "true";
}
