"""Real isolated-browser setup/version UI check with mocked Chrome APIs.

Every page request is intercepted from this source folder. No Google/OpenAI/
Supabase connection, actual extension installation or customer profile is used.
Requires a development Playwright environment, not an extension runtime dependency.
"""

import argparse
import json
import mimetypes
from pathlib import Path
from urllib.parse import unquote, urlsplit


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--browser", required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
    template = (root / "apps-script.gs").read_text(encoding="utf-8")
    import re
    version = int(re.search(r"FUDGE_CONNECTOR_VERSION = (\d+)", template)[1])
    from playwright.sync_api import expect, sync_playwright
    state = {"extension": manifest["version"], "connector": version}
    init = r"""
    (()=>{
      const meta=__META__;
      const state={secret:'fixture-original-connector-secret-0123456789',connected:false,url:''};
      const listeners=[];
      globalThis.__fixtureCopies=[];globalThis.__fixtureClipboardFailure=false;
      Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{
        if(globalThis.__fixtureClipboardFailure)throw new Error('fixture permission refusal');
        globalThis.__fixtureCopies.push(value);
      }}});
      Object.defineProperty(globalThis,'chrome',{configurable:true,value:{
        storage:{onChanged:{addListener:fn=>listeners.push(fn)}},
        runtime:{getManifest:()=>({version:meta.extension}),getURL:name=>'https://fudge-fixture.invalid/'+name,
        sendMessage:async message=>{
          if(message.type==='GET_SCRIPT_SETUP')return {ok:true,appsScriptSecret:state.secret,appsScriptUrl:state.url,sheetsDatabase:state.connected?{spreadsheetId:'fixture'}:null};
          if(message.type==='GET_SHEETS_STATUS')return {ok:true,connectionReady:state.connected,expectedConnectorVersion:meta.connector,connectorVersion:state.connected?meta.connector:null,connectorObservedAt:state.connected?'2026-11-02T16:00:00Z':null};
          if(message.type==='SAVE_SCRIPT_SETUP'){
            state.connected=true;state.secret='fixture-recovered-connector-secret-0123456789';state.url='https://script.google.com/macros/s/fixture/exec';
            for(const listener of listeners)listener({sheetsConnectorObservation:{}},'local');
            return {ok:true,database:{spreadsheetId:'fixture'}};
          }
          if(message.type==='DISCONNECT_SCRIPT'){state.connected=false;state.url='';return {ok:true};}
          throw new Error('Unexpected fixture message');
        }}
      }});
    })();
    """.replace("__META__", json.dumps(state))
    failures, requests = [], []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=args.browser, headless=True)
        try:
            context = browser.new_context(viewport={"width": 1100, "height": 900}, service_workers="block")
            context.add_init_script(init)
            page = context.new_page()
            page.on("pageerror", lambda error: failures.append(str(error)))

            def fulfill(route):
                url = urlsplit(route.request.url)
                if url.hostname != "fudge-fixture.invalid":
                    raise AssertionError("Unexpected external page request")
                target = (root / unquote(url.path).lstrip("/")).resolve()
                target.relative_to(root)
                requests.append(url.path)
                route.fulfill(status=200, content_type=mimetypes.guess_type(target.name)[0] or "text/plain", body=target.read_bytes())
            page.route("**/*", fulfill)
            page.goto("https://fudge-fixture.invalid/drive-setup.html", wait_until="networkidle")
            expect(page.locator(".brand-name")).to_have_text("fudge")
            expect(page.locator("#copyScript")).to_be_enabled()
            expect(page.locator("#scriptPreview")).to_contain_text(f"v{version}")
            assert "fixture-original" not in page.locator("#scriptPreview").inner_text()
            page.locator("#copyScript").click()
            assert page.evaluate("__fixtureCopies.length") == 1
            page.locator("#webAppUrl").fill("https://script.google.com/macros/s/fixture/exec")
            page.locator("#connectButton").click()
            expect(page.locator("#toast")).to_contain_text("Collection stays stopped")
            page.locator("#copyScript").click()
            assert page.evaluate("__fixtureCopies.at(-1).includes('fixture-recovered-connector-secret')")
            page.locator(".release-info summary").click()
            expect(page.locator("[data-release-info]")).to_contain_text(f"extension v{manifest['version']}")
            expect(page.locator("[data-release-info]")).to_contain_text(f"last response v{version}")
            assert "connector-secret" not in page.locator("[data-release-info]").inner_text()
            page.evaluate("__fixtureClipboardFailure=true")
            page.locator("#copyScript").click()
            expect(page.locator("#toast")).to_contain_text("Could not copy")
            page.set_viewport_size({"width": 390, "height": 844})
            assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), "Mobile setup overflows horizontally"
            assert not failures, failures
            context.close()
        finally:
            browser.close()
    print(json.dumps({"mode": "isolated_setup_ui_fixture", "result": "pass", "extensionVersion": manifest["version"],
                      "connectorTemplate": version, "external_page_requests": 0, "actual_extension_live_acceptance": False}))


if __name__ == "__main__":
    main()
