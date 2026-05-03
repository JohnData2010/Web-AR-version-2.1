import { STIMULUS_VERSION } from "./conditions.js";
import { MEDIA_MODE, conditionEchoFields } from "./protoPayload.js";

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

    this.demoEntered = false;
    this.permissionContinueClicked = false;
    this.cameraPreviewReady = false;

    this._rafId = null;
    this._lastFrameMs = null;
    this._longFrameCount = 0;
  }

  markDemoEntered() {
    this.demoEntered = true;
  }

  markPermissionContinueClicked() {
    this.permissionContinueClicked = true;
  }

  markCameraPreviewReady() {
    this.cameraPreviewReady = true;
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

  getSummary(
    condition,
    { condition_valid = true, demo_completed = false } = {}
  ) {
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

    const totalStimulusMs = Math.round(now - this.startMs);
    const vw =
      typeof window !== "undefined" ? Math.round(window.innerWidth) : null;
    const vh =
      typeof window !== "undefined" ? Math.round(window.innerHeight) : null;

    const micPerm = this.demoEntered ? "simulated" : "not_requested";
    const photoPerm =
      this.demoEntered && condition.photo_access !== "none"
        ? "simulated"
        : "not_requested";

    const echo = conditionEchoFields(condition);

    return {
      type: "AR_PROTO_COMPLETE",
      payload: {
        ...echo,
        returned_condition_id: condition.cid,
        completion_status: "completed",
        complete_timestamp: new Date().toISOString(),
        complete_ts_ms: Date.now(),

        condition_valid,
        demo_completed: demo_completed ? 1 : 0,

        notice_dwell_ms: Math.round(noticeMs),
        permission_dwell_ms: Math.round(permissionMs),
        demo_dwell_ms: Math.round(demoMs),
        total_stimulus_ms: totalStimulusMs,

        interaction_count: this.interactionCount,
        demo_interaction_count: this.demoInteractionCount,

        permission_continue_clicked: this.permissionContinueClicked ? 1 : 0,
        return_to_survey_clicked: 1,

        demo_started: this.demoEntered ? 1 : 0,

        /** Legacy alias; preview is camera stream when live (not embedded MP4). */
        video_loaded: this.cameraPreviewReady ? 1 : 0,
        camera_preview_ready: this.cameraPreviewReady ? 1 : 0,

        media_mode: MEDIA_MODE,
        camera_permission: this.cameraPermission,
        microphone_permission: micPerm,
        photo_permission: photoPerm,

        webcam_requested: 1,
        microphone_requested: 0,
        photo_library_requested: 0,

        device_type: deviceType,
        viewport_width: vw,
        viewport_height: vh,

        lag_flag: lagFlag,
        lag_frame_count: this._longFrameCount,
        stimulus_version: echo.stimulus_version || STIMULUS_VERSION,

        notice_review_opened_count: this.noticeReviewOpenedCount,
        time_on_prototype_ms: totalStimulusMs,
        time_on_notice_ms: Math.round(noticeMs),

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
