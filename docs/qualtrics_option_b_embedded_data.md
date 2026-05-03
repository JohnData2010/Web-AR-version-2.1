# Option B — Qualtrics Embedded Data & postMessage (assigned vs rendered)

Survey Flow should **randomise once** → set Embedded Data (**source of truth**) → iframe URL `?cid=${e://Field/condition_id}`.

The web app **echoes what it rendered** in **`AR_PROTO_AUDIT`** (on load) and **`AR_PROTO_COMPLETE`** (participant taps **Return to survey**).

All application fields arrive under **`event.data.payload`** (see `src/main.js`, `src/logger.js`, `src/protoPayload.js`).

---

## Naming convention

| Prefix | Meaning |
|--------|---------|
| *(none / `condition_id`)* | Set in Survey Flow — Qualtrics assignment (`condition_id` = `M1_C1` … `M2_C8`) |
| `assigned_*` | Optional mirror fields you set alongside the randomiser (recommended for exports) |
| `ar_*` | Copy fields from **`payload`** via JavaScript on the iframe question |
| `mc_*_expected` | Correct answers for manipulation checks (Survey Flow — not sent by web) |

---

## Minimum web echo fields (`payload`)

Listen for **`AR_PROTO_AUDIT`** and **`AR_PROTO_COMPLETE`**; map at least:

- **`cid`** → e.g. `ar_condition_id_returned` (audit) / **`returned_condition_id`** (complete — same CID string).
- **`condition_num`** → optional numeric slot 1–16.
- **`condition_valid`** (audit): `payload.condition_valid`.
- **`module`**, **`access_bundle`**, **`data_type`**, **`scope`** (narrow/broad), **`camera_mic_scope`**, **`photo_access`**.
- **`policy_section_shown`**, **`focal_policy_cue`**, **`sharing_condition`**, **`retention_condition`**, **`sharing_displayed`**, **`retention_displayed`** (0/1 integers).
- **`media_mode`** — `live_camera` (browser camera for AR demo; mic/photos remain in-app simulated UIs unless you change the app).
- **`webcam_requested`**, **`microphone_requested`**, **`photo_library_requested`** — see current `src/protoPayload.js` (`mediaRequestFlags`).

**Completion-only:** `notice_dwell_ms`, `permission_dwell_ms`, `demo_dwell_ms`, `total_stimulus_ms`, `interaction_count`, `demo_interaction_count`, `demo_started`, `demo_completed`, `camera_preview_ready` / `video_loaded`, `camera_permission`, `microphone_permission`, `photo_permission`, `device_type`, `viewport_width`, `viewport_height`, `lag_frame_count`, `complete_timestamp`.

---

## Integrity checks (Qualtrics JavaScript)

After **AUDIT**:

```text
ar_cid_match = 1  if  EmbeddedData(condition_id) === payload.cid
```

After **COMPLETE**:

```text
ar_complete_match = 1  if  EmbeddedData(condition_id) === (payload.returned_condition_id || payload.cid)
```

Option B content checks (examples):

- If assigned module is **sharing** (`M1_*`): expect `payload.retention_displayed === 0`, `payload.sharing_displayed === 1`, `payload.policy_section_shown === "sharing"`.
- If assigned module is **retention** (`M2_*`): expect `payload.sharing_displayed === 0`, `payload.retention_displayed === 1`, `payload.policy_section_shown === "retention"`.

---

## Example listener (sketch)

Use **`event.origin`** allowlist (your deployment). Read **`p = event.data.payload`**.

```javascript
Qualtrics.SurveyEngine.addOnload(function () {
  var q = this;
  q.hideNextButton();

  var assignedCid = Qualtrics.SurveyEngine.getEmbeddedData("condition_id");
  var allowedOrigin = "https://YOUR_DEPLOYMENT_HOST";

  function setED(k, v) {
    Qualtrics.SurveyEngine.setEmbeddedData(k, String(v == null ? "" : v));
  }

  window.addEventListener("message", function (event) {
    if (event.origin !== allowedOrigin) return;
    var d = event.data || {};
    var p = d.payload;
    if (!d.type || !p) return;

    if (d.type === "AR_PROTO_AUDIT") {
      setED("ar_audit_received", "1");
      setED("ar_audit_timestamp", p.audit_timestamp || "");
      setED("ar_condition_id_returned", p.cid || "");
      setED("ar_condition_num_returned", p.condition_num || "");
      setED("ar_condition_valid", p.condition_valid ? "1" : "0");
      setED("ar_cid_source", p.cid_source || "");
      setED("ar_module", p.module || "");
      setED("ar_access_bundle", p.access_bundle || "");
      setED("ar_data_type", p.data_type || "");
      setED("ar_scope", p.scope || "");
      setED("ar_camera_mic_scope", p.camera_mic_scope || "");
      setED("ar_photo_access", p.photo_access || "");
      setED("ar_policy_section_shown", p.policy_section_shown || "");
      setED("ar_sharing_condition", p.sharing_condition || "");
      setED("ar_retention_condition", p.retention_condition || "");
      setED("ar_sharing_displayed", String(p.sharing_displayed));
      setED("ar_retention_displayed", String(p.retention_displayed));
      setED("ar_stimulus_version", p.stimulus_version || "");
      setED("ar_screen_order_version", p.screen_order_version || "");
      setED("ar_media_mode", p.media_mode || "");
      var match =
        String(p.cid || "") === String(assignedCid || "");
      setED("ar_audit_match", match ? "1" : "0");
    }

    if (d.type === "AR_PROTO_COMPLETE") {
      setED("ar_complete", "1");
      setED("ar_completion_status", p.completion_status || "");
      setED("ar_condition_id_complete", p.returned_condition_id || p.cid || "");
      setED("ar_notice_dwell_ms", p.notice_dwell_ms || "");
      setED("ar_permission_dwell_ms", p.permission_dwell_ms || "");
      setED("ar_demo_dwell_ms", p.demo_dwell_ms || "");
      setED("ar_total_stimulus_ms", p.total_stimulus_ms || "");
      setED("ar_interaction_count", p.interaction_count || "");
      setED("ar_demo_interaction_count", p.demo_interaction_count || "");
      setED("ar_camera_preview_ready", p.camera_preview_ready || "0");
      setED("ar_camera_permission", p.camera_permission || "");
      setED("ar_device_type", p.device_type || "");
      setED("ar_viewport_width", p.viewport_width || "");
      setED("ar_viewport_height", p.viewport_height || "");
      setED("ar_lag_frame_count", p.lag_frame_count || "");
      var cMatch =
        String(p.returned_condition_id || p.cid || "") ===
        String(assignedCid || "");
      setED("ar_complete_match", cMatch ? "1" : "0");
      if (cMatch) q.showNextButton();
      else setED("ar_error_code", "complete_condition_mismatch");
    }

    if (d.type === "AR_PROTO_ERROR") {
      setED("ar_error_code", p.code || "unknown_error");
    }
  });
});
```

Account-specific APIs (`setEmbeddedData` vs `setJSEmbeddedData` / `__js_` prefix) may differ — validate on your Qualtrics instance.

---

## Condition mapping (16 cells)

Match Survey Flow randomiser to the same table as `src/conditions.js` / `CONDITIONS_BY_CID`. Each cell has explicit **`policy_section_shown`**, **`sharing_condition` / `retention_condition`** (with `not_displayed` where the factor is absent), and D1–D4 permission profile.

---

## What not to store

Do not persist raw face landmarks, frames, audio, full user-agent blobs, or long raw event logs in Embedded Data — use summary metrics only (as in `payload`).
