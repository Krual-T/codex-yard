# Dot tab claiming
- Dot uses tabs on Dot's active main thread. `browser.user.openTabs()` lists those tabs without claiming them.
- Choose a tab from that fresh listing and pass the returned object to `browser.user.claimTab(tab)`. Reuse the returned `Tab` for navigation, Playwright, screenshots, CUA, and other supported browser actions.
- `browser.tabs.list()` shows only tabs claimed by the current caller. `browser.tabs.new()` creates a Dot tab and claims it automatically.
- Only one caller can control a tab at a time. Claims release when the turn ends. Existing user tabs remain open; newly created tabs follow the Tab Cleanup guidance. Reusing a surviving `Tab` in a later turn automatically tries to reclaim it; list and claim any other existing tab before using it.
