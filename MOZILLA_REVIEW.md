# Mozilla reviewer instructions — xgoose 0.3.2 for Firefox

This is an update of the existing listed extension `xgoose@uscard.dev`.
Public source: https://github.com/xGoose-dev/firefox

## Exact build

Built on macOS with Node.js 25.6.1 and npm 11.9.0. The build is also supported
on Linux with Node 22.19+; all build tools are official npm registry packages.
No secrets, account, private repositories, network source downloads or environment
variables are required to build. All shared source is included in this archive.

From this directory:

```sh
npm ci --ignore-scripts
npm run build
```

The complete extension is `apps/firefox/dist/`. The submitted ZIP contains those
files directly at the root. Source maps are disabled to make the release independent
of the checkout path. `npm run check` also runs TypeScript and shared unit tests.
`npm run lint:amo` runs the Mozilla linter.

## Test without a hosted account

BYOK works without an xgoose account. Open Settings, choose your own provider,
enter an OpenAI-compatible endpoint/API key or a Gemini API key, choose a model
and save. Use a provider credential you control. Hosted AI is optional; it uses
email confirmation and requires available account credit. There is no universal
shared hosted credential in this source package.

For a complete no-credential, no-charge functional test with a synthetic provider:
install Firefox 153+ and run `FIREFOX_BINARY=/path/to/firefox npm run e2e`.
Selenium Manager obtains the official geckodriver; the test uses its own temporary
profile and a localhost-only AI fixture. See `tests/browser/firefox.mjs`.

On a normal installation, Getting started explains both routes and connection
readiness. Open Hacker News or another supported website to inspect packaged
skill functions; no optional User Scripts permission is needed for them. Click
Enable User Scripts in Settings/Getting started and select Allow user scripts in Firefox’s prompt before clicking Allow. This
optional permission is used for explicitly installed community scripts, edited skills and custom page actions.
Installed scripts and their source can be inspected, disabled and deleted in Settings.
Online skill updates require the user's explicit action.

## Firefox adaptation

- Minimum Firefox 153: uses `MessageSender.documentId`, document-scoped injection
  and `userScripts.execute`. No Chrome settings or developer-mode switch is used.
- MV3 background event page, not a service worker.
- Promise-based `browser.*` API via an esbuild-injected local alias.
- Pure JavaScript WHATWG streams in the isolated content realm, with a matching
  response adapter. Cross-world DOM RPC uses JSON strings instead of object details.
- `<all_urls>` supports the assistant on the user's current page and arbitrary
  user-selected AI endpoints. `tabs`, `activeTab`, `scripting`, `storage` and
  `alarms` support tab actions, local data, packaged skills, and background queues.
- `userScripts` is optional and requested only from a user click.
- Private-browsing operation is disabled to avoid retaining private content.

## Data disclosure

The Firefox manifest declares website content, browsing activity, authentication,
identifying information and personal communications. These cover user prompts,
selected page context, account email/auth and hosted transcript data. Hosted
messages and tool results are retained for 90 days; BYOK extension history stays
local. Requests still go to the provider the user selected. API keys are stored
locally and excluded from configuration sync and analytics.

Technical/interaction data is optional. Analytics defaults off, requires both the
local setting and Firefox's optional technical data permission, and excludes
message content and credentials. Redacted configuration sync is gated by the
same Firefox permission. Privacy: https://xgoose.org/privacy/

## Linter notes

The remaining warnings concern HTML rendering in existing product UI/Discourse
readers. User-owned strings in account cards are escaped; Markdown uses the
existing sanitizer. Discourse HTML is parsed in disconnected DOM elements for
text extraction. The source is included here for review. No obfuscated code or
remote libraries are loaded.


## 0.3.2 context-window update

Ports the model-sized context policy from xgoose Chrome commit
283fd9cdef96ebc98b4b1cad8c715cb73a90f7a1. Removes the common 128K token /
175 KB text trigger. Known models use their own capacities; unknown models keep
a conservative fallback. The agent reserves 4,096 output tokens plus input
headroom, and respects lower gateway token/byte response limits. Provider context
errors trigger one compaction/retry before any assistant output is committed.
Full local history is retained; completed tools are not replayed.

The Context meter displays current model occupancy in tokens, with local estimates
marked as estimates. The MIT-licensed gpt-tokenizer 4.1.0 o200k_base vocabulary
is bundled locally; there is no remote executable code or tokenizer download.
The build removes whitespace and simplifies syntax in content.js to stay below
AMO's JavaScript parser limit, while preserving identifiers. Complete original
TypeScript and the exact package-lock.json are included for review/rebuilding.
No new permissions or data collection. Existing logo and six gallery images stay
unchanged. Default model selection is outside this context-only update.

Regression tests include an approximately 800K-token synthetic core input and
real Firefox input above 128K, smaller-model automatic compaction and gateway
rejection/retry. These use only local synthetic providers, with no paid AI calls.

The Firefox transport also consumes streamed HTTP error bodies directly instead
of rejecting .text()/.json(). This allows the provider SDK and Hosted error
normalizer to read context rejection codes and apply the bounded retry policy.
Successful SSE responses continue streaming through the original body reader.
