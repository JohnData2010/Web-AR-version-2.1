/**
 * Option B privacy: one policy section per module (Qualtrics assigns `cid`).
 * - Module "sharing" (M1_*): only third-party sharing text; retention = not_displayed.
 * - Module "retention" (M2_*): only retention text; sharing = not_displayed.
 *
 * Production: ?cid=M1_C1 … ?cid=M2_C8
 * Localhost / ?debug=1: optional random or ?cond=1…16
 */

export const STIMULUS_VERSION = "2.1";
export const SCREEN_ORDER_VERSION = "privacy-option-b-v1";

/** Wording unchanged from prior prototype. */
export const THIRD_PARTY_TEXT = {
  internal:
    "Usage analytics about your face filter interactions are handled only within the app. They are not shared with third-party organisations.",
  external:
    "Usage analytics about your face filter interactions are shared with third-party analytics and measurement partners.",
};

export const RETENTION_TEXT = {
  immediate:
    "Any stored data related to this feature is deleted immediately after the demo ends.",
  stored:
    "Any stored data related to this feature may be retained for up to three (3) years unless you request deletion.",
};

/**
 * D1–D4 — permission UX uses scope only|while + photo (unchanged across modules).
 */
export const ACCESS_BUNDLES = {
  D1: {
    access_bundle: "D1",
    data_type: "biometric_only",
    data_type_label: "Biometric data only",
    scope_profile: "narrow",
    scope: "only",
    scope_label: "Narrow access",
    camera_mic_scope: "only_this_time",
    photo: "none",
    photo_access: "none",
  },
  D2: {
    access_bundle: "D2",
    data_type: "biometric_only",
    data_type_label: "Biometric data only",
    scope_profile: "broad",
    scope: "while",
    scope_label: "Broad access",
    camera_mic_scope: "while_using",
    photo: "none",
    photo_access: "none",
  },
  D3: {
    access_bundle: "D3",
    data_type: "biometric_personal",
    data_type_label: "Biometric + personal data",
    scope_profile: "narrow",
    scope: "only",
    scope_label: "Narrow access",
    camera_mic_scope: "only_this_time",
    photo: "library",
    photo_access: "selected_photos",
  },
  D4: {
    access_bundle: "D4",
    data_type: "biometric_personal",
    data_type_label: "Biometric + personal data",
    scope_profile: "broad",
    scope: "while",
    scope_label: "Broad access",
    camera_mic_scope: "while_using",
    photo: "library",
    photo_access: "allow_all",
  },
};

function buildSharingCondition({ cid, condition_id, bundleKey, sharing }) {
  const b = ACCESS_BUNDLES[bundleKey];
  return {
    cid,
    condition_id,
    module: "sharing",
    module_label: "Third-party sharing module",
    stimulus_version: STIMULUS_VERSION,
    ...b,
    focal_policy_cue: "sharing",
    displayed_policy_sections: ["sharing"],
    sharing_condition: sharing,
    sharing_displayed: true,
    retention_condition: "not_displayed",
    retention_displayed: false,
    notice: {
      title: "Privacy Policy",
      sections: [
        {
          key: "sharing",
          heading: "How do we share information with third parties?",
          body: THIRD_PARTY_TEXT[sharing],
        },
      ],
    },
  };
}

function buildRetentionCondition({ cid, condition_id, bundleKey, retention }) {
  const b = ACCESS_BUNDLES[bundleKey];
  return {
    cid,
    condition_id,
    module: "retention",
    module_label: "Data retention module",
    stimulus_version: STIMULUS_VERSION,
    ...b,
    focal_policy_cue: "retention",
    displayed_policy_sections: ["retention"],
    sharing_condition: "not_displayed",
    sharing_displayed: false,
    retention_condition: retention,
    retention_displayed: true,
    notice: {
      title: "Privacy Policy",
      sections: [
        {
          key: "retention",
          heading: "How long do we keep your information?",
          body: RETENTION_TEXT[retention],
        },
      ],
    },
  };
}

/** All 16 cells — same CID keys as before. */
export const CONDITIONS_BY_CID = {
  M1_C1: buildSharingCondition({
    cid: "M1_C1",
    condition_id: 1,
    bundleKey: "D1",
    sharing: "internal",
  }),
  M1_C2: buildSharingCondition({
    cid: "M1_C2",
    condition_id: 2,
    bundleKey: "D1",
    sharing: "external",
  }),
  M1_C3: buildSharingCondition({
    cid: "M1_C3",
    condition_id: 3,
    bundleKey: "D2",
    sharing: "internal",
  }),
  M1_C4: buildSharingCondition({
    cid: "M1_C4",
    condition_id: 4,
    bundleKey: "D2",
    sharing: "external",
  }),
  M1_C5: buildSharingCondition({
    cid: "M1_C5",
    condition_id: 5,
    bundleKey: "D3",
    sharing: "internal",
  }),
  M1_C6: buildSharingCondition({
    cid: "M1_C6",
    condition_id: 6,
    bundleKey: "D3",
    sharing: "external",
  }),
  M1_C7: buildSharingCondition({
    cid: "M1_C7",
    condition_id: 7,
    bundleKey: "D4",
    sharing: "internal",
  }),
  M1_C8: buildSharingCondition({
    cid: "M1_C8",
    condition_id: 8,
    bundleKey: "D4",
    sharing: "external",
  }),

  M2_C1: buildRetentionCondition({
    cid: "M2_C1",
    condition_id: 9,
    bundleKey: "D1",
    retention: "immediate",
  }),
  M2_C2: buildRetentionCondition({
    cid: "M2_C2",
    condition_id: 10,
    bundleKey: "D1",
    retention: "stored",
  }),
  M2_C3: buildRetentionCondition({
    cid: "M2_C3",
    condition_id: 11,
    bundleKey: "D2",
    retention: "immediate",
  }),
  M2_C4: buildRetentionCondition({
    cid: "M2_C4",
    condition_id: 12,
    bundleKey: "D2",
    retention: "stored",
  }),
  M2_C5: buildRetentionCondition({
    cid: "M2_C5",
    condition_id: 13,
    bundleKey: "D3",
    retention: "immediate",
  }),
  M2_C6: buildRetentionCondition({
    cid: "M2_C6",
    condition_id: 14,
    bundleKey: "D3",
    retention: "stored",
  }),
  M2_C7: buildRetentionCondition({
    cid: "M2_C7",
    condition_id: 15,
    bundleKey: "D4",
    retention: "immediate",
  }),
  M2_C8: buildRetentionCondition({
    cid: "M2_C8",
    condition_id: 16,
    bundleKey: "D4",
    retention: "stored",
  }),
};

/** Alias — existing imports use `CONDITIONS`. */
export const CONDITIONS = CONDITIONS_BY_CID;

/** Canonical order for legacy ?cond=1…16 */
export const CONDITION_ORDER = [
  "M1_C1",
  "M1_C2",
  "M1_C3",
  "M1_C4",
  "M1_C5",
  "M1_C6",
  "M1_C7",
  "M1_C8",
  "M2_C1",
  "M2_C2",
  "M2_C3",
  "M2_C4",
  "M2_C5",
  "M2_C6",
  "M2_C7",
  "M2_C8",
];

export const LEGACY_COND_TO_CID = Object.fromEntries(
  CONDITION_ORDER.map((cid, i) => [String(i + 1), cid])
);

export const VALID_CIDS = Object.keys(CONDITIONS_BY_CID);

export function isLocalDevHost() {
  if (typeof window === "undefined" || !window.location) return false;
  try {
    const { protocol, hostname } = window.location;
    if (protocol === "file:") return true;
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "[::1]"
    );
  } catch {
    return false;
  }
}

export function getConditionFromParams(search) {
  const params = new URLSearchParams(search || "");
  const debug = params.get("debug") === "1";
  const cidParam = params.get("cid");
  const condParam = params.get("cond");

  const emptyCid = !cidParam || String(cidParam).trim() === "";

  let resolvedCid = null;
  let cidSource = "query";

  if (cidParam && CONDITIONS_BY_CID[cidParam]) {
    resolvedCid = cidParam;
    cidSource = "query";
  } else if (debug || (isLocalDevHost() && emptyCid)) {
    cidSource = debug ? "debug" : "local_preview";
    if (condParam != null && condParam !== "") {
      const n = Number(condParam);
      if (Number.isInteger(n) && n >= 1 && n <= 16) {
        resolvedCid = CONDITION_ORDER[n - 1];
      }
    }
    if (!resolvedCid) {
      resolvedCid =
        CONDITION_ORDER[Math.floor(Math.random() * CONDITION_ORDER.length)];
    }
  } else if (!emptyCid) {
    return {
      condition: null,
      validation: { valid: false },
      error: {
        code: "invalid_cid",
        message: `Unknown cid "${cidParam}". Expected one of ${VALID_CIDS.join(", ")}.`,
      },
      resolved_cid: null,
      cid_source: null,
    };
  } else {
    return {
      condition: null,
      validation: { valid: false },
      error: {
        code: "missing_cid",
        message:
          "Missing required parameter cid. Qualtrics must pass ?cid=M1_C1 (etc.). For local testing add ?debug=1 or open via localhost without cid.",
      },
      resolved_cid: null,
      cid_source: null,
    };
  }

  const condition = CONDITIONS_BY_CID[resolvedCid];

  const validation = { valid: true, mismatches: [] };
  const tpP = params.get("tp");
  const rtP = params.get("rt");
  if (debug && tpP) {
    if (
      condition.module === "sharing" &&
      tpP !== condition.sharing_condition
    ) {
      validation.valid = false;
      validation.mismatches.push("tp");
    }
    if (condition.module === "retention" && tpP) {
      validation.valid = false;
      validation.mismatches.push("tp_unexpected_for_retention_module");
    }
  }
  if (debug && rtP) {
    if (
      condition.module === "retention" &&
      rtP !== condition.retention_condition
    ) {
      validation.valid = false;
      validation.mismatches.push("rt");
    }
    if (condition.module === "sharing" && rtP) {
      validation.valid = false;
      validation.mismatches.push("rt_unexpected_for_sharing_module");
    }
  }

  if (condParam != null && condParam !== "") {
    const n = Number(condParam);
    if (!Number.isInteger(n) || n !== condition.condition_id) {
      validation.valid = false;
      validation.mismatches.push("cond_vs_condition_id");
    }
  }

  return {
    condition,
    validation,
    error: null,
    resolved_cid: resolvedCid,
    cid_source: cidSource,
  };
}
