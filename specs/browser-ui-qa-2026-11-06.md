# Browser workspace UI QA — 2026-11-06

Scope: browser workspace, activity grouping and chat integration. This is not an exhaustive audit of unrelated application features.

## Verification

Live checks used the ChatGPT built-in browser against local Odysseus with lfm2.5:8b and a benign Wikipedia page. Inspected desktop at 1440×900 and 1280×720, phone portrait at 390×844 and 390×640, and landscape at 844×390. Temporary viewport overrides were reset after testing. No external submissions or purchases were performed.

The related regression suite passed 182 tests, covering browser ownership, routes, resource identity, managed sessions, startup compatibility, user-agent handling, activity grouping and UI interactions. UI fixtures additionally simulate connection loss, late responses and session expiry. Physical-device touch and virtual-keyboard behavior are not established by viewport emulation.

## Findings corrected

- Open browser could wrap into a clipped two-line button. Prevent shrinking/wrapping the label; allow its adjacent status text to wrap.
- Long status text crowded browser header actions. Give status its own muted row, with compact controls matching the application's font, tokens and borders.
- Native/global details styling made browser summaries appear inconsistent. Use explicit muted panel styling while retaining prominent failure status.
- A permanently expanded text/key toolbar consumed scarce page space. Replace it with a native disclosure, closed by default; give the phone text field its own full-width row.
- Stacked phone panes left the page too small to use. Use a Chat/Browser switch at phone widths or short workspace heights, preserving each view's DOM and draft. Wider/taller workspaces retain split/stack modes.
- Short landscape headers consumed excessive height. Condense their status and toolbar; allow the toolbar itself to scroll rather than overflow the document.
- Expanding, hiding and reopening could leave the button labeled Restore split view in a split layout. Reset the label when reopening.
- Divider keyboard input could save out-of-range ratios. Clamp before persisting, consistent with pointer bounds.
- Expired sessions retained old screenshots with an inaccurate disconnected label. Clear the image and old lease, disable takeover, report session ended and stop stale-state polling until an explicit new observation.
- Fast typing could precede a debounced click. Reserve the click's input queue position immediately; a double click updates that pending intent. If the click becomes stale, discard dependent queued text and ask for re-entry rather than type into a potentially different field.
- A completed click could steal focus from a field or disclosure clicked while its request was pending. Focus the viewer at gesture time, not after the asynchronous result.

## Other successful checks

Singleton viewer behavior; live and saved action descriptions; expand/collapse without losing per-action errors; takeover and return; reconnect via reload; zoom and responsive image dimensions; preservation of an unsent chat draft while switching views; keyboard divider resizing; prevention of input after disconnection; stale-frame rejection; and absence of document-level horizontal overflow in tested phone/landscape layouts.

No live takeover of another user's/browser tab's lease was attempted. Isolation is covered by regression tests and earlier live spectator checks. There was no need to modify authorization, bypass site challenges or restart the app for these frontend changes.

## Remaining limitations and follow-ups

- Screenshot forwarding is not a native embedded webview. Native text selection, full remote accessibility semantics, drag/drop, file uploads, browser dialogs and passkey integration remain outside the current interaction contract.
- Agent-owned pages still fit their current screenshot; responsive page resizing requires human control until safe agent-boundary resizing is implemented.
- Preview/resize changes are asynchronous. Stale clicks are rejected instead of guessed; users may need to click again after a layout change.
- Full app surfaces such as Compare, document panels, alternate themes and native mobile keyboards were not exhaustively exercised in this pass. They need dedicated integration coverage; passing browser regressions is not a claim that all app features were tested.
- Planned click indicators and expanded navigation chrome remain separate work.

Changes are applied to the local instance and remain uncommitted. No upstream push was performed.

Evidence: `/private/tmp/odysseus-ui-qa-desktop.png` and `/private/tmp/odysseus-ui-qa-phone.png`. The final live pass also verified pointer dragging, double-click divider reset, 125% zoom/reset, expand/restore and phone draft preservation. Very short landscape viewing areas may still fit-scale below the remote browser's 240px minimum viewport height; improving that bound is separate backend work.
