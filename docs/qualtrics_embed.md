# Embedding the AR prototype in Qualtrics

The prototype is a **static client-side** page designed for **HTTPS** and **iframe** embedding. **Qualtrics should assign the experimental condition** and pass it to the app; the web app **does not** randomise conditions in production.

---

## 1. Deploy

Host the repo on Netlify, Vercel, or similar (see [run_local.md](./run_local.md)). Production URLs must use **`cid`** (see [stimulus_spec.md](./stimulus_spec.md)).

Example base (replace with your deployment):

`https://your-deployment.vercel.app/public/index.html`

---

## 2. Condition parameter (`cid`)

Use **`cid`**, not legacy numeric assignment alone:

`?cid=M1_C1` … `?cid=M2_C8`

In Qualtrics Survey Flow:

1. Create **Embedded Data**, e.g. `condition_id` = `M1_C3` (one of the sixteen codes).
2. In the HTML question that contains the iframe, pipe it into the URL:

```html
<iframe
  id="ar-demo-frame"
  src="https://YOUR_HOST/public/index.html?cid=${e://Field/condition_id}"
  title="AR Demo"
  allow="camera; microphone"
  style="width: 100%; height: 640px; border: none; border-radius: 16px;"
></iframe>
```

Use Survey Flow **randomisers** (e.g. even presentation across branches) to assign **`condition_id`** before the iframe block.

---

## 3. PostMessage to Qualtrics

The iframe sends:

| Event | When |
|-------|------|
| **AR_PROTO_AUDIT** | Valid load; confirms which stimulus rendered (`cid`, validation flags). |
| **AR_PROTO_COMPLETE** | Participant taps **Return to survey** on the exit screen. |
| **AR_PROTO_ERROR** | Missing/invalid `cid` — participant should not proceed to analysis without fixing deployment/URL. |

Example **`AR_PROTO_COMPLETE`** payload includes **`cid`**, **`condition_id`**, **`returned_condition_id`**, module, bundle, dwell times, **`condition_valid`**, etc. Mirror fields into Embedded Data via JavaScript on the survey page.

Example listener sketch:

```javascript
Qualtrics.SurveyEngine.addOnload(function () {
  function handleMessage(event) {
    var d = event.data;
    if (!d || !d.type) return;
    if (d.type === "AR_PROTO_COMPLETE" && d.payload) {
      var p = d.payload;
      Qualtrics.SurveyEngine.setEmbeddedData("ar_cid", p.cid || "");
      Qualtrics.SurveyEngine.setEmbeddedData(
        "ar_returned_condition_id",
        String(p.returned_condition_id || "")
      );
      Qualtrics.SurveyEngine.setEmbeddedData("ar_complete", "1");
      window.removeEventListener("message", handleMessage);
    }
    if (d.type === "AR_PROTO_ERROR") {
      Qualtrics.SurveyEngine.setEmbeddedData("ar_error_code", d.payload.code || "");
    }
  }
  window.addEventListener("message", handleMessage);
});
```

QC: compare Qualtrics **`condition_id`** (assigned in Flow) with **`ar_cid`** / **`returned_condition_id`** from the completion payload.

**Option B privacy:** For **`M1_*`** assignments, completion payloads use **`retention_condition: "not_displayed"`** because retention text was not shown. For **`M2_*`**, **`sharing_condition: "not_displayed"`**. Rely on **`displayed_policy_sections`**, **`sharing_displayed`**, and **`retention_displayed`** when exporting analysis-ready columns.

---

## 4. Local testing

Use **`public/test-harness.html`** with the **`cid`** dropdown and the **expected-spec panel** (debug mode). Do **not** rely on the web app to choose conditions for real data collection.

---

## 5. Headers

`vercel.json` / `netlify.toml` allow iframe embedding (`frame-ancestors`) for Qualtrics.
