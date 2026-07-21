# Kea reference-session fixture provenance

Status: prepared sanitized fixture awaiting manual review.

- Safe source session ID: `019f82cc-fc58-7c01-b499-c3c65c9734e9`
- Capture date: July 20, 2026 PDT (`2026-07-21T03:51:42.598Z` through `2026-07-21T04:30:36.096Z`)
- Settled analysis-run ID: `2026-07-21T04-30-38-285Z-dfb10ae7-6235-4e30-8f5e-db0aa6a0f014`
- Associated commit: `b685c95 feat: add isolated demo orchestration`
- Sanitization date: July 20, 2026 PDT
- Manual-review date: July 20, 2026 PDT
- Manual review: complete
- Reviewer: project owner

## Origin and selection

This fixture was copied from a real, ordinary Codex development session. The
session implemented and verified the bounded, fixture-independent foundation
for Kea's Milestone 12 demo. It was not instructed to manufacture a failure or
to optimize its behavior for Kea analysis.

The session used Kea's project-local automatic handoff. After its final turn it
settled automatically as a `full_report`, with the complete evidence state
associated with the analysis run above.

It was selected because the recording contains a useful evidence-backed story:
an initial human constraint, a later human correction that narrowed the design,
implementation activity, failed and successful focused verification, a final
full check, the associated commit, a clean-tree check, a reported outcome, and
result-bearing evidence that independently supports the outcome. The complete
sanitized corpus is also comfortably within Kea's one-request budget.

## Source integrity

- Source file line count: 101
- Source file size: 593,805 bytes
- Source evidence count: 105
- Source serialized evidence-corpus size: 111,136 bytes
- Source evidence-state hash: `520f54719031eb6466c5d15986561a374d5ef62d9b0091c27bac49047387a634`
- Source-file SHA-256: `1cdde9a26d17a72b8b7731d3a08770df6317474656f1c82a38c2030c7fed2af3`

The source recording under `.codex-observer/` was not modified. Its SHA-256 was
recomputed after fixture preparation and remained identical to the value above.

## Sanitization performed

Only string content requiring public-fixture sanitization was changed. No
record, object key, non-string value, timestamp, session UUID, turn ID,
tool-call ID, Git identifier, or attempt/result identifier was rewritten.

Sanitization categories and stable replacements:

- Personal absolute project paths were replaced with `/workspace/kea`.
- The private Codex transcript path was replaced with
  `/workspace/kea/[REDACTED_VALUE]/session.jsonl`.
- Machine-specific temporary-directory paths were replaced with
  `/tmp/kea-demo-project` or `/tmp/kea-demo-output-test`.
- Credential-shaped examples and captured environment-value assignments in
  documentation, source excerpts, and test patches were replaced by Kea's
  typed markers: `[REDACTED:env-secret]`,
  `[REDACTED:bearer-token]`, and
  `[REDACTED:connection-password]`. The captured documentation's existing
  illustrative `[REDACTED:aws-key]` marker was retained.

No user name or email address was retained. No private URL was present. Product
and repository references to Kea were retained because they are necessary to
understand the public fixture's objective and outcome.

## Structural preservation

- Records removed: none
- Sanitized fixture line count: 101
- Sanitized fixture file size: 581,533 bytes
- Sanitized evidence count: 105
- Sanitized omitted evidence count: 0
- Sanitized serialized corpus size: 111,102 bytes
- Sanitized evidence-state hash: `72a9df4fe921b8725e4b2260ef09ea0e8191c3e007cad19d18a55f5a709e5f23`
- Sanitized fixture SHA-256: `5119f23824586f63a03e2a56e18bac5e7e882031f3c8ad5c875db07a25f79de9`
- Request budget: 524,288 bytes
- Eligible for one-request analysis: yes
- Adapter parse diagnostics: 0
- Tool attempts/results: 47/47
- Matched tool results: 47
- Unmatched tool results: 0

All 101 chronological records were retained. Event order, capture timestamps,
schemas, Git-state transitions, session and turn identities, tool-call
identities, and attempt/result relationships remain intact. The evidence needed
for the objective, human constraint, correction, turning point, implementation,
verification, commit, independently supported outcome, evidence gap, and
leadership insight remains present.

## Verification and limitations

The sanitized fixture was parsed with Kea's real Codex adapter and processed by
the real evidence builder. Focused scans checked for personal absolute paths,
the known source user identifier, email addresses, URLs, private-key blocks,
credential prefixes, bearer values, connection-string passwords, and unredacted
secret-like environment assignments. Reapplying Kea's current redaction rules
identified zero additional string fields requiring redaction.

Sanitization is best effort. Pattern checks cannot prove that arbitrary prose,
tool output, or diffs contain no context-specific sensitive information, and
Kea intentionally does not use entropy-based secret detection. This fixture
must not be committed or treated as approved until a human reviewer examines
the complete sanitized `events.jsonl` and replaces the pending review fields
above.
