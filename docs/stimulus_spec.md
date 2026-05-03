# Stimulus specification — Web AR prototype (Option B privacy)

**Stimulus version:** `2.1`  
**Screen order version:** `privacy-option-b-v1` — Intro → **single-cue privacy notice** → App permissions → Demo → Exit  

**Option B:** The privacy notice shows **only one** manipulation block per participant:

- **Module `sharing` (M1_C1…M1_C8):** only the **third-party sharing** heading + body (internal vs external text). **Retention is not shown.** In data: `retention_condition` = `not_displayed`, `retention_displayed` = false.
- **Module `retention` (M2_C1…M2_C8):** only the **retention** heading + body (immediate vs stored). **Third-party is not shown.** In data: `sharing_condition` = `not_displayed`, `sharing_displayed` = false.

Wording for A1/A2/C1/C2 is unchanged; only **which** paragraph appears changes by module.

---

## Permission bundles D1–D4 (same for both modules)

| Bundle | Data / scope (summary)        | `scope` (UI) | `photo`  | `photo_access`    | `camera_mic_scope`   |
|--------|-------------------------------|--------------|----------|-------------------|----------------------|
| D1     | Biometric only, narrow        | `only`      | `none`   | `none`           | `only_this_time`     |
| D2     | Biometric only, broad         | `while`     | `none`   | `none`           | `while_using`        |
| D3     | Biometric + personal, narrow  | `only`      | `library`| `selected_photos`| `only_this_time`     |
| D4     | Biometric + personal, broad   | `while`     | `library`| `allow_all`      | `while_using`        |

---

## Condition table

### Module 1 — third-party sharing (retention not displayed)

| CID   | Bundle | Manipulated sharing |
|-------|--------|---------------------|
| M1_C1 | D1     | internal            |
| M1_C2 | D1     | external            |
| M1_C3 | D2     | internal            |
| M1_C4 | D2     | external            |
| M1_C5 | D3     | internal            |
| M1_C6 | D3     | external            |
| M1_C7 | D4     | internal            |
| M1_C8 | D4     | external            |

### Module 2 — retention (sharing not displayed)

| CID   | Bundle | Manipulated retention |
|-------|--------|------------------------|
| M2_C1 | D1     | immediate              |
| M2_C2 | D1     | stored                 |
| M2_C3 | D2     | immediate              |
| M2_C4 | D2     | stored                 |
| M2_C5 | D3     | immediate              |
| M2_C6 | D3     | stored                 |
| M2_C7 | D4     | immediate              |
| M2_C8 | D4     | stored                 |

**Numeric `condition_id`:** M1_C1…M1_C8 → 1–8; M2_C1…M2_C8 → 9–16.

---

## URL / assignment

- Production: **`?cid=…`** only (Qualtrics source of truth). No web-side random on deployed hosts.
- **`LEGACY_COND_TO_CID`:** `cond=1` → `M1_C1`, …, `cond=16` → `M2_C8` (debug / legacy).

---

## PostMessage

See **`AR_PROTO_AUDIT`** / **`AR_PROTO_COMPLETE`** in code: includes `focal_policy_cue`, `displayed_policy_sections`, `sharing_displayed`, `retention_displayed`, `sharing_condition`, `retention_condition`, `photo_access`, `camera_mic_scope`, etc.

**QC:** Compare Qualtrics-assigned `cid` with `cid` / `returned_condition_id` in completion payload. Never interpret `retention_condition` as “shown” when value is `not_displayed` (Module 1), or `sharing_condition` when `not_displayed` (Module 2).

---

## Timing

- **`noticeMinMs`:** 8000 ms (same for both modules; single section).

---

## Test harness

`public/test-harness.html` shows **expected** metadata for the selected `cid` next to the iframe.
