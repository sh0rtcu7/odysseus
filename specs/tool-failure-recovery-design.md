# Shared tool failure recovery

Status: proposed architecture. Runtime behavior is unchanged by this document.

## Goal

A failed tool call is evidence for planning, not automatically the end of the user's task. Continue useful, authorized work while respecting cancellation, permission boundaries, uncertain effects and finite execution budgets. Apply the same rules to ordinary calls, approved continuations, both agent loops and resumed runs. Do not retry through access restrictions or infer task completion from a successful individual call.

## Current behavior

- `src/agent_loop.py` converts any failed approved action into a final response and sets `_approved_read_completed`. This conflates rejection of one operation with completion of the task.
- The ordinary loop counts rounds where all calls failed and eventually forces an answer. Unrelated successful calls can hide repeated failures of the same objective.
- Artifact repairs, pagination guards and provider-specific summaries have additional independent continuation rules.
- `src/clean_agent_preview.py` implements separate execution and budget behavior.
- `src/tool_capabilities.py` supplies coarse result success and content-integrity checks. Keep those compatibility contracts; they do not contain enough information to decide recovery.
- `src/agent_runtime/effects.py` already distinguishes execution status, possible impact and observed outcomes. The journal and completion gate already track evidence. Reuse these records rather than introducing another truth source.
- `ExactToolApproval` distinguishes a consumed exact first action from task/chat continuation scope. Recovery must preserve that distinction.

## Components and ownership

Introduce `src/agent_runtime/recovery.py`, a deterministic policy module with no network or tool execution. It consumes trusted execution facts, current request authority, user stop policy, task obligations and recovery counters. It returns a typed decision with a reason and permitted next-step constraints. Models can propose alternatives; only the dispatcher authorizes and executes them.

Introduce a shared result-normalization seam in the common dispatcher. Native adapters supply typed error categories, HTTP status, retry delay and outcome certainty where available. Legacy tools fall back conservatively to existing fields plus capability and journal evidence. Do not parse arbitrary error prose to grant permissions or declare that a write did not happen. Do not accept remote JSON fields claiming authorization or safe retry as trusted adapter facts.

Both loops call the same recovery policy after journaling each completed result and before any terminal summary shortcut. Their adapters translate decisions into provider messages and UI events. Keep provider formatting out of the policy module.

## Contracts

`FailureFacts` references the existing action/execution/effect IDs and contains:

- Category: invalid input, missing resource, transient service failure, service unavailable, access denied, authentication required, human interaction required, stale context, uncertain effect, internal failure or unknown.
- Execution status and impact copied from the journal/effect assessment, not from a model assertion.
- Operation fingerprint, stable resource/objective key where supplied, adapter provenance and sanitized diagnostic reference.
- Retry delay and an explicitly trusted idempotency capability, when supported.
- Whether failure text is external/untrusted. Error bodies retain the same integrity treatment as successful external content.

`RecoveryDecision` contains:

- Disposition: `retry`, `replan`, `verify_effect`, `wait_for_user`, `continue_independent_work`, `finish_partial`, or `terminate`.
- Reason code, failed action ID, optional affected objective, allowed next-step constraints and remaining budget.
- Whether a fresh observation or new approval is required. This describes requirements; it grants no authority.
- Wake deadline for bounded service backoff or a durable user-wait checkpoint.

Each failure produces one policy decision. A follow-up verification or tool call produces another ordinary journaled result. Never hide several executions behind one tool receipt.

## Decision rules

| Failure or condition | Default behavior |
| --- | --- |
| Invalid arguments | Return the diagnostic to the planner for one corrected proposal; validate and authorize again. |
| Missing resource | Refresh an authorized listing or choose another resource when permitted; do not invent a replacement identity. |
| Transient failure on a read | Bounded retry with backoff; after that, revise the plan or continue independent work. |
| Access denial or authentication challenge | Do not automatically repeat or switch transports to defeat the restriction. Pause the affected objective for legitimate user action, or skip it. |
| Human interaction required | Offer the existing browser takeover where supported. Resume only on an explicit return event. |
| Stale browser/resource binding | Observe fresh state within existing authority, discard the old plan and refs, then propose a new operation. |
| Write failed with confirmed no effect | Replan; replay only if authorized and safe for that operation. |
| Write timed out or may have partially succeeded | Verify the effect before any replay. If verification is unavailable or ambiguous, ask the user and prevent duplicate execution. |
| Approval required or scope denied | Keep the action blocked. Independent authorized work may continue; a different action receives its own authorization evaluation. |
| Cancellation, explicit user stop, revoked request authority | Terminate immediately; do not create recovery work. |
| Recovery budget exhausted | Finish with a truthful partial result or enter a specific user-wait state if input can unlock progress. |

Read classifications must come from declared operation effects. A tool name alone does not establish safe replay. GET-like browser navigation and UI clicks can still have effects. Idempotency keys are reused only according to a tool/provider's documented semantics; merely sending a key does not establish deduplication.

## Approval continuation

Execute the approved exact action once, record its outcome and consume its approval regardless of success. Replace the unconditional failed-approval final response with a recovery decision.

For task/chat scope, resume planning under the original request and the actual continuation grant. Every new operation still passes policy, exact resource binding and current approval requirements. For single-action scope, do not interpret failure as approval of a replacement: surface the result and request the required next authorization. An approval, reference or operation sealed before browser takeover remains invalid after its resource/control revision changes.

Do not automatically retry the sealed approved action. A retry is a new execution requiring authorization and, for possible writes, effect verification or supported idempotency first.

A successful approved intermediate read also returns to planning when the overall task remains incomplete. Preserve deterministic completion for narrowly scoped actions whose obligations are satisfied. Replace provider-specific "successful read means done" shortcuts incrementally with evidence-based completion.

## Task state and dependent work

Keep the run active independently of any particular call. Use existing plan item IDs where available; introduce an optional objective key for tasks without a formal plan, without forcing an extra model call to build a plan.

An objective can be pending, running, satisfied, blocked or skipped. Failure blocks dependent steps, not independent work. Never assume a failed batch is atomic: record each action and preserve its successful results. If a batch was stopped before dispatching later calls, return explicit not-executed results for those calls so provider tool-call pairing remains valid.

Only mark completion using the existing evidence/completion gate. A failure is not successful completion; a partial answer describes verified results, unresolved work and the concrete blocker. A model declaring "done" does not clear missing obligations.

## Budgets and progress

Initial configurable defaults, to be calibrated with tests:

- At most one automatic replay of an identical transient read, after a cancellable delay that honors bounded Retry-After.
- At most two revised proposals for the same failed objective without verified progress.
- At most six recovery tool executions across a task; verification reads count.
- All recovery work remains within the existing global call, round, time and cost limits. A model turn to explain the result is reserved within that budget rather than added without bound.

Track exact-operation attempts and objective-level no-progress attempts separately. Fingerprint normalized semantic arguments and resource incarnation, excluding request IDs and cosmetic formatting. Keep fingerprints private and avoid low-entropy sensitive argument hashes in public telemetry. Argument edits or unrelated successful reads do not reset objective counters. Only evidence of progress does.

Recovery limits survive approval pauses, provider changes, browser takeover and resumptions of the same task. A genuinely new user task gets new counters. Existing artifact, pagination and repetition guards remain hard upper bounds during migration; the tightest applicable bound wins. Later consolidate overlapping generic guards rather than stack new independent retry allowances.

## UI and persistence

Emit additive `tool_recovery` events with action ID, disposition, reason, attempt counts and a safe human-readable message. For example: "That read failed. Trying once more" or "The update may have completed. Checking before retrying." Keep errors visible in tool details; avoid presenting each recoverable failure as the final answer.

Persist run-level status (running, waiting for user, completed, partial, failed, cancelled) separately from tool outcome. Wire these to existing run lifecycle events; completion renders only at the actual terminal boundary. A user-wait state has a reason and explicit resume action, not an indefinite loading indicator.

Store versioned recovery counters and decisions alongside the run journal using its persistence mechanism. Add parent-task identity across approval continuations where their run ID changes. Recover an interrupted write as uncertain until reconciled. Never automatically replay it after restart. Browser leases and screenshot pixels remain ephemeral and outside the persisted recovery record. Do not log typed secrets, credentials or raw remote error pages.

## Rollout

1. Add typed facts, conservative legacy normalization and a pure decision function with unit tests. Run classification in shadow mode, recording decisions without extra calls or behavior changes.
2. Integrate failed approved reads in the standard loop. Exercise task versus single-action scope, permission checks, finite budgets and preserved tool-result pairing.
3. Integrate ordinary failures and the compact loop through shared helpers. Keep specialized guards authoritative during the transition and test equivalent decisions across loops.
4. Add uncertain-write verification, dependent-work continuation and durable resume semantics. Only enable write retries for explicitly supported adapters.
5. Add recovery UI states and enable gradually behind one server-side rollout flag. Watch additional executions, task completion, user waits, repeated calls and duplicate effects. Disabling recovery prevents new recovery attempts while preserving recorded outcomes and already-paused user interactions.

## Acceptance tests

Use local fixtures and synthetic tasks; no real-person research or live external writes.

- An approved read fails, a permitted alternative succeeds, and the answer includes only supported findings.
- Task scope permits authorized replanning; single-action approval never authorizes a replacement.
- A denial cannot be converted into an alternate-tool bypass or a fresh blanket grant.
- A timed-out write that actually succeeded is verified without being duplicated; ambiguous verification waits for the user.
- One successful call does not conceal repetition of another failing objective; cosmetic argument changes do not reset counters.
- Dependent steps wait, independent work continues, and mixed batches retain individual outcomes.
- Cancellation interrupts backoff and prevents new execution. Exhausted round/time budgets cannot be bypassed by recovery.
- A paused/resumed or restarted task retains counters, original scope and uncertain-effect state.
- Browser takeover invalidates stale plans and approvals; user-return resumes from fresh observations.
- Remote error text cannot inject a recovery policy, elevate authority or claim that a write was not executed.
- Standard and compact loops make equivalent recovery decisions for the same normalized facts.
- Existing artifact evidence checks and truthful completion behavior remain intact.
