# fudge 2.0.1 / connector 43 — QA release status

This is an installable source candidate, **not signed-off live client acceptance**.
The public brand is lowercase `fudge`; internal protocol/storage identifiers and
the existing unpacked extension ID are unchanged.

## Implemented and checked

- Setup cannot copy an empty/unloaded connector. Generated secrets use a safe JS
  string literal, including quotes/newlines/replacement-token edge cases, and
  are never shown in the preview. Reconnect/import refreshes the generated copy
  with the secret that actually worked. Clipboard/disconnect failures are caught.
- Connecting accurately says collection remains stopped until Start; the saved
  setup display does not pretend to prove live readiness.
- `versions` on the sidebar, library and setup pages shows the manifest version,
  expected connector, last observed remote connector and observation time. The
  observation survives worker restarts, stays tied to its exact endpoint and is
  labelled cached, not a live health check. Private endpoint URLs/keys are not
  rendered. Optional metadata-save failure cannot turn a successful remote
  operation into a failed/retried one.
- Connector 43 exposes model selection and a provider model-metadata access
  check. The latter generates no text, sends no review data and changes no Sheet
  or Script property. It does not establish generation permission/quota/quality.
  The existing model default remains configured, **not provider-verified**; the
  client must check actual key/model access instead of trusting a model name.
- Provider details redact the saved key; raw non-JSON bodies are withheld.
  Existing rewriter regression fixes and Start/Stop recovery remain in place.
  No backend upload/catalog release gate was enabled.

Validation: **132 smoke, 67 backend and 18 setup/version tests PASS**, all root
JS/Apps Script syntax checks PASS; `git diff --check` PASS (line-ending notices
only). Real installed Chrome, fresh isolated context and intercepted local files:
setup/copy/reconnect/clipboard refusal, lowercase/version rendering, no preview
secret, and 390px mobile layout PASS, with no real external page requests.
Chrome APIs were mocked; this is not an actual installed extension/Google/OpenAI
acceptance test. No customer browser/storage, Google Sheet cell or real API key
was accessed/changed by those fixtures.

## Existing-install update / required operator pilot

1. Stop collection, preserve/export important local data and update the existing
   unpacked folder. **Reload**, never remove/re-add the extension. A temporary
   outdated-connector warning is expected until step 3; older compatible
   connectors can still sync their supported tabs.
2. Open Change sheet → copy the protected connector. Confirm preview **v43**.
   Do not paste raw GitHub/local `apps-script.gs`: it still has a secret placeholder.
3. Paste into the existing Sheet's Apps Script project, save, approve permissions
   if required, and edit its existing deployment → New version → Deploy. Keep its
   URL/secret and Script Properties private. Never put generated code in a repo.
4. Sync and check `versions`: extension **2.0.1**, last connector response **v43**
   for the intended Sheet. Verify the actual trigger status in the Sheet menu.
5. Set the client's own API key/model privately. Run Check model access, then a
   separately authorized Test rephrasing on suitable content. Metadata access alone
   does not prove generation works. Do not change cost/model selection silently.
6. Run one authorized Google collection → saved original → Sheet fill → writer
   result cycle, Stop/resume/reload, QC replacement and picture upload checks with
   the client's actual Google/Drive permissions. Respect blocks and quota limits;
   never bypass challenges. Verify provenance, rights and factual accuracy before
   reuse; do not turn someone else's experience into a fake client testimonial.

The optional fudge → ND backend upload remains release-gated OFF. ND's source
QA archive separately records its unaccepted live-pilot and feature gaps. No
"100% working" or complete end-to-end client handover is claimed by this file.
