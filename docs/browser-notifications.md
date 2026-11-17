# Browser notifications

Open **Settings → General → Notifications**, then select **开启本设备通知** and allow notifications in the browser prompt. Enable each computer/tablet browser separately. **测试通知** sends a Web Push message to this browser; acceptance by the push service does not confirm that the OS displayed it. Existing subscriptions survive this settings integration; no re-enabling is needed after upgrading.

Each device can choose task completion, execution failure and approval/input reminders. Disable a category to stop that category on this device. **关闭本设备通知** removes its server subscription and unsubscribes the browser. Clicking a task notification focuses an existing Yard tab and switches to the corresponding local or SSH conversation through the existing application router, preserving the loaded page and conversation drafts. If no Yard tab is open, it opens the target in a new tab. A tab still running code from before this feature reloads once to receive the update. Scheduled tasks that fail before a conversation is created open Scheduled.

## Delivery and runtime

Yard sends encrypted Web Push messages through the push service selected by the browser. Chromium-based browsers generally use FCM; Firefox and Safari use their respective push services. The supported subscription endpoints are the production FCM, Mozilla, Apple and Windows push services. No Firebase account or SDK is required.

The browser registers `/notification-worker.js` at `/`. It handles push messages and notification clicks. It has no fetch handler and does not cache pages, conversations or files. Notification payloads contain the task status, optional conversation name and Yard route; they omit response text, commands and tool output. Yard and the browser both deduplicate repeated events.

Use HTTPS for access from another device. Loopback `http://localhost` / `http://127.0.0.1` is also a secure context for development and local access. iOS/iPadOS requires a supported Home Screen web app; Android and desktop behavior depends on the installed browser. Network access to that browser's push service, notification permission, and OS/browser background delivery must be available. Closing a Yard tab is supported. Fully exiting a desktop browser, force-stopping an Android browser, restrictive background settings or an offline device can delay delivery.

The Yard service and Codex backend remain running. Browser pages and Codex App can be closed or absent. Yard observes turn and approval events on its existing backend connections, and checks tracked active tasks every five seconds after a page disconnects. The observer uses read requests; it does not resume threads, change session configuration or keep an additional thread subscription loaded. Queued turns are reconciled in order when the thread becomes idle. Normal chats, SSH chats and Yard's scheduled runs use the same delivery service. A task interrupted by the user does not generate a completion or failure banner.

Messages have a one-hour TTL at the push service. Delivery is best effort: network failures and push-service rejection are shown as the last send error for that device. Test again after restoring connectivity. HTTP 404/410 removes an expired subscription; reopen the settings and enable notifications again. Permission prompts only appear after the user clicks Enable. An existing subscription survives page and Yard restarts while the data directory is retained.

## Private state and configuration

`browser-notifications.json` in `AGENTS_DATA_DIR` contains the VAPID key pair, device subscriptions/preferences, active observations and recent event deduplication state. It uses mode `0600` inside Yard's private data directory. Keep it out of Git and retain it across restarts. Replacing it replaces the server key and requires browsers to enable notifications again.

Yard generates its own VAPID keys on startup. `YARD_WEB_PUSH_SUBJECT` can override the default project contact URL with an HTTPS URL or `mailto:` contact. Encryption and VAPID signing use `web-push`; delivery uses Node's `fetch` and the process's normal proxy configuration. `npm start` enables Node's environment-proxy support.

`POST /api/notifications` uses Yard's existing Host/Origin checks, accepts bounded JSON and supports `status`, `subscribe`, `unsubscribe` and `test`. Status returns the public application key and this browser's settings, never the private key or other devices' subscription endpoints. Push endpoints are limited to the supported browser services and redirects are rejected. The service worker restricts notification navigation to this Yard origin.

## Verification

`npm run typecheck` and `npm test` cover encrypted request/receiver round trips, VAPID headers, persisted keys, cross-origin rejection, page-independent observations, duplicate events, restart recovery, waiting episodes, category choices, queued turns, interrupted turns, expired subscriptions and scheduled runs.

`npm run test:notifications:ui` uses an isolated actual Codex CLI, local scripted model and disposable Chromium profile. It verifies the original menu, React controls, tablet layout, unsubscribe/re-enable, and Service Worker notifications after all Yard pages close. Click checks switch conversations through the installed worker and original router, preserve drafts, and assert that neither the main document nor the host socket reloads. The default runner dispatches synthetic click events; native window activation and opening a new tab require an OS click driver. A Linux fixture daemon can expose `org.codex.YardNotificationTest.Click(title) → boolean` on `/org/freedesktop/Notifications`; set `AGENTS_TEST_NOTIFICATION_DBUS=1` only inside that isolated D-Bus session to exercise genuine browser-dispatched clicks, including reopening Yard after every tab closes. A local receiver decrypts real Web Push envelopes and injects the payload through Chromium's `ServiceWorker.deliverPushMessage`. Browser subscription acquisition is replaced by a disposable fixture; this test does not verify public FCM/Mozilla/Apple delivery or physical device background policies. `AGENTS_TEST_CONFIGURATION_SNAPSHOT` can supply a compatible private bootstrap, and `AGENTS_TEST_CHROMIUM` selects the test browser. Evidence stays in `.local/browser-notifications/`.

Protocol references: [Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API), [browser delivery lifecycle](https://web.dev/articles/push-notifications-faq), [web-push](https://github.com/web-push-libs/web-push).
