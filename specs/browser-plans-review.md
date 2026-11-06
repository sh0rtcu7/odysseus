# Review of browser workspace and tool recovery plans

Reviewed: 2026-11-05. This is a design review, not an implementation or a statement of Codex internals.

Documents: `browser-split-view-plan.md` and `tool-failure-recovery-design.md`.

Reference: [official desktop browser documentation](https://learn.chatgpt.com/docs/browser), including split/full views, browser navigation and profile separation, page annotations, and website/action permissions. Those documented product behaviors support a comparison of the user experience, not assumptions about OpenAI's internal retry policy or event transport. Cloud-browser sign-in details on that page must not be attributed to the desktop browser.

## Overall assessment

Proceed with split view, but add the P0 requirements below before implementation. The existing singleton, explicit takeover, uncertainty-aware recovery and stale-frame rules are sound foundations. The remaining work is more than moving a modal: the workspace must communicate lifecycle and support predictable browser interaction.

Odysseus displays a remote screenshot and forwards selected inputs. The desktop product exposes an interactive browser tab. Matching the layout does not supply native selection, accessibility, browser dialogs, IME, downloads or password-manager integration. Set explicit capability boundaries rather than implying equivalence.

## P0: requirements to resolve first

### 1. Separate presentation, control and task state

Define three independent state dimensions:

- Presentation: closed, split, stacked, expanded.
- Browser/control: connecting, agent-owned, takeover requested, human-owned, paused after lease loss, disconnected, closed remotely.
- Task: running, waiting for approval, waiting for user, recovering, completed, partial, cancelled.

Derive visible status from these dimensions. Closing a pane does not cancel a task, return control or erase cookies. Stopping the model does not promise rollback of a dispatched action. Returning control after task completion does not silently launch another model run: offer an explicit Continue task action when applicable.

Keep a compact browser/status entry outside historical tool rows, so a hidden paused browser or a needed approval is discoverable without scrolling back. Include a global Stop task control while work is active; label Hide browser and Close browser session as different actions. If closing a session interrupts work or loses unsaved page state, explain that at the action.

### 2. Reconnect and exclusive ownership

After sleep, network loss or reload, fetch authoritative session incarnation, owner, frame and control status before enabling input. Do not trust cached sessionStorage or the last image. Clear queued input on disconnect, lease loss, page change and chat switch; never replay gestures after reconnection.

Takeover must show pending state until the in-flight action actually settles. In-flight writes may finish before control transfers. A second app tab/device remains a spectator; it cannot automatically steal control. If an explicit force-transfer feature is later added, revoke the old lease atomically and invalidate its queue and refs.

Specify whether browser sessions survive reload, backend restart and idle expiry. Current in-memory sessions cannot survive a backend restart. Display that clearly and offer reopening; do not silently recreate a logged-in browser or replay its last submission. Logging out must hide screenshots, stop client polling, and invalidate access to the prior owner's sessions.

### 3. Browser chrome and page lifecycle

Add Back, Forward, Reload, current origin/URL and a loading/error indicator. Distinguish Refresh preview from Reload website: reload can resubmit a form. Manual navigation must run through the same lease, URL validation and resource invalidation boundaries as other human actions. Do not add an unvalidated navigation shortcut.

For target=_blank and window.open, keep one viewer with multiple page tabs, notify about the new page and choose a clear active-tab policy. Never retarget silently. Handle a closed selected tab and the last tab closing without a broken image or stuck lease.

Surface alert/confirm/prompt dialogs as a deliberate interaction-required state rather than an indefinite tool timeout. Login redirects and cross-origin iframes can change the relevant origin; show it before the user types credentials. Explicitly scope unsupported passkeys, HTTP authentication, file pickers and downloads. A bot challenge requires legitimate user interaction or a reported limitation, not automatic bypass.

### 4. Reliable input and honest accessibility

Define support for paste, IME/composition, touch, selection, keyboard shortcuts and native dropdowns. Currently direct key forwarding is not equivalent to a native editable page. Keep a visible text-entry fallback and describe unsupported interactions. For the first release, support composition through that fallback instead of sending partial IME keystrokes.

The screenshot itself does not expose remote DOM semantics to screen readers. Provide an accessible page summary/control-list path or state this limitation explicitly. A named region and keyboard separator alone do not make the remote page accessible.

Separate shell keyboard focus from remote page focus. Escape sent to a website must not unexpectedly close the workspace. Application shortcuts must not leak into a focused webpage or text fallback. Discard stale coordinate clicks; retain a clear user message instead of silently dropping them.

### 5. Freshness and resize under agent control

The current plan resizes only for a human lease holder. Consequently, a user watching the agent in a narrow pane may still see a fixed desktop viewport scaled down. Decide this explicitly: schedule a requested viewer size at an agent-safe browser-action boundary, invalidate refs and request a fresh observation before the next planned action. Never resize halfway through an admitted action. If deferred, show fit-to-view during agent control rather than claiming fully responsive sizing in all modes.

Expose stale/disconnected image status and age where relevant. Polling only action-generated frames may miss delayed page updates, animations and asynchronous search results. Budget an adaptive capture cadence while visible, independent of whether a new tool call occurs. Never let preview work delay control input or agent completion indefinitely.

During divider drag, prioritize human input and retain only the latest pending resize. Hidden panes must not flood the server or interfere with another chat's ownership.

### 6. Tie recovery to the browser workspace

Put approval and user-interaction requests where they remain visible with the browser open. A waiting task needs actionable Resume, Skip affected step or Cancel controls as appropriate. Allow the user to steer the overall task in chat while a browser objective is blocked, without initiating a second concurrent agent controller.

Give waits an explicit policy: active compute budgets pause during a human wait; wall-clock session expiry remains separate. Preserve original task identity, recovery counters and authority across resumed runs. A user response to an approval or challenge is not automatically a new task with fresh retry allowance.

For a browser write with unknown outcome, ask the user to inspect or use an authorized read-only verification. Do not automatically click again. Verification itself can fail or require new permission; cap that path and ask for guidance rather than nesting recovery indefinitely. Once the call budget is exhausted, reserve enough capacity to report a partial result; do not require a new provider call that cannot be made.

## P1: click-intent delivery correction

The proposed marker is a best-effort view of the executor's intended target. Playwright may scroll or wait and a moving element may change position after the bounding box was captured. Do not label this an exact record of the delivered click.

Introduce run ID and per-run sequence in addition to action ID, page incarnation and frame identity. Handle duplicate/out-of-order events after stream reconnect without replaying markers. A terminal status must win over a late intent. Never await a browser client's acknowledgement before executing the action.

There is an unavoidable timing case: a click navigates before the UI loads its intent frame. Do not roll the main viewer back to the old page merely to display the ring. Retain a brief action status and optionally a separate ephemeral previous-frame thumbnail if desired; otherwise skip the ring. Actual execution must not be slowed or altered for animation.

Bound the progress sink and frame cache by event count, bytes and TTL, with per-owner/session limits. Drop superseded visual events under load, while preserving authoritative action receipts. A slow viewer must not hold the browser action lock. Lost image/event delivery affects presentation only, not action success or retry classification.

## P1: further useful features

- A browser visibility shortcut and a persistent toolbar entry, independent of old chat tool rows.
- Optional explicit page/region annotation that attaches frame/page identity to a chat instruction. Keep annotation mode separate from remote clicking. This mirrors a documented desktop feedback workflow; it can follow the core split release.
- Clear separate-browser profile messaging and explicit browser-data clearing. Matching a user-agent is not sharing personal browser cookies, platform capabilities, sign-ins or extensions, and cannot guarantee site compatibility.
- An optional approved export of a result screenshot or page artifact. Automatic credentials/screenshots remain ephemeral; sharing evidence must be a separate user action with clear scope.
- User-friendly tab names and truncated URLs with the full origin available; keep page-provided titles untrusted and safely escaped.

## Changes to delivery order

1. Finalize the state matrix, visible controls, reconnect policy and capability boundaries.
2. Implement the split workspace and singleton mounting with a persistent browser entry and essential navigation chrome.
3. Add responsive sizing at safe action boundaries, bounded preview/resize scheduling and end-to-end input tests.
4. Integrate task recovery, approvals and user handoff with the same state model.
5. Add best-effort click markers through a bounded progress channel; annotations and expanded interaction support follow later.

Core split layout can remain frontend-only. Safe resizing during agent execution, dialogs, navigation controls and click progress require narrowly scoped backend work. Update the earlier blanket "no backend changes" scope statement accordingly before implementation.

## Additional edge-case test matrix

| Scenario | Required result |
| --- | --- |
| Network drops after a submission, before tool result | Reconcile uncertain effect; no replay on reconnect. |
| User switches chats with a pending click or text queue | No old input reaches the previous or newly selected page. |
| Takeover is requested during a slow click/navigation | Clearly pending until settlement; only one controller. |
| Two tabs both try takeover | One lease wins; the other remains a spectator. |
| Session expires or server restarts while pane is hidden | Reopening explains session loss without pretending cookies survived. |
| Click opens an OAuth popup | New tab is visible/discoverable and origin is clear; no silent target replacement. |
| Website raises a confirm dialog or closes its last tab | Explicit user state or clean closed state; no spinner deadlock. |
| Sidebar/panel changes width while model is clicking | Defer remote resize until a safe boundary. |
| Fast navigation overtakes the click-intent frame | New page stays visible; old marker is skipped or separately contextualized. |
| UI stream reconnects with duplicate/out-of-order events | No stale marker or completed action returns to pending. |
| User hides browser while human-owned, then sends chat | Task ownership remains explicit; no concurrent browser writer. |
| IME, mobile keyboard, browser zoom or display-scale changes | Input is not corrupted and coordinates remain in viewport CSS pixels. |
| Reload on a form result | No unnoticed resubmission through a mislabeled preview refresh. |
| A permission is revoked during recovery backoff | Next dispatch rechecks authority and stays blocked. |
| No verification budget remains after uncertain write | Report uncertainty and request guidance; never retry automatically. |

No runtime changes made by this review.
