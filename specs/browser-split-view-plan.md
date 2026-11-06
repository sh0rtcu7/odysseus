# Private browser split view implementation plan

Status: reviewed proposal; no runtime changes in this document.

## Proposed behavior

On a wide workspace, open the existing shared browser beside the chat: chat on the left, browser on the right, initially 50/50. A draggable divider adjusts their widths. Both panes remain usable, with independent scrolling and a visible chat composer. Preserve one browser viewer per chat and the existing takeover, return-control, page tabs, zoom and private session.

Provide Close and Expand controls in the browser header. Expand is an explicit temporary full-workspace view, with a Restore split view button. Closing hides the pane without closing the remote page or resuming the agent. Keep the existing launcher status indicating human control. Incoming results update the pane; explicit dismissal remains respected.

When available workspace width cannot fit both panes comfortably, use a vertical stack with chat above the browser. Keep the composer within the chat region; give each region a minimum usable height. If the on-screen keyboard leaves insufficient height, use a Chat/Browser toggle rather than squeezing both regions into unusable strips. Preserve browser state across all layout changes.

## Code reviewed and implications

- `static/js/browserViewer.js`: `viewers`, `ensureViewer`, `openViewer` already enforce singleton ownership. Keep those. `ensureViewer` currently appends to body; `setExpanded` conflates open/closed state with fixed modal presentation and adds `aria-modal`. Separate these responsibilities.
- `viewerViewport`, `scheduleResize` and the existing ResizeObserver already translate viewer area and zoom into bounded remote viewport sizes. Reuse them; only a lease holder can resize the remote page. Spectators continue to fit the existing screenshot.
- `static/css/03-agent-chat.css`: overlapping historical preview and `.browser-viewer-large` rules impose fixed positioning, viewport height and a shadow backdrop. Consolidate browser presentation rules instead of adding another layer of conflicting overrides.
- `static/index.html`: `#chat-container` currently holds header, history, attachments and composer as one vertical layout. Preserve those IDs and their order within a new chat column. Keep the shared browser outside message/history DOM so streaming replacements cannot destroy it.
- `static/css/01-agent-chat.css`: chat container uses flex column with `min-width:0` and `min-height:0`; history owns vertical scrolling and the composer is width constrained. Carry those constraints into the new chat column to avoid page overflow and a disappearing composer.
- `static/js/sidebar-layout.js`: sidebar auto-collapse checks the outer chat container width. The outer workspace will no longer represent the actual chat column width. Adjust this calculation deliberately, without letting divider drags repeatedly toggle the sidebar.
- Compare has its own pane layout and `.compare-active` rules. Browser docking must not become another Compare pane or alter Compare's sizing. Hide the browser dock when leaving the ordinary chat surface, preserving its session for explicit reopening.
- Current viewer tests cover singleton creation, input, zoom, dismissal and chat-switch hiding, but their layout assertions assume a body-mounted modal. Replace those assertions and add actual app-shell integration coverage.
- Existing browser route and control contracts need no changes for split view. User-agent propagation, authorization, leases, stale-frame checks and action pausing remain unchanged.

## Implementation structure

1. Add an inner workspace to `#chat-container`, containing a chat column, separator and browser host. The outer container retains sidebar spacing and existing app positioning. Existing chat content moves inside the chat column in the static markup; avoid recreating message/composer DOM or moving it on each open. Audit Compare mounting and any direct-child selectors while making this change.
2. Add a small `static/js/browserWorkspace.js` layout controller. Own open/closed, split/expanded presentation, responsive direction, divider ratio and focus restoration here. Accept the existing viewer element; never create browser sessions or call browser APIs. Avoid a general docking/window-management framework for this change.
3. Replace modal presentation calls in `browserViewer.js` with controller operations. Mount each chat's existing viewer into the shared host only when selected. Keep old viewers hidden and out of the visible layout. The layout controller must never restore a previous chat's browser automatically after navigation.
4. Replace modal ARIA with a named region in split/stack mode. Use an accessible separator with orientation and current value. Pointer drag uses pointer capture, release/cancel cleanup, and bounds. Arrow keys adjust by 5%; Home/End select allowed extremes; double-click resets to equal split. Dragging the divider must not send remote page input or trigger sidebar gestures.
5. Persist only the preferred split ratio in localStorage, with storage-error fallback. Do not persist lease tokens, URLs, page contents or an expanded state. Keep visibility/dismissal scoped to the current chat lifecycle. Clamp saved ratios whenever workspace size changes.
6. Observe the available inner workspace, not just window width. Proposed horizontal minimums: chat 360px, browser 360px plus separator; switch to stacked mode below that threshold. Clamp expanded/stack heights to the current visual viewport. Use a small breakpoint hysteresis to avoid resize oscillation.
7. Reuse the existing 200ms viewport debounce. During drag, show local layout immediately and coalesce remote resize requests. At most one resize is in flight and one latest desired size is pending. On release, apply the final measured size. Do not accumulate a screenshot/resize request for every pointer move. Keep stale-frame protections; never replay a coordinate click across a resize.
8. Opening automatically because of an agent result must not steal focus from the chat composer. An explicit launcher click can focus the browser header. Clicking the page focuses remote input as today. Closing restores a connected opener only when focus was in the browser; otherwise retain chat focus and draft. Escape restores expanded to split first; a subsequent Escape in browser chrome may close the pane. Preserve remote Escape behavior when interacting with the page itself.

## Integration safeguards

- Chat message rendering, input value, attachments, selection and scroll position survive pane open/close, drag, expansion and restoration.
- Chat auto-scroll operates only on history, never on the entire workspace. Browser wheel events remain scoped to its page image.
- Listen to the existing session-changed event, hash changes and ordinary-chat/Compare surface transitions. Hiding the dock clears workspace layout classes and releases local drag handlers, but does not release the server control lease or silently resume the agent.
- Sidebar open/close, left/right placement, document panels and full-width chat styles must produce one consistent available-workspace measurement. Do not override their margins with fixed browser offsets. Prefer stacked mode to forcing sidebar preference changes.
- Hidden viewers do not capture frames or issue resize calls. Existing lease/status behavior remains explicit. Clean up layout observers and drag listeners on disposal.

## Delivery sequence

1. Workspace markup/styles and controller with an inert fixture pane; verify sidebar, composer and responsive stacking first.
2. Mount the singleton browser into the host, remove default modal presentation, and preserve launcher/dismissal/session-switch behavior.
3. Add divider interaction, ratio persistence, expand/restore and coalesced viewport updates.
4. Run regression tests, then exercise the real app in the built-in browser using `lfm2.5:8b` and a benign page. Apply local static assets after checks. Commit/push only to the user's fork when requested.

## Acceptance checks

- Multiple browser tool calls still yield exactly one viewer, with no embedded screenshots inside chat history.
- At desktop width, chat and browser are visible and usable simultaneously; opening does not cover the composer or steal a draft's focus.
- Divider bounds hold at both extremes; keyboard resizing, reset, pointer cancellation and storage failure work.
- Resizing does not generate an unbounded request queue. Final screenshot dimensions match the owned pane at 100%; zoom and click mapping remain correct.
- Chat/browser scrolling and keyboard input remain independent; sending chat text does not type into the browser and vice versa.
- Close/reopen and expand/restore preserve zoom, browser tab and ownership state without navigating or reloading the remote page.
- Sidebar modes, document-panel coexistence, narrow screens, orientation change and virtual-keyboard layout remain usable.
- Switching chats or entering Compare hides the previous browser without leaking it into the new surface. Late results do not reopen a dismissed or unrelated pane.
- Use full app-shell browser tests, not just a viewer in an empty div. Retain all existing authorization, stale-input, lease and HTTP startup tests.

## Scope and risk

This is a frontend layout refactor of moderate size. The highest risks are composer/history sizing, sidebar auto-collapse feedback, keyboard routing and resize request buildup. There is no browser backend redesign, new remote desktop transport or permission expansion. Keep the current modal behavior recoverable on the branch while validating the new layout; the final default is split view, with expansion only by explicit user choice.

## Visual indication of model clicks

Show a small ring and pointer over the browser image where the agent intends to click. This is an informational overlay, not a clickable control. It must work in split, stacked and expanded views, including at non-default zoom. Human clicks may use a separate brief neutral ripple; agent clicks receive an accessible label such as "Odysseus is clicking here."

### Source and timing

The managed browser executor resolves the proposed element reference/selector to its actual element on the exact bound Page. Obtain its visible bounding box after any necessary scroll into view and capture a corresponding pre-click frame. Emit a UI-only `browser_action_intent` event immediately before dispatch, with an opaque action ID, session incarnation, page alias, frame ID, control revision and target coordinates in that frame's viewport pixels. Do not infer coordinates from model prose, selectors displayed in chat or stale snapshots.

The event means the executor is about to attempt the click, not that it succeeded. Do not emit it for an unauthorized or unresolved action. Do not add an artificial execution delay just to make the animation visible. Emit a matching `browser_action_result` with the same action ID and an attempted/succeeded/failed/cancelled outcome derived from the execution journal. A successful tool outcome does not by itself prove that the website completed a purchase, submission or other effect.

This requires a small backend-to-UI progress-event addition, unlike the core split layout. Add an optional progress sink to managed browser execution and connect it to the existing live tool-event stream in both agent loops. Preserve event order and ownership filtering. Publish intent while execution is in progress, rather than collecting it in the final tool result after the click. If no progress sink is available, omit the indicator and execute normally.

### Rendering and stale-state rules

- Position a pointer-events-none overlay inside the image's viewing area. Invert the existing `imagePoint` contain/letterbox mapping: viewport coordinates become image-relative CSS positions, including centering offsets and scaling. Recompute positions after local resize or zoom.
- Render only when session incarnation, page, control revision and displayed frame ID match. Include the pre-click frame in the existing ephemeral frame delivery mechanism and retain it long enough for the event/image to arrive together. Bound frame retention and evict expired frames; do not persist screenshots in chat history.
- A target may be scrolled, obscured, detached or moving. If a reliable visible target cannot be resolved, omit the marker; never invent a position. Treat coordinates as the intended target, since the page may still move between observation and dispatch. Do not switch to forced coordinate clicks to make the indicator and execution agree.
- Retain a marker briefly on its matching pre-click image. Clear it when navigation, tab switching, takeover, resource replacement or a newer displayed frame invalidates its coordinates. Do not leave a ring over an unrelated location on the resulting page. A toolbar status may briefly say "Click attempted" or "Click failed" after the image changes.
- Show planned/attempting state with a subtle pulsing ring; use a brief check or error treatment when a matching result arrives while the same frame is still visible. Respect reduced-motion preferences and announce status through a throttled live region. Do not rely on color alone.
- Indicators update without opening a dismissed pane or stealing chat focus. Bound concurrent markers, coalesce repeated status announcements and clear them on chat switches. They never grant permission, bypass approvals or change the execution outcome.
- Keep payloads minimal: identifiers, coordinates and outcome only. Avoid field contents, typed text, page HTML and sensitive element labels. Raw third-party tool output cannot manufacture trusted click-intent events.

### Delivery and tests

Implement this after the split workspace and resize handling are stable. First add executor progress events and routing, then the overlay and accessible status, then live verification with a benign page.

Acceptance tests cover: an element click shown before dispatch; a matching attempted/result transition; no marker for denied or unresolved actions; correct positions with letterboxing, zoom and divider resizing; offscreen targets scrolled into view; detached or moving targets safely omitted; navigation/takeover invalidation; events arriving before or after their frame; bounded frame retention; no marker appearing in another chat; dismissal/focus preservation; reduced motion; and equivalent event delivery in both agent loops. The browser must still execute correctly if the UI disconnects or cannot display the marker.
