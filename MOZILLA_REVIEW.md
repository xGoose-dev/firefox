# Mozilla reviewer instructions — xgoose 0.3.1 for Firefox

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
