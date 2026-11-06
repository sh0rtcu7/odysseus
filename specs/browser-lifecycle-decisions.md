# Browser lifecycle and reconnect decisions

Accepted for implementation, 2026-11-05.

Presentation (hidden/split/stacked/expanded), browser ownership (agent/requested/human/paused) and task status are independent. The server is authoritative for session incarnation, ownership, control revision and task outcome.

- Hide browser: keep page, cookies and current ownership; discard unsent browser gestures. Do not cancel the task or return control. Explicit dismissal prevents later progress events from reopening it.
- Expand/restore: change presentation only. Keep chat draft, page tab and zoom. Automatic opening never steals composer focus.
- Return control: resume an active run after a fresh permitted observation; never start a new run if the prior task completed or was cancelled. Further work then requires a new chat request.
- Stop task: stop new model/tool work through the existing run cancellation path. An already dispatched external action may still complete. Never describe stop as rollback.
- Takeover: gate new agent work first, then wait for in-flight work. Show pending until acknowledged. Only the valid exclusive lease enables human input; spectators cannot steal it.
- Hide, chat switch, ownership loss, page replacement or disconnect: invalidate local input generations and clear buffered keystrokes/click timers. A previously sent action may finish; queued actions must not be replayed. Late responses cannot re-enable a disconnected viewer.
- Disconnect: show the last image as stale, disable input, discard the queue. Reconnect fetches authoritative state; it does not resubmit take, clicks, typed text or uncertain writes. A retained valid lease may reconnect to the same controller; expired or missing leases require explicit takeover.
- Lease expiry: stay paused. Neither closing the viewer nor reconnection implicitly returns control to the model.
- Backend restart or idle expiry: browser contexts and sign-ins are lost. Explain the closed session; reopening is a new browser task, not a replay of the last operation.
- Chat switch or Compare entry: hide the prior viewer, discard unsent gestures and remove split layout. Keep remote ownership until explicit return or lease expiry. Late events cannot open an unrelated chat's browser.
- Frontend reload: recover only metadata and any valid lease; always fetch current state before input. Never store screenshot pixels or typed input in persistent recovery state.

Implementation stages: first deliver split layout, safe input invalidation and authoritative reconnect. Additional browser navigation chrome, persistent workspace status, low-height mobile Chat/Browser toggle, safe agent-owned resizing, dialog handling and click indicators follow the reviewed plan. They are not implied to be implemented by the first layout change.
