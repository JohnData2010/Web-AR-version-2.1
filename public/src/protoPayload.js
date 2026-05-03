/**
 * Option B Qualtrics ↔ Web: shared fields for AR_PROTO_AUDIT / AR_PROTO_COMPLETE.
 * Embedded Data naming on Qualtrics side uses ar_*; payload stays flat inside .payload for listeners.
 */

import {
  SCREEN_ORDER_VERSION,
  STIMULUS_VERSION,
} from "./conditions.js";

/** Matches live-camera demo (browser getUserMedia for video; mic/photos UI-only where applicable). */
export const MEDIA_MODE = "live_camera";

export function stimulusVersion(condition) {
  return condition?.stimulus_version || STIMULUS_VERSION;
}

/**
 * Canonical condition echo fields — map to Embedded Data keys ar_module, ar_access_bundle, etc.
 */
export function conditionEchoFields(condition) {
  return {
    cid: condition.cid,
    condition_num: condition.condition_num,
    /** Numeric slot 1–16 (same as condition_num; kept for older exports). */
    condition_id: condition.condition_id,

    module: condition.module,
    module_label: condition.module_label,
    access_bundle: condition.access_bundle,
    data_type: condition.data_type,
    /** narrow | broad — matches Qualtrics assigned_scope wording. */
    scope: condition.scope_profile,
    /** Internal UX: only | while */
    scope_grant: condition.scope,
    scope_label: condition.scope_label,
    scope_profile: condition.scope_profile,
    data_type_label: condition.data_type_label,

    camera_mic_scope: condition.camera_mic_scope,
    photo_access: condition.photo_access,
    /** Legacy shorthand for UX code paths */
    photo: condition.photo,

    focal_policy_cue: condition.focal_policy_cue,
    policy_section_shown: condition.policy_section_shown,
    policy_mode: condition.policy_mode,
    displayed_policy_sections: condition.displayed_policy_sections,

    sharing_condition: condition.sharing_condition,
    retention_condition: condition.retention_condition,
    sharing_displayed: condition.sharing_displayed ? 1 : 0,
    retention_displayed: condition.retention_displayed ? 1 : 0,

    stimulus_version: stimulusVersion(condition),
    screen_order_version: SCREEN_ORDER_VERSION,
  };
}

/**
 * Device-facing requests: camera uses getUserMedia; mic/photos stay in-app simulated (no device APIs).
 */
export function mediaRequestFlags() {
  return {
    media_mode: MEDIA_MODE,
    webcam_requested: 1,
    microphone_requested: 0,
    photo_library_requested: 0,
  };
}
