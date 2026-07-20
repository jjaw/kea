export const SESSION_ELIGIBILITY_THRESHOLDS = {
  minimumMatchedResultsBetweenChangedSnapshots: 1,
  minimumHumanMessagesForInvestigation: 2,
  minimumDistinctTurnsForInvestigation: 2,
  minimumMatchedToolResultsForInvestigation: 4,
  minimumObservableErrorResultsForInvestigation: 1
} as const;
