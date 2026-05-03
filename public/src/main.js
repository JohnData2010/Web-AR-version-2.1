import {
  getConditionFromParams,
  isLocalDevHost,
  STIMULUS_VERSION,
} from "./conditions.js";
import { initPostMessageOrigin, sendMessage } from "./postmessage.js";
import {
  conditionEchoFields,
  mediaRequestFlags,
} from "./protoPayload.js";
import { AppUI } from "./ui.js";

function showErrorState(root, err, { urlSearch, debug } = {}) {
  root.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "card";
  wrap.style.cssText =
    "max-width:400px;margin:32px auto;padding:20px;border-radius:16px;border:1px solid #fecaca;background:#fff1f2;color:#7f1d1d;font-family:system-ui,sans-serif;font-size:14px;line-height:1.5;";
  const h = document.createElement("div");
  h.style.fontWeight = "600";
  h.style.marginBottom = "8px";
  h.textContent = "AR demo cannot load";
  const p = document.createElement("p");
  p.style.margin = "0 0 8px 0";
  p.textContent = err.message || "Invalid configuration.";
  const code = document.createElement("code");
  code.style.display = "block";
  code.style.fontSize = "12px";
  code.style.marginTop = "8px";
  code.textContent = `code: ${err.code || "error"}`;
  wrap.append(h, p, code);
  if (debug) {
    const u = document.createElement("p");
    u.style.fontSize = "12px";
    u.style.marginTop = "10px";
    u.style.color = "#57534e";
    u.textContent = `URL: ${urlSearch || ""}`;
    wrap.appendChild(u);
  }
  root.appendChild(wrap);
}

function init() {
  initPostMessageOrigin();

  const params = new URLSearchParams(window.location.search);
  const debug = params.get("debug") === "1";

  const result = getConditionFromParams(window.location.search);
  const condParamRaw = params.get("cond");
  const condParam = condParamRaw ? Number(condParamRaw) : null;
  const cidParamRaw = params.get("cid");

  if (result.error) {
    sendMessage({
      type: "AR_PROTO_ERROR",
      payload: {
        type: "AR_PROTO_ERROR",
        code: result.error.code,
        message: result.error.message,
        url_search: window.location.search || "",
        cid_param: cidParamRaw,
        cond_param: Number.isFinite(condParam) ? condParam : null,
        stimulus_version: STIMULUS_VERSION,
        error_ts_iso: new Date().toISOString(),
        ts_ms: Date.now(),
      },
    });

    const appBody = document.getElementById("appBody");
    if (appBody) {
      showErrorState(appBody, result.error, {
        urlSearch: window.location.search,
        debug,
      });
    }
    return;
  }

  const { condition, validation, resolved_cid, cid_source } = result;

  const auditEcho = conditionEchoFields(condition);

  sendMessage({
    type: "AR_PROTO_AUDIT",
    payload: {
      type: "AR_PROTO_AUDIT",
      ...auditEcho,
      ...mediaRequestFlags(),

      cid_source: cid_source || "query",
      condition_valid: validation.valid,

      audit_timestamp: new Date().toISOString(),
      audit_ts_ms: Date.now(),

      resolved_cid,
      cid_param_present: cidParamRaw != null && cidParamRaw !== "",
      cid_param_value: cidParamRaw || null,
      url_search: window.location.search || "",
      local_dev_host: isLocalDevHost(),
      cond_param_present: condParamRaw != null && condParamRaw !== "",
      cond_param_value: Number.isFinite(condParam) ? condParam : null,

      validation_ok: validation.valid,
      validation_mismatches: validation.mismatches || [],
    },
  });

  const headerStatus = document.getElementById("headerStatus");
  // Pilot test: always show Qualtrics `cid` in the header for verification.
  const showDevConditionBadge = true;
  // Production (hide condition id from participants — only debug or local preview):
  // const showDevConditionBadge = debug || isLocalDevHost();
  if (headerStatus) {
    headerStatus.textContent = showDevConditionBadge ? condition.cid : `–`;
    headerStatus.title = showDevConditionBadge
      ? `${condition.cid} · ${condition.module_label || condition.module}`
      : "Status";
    headerStatus.style.display = "inline-flex";

    if (showDevConditionBadge) {
      const ok = validation.valid;
      headerStatus.setAttribute("aria-hidden", "false");
      headerStatus.setAttribute("role", "note");
      headerStatus.classList.add("condition-badge-debug");
      headerStatus.textContent = ok ? condition.cid : `${condition.cid} ⚠`;
      headerStatus.style.color = ok ? "#065f46" : "#92400e";
      headerStatus.style.borderColor = ok
        ? "rgba(34, 197, 94, 0.45)"
        : "rgba(245, 158, 11, 0.55)";
      headerStatus.style.background = ok
        ? "rgba(34, 197, 94, 0.12)"
        : "rgba(245, 158, 11, 0.12)";
      headerStatus.title = ok
        ? `${condition.cid} (${condition.module_label || condition.module}) · ${cid_source || ""}`
        : `${condition.cid} (mismatch: ${validation.mismatches.join(", ")})`;
    } else {
      headerStatus.setAttribute("aria-hidden", "true");
      headerStatus.classList.remove("condition-badge-debug");
      headerStatus.style.color = "";
      headerStatus.style.borderColor = "";
      headerStatus.style.background = "";
    }
  }

  const appBody = document.getElementById("appBody");
  if (!appBody) {
    return;
  }

  // eslint-disable-next-line no-new
  new AppUI({
    root: appBody,
    condition,
    debug,
    condition_valid: validation.valid,
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
