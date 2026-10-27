/// <reference lib="webworker" />
/* oxlint-disable typescript/no-unsafe-call, typescript/no-unsafe-argument -- Canonical standalone worker runs outside the renderer TypeScript project and uses ServiceWorkerGlobalScope APIs. */
// Keep the canonical worker URL and protocol compatible with ChatGPT web.
// https://github.com/openai/openai/blob/master/chatgpt/web/public/service-worker/events.js
const ALLOWED_TARGET_URL_HOSTNAMES = new Set([
  "chatgpt.com",
  "chatgpt-staging.com",
]);

self.addEventListener("push", function (event) {
  event.waitUntil(handlePushEvent(event));
});

async function handlePushEvent(event) {
  let data = {};
  if (event.data) {
    try {
      // Await the promise returned by event.data.json()
      data = await event.data.json();
    } catch {
      return;
    }
  }

  if (data == null || typeof data !== "object") {
    return;
  }
  let postDisplayed = false;
  const clients = await self.clients.matchAll({
    includeUncontrolled: true,
  });
  for (const client of clients) {
    if (client.visibilityState === "visible") {
      postDisplayed = true;
    }
    client.postMessage(data);
  }

  if (data.type === "new-message" || data.type === "target_url") {
    const title = data.title || "Default title";
    const notificationData = {
      ...data.data,
    };
    if (
      notificationData.notification_channel_id == null &&
      data.channel_id != null
    ) {
      notificationData.notification_channel_id = data.channel_id;
    }
    const options = {
      body: data.body ?? "Default body",
      icon: data.icon ?? "https://chatgpt.com/images/chatgpt-icon-96x96.png",
      badge: data.badge ?? "https://chatgpt.com/images/chatgpt-icon-96x96.png",
      data: notificationData,
    };
    if (data.type === "target_url" || !postDisplayed) {
      await self.registration.showNotification(title, options);
    }
  }
}

self.addEventListener("notificationclick", function (event) {
  const data = event.notification.data ?? {};
  let url = new URL("https://chatgpt.com/");

  if (data.type === "target_url" && data.url != null) {
    try {
      const targetUrl = new URL(data.url);
      if (
        targetUrl.protocol === "https:" &&
        ALLOWED_TARGET_URL_HOSTNAMES.has(targetUrl.hostname)
      ) {
        url = targetUrl;
      }
    } catch {
      // Fall back to the ChatGPT home page for malformed target URLs.
    }
  } else if (data.conversation_id != null) {
    url = new URL(
      `/c/${encodeURIComponent(data.conversation_id)}`,
      "https://chatgpt.com/",
    );
  }

  if (data.notification_id) {
    url.searchParams.set("notification_id", data.notification_id);
  }
  if (data.notification_channel_id) {
    url.searchParams.set(
      "notification_channel_id",
      data.notification_channel_id,
    );
  }

  event.waitUntil(self.clients.openWindow(url.toString()));
  event.notification.close();
});
