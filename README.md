# xgoose for Firefox

An open source AI assistant and website skill manager in your current Firefox tab.
Based on [xgoose 0.3.1](https://github.com/xGoose-dev/xgoose), with a Firefox event
page, Promise-based browser APIs, optional script permissions, and content-script
streaming adapted to Firefox. MIT licensed.

## Install

[Get xgoose on Firefox Add-ons](https://addons.mozilla.org/firefox/addon/xgoose/).
Firefox 0.3.2 requires **Firefox 153 or later** on desktop and Android.
It uses document-scoped script injection and `userScripts.execute`, introduced in
Firefox 153. Until Mozilla publishes this update, the store may offer the older release.

## First conversation

1. Open Getting started after installation. Use email sign-in for Hosted AI,
   or choose **Connect your own API key**. BYOK does not require an xgoose account.
2. Check the connection status. Hosted users can claim trial credit when eligible;
   existing BYOK configuration is recognized automatically.
3. Open a target website, click the xgoose toolbar icon or floating button, and ask
   a question. Built-in skills and page reading work immediately.
4. Optionally enable **User Scripts** for community skills, local edits and custom
   page actions. Firefox requests the permission directly from a button click.

## Features

- Floating chat with streaming responses, source links, local history and automatic
  context compaction. Attach up to three images per message.
- Model-sized context windows replace the fixed 128K/175 KB caps. Context occupancy
  uses a local token estimate, reserves output space and compacts when necessary.
  Provider limits remain authoritative, including lower custom-endpoint limits.
- 34 packaged website skills, including Reddit, Hacker News, Discourse, Weibo,
  V2EX, NGA, LinkedIn, Substack, X, Zhihu and travel research sites.
- Install, inspect, edit, disable, remove and explicitly update website scripts.
- Hosted AI with email confirmation sign-in; OpenAI-compatible and Gemini BYOK.
- English, Simplified Chinese and Spanish UI, with separate answer-language settings.

## Privacy

AI requests send your prompt and requested page/skill content to the selected
provider. Hosted conversations include messages and tool inputs/results and are
stored for 90 days, with secrets redacted and audited administrator access.
BYOK history stays in the extension; AI traffic still goes to your selected provider.
Usage analytics are off by default and require Firefox's separate optional technical
data permission. Redacted configuration sync also requires that permission.
Private browsing is disabled for this extension to keep private data out of history.
Read [the privacy policy](https://xgoose.org/privacy/).

## Develop

Requires Node.js 22.19 or later and npm. All shared libraries are in this repository;
no private sibling repositories or credentials are required.

```sh
npm ci --ignore-scripts
npm run check
npm run lint:amo
npm run package
```

The loadable extension is in `apps/firefox/dist/`. For local testing:

```sh
npx web-ext run --source-dir apps/firefox/dist
```

Run the real Firefox regression suite with Firefox 153+ installed:

```sh
FIREFOX_BINARY=/path/to/firefox npm run e2e
```

The suite verifies large-model input above 128K, small-model compaction, automatic
context-rejection recovery, and the model-specific Context meter. It uses an isolated temporary Firefox profile, a synthetic local AI provider,
and Selenium. It verifies page reading, streamed replies, built-in skill injection
without optional scripts, Firefox's permission prompt, and document-scoped custom
execution. It uses no user account or paid AI requests. Screenshots/reports are saved
under `artifacts/firefox-e2e/` and are excluded from Git.

## Layout

- `apps/firefox/`: Firefox host, onboarding, settings, built-in skills and static assets.
- `packages/`: agent core, page controller, DOM reader, skill runtime and chat UI.
- `tests/`: shared regression tests and real Firefox browser tests.
- `MOZILLA_REVIEW.md`: exact rebuild and reviewer instructions.
- `docs/store/`: listing text, artwork and release notes.
