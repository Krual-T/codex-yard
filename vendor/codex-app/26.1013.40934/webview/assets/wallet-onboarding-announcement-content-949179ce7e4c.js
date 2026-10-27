const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["./wallet-onboarding-announcement-modal-c15e87ca210a.js","./rolldown-runtime-2d059c5e81f4.js","./app-shared-61271c39e3c5.js","./app-shared-dc7535e633d7.css","./app-initial-a68277f60b93.js","./app-initial-e7c27dd40beb.css","./wallet-onboarding-announcement-modal-d1eb7efda70f.css"])))=>i.map(i=>d[i]);
import{n as e}from"./rolldown-runtime-2d059c5e81f4.js";import{$4 as t,$dt as n,B4 as r,CPt as i,Cot as a,DDt as o,FSt as s,ISt as c,Ixt as l,JR as u,Mz as d,NDt as f,Nxt as p,Nz as m,ODt as h,Qdt as g,RDt as _,Rxt as v,SLt as y,Sot as b,XIt as x,YR as S,_0 as ee,_O as C,bPt as w,cO as T,fO as E,gzt as D,hzt as te,jxt as O,lLt as ne,lPt as k,mO as re,mwt as A,nst as ie,pwt as j,rIt as M,t3 as N,tft as ae,uIt as P,uLt as F,uPt as oe,v0 as se,vMt as I,vO as ce,yPt as L,z4 as R}from"./app-shared-61271c39e3c5.js";import{Sjr as le,_jr as ue,a4n as de,aMn as fe,cjr as pe,hjr as me,lMn as he,nbt as ge,ojr as _e,rbt as z,s4n as ve,sMn as ye,sjr as be,tbt as xe,xjr as B}from"./app-initial-a68277f60b93.js";import{n as Se,t as V}from"./mcp-app-host-styles-bffbb1a5e42b.js";import{i as H,o as Ce,r as we}from"./mcp-sandbox-rpc-2746253abd6f.js";import{n as U,r as Te,t as Ee}from"./sandbox-origin-33cf3517efd3.js";import{n as De,r as Oe}from"./view-queries-cd18ae2e0f1f.js";function ke(e,{styleVariables:t={},theme:n=`light`}={}){return`<!doctype html>
<html data-theme="${n}" style="color-scheme: ${n}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <style>
      html, body { min-height: 100%; margin: 0; background: var(--color-background-primary, #fff); }
      body { color: var(--color-text-primary, #171717); font-family: var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif); }
      * { box-sizing: border-box; }
      form { display: flex; flex-direction: column; width: 100%; min-height: 100vh; padding: 28px 24px 8px; }
      .enrollment-content { display: flex; flex: 1; flex-direction: column; justify-content: center; }
      h1 { margin: 0 0 28px; color: var(--color-text-primary, #171717); font-size: 20px; font-weight: var(--font-weight-semibold, 600); line-height: 25px; letter-spacing: -0.45px; text-align: center; }
      .fields { overflow: hidden; border: 1px solid var(--color-border-primary, #d8d8d8); border-radius: 13px; background: var(--color-background-secondary, #fff); }
      label { display: grid; min-width: 0; padding: 7px 16px 6px; color: var(--color-text-primary, #171717); font-size: 13px; line-height: 17px; }
      label:focus-within { outline: none; box-shadow: inset 0 0 0 2px var(--color-ring-primary, #6b6b6b); }
      .row { display: grid; grid-template-columns: 1fr 1fr; border-top: 1px solid var(--color-border-secondary, #d8d8d8); }
      .row label + label { border-left: 1px solid var(--color-border-secondary, #d8d8d8); }
      .field { position: relative; height: 24px; overflow: hidden; }
      .hosted { position: absolute; inset: 0; opacity: 0; }
      /* Match the VGS document scheme to keep its loading canvas transparent. */
      .hosted iframe { display: block; width: 100%; height: 100%; border: 0; color-scheme: light; }
      .field::before { position: absolute; top: 7px; left: 0; width: 42%; height: 10px; border-radius: 999px; background: var(--color-background-disabled, #dedede); content: ""; opacity: 0.8; }
      [data-fields-ready="true"] .hosted { opacity: 1; }
      [data-fields-ready="true"] .field::before { content: none; }
      .privacy { margin: 24px 0 0; color: var(--color-text-tertiary, #8f8f8f); font-size: 12px; line-height: 16px; text-align: center; }
      .verification select, .verification input { width: 100%; height: 32px; border: 0; background: transparent; color: inherit; font: inherit; font-size: 16px; }
      .actions { display: flex; flex-shrink: 0; flex-direction: column; }
      .status { min-height: 16px; margin: 16px 0 0; color: var(--color-text-secondary, #666); font-size: 14px; line-height: 16px; text-align: center; }
      .error { display: none; margin-top: 16px; padding: 12px; border: 1px solid var(--color-border-danger, #efc4c4); border-radius: 12px; background: var(--color-background-danger, #fff5f5); color: var(--color-text-danger, #a12020); font-size: 14px; line-height: 20px; text-align: center; }
      .error[data-visible="true"] { display: block; }
      button { width: 100%; min-height: 44px; margin-top: 16px; border: 0; border-radius: 999px; background: var(--color-background-inverse, #171717); color: var(--color-text-inverse, #fff); font: inherit; font-size: 15px; font-weight: var(--font-weight-medium, 500); cursor: var(--cursor-interaction); }
      button:disabled { background: var(--color-background-disabled, #dedede); color: var(--color-text-disabled, #8a8a8a); cursor: not-allowed; }
      .retry { display: none; }
      .retry[data-visible="true"] { display: block; }
      [hidden] { display: none !important; }
      html[data-theme="dark"], html[data-theme="dark"] body { background: var(--color-background-primary, #171717); }
      html[data-theme="dark"] body, html[data-theme="dark"] h1, html[data-theme="dark"] label { color: var(--color-text-primary, #f5f5f5); }
      html[data-theme="dark"] .fields { border-color: var(--color-border-primary, #555); background: var(--color-background-secondary, #242424); }
      html[data-theme="dark"] .row, html[data-theme="dark"] .row label + label { border-color: var(--color-border-secondary, #555); }
      html[data-theme="dark"] .privacy { color: var(--color-text-tertiary, #a3a3a3); }
      html[data-theme="dark"] .status { color: var(--color-text-secondary, #c7c7c7); }
      html[data-theme="dark"] label:focus-within { box-shadow: inset 0 0 0 2px var(--color-ring-primary, #b8b8b8); }
      html[data-theme="dark"] button { background: var(--color-background-inverse, #f5f5f5); color: var(--color-text-inverse, #171717); }
      html[data-theme="dark"] button:disabled { background: var(--color-background-disabled, #484848); color: var(--color-text-disabled, #999); }
      html[data-theme="dark"] .error { border-color: var(--color-border-danger, #744343); background: var(--color-background-danger, #342424); color: var(--color-text-danger, #f3b6b6); }
      @media (max-width: 420px) { form { padding: 22px 18px 8px; } label { padding-right: 14px; padding-left: 14px; } }
    </style>
  </head>
  <body>
    <form id="form" data-fields-ready="false">
      <div class="enrollment-content">
        <h1 id="title"></h1>
        <div class="fields" id="fields" aria-busy="true">
          <label><span id="card-number-label"></span><span class="field"><span class="hosted" id="vgs-card-number"></span></span></label>
          <div class="row">
            <label><span id="expiration-label"></span><span class="field"><span class="hosted" id="vgs-card-expiration"></span></span></label>
            <label><span id="cvc-label"></span><span class="field"><span class="hosted" id="vgs-card-cvc"></span></span></label>
          </div>
        </div>
        <p class="privacy" id="privacy"></p>
        <div class="verification" id="verification" hidden>
          <div class="fields">
            <label><span id="verification-option-label"></span><select id="verification-option"></select></label>
          </div>
          <button id="request-code" type="button"></button>
          <div id="code-fields" hidden>
            <div class="fields">
              <label><span id="verification-code-label"></span><input id="verification-code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" /></label>
            </div>
            <button id="verify-code" type="button"></button>
          </div>
        </div>
      </div>
      <div class="actions">
        <p class="status" id="status" role="status"></p>
        <div class="error" id="error" role="alert"></div>
        <button id="submit" type="submit" disabled></button>
        <button class="retry" id="retry" type="button"></button>
      </div>
    </form>
    <script>
      (() => {
        const messages = ${JSON.stringify(e).replaceAll(`<`,`\\u003c`)};
        const initialStyleVariables = ${JSON.stringify(t).replaceAll(`<`,`\\u003c`)};
        const initialTheme = ${JSON.stringify(n)};
        const sdkUrl = ${JSON.stringify(je)};
        const fieldInitializationTimeoutMs = ${JSON.stringify(Me)};
        const retryTool = ${JSON.stringify(W)};
        const registerTool = ${JSON.stringify(G)};
        const requestCodeTool = ${JSON.stringify(K)};
        const verifyTool = ${JSON.stringify(q)};
        const finalizeTool = ${JSON.stringify(J)};
        const stageTool = ${JSON.stringify(Y)};
        const formRoot = document.getElementById("form");
        const fieldsRoot = document.getElementById("fields");
        const status = document.getElementById("status");
        const error = document.getElementById("error");
        const submit = document.getElementById("submit");
        const retry = document.getElementById("retry");
        const verification = document.getElementById("verification");
        const verificationOption = document.getElementById("verification-option");
        const requestCodeButton = document.getElementById("request-code");
        const codeFields = document.getElementById("code-fields");
        const verificationCode = document.getElementById("verification-code");
        const verifyCodeButton = document.getElementById("verify-code");
        let sdkPromise = null;
        let sdkError = false;
        let activeAttempt = null;
        let form = null;
        let fields = [];
        let fieldValidity = [false, false, false];
        let vaultedCardId = null;
        let registrationReadyToFinalize = false;

        document.getElementById("verification-option-label").textContent = messages.verificationOption;
        document.getElementById("verification-code-label").textContent = messages.verificationCode;
        requestCodeButton.textContent = messages.sendCode;
        verifyCodeButton.textContent = messages.verifyCode;

        const applyHostStyles = () => {
          const root = document.documentElement;
          const theme = globalThis.openai?.theme === "dark" || globalThis.openai?.theme === "light"
            ? globalThis.openai.theme
            : initialTheme;
          root.dataset.theme = theme;
          root.style.colorScheme = theme;
          const styleVariables = globalThis.openai?.toolInput?.style_variables ?? initialStyleVariables;
          for (const [name, value] of Object.entries(styleVariables)) {
            if (typeof value === "string") root.style.setProperty(name, value);
          }
        };

        applyHostStyles();

        document.getElementById("title").textContent = messages.title;
        document.getElementById("card-number-label").textContent = messages.cardNumber;
        document.getElementById("expiration-label").textContent = messages.expiration;
        document.getElementById("cvc-label").textContent = messages.cvc;
        document.getElementById("privacy").textContent = messages.privacy;
        submit.textContent = messages.submit;

        const reportStage = (stage, startedAt, result) => {
          const api = globalThis.openai;
          if (!api || typeof api.callTool !== "function") return;
          void api.callTool(stageTool, {
            duration_ms: Math.max(0, Math.round(performance.now() - startedAt)),
            result,
            stage,
          }).catch(() => undefined);
        };

        const showError = (message, retryLabel) => {
          fieldsRoot.setAttribute("aria-busy", "false");
          status.textContent = "";
          error.textContent = message;
          error.dataset.visible = "true";
          submit.hidden = true;
          retry.textContent = retryLabel;
          retry.dataset.visible = "true";
        };

        const showLoading = () => {
          formRoot.hidden = false;
          formRoot.dataset.fieldsReady = "false";
          fieldsRoot.setAttribute("aria-busy", "true");
          status.textContent = messages.initializing;
          error.textContent = "";
          error.dataset.visible = "false";
          submit.hidden = false;
          submit.disabled = true;
          submit.textContent = messages.submit;
          retry.dataset.visible = "false";
        };

        const resetForm = () => {
          form = null;
          fields = [];
          fieldValidity = [false, false, false];
          vaultedCardId = null;
          registrationReadyToFinalize = false;
          verification.hidden = true;
          fieldsRoot.hidden = false;
          document.getElementById("privacy").hidden = false;
          codeFields.hidden = true;
          verificationCode.value = "";
          for (const id of ["vgs-card-number", "vgs-card-expiration", "vgs-card-cvc"]) {
            document.getElementById(id).replaceChildren();
          }
          showLoading();
        };

        const getStyle = (name, fallback) => {
          const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
          return value || fallback;
        };

        const getFieldBackground = () => {
          const background = getComputedStyle(fieldsRoot).backgroundColor;
          if (background.startsWith("rgb(")) return background;

          const canvas = document.createElement("canvas");
          canvas.width = 1;
          canvas.height = 1;
          const context = canvas.getContext("2d");
          if (!context) return background;

          for (const element of [document.documentElement, document.body, fieldsRoot]) {
            context.fillStyle = getComputedStyle(element).backgroundColor;
            context.fillRect(0, 0, 1, 1);
          }
          const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
          return "rgb(" + red + ", " + green + ", " + blue + ")";
        };

        const getFieldCss = () => {
          const isDark = document.documentElement.dataset.theme === "dark";
          return {
            "&::placeholder": { color: getStyle("--color-text-tertiary", isDark ? "#a3a3a3" : "#8b8b8b") },
            "background-color": getFieldBackground(),
            border: "0",
            "box-sizing": "border-box",
            color: getStyle("--color-text-primary", isDark ? "#f5f5f5" : "#171717"),
            "font-family": getStyle("--font-sans", "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"),
            "font-size": "16px",
            height: "24px",
            "line-height": "24px",
            padding: "0",
            width: "100%",
          };
        };

        const loadSdk = () => {
          if (globalThis.VGSCollect && typeof globalThis.VGSCollect.create === "function") {
            return Promise.resolve(globalThis.VGSCollect);
          }
          if (sdkPromise) return sdkPromise;
          const startedAt = performance.now();
          sdkPromise = new Promise((resolve, reject) => {
            const script = document.createElement("script");
            script.async = true;
            script.src = sdkUrl;
            script.onload = () => {
              if (globalThis.VGSCollect && typeof globalThis.VGSCollect.create === "function") {
                sdkError = false;
                reportStage("sdk_load", startedAt, "success");
                resolve(globalThis.VGSCollect);
              } else {
                reject(new Error("VGS Collect did not initialize"));
              }
            };
            script.onerror = () => reject(new Error("VGS Collect failed to load"));
            document.head.appendChild(script);
          }).catch((loadError) => {
            sdkError = true;
            sdkPromise = null;
            reportStage("sdk_load", startedAt, "failure");
            throw loadError;
          });
          return sdkPromise;
        };

        const parseBootstrap = () => {
          const bootstrap = globalThis.openai?.toolResponseMetadata?.vgs_collect_bootstrap;
          if (!bootstrap || typeof bootstrap !== "object") return null;
          if (typeof bootstrap.vault_id !== "string" || !bootstrap.vault_id.trim()) return null;
          if (typeof bootstrap.access_token !== "string" || !bootstrap.access_token.trim()) return null;
          if (bootstrap.environment !== "sandbox" && bootstrap.environment !== "live") return null;
          return bootstrap;
        };

        const successfulResult = (response) => {
          const content = response?.structuredContent ?? response?.structured_content;
          if (response?.isError === true || content?.ok !== true) {
            throw new Error("Wallet did not confirm card registration");
          }
          return content;
        };

        const finalizeCard = async () => {
          if (!registrationReadyToFinalize) return;
          const startedAt = performance.now();
          submit.disabled = true;
          submit.textContent = messages.submitting;
          try {
            const result = successfulResult(await globalThis.openai.callTool(finalizeTool, {}));
            if (!result.card || typeof result.card.last4 !== "string") {
              throw new Error("Wallet did not confirm the saved card");
            }
            vaultedCardId = null;
            registrationReadyToFinalize = false;
            reportStage("save", startedAt, "success");
          } catch {
            reportStage("save", startedAt, "failure");
            showError(messages.saveError, messages.retrySave);
          }
        };

        const registerCard = async () => {
          if (!vaultedCardId) return;
          const startedAt = performance.now();
          submit.disabled = true;
          submit.textContent = messages.submitting;
          try {
            const response = await globalThis.openai.callTool(registerTool, {
              vgs_card_id: vaultedCardId,
            });
            const errorCode = (response?.structuredContent ?? response?.structured_content)?.error?.code;
            if (errorCode === "WalletDeviceRequired" || errorCode === "WalletAmexUnavailable") {
              vaultedCardId = null;
              reportStage("save", startedAt, "failure");
              const failureMessage = errorCode === "WalletAmexUnavailable" ? messages.amexUnavailable : messages.deviceRequired;
              showError(failureMessage, messages.useDifferentCard);
              return;
            }
            const result = successfulResult(response);
            if (typeof result.registration_id !== "string" || !result.registration_id.trim()) {
              throw new Error("Wallet did not provide a registration session");
            }
            vaultedCardId = null;
            if (result.status === "verification_required") {
              if (!Array.isArray(result.verification_options) || result.verification_options.length === 0) {
                throw new Error("Wallet did not provide a verification option");
              }
              verificationOption.replaceChildren();
              for (const option of result.verification_options) {
                if (typeof option?.option_id !== "string" || typeof option?.value !== "string") {
                  throw new Error("Wallet returned an invalid verification option");
                }
                const choice = document.createElement("option");
                choice.value = option.option_id;
                choice.textContent = option.value;
                verificationOption.append(choice);
              }
              fieldsRoot.hidden = true;
              document.getElementById("privacy").hidden = true;
              verification.hidden = false;
              submit.hidden = true;
              return;
            }
            if (result.status !== "ready_to_finalize") {
              throw new Error("Wallet returned an unknown verification status");
            }
            registrationReadyToFinalize = true;
            await finalizeCard();
          } catch {
            reportStage("save", startedAt, "failure");
            showError(messages.saveError, messages.retrySave);
          }
        };

        requestCodeButton.addEventListener("click", async () => {
          requestCodeButton.disabled = true;
          try {
            const result = successfulResult(await globalThis.openai.callTool(requestCodeTool, {
              option_id: verificationOption.value,
            }));
            if (result.status !== "verification_code_sent") {
              throw new Error("Wallet did not send a verification code");
            }
            codeFields.hidden = false;
            verificationCode.value = "";
            error.dataset.visible = "false";
            verificationCode.focus();
          } catch {
            error.textContent = messages.verificationError;
            error.dataset.visible = "true";
          } finally {
            requestCodeButton.disabled = false;
          }
        });

        verifyCodeButton.addEventListener("click", async () => {
          if (!/^[0-9]{6}$/.test(verificationCode.value)) {
            error.textContent = messages.verificationError;
            error.dataset.visible = "true";
            return;
          }
          verifyCodeButton.disabled = true;
          try {
            const result = successfulResult(await globalThis.openai.callTool(verifyTool, {
              otp: verificationCode.value,
            }));
            if (result.status !== "ready_to_finalize") {
              throw new Error("Wallet did not verify the card");
            }
            registrationReadyToFinalize = true;
            verification.hidden = true;
            await finalizeCard();
          } catch {
            error.textContent = messages.verificationError;
            error.dataset.visible = "true";
          } finally {
            verifyCodeButton.disabled = false;
          }
        });

        const initializeFields = async (attempt, bootstrap) => {
          const startedAt = performance.now();
          resetForm();
          let initializationTimeout;
          let timedOut = false;
          try {
            await Promise.race([
              (async () => {
                const collect = await loadSdk();
                if (activeAttempt !== attempt || timedOut) return;
                form = collect.create(bootstrap.vault_id, bootstrap.environment, () => undefined);
                form.on?.("enterPress", () => {
                  if (!submit.disabled) formRoot.requestSubmit(submit);
                });
                const css = getFieldCss();
                fields = [
                  form.cardNumberField("#vgs-card-number", { css, placeholder: "" }),
                  form.cardExpirationDateField("#vgs-card-expiration", { css, placeholder: messages.expirationPlaceholder }),
                  form.cardCVCField("#vgs-card-cvc", { css, placeholder: messages.cvcPlaceholder }),
                ];
                fields.forEach((field, index) => {
                  field.on("update", (state) => {
                    fieldValidity[index] = state?.isValid === true;
                    submit.disabled = fieldValidity.some((valid) => !valid);
                  });
                });
                await Promise.all(fields.map((field) => field.promise ?? Promise.resolve()));
                if (activeAttempt !== attempt || timedOut) return;
                if (fields.some((field) => field.loadingState !== "loaded")) {
                  throw new Error("A VGS field did not finish loading");
                }
                formRoot.dataset.fieldsReady = "true";
                fieldsRoot.setAttribute("aria-busy", "false");
                status.textContent = "";
                reportStage("fields_ready", startedAt, "success");
              })(),
              new Promise((_, reject) => {
                initializationTimeout = setTimeout(() => {
                  timedOut = true;
                  reject(new Error("VGS fields did not finish loading in time"));
                }, fieldInitializationTimeoutMs);
              }),
            ]);
          } catch {
            if (activeAttempt !== attempt) return;
            reportStage("fields_ready", startedAt, "failure");
            showError(sdkError ? messages.error : messages.bootstrapError, messages.retry);
          } finally {
            clearTimeout(initializationTimeout);
          }
        };

        const syncGlobals = () => {
          applyHostStyles();
          const css = getFieldCss();
          for (const field of fields) {
            field.update?.({ css });
          }
          const input = globalThis.openai?.toolInput;
          if (!input || input.enrollment_requested !== true) {
            if (activeAttempt !== null) {
              activeAttempt = null;
              resetForm();
            }
            return;
          }
          const attempt = String(input.enrollment_attempt) + ":" + String(input.bootstrap_retry);
          if (input.bootstrap_status === "error") {
            activeAttempt = attempt;
            showError(messages.bootstrapError, messages.retry);
            return;
          }
          if (input.bootstrap_status !== "ready") {
            showLoading();
            return;
          }
          if (activeAttempt === attempt) return;
          const bootstrap = parseBootstrap();
          if (!bootstrap) {
            activeAttempt = attempt;
            showError(messages.bootstrapError, messages.retry);
            return;
          }
          activeAttempt = attempt;
          void initializeFields(attempt, bootstrap);
        };

        formRoot.addEventListener("submit", (event) => {
          event.preventDefault();
          if (!verification.hidden) {
            if (!codeFields.hidden) verifyCodeButton.click();
            return;
          }
          const bootstrap = parseBootstrap();
          if (!form || !bootstrap || fieldValidity.some((valid) => !valid)) return;
          const startedAt = performance.now();
          submit.disabled = true;
          submit.textContent = messages.submitting;
          error.dataset.visible = "false";
          try {
            form.createCard(
              { auth: bootstrap.access_token, data: { cardholder: {} } },
              (statusCode, payload) => {
                if (statusCode === 401 || statusCode === 403) {
                  reportStage("submit", startedAt, "failure");
                  showError(messages.bootstrapError, messages.retry);
                  return;
                }
                const card = payload?.data;
                if (statusCode < 200 || statusCode >= 300 || !card || typeof card.id !== "string" || !card.id.trim()) {
                  reportStage("submit", startedAt, "failure");
                  showError(messages.error, messages.retry);
                  return;
                }
                vaultedCardId = card.id;
                reportStage("submit", startedAt, "success");
                void registerCard();
              },
              () => {
                reportStage("submit", startedAt, "failure");
                error.textContent = messages.validationError;
                error.dataset.visible = "true";
                submit.disabled = fieldValidity.some((valid) => !valid);
                submit.textContent = messages.submit;
              },
            );
          } catch {
            reportStage("submit", startedAt, "failure");
            showError(messages.error, messages.retry);
          }
        });

        retry.addEventListener("click", () => {
          if (registrationReadyToFinalize || vaultedCardId) {
            error.dataset.visible = "false";
            retry.dataset.visible = "false";
            submit.hidden = false;
            if (registrationReadyToFinalize) void finalizeCard();
            else void registerCard();
            return;
          }
          showLoading();
          void globalThis.openai.callTool(retryTool, {}).catch(() => {
            showError(messages.bootstrapError, messages.retry);
          });
        });

        globalThis.addEventListener("openai:set_globals", syncGlobals);
        void loadSdk().catch(() => undefined);
        syncGlobals();
      })();
    <\/script>
  </body>
</html>`}var W,G,K,q,J,Y,Ae,je,Me;function Ne(){return(Ne=e((()=>{W=`__wallet_onboarding_retry_bootstrap`,G=`__wallet_onboarding_register_vgs_card`,K=`__wallet_onboarding_request_verification`,q=`__wallet_onboarding_verify_card`,J=`__wallet_onboarding_finalize_card`,Y=`__wallet_onboarding_stage`,Ae={baseUriDomains:[],connectDomains:[`https://js.verygoodvault.com`,`https://js3.verygoodvault.com`,`https://vgs-collect-keeper.apps.verygood.systems`,`https://*.verygoodproxy.com`],frameDomains:[`https://js.verygoodvault.com`,`https://js3.verygoodvault.com`,`https://vgs-collect-keeper.apps.verygood.systems`],includeDefaultDomains:!1,isTrusted:!0,resourceDomains:[`https://js.verygoodvault.com`,`https://js3.verygoodvault.com`,`https://vgs-collect-keeper.apps.verygood.systems`]},je=`https://js.verygoodvault.com/vgs-collect/3.2.2/vgs-collect.js`,Me=15e3})))()}function Pe(e){let t=(0,Ze.c)(6),n;t[0]===e.enrollmentView?n=t[1]:(n=De({view:e.enrollmentView}),t[0]=e.enrollmentView,t[1]=n);let r=n,i=l(ye,r),a;return t[2]!==r||t[3]!==i||t[4]!==e?(a=i==null?null:(0,Qe.jsx)(Fe,{...e,resourceIdentity:{context:r,identity:i}},s([i])),t[2]=r,t[3]=i,t[4]=e,t[5]=a):a=t[5],a}function Fe(e){let t=(0,Ze.c)(87),{active:r,enrollmentAttempt:i,enrollmentView:a,onComplete:o,onPreparationError:s,onPrepared:c,preparing:u,targetElement:d,resourceIdentity:f}=e,m=p(b),h=_(),x=v(Se),S=(0,X.useId)(),ee=(0,X.useRef)(r),C=(0,X.useRef)(!1),T=(0,X.useRef)(null),E=(0,X.useRef)(null),D;t[0]===Symbol.for(`react.memo_cache_sentinel`)?(D=new Map,t[0]=D):D=t[0];let te=(0,X.useRef)(D),[O,ne]=(0,X.useState)(0),[k,re]=(0,X.useState)(null),[A,ie]=(0,X.useState)(null),[j,M]=(0,X.useState)(null),[N,ae]=(0,X.useState)(!1),P=f.identity.kind===`connector`?f.identity.connectorId:null,oe;t[1]!==h.locale||t[2]!==f.identity?(oe={identity:f.identity,locale:h.locale,widgetDomain:null},t[1]=h.locale,t[2]=f.identity,t[3]=oe):oe=t[3];let{data:se}=l(Te,oe),I=se?.sourceUrl,ce;t[4]===I?ce=t[5]:(ce=I==null?null:Ee(I),t[4]=I,t[5]=ce);let L=ce,R=`wallet-onboarding-${S}`,fe;t[6]!==r||t[7]!==k?.metadata||t[8]!==P||t[9]!==a.hostId||t[10]!==a.server||t[11]!==a.serverTools||t[12]!==o||t[13]!==s||t[14]!==c||t[15]!==u||t[16]!==f||t[17]!==m?(fe=async(e,t)=>{if(m.get(he,f)!==`current`)throw Error(`Wallet enrollment account changed`);if(e===`__wallet_onboarding_stage`){let e=rt.parse(t);return w.info(`wallet_onboarding_sandbox.stage`,{safe:e}),u&&e.stage===`fields_ready`&&(e.result===`success`?c():s()),{}}if(e===`__wallet_onboarding_retry_bootstrap`){if(!r)throw Error(`Wallet onboarding enrollment is not active`);return it.parse(t),ne(Ye),{}}if(e!==`__wallet_onboarding_register_vgs_card`&&e!==`__wallet_onboarding_request_verification`&&e!==`__wallet_onboarding_verify_card`&&e!==`__wallet_onboarding_finalize_card`)throw Error(`Wallet onboarding sandbox cannot call this tool`);if(!r&&(e!==`__wallet_onboarding_finalize_card`||T.current==null))throw Error(`Wallet onboarding enrollment is not active`);let n=async(e,t)=>{let n=RegExp(`(?:^|[._])(?:wallet_)?${e}$`),r=a.serverTools.find(e=>n.test(e.name));if(r==null)throw Error(`Wallet registration tool is unavailable`);let i=ue({connectorId:P,server:a.server,toolName:r.name,tools:a.serverTools}),o=()=>{if(m.get(he,f)!==`current`)throw Error(`Wallet enrollment account changed while calling its tool`)};if(e===`register_vgs_agentic_token`){let e=ge(i.codexAppsToolIdentity);if(e==null)throw Error(`Wallet registration tool is unavailable`);return xe({scope:m,resourceIdentity:f,...e,toolArguments:t})}let s=await de(m,a.hostId,a.server,i.name,t);return o(),_e({isCodexAppsServer:le(a.server),toolResult:s})};if(e===`__wallet_onboarding_register_vgs_card`){let e=et.parse(t);if(!$e.safeParse(k?.metadata).success)throw Error(`Wallet card enrollment is unavailable`);T.current=null;let{width:r,height:i}=window.screen,a=await n(`register_vgs_agentic_token`,{vgs_card_id:e.vgs_card_id,device_type:`desktop`,...r>0&&i>0?{screen_dimensions:{width:r,height:i}}:{}}),o=tt.safeParse(a.structuredContent);return a.isError!==!0&&o.success&&(T.current={id:o.data.registration_id,optionIds:new Set(o.data.verification_options.map(Je))}),a}let i=T.current;if(i==null)throw Error(`Wallet card registration is unavailable`);if(e===`__wallet_onboarding_request_verification`){let{option_id:e}=F({option_id:y()}).parse(t);if(!i.optionIds.has(e))throw Error(`Wallet verification option is unavailable`);return n(`request_vgs_card_verification`,{registration_id:i.id,option_id:e})}if(e===`__wallet_onboarding_verify_card`){let{otp:e}=F({otp:y().regex(/^[0-9]{6}$/)}).parse(t);return n(`verify_vgs_card`,{registration_id:i.id,otp:e})}F({}).strict().parse(t);let l=await n(`finalize_vgs_card_registration`,{registration_id:i.id});return l.isError!==!0&&nt.safeParse(l.structuredContent).success&&(T.current=null,ee.current?o():C.current=!0),l},t[6]=r,t[7]=k?.metadata,t[8]=P,t[9]=a.hostId,t[10]=a.server,t[11]=a.serverTools,t[12]=o,t[13]=s,t[14]=c,t[15]=u,t[16]=f,t[17]=m,t[18]=fe):fe=t[18];let pe=(0,X.useEffectEvent)(fe),me;t[19]===s?me=t[20]:(me=()=>{s()},t[19]=s,t[20]=me);let z=(0,X.useEffectEvent)(me),ve;t[21]!==r||t[22]!==o?(ve=()=>{r&&C.current&&(C.current=!1,o())},t[21]=r,t[22]=o,t[23]=ve):ve=t[23];let ye=(0,X.useEffectEvent)(ve),B,V;t[24]===L?(B=t[25],V=t[26]):(B=()=>{if(L==null)return;let e=document.createElement(`webview`);return e.className=`h-full w-full overflow-hidden border-0`,e.setAttribute(`partition`,g(L)),M(e),()=>{e.remove(),e.destroy?.(),M(t=>t===e?null:t)}},V=[L],t[24]=L,t[25]=B,t[26]=V),(0,X.useLayoutEffect)(B,V);let H;t[27]!==r||t[28]!==ye||t[29]!==j||t[30]!==d?(H=()=>{if(ee.current=r,ye(),j==null)return;let e=r?d:E.current;e!=null&&j.parentElement!==e&&e.appendChild(j)},t[27]=r,t[28]=ye,t[29]=j,t[30]=d,t[31]=H):H=t[31];let Ce;t[32]!==r||t[33]!==j||t[34]!==d?(Ce=[r,j,d],t[32]=r,t[33]=j,t[34]=d,t[35]=Ce):Ce=t[35],(0,X.useLayoutEffect)(H,Ce);let U;t[36]!==z||t[37]!==pe||t[38]!==h||t[39]!==j||t[40]!==L||t[41]!==m||t[42]!==I||t[43]!==R?(U=()=>{if(j==null||L==null||I==null)return;let e=n(I,{requireSkybridge:!0});if(e==null){w.warning(`wallet_onboarding_sandbox.invalid_origin`,{safe:{}}),z();return}let t=new AbortController,r,i=performance.now();ae(!1);let a=document.documentElement.dataset.theme===`dark`?`dark`:`light`,o=m.get(Se),s=ke({bootstrapError:h.formatMessage(Z.bootstrapError),amexUnavailable:h.formatMessage(Z.amexUnavailable),cardNumber:h.formatMessage(Z.cardNumber),cvc:h.formatMessage(Z.cvc),cvcPlaceholder:h.formatMessage(Z.cvcPlaceholder),deviceRequired:h.formatMessage(Z.deviceRequired),error:h.formatMessage(Z.error),expiration:h.formatMessage(Z.expiration),expirationPlaceholder:h.formatMessage(Z.expirationPlaceholder),initializing:h.formatMessage(Z.initializing),privacy:h.formatMessage(Z.privacy),retry:h.formatMessage(Z.retry),retrySave:h.formatMessage(Z.retrySave),saveError:h.formatMessage(Z.saveError),sendCode:h.formatMessage(Z.sendCode),submit:h.formatMessage(Z.submit),submitting:h.formatMessage(Z.submitting),title:h.formatMessage(Z.title),useDifferentCard:h.formatMessage(Z.useDifferentCard),validationError:h.formatMessage(Z.validationError),verificationCode:h.formatMessage(Z.verificationCode),verificationError:h.formatMessage(Z.verificationError),verificationOption:h.formatMessage(Z.verificationOption),verifyCode:h.formatMessage(Z.verifyCode)},{styleVariables:o,theme:a});return we({hostApiHandlers:{callMcp:qe,callTool:(e,t)=>pe(e,t),notifyBackgroundColor:Ke,notifyEnvironmentError:()=>{w.warning(`wallet_onboarding_sandbox.environment_error`,{safe:{}}),z()},notifyIntrinsicHeight:Ge,notifyIntrinsicWidth:We,notifyNavigation:Ue,notifySecurityPolicyViolation:()=>{w.warning(`wallet_onboarding_sandbox.csp_violation`,{safe:{}}),z()},openExternal:He,requestDisplayMode:Ve,sendFollowUpMessage:Be,sendInstrument:ze,updateWidgetState:Re},origin:e,sandboxId:L,signal:t.signal,sourceUrl:I,webview:j}).then(async e=>{if(t.signal.aborted)return;ie(e);let n=e.runWidgetCode({csp:Ae,displayMode:`inline`,features:[],html:s,isFirstParty:!1,isSidebarOpen:!1,isTombstone:!1,maxHeight:620,maxWidth:568,measureWidth:!1,mcpApps:{hostCapabilities:{sandbox:{csp:Ae}},hostContext:{availableDisplayModes:[`inline`],containerDimensions:{maxHeight:620,maxWidth:568},deviceCapabilities:{hover:!0,touch:!1},displayMode:`inline`,locale:h.locale,platform:`desktop`,safeAreaInsets:{bottom:0,left:0,right:0,top:0},styles:{variables:o},theme:a,timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,userAgent:`chatgpt`},hostInfo:{name:`chatgpt`}},safeArea:{insets:{bottom:0,left:0,right:0,top:0}},theme:a,toolInput:null,toolOutput:null,toolResponseMetadata:null,userAgent:{capabilities:{hover:!0,touch:!1},device:{os:`unknown`,platform:`native`,type:`desktop`}},viewParams:null,widgetId:R,widgetState:null});r=setTimeout(()=>{t.signal.aborted||(w.warning(`wallet_onboarding_sandbox.init_failed`,{safe:{errorName:`TimeoutError`}}),z(),t.abort())},at),await Xe(n,t.signal,()=>{clearTimeout(r),ae(!0),w.info(`wallet_onboarding_sandbox.initialized`,{safe:{durationMs:Math.max(0,Math.round(performance.now()-i))}})})===`ended`&&(clearTimeout(r),t.signal.aborted||(w.warning(`wallet_onboarding_sandbox.init_failed`,{safe:{errorName:`MissingRunningStatus`}}),z()))}).catch(e=>{t.signal.aborted||(w.warning(`wallet_onboarding_sandbox.init_failed`,{safe:{errorName:e instanceof Error?e.name:`UnknownError`}}),z())}),()=>{clearTimeout(r),t.abort(),ae(!1),ie(null)}},t[36]=z,t[37]=pe,t[38]=h,t[39]=j,t[40]=L,t[41]=m,t[42]=I,t[43]=R,t[44]=U):U=t[44];let De;t[45]!==h||t[46]!==j||t[47]!==L||t[48]!==m||t[49]!==I||t[50]!==R?(De=[h,j,L,m,I,R],t[45]=h,t[46]=j,t[47]=L,t[48]=m,t[49]=I,t[50]=R,t[51]=De):De=t[51],(0,X.useLayoutEffect)(U,De);let Oe;t[52]!==O||t[53]!==P||t[54]!==i||t[55]!==a.hostId||t[56]!==a.server||t[57]!==a.tool.name||t[58]!==z||t[59]!==u||t[60]!==m?(Oe=()=>{if(!u||i===0)return;let e=JSON.stringify([P,a.hostId,a.server,a.tool.name,i,O]);re({attempt:i,metadata:null,retry:O,status:`loading`});let t=te.current.get(e);if(t==null){let n=performance.now();t=de(m,a.hostId,a.server,a.tool.name,{}).then(e=>(w.info(`wallet_onboarding_sandbox.bootstrap`,{safe:{durationMs:Math.max(0,Math.round(performance.now()-n))}}),e)),te.current.set(e,t)}let n=!1,r=setTimeout(()=>{n||(n=!0,w.warning(`wallet_onboarding_sandbox.bootstrap_failed`,{safe:{errorName:`TimeoutError`}}),re({attempt:i,metadata:null,retry:O,status:`error`}),z())},at);return t.then(e=>{if(n)return;let t=_e({isCodexAppsServer:le(a.server),toolResult:e}),r=be({toolResult:t}),o=$e.safeParse(r);re({attempt:i,metadata:o.success?o.data:null,retry:O,status:o.success?`ready`:`error`}),o.success||z()}).catch(e=>{n||(w.warning(`wallet_onboarding_sandbox.bootstrap_failed`,{safe:{errorName:e instanceof Error?e.name:`UnknownError`}}),re({attempt:i,metadata:null,retry:O,status:`error`}),z())}).finally(()=>{clearTimeout(r)}),()=>{n=!0,clearTimeout(r)}},t[52]=O,t[53]=P,t[54]=i,t[55]=a.hostId,t[56]=a.server,t[57]=a.tool.name,t[58]=z,t[59]=u,t[60]=m,t[61]=Oe):Oe=t[61];let W;t[62]!==O||t[63]!==P||t[64]!==i||t[65]!==a.hostId||t[66]!==a.server||t[67]!==a.tool.name||t[68]!==u||t[69]!==m?(W=[O,P,i,a.hostId,a.server,a.tool.name,u,m],t[62]=O,t[63]=P,t[64]=i,t[65]=a.hostId,t[66]=a.server,t[67]=a.tool.name,t[68]=u,t[69]=m,t[70]=W):W=t[70],(0,X.useEffect)(Oe,W);let G,K;t[71]!==x||t[72]!==h.locale||t[73]!==N||t[74]!==A?(G=()=>{if(!N||A==null)return;let e=document.documentElement.dataset.theme===`dark`?`dark`:`light`;Promise.all([A.setTheme({theme:e}),A.notifyMcpAppsHostContext({hostContext:{availableDisplayModes:[`inline`],containerDimensions:{maxHeight:620,maxWidth:568},deviceCapabilities:{hover:!0,touch:!1},displayMode:`inline`,locale:h.locale,platform:`desktop`,safeAreaInsets:{bottom:0,left:0,right:0,top:0},styles:{variables:x},theme:e,timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,userAgent:`chatgpt`}})]).catch(Le)},K=[x,h.locale,N,A],t[71]=x,t[72]=h.locale,t[73]=N,t[74]=A,t[75]=G,t[76]=K):(G=t[75],K=t[76]),(0,X.useEffect)(G,K);let q,J;t[77]!==k||t[78]!==i||t[79]!==x||t[80]!==N||t[81]!==u||t[82]!==A||t[83]!==R?(q=()=>{if(!N||A==null)return;let e=u&&k?.attempt===i?k:null;A.setWidgetData({toolInput:e==null?null:{bootstrap_retry:e.retry,bootstrap_status:e.status,enrollment_attempt:e.attempt,enrollment_requested:!0,style_variables:x},toolOutput:null,toolResponseMetadata:e?.metadata??null,widgetId:R,widgetState:null}).catch(Ie)},J=[k,i,x,N,u,A,R],t[77]=k,t[78]=i,t[79]=x,t[80]=N,t[81]=u,t[82]=A,t[83]=R,t[84]=q,t[85]=J):(q=t[84],J=t[85]),(0,X.useEffect)(q,J);let Y;return t[86]===Symbol.for(`react.memo_cache_sentinel`)?(Y=(0,Qe.jsx)(`div`,{ref:E,"aria-hidden":`true`,className:`pointer-events-none fixed h-px w-px overflow-hidden opacity-0`}),t[86]=Y):Y=t[86],Y}function Ie(){}function Le(){}function Re(){}function ze(){}function Be(){return Promise.reject(Error(`Wallet onboarding sandbox cannot send follow-ups`))}function Ve(){return{mode:`inline`}}function He(){}function Ue(){}function We(){}function Ge(){}function Ke(){}function qe(){return Promise.reject(Error(`Wallet onboarding sandbox cannot make MCP requests`))}function Je(e){return e.option_id}function Ye(e){return e+1}async function Xe(e,t,n){for await(let r of e){if(t.aborted)return`aborted`;if(Ce.safeParse(r).success)return n(),`running`}return`ended`}var Ze,X,Qe,$e,et,tt,nt,rt,it,at,Z;function ot(){return(ot=e((()=>{Ze=te(),c(),O(),ie(),ae(),X=D(),h(),i(),fe(),B(),z(),V(),H(),pe(),U(),me(),ve(),Oe(),a(),L(),Ne(),Qe=I(),$e=F({vgs_collect_bootstrap:F({access_token:y().trim().min(1),environment:M([`sandbox`,`live`]),vault_id:y().trim().min(1)})}),et=F({vgs_card_id:y().trim().min(1)}),tt=F({ok:x(!0),registration_id:y().trim().min(1),status:M([`ready_to_finalize`,`verification_required`]),verification_options:P(F({option_id:y()}))}),nt=F({card:F({last4:y()}),ok:x(!0)}),rt=F({duration_ms:ne().nonnegative(),result:M([`failure`,`success`]),stage:M([`fields_ready`,`save`,`sdk_load`,`submit`])}),it=F({}).strict(),at=15e3,Z=o({amexUnavailable:{id:`codexWalletOnboardingEnrollment.amexUnavailable`,defaultMessage:`Wallet can’t add an American Express card from this location. You can use a different card.`,description:`Wallet enrollment error when American Express is unavailable from the user’s location.`},bootstrapError:{id:`codexWalletOnboardingEnrollment.bootstrapError`,defaultMessage:`The secure card session is unavailable or expired`,description:`Error shown when Wallet onboarding cannot authorize VGS Collect`},cardNumber:{id:`codexWalletOnboardingEnrollment.cardNumber`,defaultMessage:`Card number`,description:`Label for the Wallet onboarding secure card-number field`},cvc:{id:`codexWalletOnboardingEnrollment.cvc`,defaultMessage:`Security code`,description:`Label for the Wallet onboarding secure card-security-code field`},cvcPlaceholder:{id:`codexWalletOnboardingEnrollment.cvcPlaceholder`,defaultMessage:`3 digits`,description:`Placeholder for the Wallet onboarding secure card-security-code field`},deviceRequired:{id:`codexWalletOnboardingEnrollment.deviceRequired`,defaultMessage:`Wallet couldn’t confirm the information needed to add this American Express card. You can use a different card.`,description:`Wallet enrollment error when the information needed to add an American Express card could not be confirmed.`},error:{id:`codexWalletOnboardingEnrollment.error`,defaultMessage:`We couldn't add this card`,description:`Generic error shown when Wallet onboarding cannot add a card`},expiration:{id:`codexWalletOnboardingEnrollment.expiration`,defaultMessage:`Expiration date`,description:`Label for the Wallet onboarding secure card-expiration field`},expirationPlaceholder:{id:`codexWalletOnboardingEnrollment.expirationMonthYearPlaceholder`,defaultMessage:`MM/YY`,description:`Format hint inside the Wallet onboarding secure card-expiration field. The input always accepts a two-digit month followed by a slash and a two-digit year, for example 03/30. Translate the month and year abbreviations if needed, but always keep month before year, including in Chinese. Do not use the locale's usual date order.`},initializing:{id:`codexWalletOnboardingEnrollment.initializing`,defaultMessage:`Preparing secure card fields…`,description:`Status shown while Wallet onboarding prepares the secure card fields`},privacy:{id:`codexWalletOnboardingEnrollment.privacy`,defaultMessage:`Fully encrypted and never shared with third party apps`,description:`Privacy explanation shown below Wallet onboarding secure card fields`},retry:{id:`codexWalletOnboardingEnrollment.retry`,defaultMessage:`Try again`,description:`Button that retries Wallet onboarding secure-field initialization`},retrySave:{id:`codexWalletOnboardingEnrollment.retrySave`,defaultMessage:`Save to Wallet`,description:`Button that retries saving a secured card to Wallet`},saveError:{id:`codexWalletOnboardingEnrollment.saveError`,defaultMessage:`Your card was secured, but Wallet couldn't save it`,description:`Error shown when Wallet onboarding cannot save an already secured card`},sendCode:{id:`codexWalletOnboardingEnrollment.sendCode`,defaultMessage:`Send verification code`,description:`Button to request a one-time card issuer verification code`},submit:{id:`codexWalletOnboardingEnrollment.submit`,defaultMessage:`Add card`,description:`Button that submits the Wallet onboarding secure card form`},submitting:{id:`codexWalletOnboardingEnrollment.submitting`,defaultMessage:`Adding card…`,description:`Status shown while Wallet onboarding adds the secured card`},title:{id:`codexWalletOnboardingEnrollment.title`,defaultMessage:`Add new card`,description:`Heading for the Wallet onboarding secure card form`},useDifferentCard:{id:`codexWalletOnboardingEnrollment.useDifferentCard`,defaultMessage:`Use a different card`,description:`Button that opens a new secure card form when the previous card could not be added.`},validationError:{id:`codexWalletOnboardingEnrollment.validationError`,defaultMessage:`Check your card details and try again`,description:`Error shown when Wallet onboarding secure fields reject card details`},verificationCode:{id:`codexWalletOnboardingEnrollment.verificationCode`,defaultMessage:`Six-digit verification code`,description:`Label for the one-time code received from the card issuer`},verificationError:{id:`codexWalletOnboardingEnrollment.verificationError`,defaultMessage:`We couldn't verify this card. Try again`,description:`Error shown when the card issuer rejects a verification request or code`},verificationOption:{id:`codexWalletOnboardingEnrollment.verificationOption`,defaultMessage:`Where should we send the verification code?`,description:`Label for choosing a masked email address or phone number supplied by the card issuer`},verifyCode:{id:`codexWalletOnboardingEnrollment.verifyCode`,defaultMessage:`Verify and save`,description:`Button to verify the card issuer's code and save the card to Wallet`}})})))()}function st(e){let t=(0,dt.c)(2),n;return t[0]===e?n=t[1]:(n=(0,$.jsx)(ct,{...e},e.enrollmentView.hostId),t[0]=e,t[1]=n),n}function ct(e){let t=(0,dt.c)(21),{dismissAnnouncement:n,enrollmentView:r,onCloseAutoFocus:i}=e,[a,o]=(0,Q.useState)(`introduction`),[s,c]=(0,Q.useState)(1),[l,u]=(0,Q.useState)(!1),[d,f]=(0,Q.useState)(`loading`),[p,m]=(0,Q.useState)(null),h;t[0]!==n||t[1]!==l||t[2]!==i||t[3]!==d||t[4]!==a?(h=a===`introduction`?(0,$.jsx)(ft,{dismissAnnouncement:n,onCloseAutoFocus:i,isSettingUpWallet:l&&d===`loading`,onSetUpWallet:()=>{u(!0),d!==`loading`&&o(`enrollment`)}}):(0,$.jsx)(ut,{completed:a===`success`,dismissAnnouncement:n,onCloseAutoFocus:i,preparationFailed:d===`error`,setSandboxTarget:m,onBack:()=>{u(!1),o(`introduction`)},onRetry:()=>{f(`loading`),c(lt)}}),t[0]=n,t[1]=l,t[2]=i,t[3]=d,t[4]=a,t[5]=h):h=t[5];let g=a===`enrollment`&&d!==`error`,_;t[6]===Symbol.for(`react.memo_cache_sentinel`)?(_=()=>{o(`success`)},t[6]=_):_=t[6];let v,y;t[7]===l?(v=t[8],y=t[9]):(v=()=>{f(`error`),l&&o(`enrollment`)},y=()=>{f(`ready`),l&&o(`enrollment`)},t[7]=l,t[8]=v,t[9]=y);let b=a!==`success`&&d!==`error`,x;t[10]!==s||t[11]!==r||t[12]!==p||t[13]!==g||t[14]!==v||t[15]!==y||t[16]!==b?(x=(0,$.jsx)(Pe,{active:g,enrollmentAttempt:s,enrollmentView:r,onComplete:_,onPreparationError:v,onPrepared:y,preparing:b,targetElement:p},s),t[10]=s,t[11]=r,t[12]=p,t[13]=g,t[14]=v,t[15]=y,t[16]=b,t[17]=x):x=t[17];let S;return t[18]!==h||t[19]!==x?(S=(0,$.jsxs)($.Fragment,{children:[h,x]}),t[18]=h,t[19]=x,t[20]=S):S=t[20],S}function lt(e){return e+1}function ut(e){let n=(0,dt.c)(24),{completed:r,dismissAnnouncement:i,onBack:a,onCloseAutoFocus:o,onRetry:s,preparationFailed:c,setSandboxTarget:l}=e,u=c!==void 0&&c,p=S(),m;n[0]===o?m=n[1]:(m={"aria-describedby":void 0,onCloseAutoFocus:o},n[0]=o,n[1]=m);let h;n[2]===Symbol.for(`react.memo_cache_sentinel`)?(h=(0,$.jsx)(f,{id:`codexWalletOnboardingEnrollmentModal.close`,defaultMessage:`Close`,description:`Accessible label for closing ChatGPT Wallet card enrollment`}),n[2]=h):h=n[2];let g;n[3]===i?g=n[4]:(g=e=>{e||i()},n[3]=i,n[4]=g);let _;n[5]!==r||n[6]!==s||n[7]!==u||n[8]!==l||n[9]!==p?(_=r?(0,$.jsx)(A.div,{animate:{opacity:1,y:0},className:`flex min-h-0 flex-1 items-center justify-center px-6 select-none`,initial:!p&&{opacity:0,y:12},transition:{duration:p?0:.28},children:(0,$.jsx)(T,{className:`items-center text-center`,icon:(0,$.jsx)(A.span,{animate:{rotate:0,scale:1},className:`flex`,initial:!p&&{rotate:-18,scale:0},transition:p?{duration:0}:{damping:18,delay:.12,stiffness:320,type:`spring`},children:(0,$.jsx)(d,{"aria-hidden":!1,asset:ee})}),iconBackgroundClassName:`bg-chart-green/20`,iconClassName:`mx-auto text-chart-green`,title:(0,$.jsx)(C,{children:(0,$.jsx)(f,{id:`codexWalletOnboardingEnrollmentModal.successTitle`,defaultMessage:`Your card was successfully saved`,description:`Heading shown after a card is saved during ChatGPT Wallet onboarding`})}),subtitle:(0,$.jsx)(f,{id:`codexWalletOnboardingEnrollmentModal.successDescription`,defaultMessage:`You’re ready to go`,description:`Confirmation shown after a card is saved during ChatGPT Wallet onboarding`})})}):u?(0,$.jsxs)(`div`,{className:`flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-6 text-center select-none`,children:[(0,$.jsx)(C,{children:(0,$.jsx)(f,{id:`codexWalletOnboardingEnrollmentModal.preparationErrorTitle`,defaultMessage:`Unable to add your card`,description:`Heading shown when Wallet onboarding cannot initialize secure card enrollment`})}),(0,$.jsx)(`p`,{role:`alert`,className:`text-secondary`,children:(0,$.jsx)(f,{id:`codexWalletOnboardingEnrollmentModal.preparationError`,defaultMessage:`The secure card session is unavailable or expired`,description:`Error shown when Wallet onboarding cannot initialize secure card enrollment`})}),(0,$.jsx)(t,{className:`w-full justify-center`,color:`primary`,size:`large`,onClick:s,children:(0,$.jsx)(f,{id:`codexWalletOnboardingEnrollmentModal.retryPreparation`,defaultMessage:`Try again`,description:`Button that retries secure Wallet card-enrollment initialization`})})]}):(0,$.jsxs)($.Fragment,{children:[(0,$.jsx)(C,{className:`sr-only`,children:(0,$.jsx)(f,{id:`codexWalletOnboardingEnrollmentModal.title`,defaultMessage:`Add a card to ChatGPT Wallet`,description:`Accessible title for ChatGPT Wallet card enrollment`})}),(0,$.jsx)(`div`,{ref:l,className:`relative min-h-0 flex-1 overflow-hidden bg-surface`})]}),n[5]=r,n[6]=s,n[7]=u,n[8]=l,n[9]=p,n[10]=_):_=n[10];let v=r?`primary`:`ghostTertiary`,y=r?i:a,b;n[11]===r?b=n[12]:(b=r?(0,$.jsx)(f,{id:`codexWalletOnboardingEnrollmentModal.continue`,defaultMessage:`Continue`,description:`Button that closes the ChatGPT Wallet onboarding announcement after a card is saved`}):(0,$.jsx)(f,{id:`codexWalletOnboardingEnrollmentModal.back`,defaultMessage:`Back`,description:`Button that returns from Wallet card enrollment to the Wallet introduction`}),n[11]=r,n[12]=b);let x;n[13]!==v||n[14]!==y||n[15]!==b?(x=(0,$.jsx)(`div`,{className:`shrink-0 bg-surface px-6 pb-6`,children:(0,$.jsx)(t,{className:`w-full justify-center`,color:v,size:`large`,onClick:y,children:b})}),n[13]=v,n[14]=y,n[15]=b,n[16]=x):x=n[16];let w;n[17]!==_||n[18]!==x?(w=(0,$.jsxs)(`div`,{className:`flex h-full min-h-0 flex-col`,children:[_,x]}),n[17]=_,n[18]=x,n[19]=w):w=n[19];let E;return n[20]!==w||n[21]!==m||n[22]!==g?(E=(0,$.jsx)(re,{open:!0,shouldIgnoreClickOutside:!0,contentClassName:`h-[min(504px,calc(100dvh-32px))] w-[min(480px,92vw)] !rounded-[16px] !bg-surface !ring-0 !backdrop-blur-none`,contentProps:m,dialogCloseClassName:`z-10`,dialogCloseLabel:h,onOpenChange:g,size:`feature`,children:w}),n[20]=w,n[21]=m,n[22]=g,n[23]=E):E=n[23],E}var dt,Q,$,ft;function pt(){return(pt=e((()=>{dt=te(),se(),j(),Q=D(),h(),N(),ce(),E(),m(),R(),u(),ot(),$=I(),oe(),ft=r(async()=>(await k(async()=>{let{WalletOnboardingAnnouncementModal:e}=await import(`./wallet-onboarding-announcement-modal-c15e87ca210a.js`);return{WalletOnboardingAnnouncementModal:e}},__vite__mapDeps([0,1,2,3,4,5,6]),import.meta.url)).WalletOnboardingAnnouncementModal,{propagateLoadError:!0,suspendToParent:!0})})))()}pt();export{st as WalletOnboardingAnnouncement};
//# sourceMappingURL=wallet-onboarding-announcement-content-949179ce7e4c.js.map