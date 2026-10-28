// These factories receive the pinned renderer's React and service objects.
// Keep runtime React imports out of this bundle: the existing tree owns them.
export { createSidebarRelativeTimeComponent } from './sidebar/relative-time.tsx';
export { createCollapsibleUserMessageContentComponent } from './messages/collapsible-user-message-content.tsx';
