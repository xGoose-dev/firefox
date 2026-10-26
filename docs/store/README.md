# Firefox store submission

Version: 0.3.1. Add-on ID: `xgoose@uscard.dev`.
Existing store listing: https://addons.mozilla.org/firefox/addon/xgoose/
Public source: https://github.com/xGoose-dev/firefox

The Firefox release is based on xgoose 0.3.1 with 34 packaged skills. Its manifest
uses a background event page, Firefox 153 document-scoped script execution,
optional User Scripts, built-in data consent, and disabled private-browsing access.

Use `description.txt` for the product description, `firefox-release-notes.md`
for version notes, and `MOZILLA_REVIEW.md` at the repository root for source/build
and testing instructions. The release includes both the extension ZIP and the
matching source archive. All shared libraries are included.

Onboarding review fixes:

- Email sign-in and account-free BYOK are both explicit. The BYOK link selects
  the correct Settings mode instead of leaving the user in Hosted mode.
- Connection readiness and trial eligibility are shown after sign-in/configuration.
- BYOK configuration collapses optional Hosted sign-in; the first-use path goes
  directly to a website and a first prompt.
- Custom scripts are optional after the first-use steps. Permission is requested
  directly through Firefox; ordinary page reading does not show a blocking banner.
- Email delivery failures show an inline error and allow another attempt.
- Hosted transcript storage is disclosed alongside the connection choice.
- Keyboard focus, a skip link, localized text, and narrow layouts are supported.

Validation uses 70 shared unit tests, six archive safety tests, TypeScript, Mozilla
addons-linter, and a real Firefox 158.0.1 browser regression with a synthetic local
provider. The browser suite also exercises the real optional permission prompt.

Firefox gallery uses the same xgoose logo and feature-illustration design as Chrome.
All platform labels say “for Firefox”; the onboarding image embeds actual Firefox
Getting started UI and omits Chrome-specific permission switches. Six gallery
images cover research, skills, connection, images, first use and custom scripts.
The packaged toolbar icons are byte-identical to Chrome 0.3.1.
