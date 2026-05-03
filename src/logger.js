import {
  SCREEN_ORDER_VERSION,
  STIMULUS_VERSION,
} from "./conditions.js";

export class Logger {
  constructor() {
    this.startMs = performance.now();

    this.noticeVisibleStartMs = null;
    this.noticeAccumulatedMs = 0;

    this.permissionsVisibleStartMs = null;
    this.permissionsAccumulatedMs = 0;

    this.demoVisibleStartMs = null;
    this.demoAccumulatedMs = 0;

    this.noticeReviewOpenedCount = 0;

    this.interactionCount = 0;
    this.demoInteractionCount = 0;

    this.cameraPermission = "unknown";

    this._rafId = null;
    this._lastFrameMs = null;
    this._longFrameCount = 0;
  }

  addInteraction(opts = {}) {
    this.interactionCount += 1;
    if (opts && opts.demo) this.demoInteractionCount += 1;
  }

  markNoticeVisible() {
    if (this.noticeVisibleStartMs == null) {
      this.noticeVisibleStartMs = performance.now();
    }
  }

  markNoticeHidden() {
    if (this.noticeVisibleStartMs != null) {
      this.noticeAccumulatedMs += performance.now() - this.noticeVisibleStartMs;
      this.noticeVisibleStartMs = null;
    }
  }

  markPermissionsVisible() {
    if (this.permissionsVisibleStartMs == null) {
      this.permissionsVisibleStartMs = performance.now();
    }
  }

  markPermissionsHidden() {
    if (this.permissionsVisibleStartMs != null) {
      this.permissionsAccumulatedMs +=
        performance.now() - this.permissionsVisibleStartMs;
      this.permissionsVisibleStartMs = null;
    }
  }

  markDemoVisible() {
    if (this.demoVisibleStartMs == null) {
      this.demoVisibleStartMs = performance.now();
    }
  }

  markDemoHidden() {
    if (this.demoVisibleStartMs != null) {
      this.demoAccumulatedMs +=
        performance.now() - this.demoVisibleStartMs;
      this.demoVisibleStartMs = null;
    }
  }

  markNoticeReviewOpened() {
    this.noticeReviewOpenedCount += 1;
  }

  setCameraPermission(value) {
    this.cameraPermission = value;
  }

  startLagMonitor() {
    if (this._rafId) return;

    this._lastFrameMs = performance.now();
    const tick = () => {
      const now = performance.now();
      const delta = now - (this._lastFrameMs || now);
      this._lastFrameMs = now;

      if (delta > 200) this._longFrameCount += 1;

      this._rafId = requestAnimationFrame(tick);
    };

    this._rafId = requestAnimationFrame(tick);
  }

  stopLagMonitor() {
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    this._lastFrameMs = null;
  }

  getSummary(condition, { condition_valid = true } = {}) {
    const now = performance.now();

    const noticeMs =
      this.noticeAccumulatedMs +
      (this.noticeVisibleStartMs ? now - this.noticeVisibleStartMs : 0);

    const permissionMs =
      this.permissionsAccumulatedMs +
      (this.permissionsVisibleStartMs
        ? now - this.permissionsVisibleStartMs
        : 0);

    const demoMs =
      this.demoAccumulatedMs +
      (this.demoVisibleStartMs ? now - this.demoVisibleStartMs : 0);

    const deviceType = this._getDeviceType();
    const lagFlag = this._longFrameCount >= 3;

    const returnedId = condition.condition_id;

    return {
      type: "AR_PROTO_COMPLETE",
      payload: {
        cid: condition.cid,
        condition_id: returnedId,
        returned_condition_id: returnedId,
        module: condition.module,
        module_label: condition.module_label,
        focal_policy_cue: condition.focal_policy_cue,
        displayed_policy_sections: condition.displayed_policy_sections,

        access_bundle: condition.access_bundle,
        data_type: condition.data_type,
        data_type_label: condition.data_type_label,
        scope_profile: condition.scope_profile,
        scope: condition.scope,
        scope_label: condition.scope_label,
        photo: condition.photo,
        photo_access: condition.photo_access,
        camera_mic_scope: condition.camera_mic_scope,

        sharing_condition: condition.sharing_condition,
        sharing_displayed: condition.sharing_displayed,
        retention_condition: condition.retention_condition,
        retention_displayed: condition.retention_displayed,

        stimulus_version: condition.stimulus_version || STIMULUS_VERSION,
        screen_order_version: SCREEN_ORDER_VERSION,

        device_type: deviceType,
        camera_permission: this.cameraPermission,

        time_on_prototype_ms: Math.round(now - this.startMs),
        time_on_notice_ms: Math.round(noticeMs),
        notice_dwell_ms: Math.round(noticeMs),
        permission_dwell_ms: Math.round(permissionMs),
        demo_dwell_ms: Math.round(demoMs),

        notice_review_opened_count: this.noticeReviewOpenedCount,
        interaction_count: this.interactionCount,

        lag_flag: lagFlag,

        condition_valid,
        completion_status: "completed",

        view_details_clicked: false,
      },
    };
  }

  _getDeviceType() {
    const ua = (navigator.userAgent || "").toLowerCase();
    const isMobile =
      /mobi|android|iphone|ipod/.test(ua) ||
      (navigator.maxTouchPoints && navigator.maxTouchPoints > 1);

    const isTablet = /ipad/.test(ua);

    if (isTablet) return "tablet";
    return isMobile ? "mobile" : "desktop";
  }
}
