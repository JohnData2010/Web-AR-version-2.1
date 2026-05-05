import { Logger } from "./logger.js";
import { sendCompletionMessage } from "./postmessage.js";

// Helper để inline markdown: chỉ convert **bold** -> <strong>bold</strong>
function renderInlineMarkdown(input = "") {
  return String(input).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

function escapeHtml(s = "") {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const SCREENS = {
  INTRO: "intro",
  NOTICE: "notice",
  PERMISSIONS: "permissions",
  DEMO: "demo",
  EXIT: "exit",
  FEEDBACK: "feedback",
};

/** History / retention: counter-clockwise arc + undo stem + clock hands (Lucide-style). */
const RETENTION_NOTICE_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/></svg>`;

/** Third-party sharing: network share nodes (Lucide-style share-2). */
const SHARING_NOTICE_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>`;

/** Short copy when the browser/OS blocked camera (e.g. Block / Don't allow). */
const CAMERA_DENIED_SHORT =
  "Allow the camera for this page, then turn the live camera on again.";

/** True when getUserMedia failed because the user (or policy) denied camera access. */
function isMediaPermissionUserDenial(err) {
  if (!err || typeof err !== "object") return false;
  const name = String(err.name || "");
  if (name === "NotAllowedError" || name === "PermissionDeniedError") return true;
  const msg = String(err.message || "").toLowerCase();
  if (msg.includes("permission denied")) return true;
  if (msg.includes("not allowed")) return true;
  if (msg.includes("user denied")) return true;
  return false;
}

export class AppUI {
  constructor({ root, condition, debug = false, condition_valid = true }) {
    this.root = root;
    this.condition = condition;
    this.debug = debug;
    this.condition_valid = condition_valid;
    this.logger = new Logger();

    this.currentScreen = null;
    this.demoStartTime = null;
    // Thời điểm bắt đầu đếm 12s sau khi người dùng đã bật camera + chọn filter
    this.demoQualifyingStartTime = null;
    this.demoContinueEnabled = false;

    // Screen gating thresholds (min dwell time before allowing "Continue")
    this.permissionsMinMs = 7000; // App permissions screen
    this.noticeMinMs = 8000; // Single policy section (Option B); same for both modules

    this.permissionsTimerInterval = null;
    this.permissionsQualifyingStartTime = null;
    this.noticeTimerInterval = null;
    this.noticeQualifyingStartTime = null;
    this.permissionDecisionDelayMs = 2000;

    // No minimum dwell on Continue after permissions are granted (experience screen).
    this.demoMinMs = 0;
    this.demoInteractionCountAtStart = 0;
    this.demoTimerInterval = null;

    /** True while any code path is awaiting getUserMedia (avoid duplicate / racing calls). */
    this._cameraGumInProgress = false;
    /** True after user denied system camera — visibility/focus may retry getUserMedia. */
    this._cameraResumePending = false;
    this._cameraResumeInFlight = false;
    this._cameraPermStatusRef = null;
    this._cameraPermOnChange = null;
    this._cameraVisHandler = null;
    this._cameraDeviceChangeHandler = null;
    this._cameraDeviceDebounceTimer = 0;

    this.cameraStream = null;
    this.usingCamera = false;
    this.cameraGranted = false;

    // Permission grant flags for demo countdown gating.
    // Continue should only start once ALL required permissions are granted.
    this.cameraGranted = false;
    this.micGranted = false;
    this.photosGranted = false;

    // Trạng thái tương tác demo: đã bật camera / đã chọn style nào chưa
    this.hasUsedCamera = false;
    this.hasChosenStyle = false;

    // Marks whether the participant has completed the demo (left demo for exit).
    // Keeps the demo Continue button unlocked if they navigate back from feedback.
    this.demoCompleted = false;
    this._prevScreen = null;

    // Soften effect tích hợp sẵn trong mỗi feature (không còn nút bật/tắt)
    this.isFilterMuted = true;
    this.currentStyleVariant = 0;

    // Face tracking state (MediaPipe Face Landmarker)
    this.faceLandmarker = null;
    this.faceTrackingCanvas = null;
    this.faceTrackingCtx = null;
    this.faceTrackingLoopHandle = null;
    this._faceLibPromise = null;

    // Microphone state (for Blow Balloon style)
    this.micStream = null;
    this.micEnabled = false;
    this.micGranted = false;
    this.audioCtx = null;
    this.micAnalyser = null;
    this.micScriptProcessor = null;
    this.micDataFloat = null;
    this.micLevel = 0;
    this.micBaseline = 0;
    this._baselineFrames = 0;
    this._fakeMicAnimation = null;

    // Balloon game state (style 1)
    this.balloon = { value: 0, popped: false, popTimer: 0 };

    // Spark Pop (style 2): sparkles bắn từ miệng khi hả miệng
    this.dreamyBlushParticles = [];

    this.init();
  }

  // Open system photo picker and remember selected image for AR overlays
  openPhotoPicker() {
    if (!this._photoInput) {
      const input = document.createElement("input");
      input.type = "file";
      // Support both photos & videos (albums) for the demo permission prompt.
      input.accept = "image/*,video/*";
      input.style.display = "none";
      input.addEventListener("change", () => {
        const file = input.files && input.files[0];
        if (!file) return;
        // This demo no longer renders a photo/video overlay, but we still
        // treat a successful system selection as "photos & videos access granted"
        // for the permission gating UX.
        this.photosGranted = true;
        if (file.type.startsWith("image/")) {
          const url = URL.createObjectURL(file);
          this.showPhotoInFrame(url);
        }
      });
      document.body.appendChild(input);
      this._photoInput = input;
    }
    this._photoInput.value = "";
    this._photoInput.click();
  }

  showPhotoInFrame(url) {
    // Ảnh dùng cho các overlay AR (nếu được kích hoạt)
    if (!this.memoryFrameImage) {
      this.memoryFrameImage = new Image();
      this.memoryFrameImage.crossOrigin = "anonymous";
    }
    this.memoryFrameImage.src = url;
    this.photosGranted = true;
  }

  init() {
    this.root.innerHTML = "";
    const intro = this.buildIntroScreen();
    const notice = this.buildNoticeScreen();
    const permissions = this.buildPermissionsScreen();
    const demo = this.buildDemoScreen();
    const exit = this.buildExitScreen();
    const feedback = this.buildFeedbackScreen();

    // Study flow: Intro → Privacy notice → App permissions → Demo → Exit
    this.root.append(intro, notice, permissions, demo, exit, feedback);

    this.toScreen(SCREENS.INTRO);
  }

  toScreen(screen) {
    const prev = this.currentScreen;
    this._prevScreen = prev;

    // Stop screen gating timers when leaving those screens.
    if (prev === SCREENS.PERMISSIONS && screen !== SCREENS.PERMISSIONS) {
      this.logger.markPermissionsHidden();
      if (this.permissionsTimerInterval) {
        clearInterval(this.permissionsTimerInterval);
        this.permissionsTimerInterval = null;
      }
      this.permissionsQualifyingStartTime = null;
    }
    if (prev === SCREENS.NOTICE && screen !== SCREENS.NOTICE) {
      if (this.noticeTimerInterval) {
        clearInterval(this.noticeTimerInterval);
        this.noticeTimerInterval = null;
      }
      this.noticeQualifyingStartTime = null;
    }

    // nếu rời màn demo thì tắt camera để không giữ webcam chạy nền
    if (prev === SCREENS.DEMO && screen !== SCREENS.DEMO) {
      this.logger.markDemoHidden();
      this.teardownCameraResumeListeners();
      this.stopCamera();

      // Nếu đang hiển thị overlay notice trong demo thì ẩn đi
      const inlineNotice = document.getElementById("demoNoticeOverlay");
      if (inlineNotice) {
        inlineNotice.remove();
      }
    }

    this.currentScreen = screen;
    const screens = this.root.querySelectorAll(".screen");
    screens.forEach((el) => {
      el.classList.toggle("active", el.dataset.screen === screen);
    });

    if (screen === SCREENS.NOTICE) {
      this.logger.markNoticeVisible();
    } else {
      this.logger.markNoticeHidden();
    }

    if (screen === SCREENS.NOTICE) {
      this.onEnterNotice();
    } else if (screen === SCREENS.PERMISSIONS) {
      this.onEnterPermissions();
    } else if (screen === SCREENS.DEMO) {
      this.onEnterDemo();
    } else if (screen === SCREENS.EXIT) {
      this.onEnterExit();
    } else if (screen === SCREENS.FEEDBACK) {
      this.onEnterFeedback();
    }
  }

  buildIntroScreen() {
    const el = document.createElement("section");
    el.className = "screen";
    el.dataset.screen = SCREENS.INTRO;

    const title = document.createElement("div");
    title.className = "screen-title";
    title.textContent = "Introduction";

    const subtitle = document.createElement("div");
    subtitle.className = "screen-subtitle screen-subtitle-intro";
    subtitle.textContent =
      "Before you begin, please review the access this feature may request and how related data may be handled. You will then try the demo before answering the survey questions.";

    const btnRow = document.createElement("div");
    btnRow.className = "btn-row";

    const primary = document.createElement("button");
    primary.className = "btn btn-primary";
    primary.textContent = "Start demo";
    primary.addEventListener("click", () => {
      this.logger.addInteraction();
      this.toScreen(SCREENS.NOTICE);
    });

    btnRow.appendChild(primary);

    el.append(title, subtitle, btnRow);
    return el;
  }

  /** Option B: one or more blocks from `condition.notice.sections` (M1 = sharing only, M2 = retention only). */
  buildNoticeSectionsInnerHtml() {
    const sections = this.condition.notice?.sections || [];
    return sections
      .map((sec) => {
        if (sec.key === "retention") {
          return `
      <div class="notice-policy-block notice-retention-highlight" data-section="${escapeHtml(sec.key)}">
        <div class="notice-retention-row">
          <div class="notice-retention-icon" aria-hidden="true">${RETENTION_NOTICE_ICON}</div>
          <div class="notice-retention-copy">
            <p class="notice-policy-heading">${escapeHtml(sec.heading)}</p>
            <p class="notice-policy-body">${renderInlineMarkdown(sec.body)}</p>
          </div>
        </div>
      </div>`;
        }
        if (sec.key === "sharing") {
          return `
      <div class="notice-policy-block notice-sharing-highlight" data-section="${escapeHtml(sec.key)}">
        <div class="notice-sharing-row">
          <div class="notice-sharing-icon" aria-hidden="true">${SHARING_NOTICE_ICON}</div>
          <div class="notice-sharing-copy">
            <p class="notice-policy-heading">${escapeHtml(sec.heading)}</p>
            <p class="notice-policy-body">${renderInlineMarkdown(sec.body)}</p>
          </div>
        </div>
      </div>`;
        }
        return `
      <div class="notice-policy-block" data-section="${escapeHtml(sec.key)}">
        <p class="notice-policy-heading">${escapeHtml(sec.heading)}</p>
        <p class="notice-policy-body">${renderInlineMarkdown(sec.body)}</p>
      </div>`;
      })
      .join("");
  }

  buildNoticeScreen() {
    const el = document.createElement("section");
    el.className = "screen";
    el.dataset.screen = SCREENS.NOTICE;

    const title = document.createElement("div");
    title.className = "screen-title";
    title.textContent =
      this.condition.notice?.title || "Privacy Policy";

    const card = document.createElement("div");
    const noticeShellFlat =
      this.condition.module === "retention" ||
      this.condition.module === "sharing";
    card.className = noticeShellFlat
      ? "notice-policy-outer-flat"
      : "card card-contrast";
    card.innerHTML = `<div class="notice-text notice-read-column">${this.buildNoticeSectionsInnerHtml()}</div>`;

    const btnRow = document.createElement("div");
    btnRow.className = "btn-row";

    const back = document.createElement("button");
    back.className = "btn btn-secondary";
    back.textContent = "Back";
    back.addEventListener("click", () => {
      this.logger.addInteraction();
      this.toScreen(SCREENS.INTRO);
    });

    const primary = document.createElement("button");
    primary.className = "btn btn-primary";
    primary.textContent = "I understand, continue";
    primary.id = "noticeContinueButton";
    primary.disabled = true;
    primary.classList.add("btn-disabled");
    primary.addEventListener("click", () => {
      this.logger.addInteraction();
      this.toScreen(SCREENS.PERMISSIONS);
    });

    btnRow.append(back, primary);

    el.append(title, card, btnRow);
    return el;
  }

  buildPermissionsScreen() {
    const el = document.createElement("section");
    el.className = "screen";
    el.dataset.screen = SCREENS.PERMISSIONS;

    const title = document.createElement("div");
    title.className = "screen-title";
    title.textContent = "App permissions";

    const subtitle = document.createElement("div");
    subtitle.className = "screen-subtitle";
    subtitle.textContent =
      "Before the demo starts, please review the permissions this demo needs.";

    const card = document.createElement("div");
    card.className = "card permissions-focal-card";
    const hasPhoto = this.condition.photo === "library";
    const scope = this.condition.scope || "while";

    const CAMERA_ICON =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h8A2.5 2.5 0 0 1 16 8.5v7a2.5 2.5 0 0 1-2.5 2.5h-8A2.5 2.5 0 0 1 3 15.5v-7Z"/><path d="M16 10.5 21 8v8l-5-2.5"/></svg>';
    const MIC_ICON =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M6 11a6 6 0 0 0 12 0"/><path d="M12 17v4"/><path d="M9 21h6"/></svg>';
    const ALBUMS_ICON =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="m5.5 17 4.5-4.5 3.2 3.2 2.3-2.3 3 3.6"/></svg>';

    const cameraMicScopeValue =
      scope === "only" ? "Only this time" : "Allow only while using the app";
    const photoScopeValue =
      scope === "only" ? "Select photos and videos" : "Allow all";

    const permissionRows = [
      { label: "Camera", icon: CAMERA_ICON, scope: cameraMicScopeValue },
      { label: "Microphone", icon: MIC_ICON, scope: cameraMicScopeValue },
      ...(hasPhoto
        ? [{ label: "Photo library", icon: ALBUMS_ICON, scope: photoScopeValue }]
        : []),
    ]
      .map(
        (item) => `
        <div class="permission-item">
          <div class="permission-item-icon-wrap" aria-hidden="true">${item.icon}</div>
          <div class="permission-item-copy">
            <p class="permission-item-title">${item.label}</p>
            <p class="permission-item-access">Access is set to <span class="permission-panel-value">${item.scope}</span>.</p>
          </div>
        </div>
      `
      )
      .join("");

    card.innerHTML = `
      <div class="notice-text notice-read-column permission-panel">
        <p class="permission-panel-lead">This app needs access to the following:</p>
        <div class="permission-item-list">
          ${permissionRows}
        </div>
      </div>
    `;

    const btnRow = document.createElement("div");
    btnRow.className = "btn-row";
    btnRow.style.marginTop = "8px";

    const back = document.createElement("button");
    back.className = "btn btn-secondary";
    back.textContent = "Back";
    back.addEventListener("click", () => {
      this.logger.addInteraction();
      this.toScreen(SCREENS.NOTICE);
    });

    const primary = document.createElement("button");
    primary.className = "btn btn-primary";
    primary.textContent = "Continue";
    primary.id = "permissionsContinueButton";
    primary.disabled = true;
    primary.classList.add("btn-disabled");
    primary.addEventListener("click", () => {
      this.logger.addInteraction();
      this.logger.markPermissionContinueClicked();
      this.toScreen(SCREENS.DEMO);
    });

    btnRow.append(back, primary);
    el.append(title, subtitle, card, btnRow);
    return el;
  }

  buildDemoScreen() {
    const el = document.createElement("section");
    el.className = "screen";
    el.dataset.screen = SCREENS.DEMO;

    const title = document.createElement("div");
    title.className = "screen-title";
    title.textContent = "Try the AR filter";

    const subtitle = document.createElement("div");
    subtitle.className = "screen-subtitle";
    subtitle.textContent =
      "Step 2 of 3: use your camera for the live AR face-filter preview. Tap the buttons below to try different styles.";

    const demoShell = document.createElement("div");
    demoShell.className = "demo-shell";

    // Live camera preview + AR overlay frame
    const frame = document.createElement("div");
    frame.className = "demo-video-frame";
    frame.id = "demoFrame";

    // Placeholder (static demo image fallback)
    const placeholder = document.createElement("div");
    placeholder.className = "demo-placeholder";
    placeholder.id = "demoPlaceholder";

    const placeholderVideo = document.createElement("img");
    placeholderVideo.src =
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 600'%3E%3Crect width='400' height='600' fill='%23e0f2fe'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' fill='%236b7280' font-family='system-ui' font-size='16'%3EDemo%3C/text%3E%3C/svg%3E";
    placeholderVideo.alt = "Demo placeholder";
    placeholderVideo.style.cssText =
      "width:100%;height:100%;object-fit:cover;";
    placeholder.appendChild(placeholderVideo);
    if (this.isFilterMuted) {
      placeholder.style.filter = "grayscale(0.15) saturate(0.8)";
    }

    // Real camera video
    const video = document.createElement("video");
    video.className = "demo-camera-video";
    video.id = "demoCameraVideo";
    video.setAttribute("playsinline", "");
    video.setAttribute("muted", "");
    video.muted = true;
    video.defaultMuted = true;
    video.volume = 0;
    video.style.display = "none";

    // Canvas overlay for face tracking
    const overlay = document.createElement("canvas");
    overlay.className = "demo-camera-overlay-canvas";
    overlay.id = "demoCameraOverlayCanvas";
    overlay.style.cssText =
      "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:5;";
    overlay.style.display = "none";

    // Social UI overlay (Instagram/TikTok style)
    const socialUI = document.getElementById("social-ui-template");
    if (socialUI) {
      const clone = socialUI.content.cloneNode(true);
      frame.appendChild(clone);
    }

    // Grain overlay
    const grainTemplate = document.getElementById("grain-overlay-template");
    if (grainTemplate) {
      const grainClone = grainTemplate.content.cloneNode(true);
      frame.appendChild(grainClone);
    }

    frame.append(placeholder, video, overlay);

    // TikTok-like left-bottom "albums" icon (visual only; no click).
    if (this.condition.photo === "library") {
      const albumsIcon = document.createElement("div");
      albumsIcon.setAttribute("aria-hidden", "true");
      albumsIcon.style.cssText = `
        position:absolute;
        left:16px;
        bottom:22px;
        width:44px;
        height:44px;
        border-radius:999px;
        background: rgba(15, 23, 42, 0.55);
        border: 1px solid rgba(255,255,255,0.25);
        display:flex;
        align-items:center;
        justify-content:center;
        pointer-events:none;
        z-index: 26;
      `;
      albumsIcon.innerHTML =
        '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="color:rgba(249,250,251,0.95);">' +
        '<rect x="4" y="5" width="16" height="14" rx="2"></rect>' +
        '<circle cx="9" cy="10" r="1.6"></circle>' +
        '<path d="M5.5 17.5 10 13l3 3 2.5-2.5L18.5 17.5"></path>' +
        "</svg>";
      frame.appendChild(albumsIcon);
    }

    demoShell.appendChild(frame);

    const cameraAlert = document.createElement("div");
    cameraAlert.id = "demoCameraAlert";
    cameraAlert.className = "demo-camera-alert";
    cameraAlert.hidden = true;
    demoShell.appendChild(cameraAlert);

    // CTA text
    const ctaText = document.createElement("div");
    ctaText.className = "demo-cta-text";
    ctaText.id = "demoCtaText";
    ctaText.textContent = "";
    demoShell.appendChild(ctaText);

    el.appendChild(demoShell);

    // Continue button (gated)
    const btnRow = document.createElement("div");
    btnRow.className = "btn-row";
    btnRow.style.marginTop = "8px";

    const continueBtn = document.createElement("button");
    continueBtn.className = "btn btn-primary btn-disabled";
    continueBtn.id = "demoContinueButton";
    continueBtn.textContent = "Continue";
    continueBtn.disabled = true;
    continueBtn.addEventListener("click", () => {
      if (!this.demoContinueEnabled) return;
      this.logger.addInteraction({ demo: true });
      this.demoCompleted = true;
      this.toScreen(SCREENS.EXIT);
    });

    btnRow.appendChild(continueBtn);
    el.appendChild(btnRow);

    return el;
  }

  buildExitScreen() {
    const el = document.createElement("section");
    el.className = "screen";
    el.dataset.screen = SCREENS.EXIT;

    const title = document.createElement("div");
    title.className = "screen-title";
    title.textContent = "Demo done";

    const card = document.createElement("div");
    card.className = "card card-contrast";
    const body = document.createElement("div");
    body.className = "notice-text notice-read-column";
    body.textContent =
      "Thanks for trying the AR face filter. Next, we’ll ask a few questions about what you saw and what you think about the app.";
    card.appendChild(body);

    const btnRow = document.createElement("div");
    btnRow.className = "btn-row";

    const continueBtn = document.createElement("button");
    continueBtn.className = "btn btn-primary";
    continueBtn.textContent = "Continue";
    continueBtn.addEventListener("click", () => {
      this.logger.addInteraction();
      this.finishAndSendData();
    });

    btnRow.appendChild(continueBtn);
    el.append(title, card, btnRow);
    return el;
  }

  buildFeedbackScreen() {
    const el = document.createElement("section");
    el.className = "screen";
    el.dataset.screen = SCREENS.FEEDBACK;

    const title = document.createElement("div");
    title.className = "screen-title";
    title.textContent = "Write feedback";

    const subtitle = document.createElement("div");
    subtitle.className = "screen-subtitle";
    subtitle.textContent =
      "We’d love to hear your thoughts. Please let us know what worked well and what could be improved.";

    const card = document.createElement("div");
    card.className = "card card-contrast";
    card.style.padding = "16px";

    const textarea = document.createElement("textarea");
    textarea.id = "feedbackTextarea";
    textarea.placeholder = "Your feedback…";

    const hint = document.createElement("div");
    hint.className = "meta-text";
    hint.style.cssText = "margin-top:10px;";
    hint.textContent = "Press “Send” to submit your feedback.";

    const btnRow = document.createElement("div");
    btnRow.className = "btn-row";
    btnRow.style.marginTop = "12px";
    btnRow.style.gap = "10px";

    const backBtn = document.createElement("button");
    backBtn.className = "btn btn-secondary";
    backBtn.textContent = "Back";
    backBtn.addEventListener("click", () => {
      this.logger.addInteraction();
      this.toScreen(SCREENS.EXIT);
    });

    const sendBtn = document.createElement("button");
    sendBtn.className = "btn btn-primary";
    sendBtn.id = "feedbackSendButton";
    sendBtn.textContent = "Send";
    sendBtn.addEventListener("click", () => this.sendFeedbackEmail());

    // Optional: disable Send when empty.
    const updateSendEnabled = () => {
      const v = (textarea.value || "").trim();
      sendBtn.disabled = v.length === 0;
      if (sendBtn.disabled) sendBtn.classList.add("btn-disabled");
      else sendBtn.classList.remove("btn-disabled");
    };
    updateSendEnabled();
    textarea.addEventListener("input", updateSendEnabled);

    btnRow.append(backBtn, sendBtn);
    card.append(textarea, hint, btnRow);

    el.append(title, subtitle, card);
    return el;
  }

  onEnterFeedback() {
    // Focus textarea for faster feedback.
    const textarea = document.getElementById("feedbackTextarea");
    if (textarea) textarea.focus();
  }

  sendFeedbackEmail() {
    const textarea = document.getElementById("feedbackTextarea");
    const feedback = (textarea?.value || "").trim();

    const subject = "AR face-filter demo feedback";
    const conditionId = this.condition?.condition_id;
    const cid = this.condition?.cid;
    const sc = this.condition?.sharing_condition;
    const rc = this.condition?.retention_condition;

    const body = [
      "Feedback:",
      feedback || "(empty)",
      "",
      "Context:",
      `cid: ${cid ?? "N/A"}`,
      `condition_id: ${conditionId != null ? String(conditionId) : "N/A"}`,
      `sharing_condition: ${sc ?? "N/A"}`,
      `retention_condition: ${rc ?? "N/A"}`,
      `Time: ${new Date().toISOString()}`,
    ].join("\n");

    const mailTo = "s219566648@deakin.edu.au";
    const mailtoUrl =
      `mailto:${mailTo}` +
      `?subject=${encodeURIComponent(subject)}` +
      `&body=${encodeURIComponent(body)}`;

    // Open email client with pre-filled content.
    window.location.href = mailtoUrl;
  }

  onEnterPermissions() {
    this.logger.markPermissionsVisible();
    if (this.permissionsTimerInterval) {
      clearInterval(this.permissionsTimerInterval);
      this.permissionsTimerInterval = null;
    }

    this.permissionsQualifyingStartTime = performance.now();

    const btn = document.getElementById("permissionsContinueButton");
    if (!btn) return;

    if (!btn.dataset.originalText) btn.dataset.originalText = btn.textContent;

    // Start disabled; will be enabled after threshold.
    btn.disabled = true;
    btn.classList.add("btn-disabled");

    this.updatePermissionsGatingState();
    this.permissionsTimerInterval = setInterval(
      () => this.updatePermissionsGatingState(),
      500
    );
  }

  updatePermissionsGatingState() {
    const btn = document.getElementById("permissionsContinueButton");
    if (!btn) return;
    if (!this.permissionsQualifyingStartTime) return;

    const elapsed = performance.now() - this.permissionsQualifyingStartTime;
    const remainingMs = Math.max(0, this.permissionsMinMs - elapsed);
    const remainingSec = Math.ceil(remainingMs / 1000);
    const canContinue = remainingMs <= 0;

    const originalText = btn.dataset.originalText || "Continue";
    if (canContinue) {
      btn.disabled = false;
      btn.classList.remove("btn-disabled");
      btn.textContent = originalText;
      if (this.permissionsTimerInterval) {
        clearInterval(this.permissionsTimerInterval);
        this.permissionsTimerInterval = null;
      }
      return;
    }

    btn.disabled = true;
    btn.classList.add("btn-disabled");
    btn.textContent = `${originalText} (in ${remainingSec}s)`;
  }

  onEnterNotice() {
    if (this.noticeTimerInterval) {
      clearInterval(this.noticeTimerInterval);
      this.noticeTimerInterval = null;
    }

    if (this.noticeQualifyingStartTime == null) {
      this.noticeQualifyingStartTime = performance.now();
    }

    const btn = document.getElementById("noticeContinueButton");
    if (!btn) return;

    if (!btn.dataset.originalText) btn.dataset.originalText = btn.textContent;

    btn.disabled = true;
    btn.classList.add("btn-disabled");

    this.updateNoticeGatingState();
    this.noticeTimerInterval = setInterval(
      () => this.updateNoticeGatingState(),
      500
    );
  }

  updateNoticeGatingState() {
    const btn = document.getElementById("noticeContinueButton");
    if (!btn) return;
    if (!this.noticeQualifyingStartTime) return;

    const elapsed = performance.now() - this.noticeQualifyingStartTime;
    const remainingMs = Math.max(0, this.noticeMinMs - elapsed);
    const remainingSec = Math.ceil(remainingMs / 1000);
    const canContinue = remainingMs <= 0;

    const originalText = btn.dataset.originalText || "I understand, continue";
    if (canContinue) {
      btn.disabled = false;
      btn.classList.remove("btn-disabled");
      btn.textContent = originalText;
      if (this.noticeTimerInterval) {
        clearInterval(this.noticeTimerInterval);
        this.noticeTimerInterval = null;
      }
      return;
    }

    btn.disabled = true;
    btn.classList.add("btn-disabled");
    btn.textContent = `${originalText} (in ${remainingSec}s)`;
  }

  onEnterDemo() {
    this.demoStartTime = performance.now();
    this.demoInteractionCountAtStart = this.logger.interactionCount;
    this.logger.markDemoVisible();
    this.logger.markDemoEntered();
    this.logger.startLagMonitor();

    // Always treat demo entry as a fresh run so permissions are re-asked consistently.
    this.demoCompleted = false;

    // Reset demo state
    this.hasUsedCamera = false;
    this.hasChosenStyle = false;
    this.demoQualifyingStartTime = null;
    this.demoContinueEnabled = false;
    this.cameraGranted = false;
    this.micGranted = false;
    this.photosGranted = false;
    this._cameraResumePending = false;
    this.hideDemoCameraAlert();
    this.teardownCameraResumeListeners();

    // Bắt đầu timer kiểm tra gating
    this.startDemoGatingTimer();

    // Request flows when the demo appears:
    // - Camera: after the in-app prompt, call getUserMedia (system camera API).
    // - Microphone / photo albums: same in-app prompts and UI as before; no device mic or photo-library APIs.
    const needPhotos = this.condition.photo === "library";
    const needMic = true;

    const afterPhotos = () => {};

    const promptPhotos = () => {
      if (!needPhotos) {
        afterPhotos();
        return;
      }
      this.showPermissionPrompt(
        "photos",
        () => {
          // UI-only grant: no real picker/API call.
          this.photosGranted = true;
        },
        () => afterPhotos()
      );
    };

    const promptMic = () => {
      if (!needMic) {
        promptPhotos();
        return;
      }
      this.showPermissionPrompt(
        "microphone",
        async () => {
          this.micGranted = true;
          promptPhotos();
        },
        () => promptPhotos()
      );
    };

    const promptCamera = () => {
      this.showPermissionPrompt(
        "camera",
        async () => {
          this._cameraGumInProgress = true;
          try {
            try {
              const stream = await this.requestCameraStream();
              await this.enableCameraView(stream);
              this.logger.setCameraPermission("granted");
              this._cameraResumePending = false;
            } catch (err) {
              console.error("Camera start failed:", err);
              const denied = isMediaPermissionUserDenial(err);
              this.logger.setCameraPermission(denied ? "denied" : "error");
              if (denied) this._cameraResumePending = true;
              this.showCameraUnavailable(
                denied
                  ? CAMERA_DENIED_SHORT
                  : "Could not open the camera. Try again in a moment.",
                denied ? "denied" : "error"
              );
            }
          } finally {
            this._cameraGumInProgress = false;
          }
          promptMic();
        },
        () => promptMic()
      );
    };

    // Always show the prompts at demo entry (so participants don't have to click filters).
    promptCamera();
    void this.setupCameraResumeListeners();
  }

  onEnterExit() {
    this.logger.stopLagMonitor();
    if (this.demoTimerInterval) {
      clearInterval(this.demoTimerInterval);
      this.demoTimerInterval = null;
    }

    if (this.permissionsTimerInterval) {
      clearInterval(this.permissionsTimerInterval);
      this.permissionsTimerInterval = null;
    }
    this.permissionsQualifyingStartTime = null;

    if (this.noticeTimerInterval) {
      clearInterval(this.noticeTimerInterval);
      this.noticeTimerInterval = null;
    }
    this.noticeQualifyingStartTime = null;
  }

  finishAndSendData() {
    const summary = this.logger.getSummary(this.condition, {
      condition_valid: this.condition_valid,
      demo_completed: this.demoCompleted,
    });
    sendCompletionMessage(summary);
  }

  // Hiển thị lại notice overlay inline trong demo
  showInlineNotice() {
    this.logger.markNoticeReviewOpened();

    // Kiểm tra xem đã có overlay chưa
    let overlay = document.getElementById("demoNoticeOverlay");
    if (overlay) {
      // Đã có rồi thì chỉ cần hiện ra
      overlay.style.display = "flex";
      return;
    }

    // Tạo mới overlay
    overlay = document.createElement("div");
    overlay.id = "demoNoticeOverlay";
    overlay.className = "ar-modal-overlay";

    const card = document.createElement("div");
    const overlayFocalSheet =
      this.condition.module === "retention" ||
      this.condition.module === "sharing";
    card.className = overlayFocalSheet
      ? "card notice-overlay-focal-sheet"
      : "card card-contrast";

    const heading = document.createElement("div");
    heading.className = "notice-heading";
    heading.textContent =
      this.condition.notice?.title || "Privacy Policy";
    heading.style.marginBottom = "10px";

    const text = document.createElement("div");
    text.className = "notice-text notice-read-column";
    text.innerHTML = this.buildNoticeSectionsInnerHtml();

    const btnRow = document.createElement("div");
    btnRow.className = "btn-row";
    btnRow.style.marginTop = "14px";

    const closeBtn = document.createElement("button");
    closeBtn.className = "btn btn-primary";
    closeBtn.textContent = "Close";
    closeBtn.addEventListener("click", () => {
      overlay.style.display = "none";
    });

    btnRow.append(closeBtn);
    card.append(heading, text, btnRow);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
  }

  // Simple in-app permission prompt styled like mobile OS dialogs
  showPermissionPrompt(kind, onAllow, onDeny = null) {
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/53d0209c-35d3-4927-ba1e-aa88e05e7ed6',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'a93ced'},body:JSON.stringify({sessionId:'a93ced',runId:'qualtrics-permission-debug',hypothesisId:'P1',location:'src/ui.js:showPermissionPrompt:start',message:'permission prompt created',data:{kind,decisionDelayMs:this.permissionDecisionDelayMs,scope:this.condition?.scope,photo:this.condition?.photo},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    const overlay = document.createElement("div");
    overlay.className = "ar-permission-overlay";
    overlay.style.background = "rgba(15, 23, 42, 0.48)";
    overlay.style.backdropFilter = "blur(4px)";
    overlay.style.webkitBackdropFilter = "blur(4px)";

    const card = document.createElement("div");
    card.className = "ar-permission-card";
    card.style.cssText =
      "background:#ffffff;border:1px solid rgba(148,163,184,0.38);" +
      "border-radius:16px;box-shadow:0 16px 34px rgba(15,23,42,0.32);" +
      "padding:14px 0 0;max-width:min(332px,100%);overflow:hidden;";

    const iconWrap = document.createElement("div");
    iconWrap.setAttribute("aria-hidden", "true");
    iconWrap.style.cssText =
      "width:28px;height:28px;margin:0 auto 8px;border-radius:999px;" +
      "display:flex;align-items:center;justify-content:center;color:#2563eb;";
    if (kind === "camera") {
      iconWrap.innerHTML =
        '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h8A2.5 2.5 0 0 1 16 8.5v7a2.5 2.5 0 0 1-2.5 2.5h-8A2.5 2.5 0 0 1 3 15.5v-7Z"/><path d="M16 10.5 21 8v8l-5-2.5"/></svg>';
    } else if (kind === "microphone") {
      iconWrap.innerHTML =
        '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M6 11a6 6 0 0 0 12 0"/><path d="M12 17v4"/><path d="M9 21h6"/></svg>';
    } else if (kind === "photos") {
      iconWrap.innerHTML =
        '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="m5.5 17 4.5-4.5 3.2 3.2 2.3-2.3 3 3.6"/></svg>';
    } else {
      iconWrap.innerHTML =
        '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>';
    }

    const title = document.createElement("div");
    title.style.cssText =
      "font-size:15px;font-weight:500;color:#111827;text-align:center;" +
      "margin:0 16px 8px;line-height:1.35;";
    const appName = "Face-Filter Demo";
    if (kind === "camera") {
      title.textContent = `Allow “${appName}” to access your camera?`;
    } else if (kind === "microphone") {
      title.textContent = `Allow “${appName}” to access your microphone?`;
    } else if (kind === "photos") {
      title.textContent = `Allow “${appName}” to access photos and videos on this device?`;
    } else {
      title.textContent = `Allow “${appName}” to access this feature?`;
    }

    const message = document.createElement("div");
    message.style.cssText =
      "font-size:13px;color:#4b5563;line-height:1.45;text-align:center;" +
      "margin:0 18px 12px;";
    if (kind === "camera") {
      message.textContent =
        "Allows the app to take pictures and record videos for this demo.";
    } else if (kind === "microphone") {
      message.textContent =
        "Allows the app to record audio for this demo.";
    } else if (kind === "photos") {
      const scope = this.condition.scope || "while";
      message.textContent =
        scope === "only"
          ? "Access only the photos and videos you select."
          : "Allow access to your albums for this demo until you change your device settings.";
    } else {
      message.textContent =
        "The demo needs this permission to run the AR effect correctly.";
    }

    const buttonsCol = document.createElement("div");
    buttonsCol.style.cssText =
      "display:flex;flex-direction:column;border-top:1px solid rgba(203,213,225,0.9);";

    const makeBtn = (label, styleCss, onClick) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = label;
      btn.style.cssText =
        "width:100%;border:none;border-radius:0 0 16px 16px;padding:13px 12px;font-size:14px;font-weight:500;min-height:48px;" +
        "cursor:pointer;" +
        styleCss;
      btn.addEventListener("click", onClick);
      return btn;
    };

    const scope = this.condition.scope || "while";
    const isPhotos = kind === "photos";

    /** One affordance per condition (D bundle): narrow vs broad wording only — same styling always. */
    let singleLabel;
    if (isPhotos) {
      singleLabel =
        scope === "only"
          ? "Select photos and videos"
          : "Allow all";
    } else {
      singleLabel =
        scope === "while"
          ? "Allow only while using the app"
          : "Only this time";
    }

    /** Light “Only this time” style for every condition — outline + soft tint, not solid blue. */
    const UNIFIED_ACTION_STYLE =
      "background:linear-gradient(180deg,#f8fbff 0%,#eef4ff 100%);" +
      "color:#1d4ed8;font-weight:600;box-shadow:inset 0 1px 0 rgba(255,255,255,0.95);";

    const actionBtn = makeBtn(singleLabel, UNIFIED_ACTION_STYLE, async () => {
      document.body.removeChild(overlay);
      try {
        fetch(
          "http://127.0.0.1:7243/ingest/53d0209c-35d3-4927-ba1e-aa88e05e7ed6",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Debug-Session-Id": "a93ced",
            },
            body: JSON.stringify({
              sessionId: "a93ced",
              runId: "qualtrics-permission-debug",
              hypothesisId: "P4",
              location: "src/ui.js:showPermissionPrompt:single-option",
              message: "onAllow invoked",
              data: { kind, singleLabel, scope },
              timestamp: Date.now(),
            }),
          }
        ).catch(() => {});
        await onAllow();
      } catch (err) {
        console.error("Permission action failed", err);
      }
    });

    const actionableButtons = [actionBtn];
    const originalButtonLabels = new Map();
    actionableButtons.forEach((btn) => {
      originalButtonLabels.set(btn, btn.textContent || "");
      btn.disabled = true;
      btn.setAttribute("aria-disabled", "true");
      btn.style.opacity = "0.65";
      btn.style.cursor = "default";
    });

    const countdownSec = Math.ceil(this.permissionDecisionDelayMs / 1000);
    fetch(
      "http://127.0.0.1:7243/ingest/53d0209c-35d3-4927-ba1e-aa88e05e7ed6",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Debug-Session-Id": "a93ced",
        },
        body: JSON.stringify({
          sessionId: "a93ced",
          runId: "qualtrics-permission-debug",
          hypothesisId: "P2",
          location: "src/ui.js:showPermissionPrompt:countdown",
          message: "countdown computed",
          data: {
            countdownSec,
            permissionDecisionDelayMs: this.permissionDecisionDelayMs,
            singleLabel,
          },
          timestamp: Date.now(),
        }),
      }
    ).catch(() => {});
    actionableButtons.forEach((btn) => {
      const originalLabel = originalButtonLabels.get(btn) || "";
      btn.textContent = `${originalLabel} (in ${countdownSec}s)`;
    });
    let remainingSec = countdownSec;
    const countdownTimer = setInterval(() => {
      remainingSec -= 1;
      if (remainingSec > 0) {
        actionableButtons.forEach((btn) => {
          const originalLabel = originalButtonLabels.get(btn) || "";
          btn.textContent = `${originalLabel} (in ${remainingSec}s)`;
        });
      } else {
        clearInterval(countdownTimer);
      }
    }, 1000);

    setTimeout(() => {
      actionableButtons.forEach((btn) => {
        const originalLabel = originalButtonLabels.get(btn);
        if (originalLabel) btn.textContent = originalLabel;
        btn.disabled = false;
        btn.removeAttribute("aria-disabled");
        btn.style.opacity = "";
        btn.style.cursor = "pointer";
      });
    }, this.permissionDecisionDelayMs);

    buttonsCol.append(actionBtn);
    card.append(iconWrap, title, message, buttonsCol);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
  }

  // Bật timer kiểm tra điều kiện gating cho nút Continue
  startDemoGatingTimer() {
    if (this.demoTimerInterval) return;

    this.demoTimerInterval = setInterval(() => {
      this.updateDemoGatingState();
    }, 500);
  }

  // Kiểm tra và cập nhật trạng thái nút Continue
  updateDemoGatingState() {
    // If the participant already completed the demo, keep Continue unlocked
    // (e.g. after opening feedback and tapping Back).
    if (this.demoCompleted) {
      this.demoContinueEnabled = true;
      this.updateContinueButton(true, null);
      return;
    }

    const needPhotos = this.condition.photo === "library";
    const allRequiredGranted =
      this.cameraGranted &&
      this.micGranted &&
      (!needPhotos || this.photosGranted);

    const cta = document.getElementById("demoCtaText");

    if (!allRequiredGranted) {
      // Only start the countdown once ALL required permissions are granted.
      this.demoQualifyingStartTime = null;
      this.demoContinueEnabled = false;
      this.updateContinueButton(false, null);
      if (cta) cta.textContent = "";
      return;
    }

    // Permissions OK -> clear notice.
    if (cta) cta.textContent = "";

    // Start countdown at first engagement moment.
    if (!this.demoQualifyingStartTime) {
      this.demoQualifyingStartTime = performance.now();
    }

    const elapsed = performance.now() - this.demoQualifyingStartTime;
    const remainingMs = Math.max(0, this.demoMinMs - elapsed);
    const remainingSec = Math.ceil(remainingMs / 1000);
    const canContinue = remainingMs <= 0;

    this.demoContinueEnabled = canContinue;
    this.updateContinueButton(canContinue, remainingSec);
  }

  updateContinueButton(enabled, remainingSec = null) {
    const btn = document.getElementById("demoContinueButton");
    if (!btn) return;

    if (enabled) {
      btn.classList.remove("btn-disabled");
      btn.disabled = false;
      btn.textContent = "Continue";
    } else {
      btn.classList.add("btn-disabled");
      btn.disabled = true;
      if (typeof remainingSec === "number") {
        btn.textContent = `Continue (in ${remainingSec}s)`;
      } else {
        btn.textContent = "Continue";
      }
    }
  }

  // Cycle qua các style overlay (0–1: Spark Pop, Blow Balloon)
  cycleStyle() {
    const prevVariant = this.currentStyleVariant;
    this.currentStyleVariant = (this.currentStyleVariant + 1) % 2;
    this.hasChosenStyle = true;
    this.updateDemoGatingState();

    // No dedicated "Stop mic" button anymore:
    // stop microphone when leaving Blow Balloon mode (variant 1).
    if (prevVariant === 1 && this.currentStyleVariant !== 1 && this.micEnabled) {
      this.stopMicrophone();
    }

    const labels = ["", "Blow Balloon"];
    this.showStyleTag(labels[this.currentStyleVariant]);
    const micChip = document.getElementById("demoMicStatusChip");
    if (micChip) {
      micChip.style.display = this.currentStyleVariant === 1 ? "inline-flex" : "none";
      micChip.innerHTML = this.micEnabled
        ? '<span class="chip-dot"></span><span>Live mic active</span>'
        : '<span class="chip-dot chip-dot-off"></span><span>Mic off</span>';
    }

    // Khi chuyển sang Blow Balloon lần đầu, hiện prompt 3 lựa chọn cho microphone
    if (this.currentStyleVariant === 1 && !this.micEnabled) {
      if (!this._demoMicPrompted) {
        this._demoMicPrompted = true;
        this.showPermissionPrompt("microphone", () => this.startMicrophone());
      } else {
        // Permission likely already granted; start mic directly without re-prompting UI.
        this.startMicrophone().catch(() => {});
      }
    }
  }

  // Cập nhật tên feature hiện tại (chỉ một khung .filter-name từ template, không tạo khung mới)
  showStyleTag(label) {
    const frame = document.getElementById("demoFrame");
    if (!frame) return;

    const filterNameEl = frame.querySelector(".filter-name");
    if (filterNameEl) {
      filterNameEl.textContent = label;
      // If we intentionally hide the label (e.g., remove "Spark Pop"),
      // also hide the pill background so no empty rounded bar remains.
      filterNameEl.style.display = label ? "block" : "none";
      const oldTag = frame.querySelector(".demo-style-tag");
      if (oldTag) oldTag.remove();
      return;
    }

    // Fallback nếu không có template .filter-name: tạo tag tạm
    let tag = frame.querySelector(".demo-style-tag");
    if (!tag) {
      tag = document.createElement("div");
      tag.className = "demo-style-tag";
      tag.style.cssText =
        "position:absolute;top:14px;right:14px;z-index:30;background:rgba(255,255,255,0.92);padding:6px 12px;border-radius:999px;font-size:13px;font-weight:600;border:1px solid rgba(148,163,184,0.6);";
      tag.style.color = "#22223b";
      tag.style.fontWeight = "500";
      tag.style.boxShadow = "0 2px 10px rgba(0,0,0,0.10)";
      tag.style.pointerEvents = "none";
      frame.appendChild(tag);
    }
    tag.textContent = label;
  }

  // stopCamera: stop all tracks, reset UI về trạng thái chưa bật camera
  stopCamera() {
    try {
      if (this.cameraStream) {
        this.cameraStream.getTracks().forEach((t) => t.stop());
      }
    } catch (e) {}
    this.cameraStream = null;
    this.usingCamera = false;

    this.stopMicrophone();

    const video = document.getElementById("demoCameraVideo");
    if (video instanceof HTMLVideoElement) {
      try {
        video.pause();
      } catch (e) {}
      video.removeAttribute("src");
      video.srcObject = null;
      video.currentTime = 0;
      video.style.display = "none";
      video.style.filter = "none";
      video.style.transition = "filter 0.3s ease";
      video.style.transform = "none";
    }

    const overlay = document.getElementById("demoCameraOverlayCanvas");
    if (overlay) overlay.style.display = "none";

    // Dừng face tracking nếu đang chạy
    this.stopFaceTracking();

    const placeholder = document.getElementById("demoPlaceholder");
    if (placeholder) {
      placeholder.style.display = "flex";
      placeholder.style.filter = this.isFilterMuted
        ? "grayscale(0.15) saturate(0.8)"
        : "none";
    }

    const statusChip = document.getElementById("demoStatusChip");
    if (statusChip) {
      statusChip.innerHTML =
        '<span class="chip-dot chip-dot-off"></span><span>Camera off</span>';
    }

    const camBtn = document.getElementById("demoCameraButton");
    if (camBtn instanceof HTMLButtonElement) {
      camBtn.textContent = "Stop camera";
      camBtn.disabled = true;
    }
  }

  async toggleMicrophone() {
    if (this.micEnabled) {
      this.stopMicrophone();
      return;
    }
    await this.startMicrophone();
  }

  async startMicrophone() {
    // UI-only simulation: do not call device microphone APIs.
    this.micEnabled = true;
    this.micGranted = true;
    this.micLevel = 0.25;
    this.micBaseline = 0;
    this._baselineFrames = 0;

    if (this._fakeMicAnimation) cancelAnimationFrame(this._fakeMicAnimation);
    const tick = () => {
      if (!this.micEnabled) return;
      const t = performance.now() / 700;
      this.micLevel = 0.18 + (Math.sin(t) + 1) * 0.22 + Math.random() * 0.08;
      this._fakeMicAnimation = requestAnimationFrame(tick);
    };
    this._fakeMicAnimation = requestAnimationFrame(tick);

    const micBtn = document.getElementById("demoMicButton");
    if (micBtn instanceof HTMLButtonElement) {
      micBtn.textContent = "Stop mic";
      micBtn.disabled = false;
    }
    const micChip = document.getElementById("demoMicStatusChip");
    if (micChip)
      micChip.innerHTML = '<span class="chip-dot"></span><span>Mic simulated</span>';
  }

  stopMicrophone() {
    try {
      if (this.micStream) this.micStream.getTracks().forEach((t) => t.stop());
    } catch (e) {}
    this.micStream = null;
    this.micEnabled = false;
    if (this._fakeMicAnimation) {
      cancelAnimationFrame(this._fakeMicAnimation);
      this._fakeMicAnimation = null;
    }
    try {
      if (this.micScriptProcessor) {
        this.micScriptProcessor.disconnect();
        this.micScriptProcessor = null;
      }
      this.audioCtx?.close?.();
    } catch (e) {}
    this.audioCtx = null;
    this.micAnalyser = null;
    this.micDataFloat = null;
    const micBtn = document.getElementById("demoMicButton");
    if (micBtn instanceof HTMLButtonElement) {
      micBtn.textContent = "Stop mic";
      micBtn.disabled = true;
    }
    const micChip = document.getElementById("demoMicStatusChip");
    if (micChip) micChip.innerHTML = '<span class="chip-dot chip-dot-off"></span><span>Mic off</span>';
  }

  updateMicLevel() {
    if (!this.micEnabled) {
      this.micLevel = this.micLevel * 0.9;
      return this.micLevel;
    }
    if (this.micScriptProcessor) return this.micLevel;
    if (this.audioCtx?.state === "suspended") this.audioCtx.resume().catch(() => {});
    if (!this.micAnalyser || !this.micDataFloat) return this.micLevel;
    this.micAnalyser.getFloatTimeDomainData(this.micDataFloat);
    let sum = 0;
    for (let i = 0; i < this.micDataFloat.length; i++) sum += this.micDataFloat[i] * this.micDataFloat[i];
    const rms = Math.sqrt(sum / this.micDataFloat.length);
    if (this._baselineFrames < 10) {
      this.micBaseline = (this.micBaseline * this._baselineFrames + rms) / (this._baselineFrames + 1);
      this._baselineFrames++;
    } else if (rms < this.micBaseline + 0.02) {
      this.micBaseline = this.micBaseline * 0.98 + rms * 0.02;
    }
    let raw = Math.max(0, rms - (this.micBaseline + 0.005));
    if (raw < 0.002 && rms > 0.001) raw = rms * 0.5;
    const normalized = Math.min(1, raw / 0.06);
    let level = this.micLevel * 0.75 + normalized * 0.25;
    if (this.micLevel < 0.01 && rms > 0.002) level = Math.min(1, rms / 0.018);
    this.micLevel = level;
    return this.micLevel;
  }

  teardownCameraResumeListeners() {
    if (this._cameraVisHandler) {
      document.removeEventListener("visibilitychange", this._cameraVisHandler);
      window.removeEventListener("focus", this._cameraVisHandler);
      this._cameraVisHandler = null;
    }
    if (this._cameraPermStatusRef && this._cameraPermOnChange) {
      this._cameraPermStatusRef.removeEventListener("change", this._cameraPermOnChange);
      this._cameraPermStatusRef = null;
      this._cameraPermOnChange = null;
    }
    if (this._cameraDeviceChangeHandler && navigator.mediaDevices?.removeEventListener) {
      navigator.mediaDevices.removeEventListener("devicechange", this._cameraDeviceChangeHandler);
      this._cameraDeviceChangeHandler = null;
    }
    if (this._cameraDeviceDebounceTimer) {
      clearTimeout(this._cameraDeviceDebounceTimer);
      this._cameraDeviceDebounceTimer = 0;
    }
  }

  /**
   * When the participant fixes camera in browser / OS settings, retry getUserMedia without reload.
   * Uses Permissions API where supported, plus visibility/focus and devicechange fallbacks.
   */
  async setupCameraResumeListeners() {
    this.teardownCameraResumeListeners();

    this._cameraVisHandler = () => {
      if (document.hidden) return;
      if (this.currentScreen !== SCREENS.DEMO) return;
      if (!this._cameraResumePending) return;
      this.tryResumeCameraAfterSystemAllow().catch(() => {});
    };
    document.addEventListener("visibilitychange", this._cameraVisHandler);
    window.addEventListener("focus", this._cameraVisHandler);

    if (navigator.mediaDevices?.addEventListener) {
      this._cameraDeviceChangeHandler = () => {
        if (this.currentScreen !== SCREENS.DEMO) return;
        if (!this._cameraResumePending) return;
        if (this._cameraGumInProgress || this._cameraResumeInFlight) return;
        clearTimeout(this._cameraDeviceDebounceTimer);
        this._cameraDeviceDebounceTimer = setTimeout(() => {
          this._cameraDeviceDebounceTimer = 0;
          this.tryResumeCameraAfterSystemAllow().catch(() => {});
        }, 400);
      };
      navigator.mediaDevices.addEventListener("devicechange", this._cameraDeviceChangeHandler);
    }

    if (!navigator.permissions?.query) return;
    try {
      const status = await navigator.permissions.query({ name: "camera" });
      this._cameraPermStatusRef = status;
      this._cameraPermOnChange = () => {
        if (this.currentScreen !== SCREENS.DEMO) return;
        if (status.state === "granted") {
          this.tryResumeCameraAfterSystemAllow().catch(() => {});
        }
      };
      status.addEventListener("change", this._cameraPermOnChange);
    } catch (_) {
      // Safari / some contexts: camera is not a valid PermissionName
    }
  }

  async tryResumeCameraAfterSystemAllow() {
    if (this.currentScreen !== SCREENS.DEMO) return;
    if (this._cameraGumInProgress) return;
    if (this._cameraResumeInFlight) return;
    const tracks = this.cameraStream?.getTracks?.() || [];
    if (
      this.usingCamera &&
      tracks.length > 0 &&
      tracks.some((t) => t.readyState === "live")
    ) {
      return;
    }

    this._cameraResumeInFlight = true;
    try {
      const stream = await this.requestCameraStream();
      await this.enableCameraView(stream);
      this.logger.setCameraPermission("granted");
      this._cameraResumePending = false;
      this.updateDemoGatingState();
    } catch (e) {
      console.warn("Camera auto-resume failed:", e);
    } finally {
      this._cameraResumeInFlight = false;
    }
  }

  /** System camera API — used for the live AR preview only. */
  async requestCameraStream() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("Camera API unavailable in this browser or context.");
    }
    return navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "user" } },
      audio: false,
    });
  }

  // Yêu cầu camera: bật/tắt robust, request camera, xử lý lỗi.
  async requestCamera() {
    // Nếu đang bật camera -> toggle OFF
    if (this.usingCamera) {
      this.logger.addInteraction({ demo: true });
      this.stopCamera();
      this.updateDemoGatingState();
      return;
    }

    const camBtn = document.getElementById("demoCameraButton");
    const statusChip = document.getElementById("demoStatusChip");

    if (camBtn instanceof HTMLButtonElement) {
      camBtn.disabled = true;
      camBtn.textContent = "Starting camera…";
    }
    if (statusChip) {
      statusChip.innerHTML =
        '<span class="chip-dot"></span><span>Opening camera…</span>';
    }

    this._cameraGumInProgress = true;
    try {
      const stream = await this.requestCameraStream();
      await this.enableCameraView(stream);
      this.logger.setCameraPermission("granted");
      this._cameraResumePending = false;
      this.updateDemoGatingState();
      if (camBtn instanceof HTMLButtonElement) {
        camBtn.disabled = false;
        camBtn.textContent = "Stop camera";
      }
    } catch (err) {
      console.error("Camera failed:", err);
      const denied = isMediaPermissionUserDenial(err);
      this.logger.setCameraPermission(denied ? "denied" : "error");
      if (denied) this._cameraResumePending = true;
      this.showCameraUnavailable(
        denied ? CAMERA_DENIED_SHORT : "Could not open the camera. Try again in a moment.",
        denied ? "denied" : "error"
      );
      if (camBtn instanceof HTMLButtonElement) {
        camBtn.disabled = false;
        camBtn.textContent = "Stop camera";
      }
    } finally {
      this._cameraGumInProgress = false;
    }
  }

  // Kích hoạt camera view: chuẩn bị UI, bật luồng camera trực tiếp, set filter + AR overlay
  async enableCameraView(stream) {
    const video = document.getElementById("demoCameraVideo");
    const placeholder = document.getElementById("demoPlaceholder");
    const statusChip = document.getElementById("demoStatusChip");
    if (!(video instanceof HTMLVideoElement)) return;

    if (this.cameraStream && this.cameraStream !== stream) {
      try {
        this.cameraStream.getTracks().forEach((t) => t.stop());
      } catch (_) {}
    }
    this.cameraStream = stream;

    video.removeAttribute("src");
    video.loop = false;
    video.setAttribute("playsinline", "");
    video.muted = true;
    video.volume = 0;
    video.srcObject = stream;
    
    // Mirror video for selfie view
    video.style.transform = "scaleX(-1)";
    video.style.display = "none";

    // Apply filter
    video.style.filter = this.isFilterMuted
      ? "brightness(1.1) saturate(1.2) contrast(1.05) blur(0.4px) sepia(0.1)"
      : "none";
    video.style.transition = "filter 0.3s ease";

    if (placeholder) placeholder.style.display = "none";

    try {
      await video.play();
      video.style.display = "block";
    } catch (e) {
      console.warn("Camera preview playback failed:", e);
      try {
        stream.getTracks().forEach((t) => t.stop());
      } catch (_) {}
      this.cameraStream = null;
      video.srcObject = null;
      this.showCameraUnavailable(
        "Tap the video once or refresh the page, then allow the camera.",
        "playback"
      );
      video.style.display = "none";
      if (placeholder) placeholder.style.display = "flex";
      return;
    }

    this.hideDemoCameraAlert();
    this._cameraResumePending = false;

    this.hasUsedCamera = true;

    if (statusChip) {
      statusChip.innerHTML =
        '<span class="chip-dot"></span><span>Live camera active</span>';
    }

    this.usingCamera = true;

    // Camera access is considered granted when the stream is previewing successfully.
    this.cameraGranted = true;
    this.logger.markCameraPreviewReady();

    try {
      await this.ensureFaceTracking(video, document.getElementById("demoFrame"));
    } catch (e) {
      console.warn("Face tracking init failed:", e);
    }
  }

  hideDemoCameraAlert() {
    const alertEl = document.getElementById("demoCameraAlert");
    if (!alertEl) return;
    alertEl.hidden = true;
    alertEl.classList.remove("is-visible");
    alertEl.removeAttribute("role");
    alertEl.replaceChildren();
  }

  // Thông báo nếu camera bị lỗi hoặc không thể dùng
  showCameraUnavailable(message, variant = "error") {
    const statusChip = document.getElementById("demoStatusChip");
    if (statusChip) {
      const label =
        variant === "denied"
          ? "Camera blocked"
          : variant === "playback"
            ? "Preview issue"
            : "Camera unavailable";
      statusChip.innerHTML = `<span class="chip-dot chip-dot-warn"></span><span>${label}</span>`;
    }
    const cta = document.getElementById("demoCtaText");
    if (cta) cta.textContent = "";

    const alertEl = document.getElementById("demoCameraAlert");
    if (!alertEl) {
      if (cta) cta.textContent = message;
      return;
    }

    const titleText =
      variant === "denied"
        ? "Turn on camera access"
        : variant === "playback"
          ? "Preview did not start"
          : "Camera problem";

    const tone =
      variant === "denied" ? "demo-camera-alert--warning" : "demo-camera-alert--info";
    alertEl.className = `demo-camera-alert is-visible ${tone}`;
    alertEl.hidden = false;
    alertEl.setAttribute("role", "alert");

    const iconWrap = document.createElement("div");
    iconWrap.className = "demo-camera-alert__icon";
    iconWrap.setAttribute("aria-hidden", "true");
    const svg =
      variant === "denied"
        ? '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M12 9v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M12 17h.01" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/><path d="M10.3 3.3 2.6 17a1.7 1.7 0 0 0 1.5 2.5h16.8a1.7 1.7 0 0 0 1.5-2.5L13.7 3.3a1.7 1.7 0 0 0-3.4 0Z" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round"/></svg>'
        : '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.75"/><path d="M12 8v5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M12 16h.01" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>';
    iconWrap.innerHTML = svg;

    const body = document.createElement("div");
    body.className = "demo-camera-alert__body";
    const title = document.createElement("div");
    title.className = "demo-camera-alert__title";
    title.textContent = titleText;
    const p = document.createElement("p");
    p.className = "demo-camera-alert__text";
    p.textContent = message;
    body.append(title, p);
    alertEl.replaceChildren(iconWrap, body);
  }

  // === FACE TRACKING WITH MEDIAPIPE ===

  async ensureFaceTracking(videoEl, frameEl) {
    if (!videoEl || !frameEl) {
      console.error("❌ Missing video or frame element");
      return;
    }

    console.log("🎯 Starting face tracking initialization...");

    // Initialize Face Landmarker if not done
    if (!this.faceLandmarker) {
      console.log("📦 Loading MediaPipe Face Landmarker...");
      await this.initFaceLandmarker();
    }

    if (!this.faceLandmarker) {
      console.error("❌ Face Landmarker not available - overlay will not work");
      return;
    }

    console.log("✅ Face Landmarker ready");

    // Setup canvas overlay
    let canvas = document.getElementById("demoCameraOverlayCanvas");
    if (!canvas) {
      console.log("🎨 Creating new canvas overlay");
      canvas = document.createElement("canvas");
      canvas.id = "demoCameraOverlayCanvas";
      canvas.style.cssText =
        "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:5;";
      frameEl.appendChild(canvas);
    }

    this.faceTrackingCanvas = canvas;
    this.faceTrackingCtx = canvas.getContext("2d");

    // CRITICAL: Wait for video metadata to be loaded
    if (videoEl.videoWidth === 0 || videoEl.videoHeight === 0) {
      console.log("⏳ Waiting for video metadata...");
      await new Promise((resolve) => {
        if (videoEl.readyState >= 2) {
          resolve();
        } else {
          videoEl.addEventListener("loadedmetadata", resolve, { once: true });
        }
      });
    }

    console.log("📹 Video dimensions:", videoEl.videoWidth, "x", videoEl.videoHeight);

    // Match canvas size to video display size
    const updateCanvasSize = () => {
      const rect = frameEl.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        canvas.width = rect.width;
        canvas.height = rect.height;
        console.log("📐 Canvas sized:", canvas.width, "x", canvas.height);
      } else {
        console.warn("⚠️ Frame has zero size, using fallback");
        canvas.width = 640;
        canvas.height = 480;
      }
    };
    updateCanvasSize();
    window.addEventListener("resize", updateCanvasSize);

    canvas.style.display = "block";
    console.log("👁️ Canvas overlay is now visible");

    // VISUAL TEST: Draw a test rectangle to confirm canvas is working
    const testCtx = canvas.getContext("2d");
    if (testCtx) {
      testCtx.fillStyle = "rgba(255, 0, 0, 0.3)";
      testCtx.fillRect(10, 10, 100, 100);
      testCtx.fillStyle = "white";
      testCtx.font = "14px Arial";
      testCtx.fillText("Canvas Active", 20, 50);
      console.log("🎨 Test rectangle drawn on canvas");
      
      // Clear after 2 seconds
      setTimeout(() => {
        testCtx.clearRect(0, 0, canvas.width, canvas.height);
      }, 2000);
    }

    // Start tracking loop
    this.startFaceTrackingLoop(videoEl, canvas);
    console.log("🔄 Face tracking loop started");
  }

  async initFaceLandmarker() {
    if (this._faceLibPromise) return this._faceLibPromise;

    this._faceLibPromise = (async () => {
      try {
        console.log("📥 Importing MediaPipe from CDN...");
        // FIXED: Use correct import path - try multiple approaches
        let FaceLandmarker, FilesetResolver;
        
        // Wait for pre-load if in progress
        if (window.__visionReady === false) {
          // Wait for pre-load to complete or fail
          await new Promise((resolve) => {
            const checkReady = setInterval(() => {
              if (window.__visionReady !== false) {
                clearInterval(checkReady);
                resolve();
              }
            }, 50);
            // Timeout after 5 seconds
            setTimeout(() => {
              clearInterval(checkReady);
              resolve();
            }, 5000);
          });
        }

        // Check if already loaded via script tag
        if (window.FaceLandmarker && window.FilesetResolver) {
          FaceLandmarker = window.FaceLandmarker;
          FilesetResolver = window.FilesetResolver;
        } else {
          // Try dynamic import - use the correct CDN path
          try {
            // Try the standard bundle path - use unpkg as alternative
            let visionModule;
            try {
              visionModule = await import(
                "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/vision_bundle.js"
              );
            } catch (e1) {
              // Try unpkg as fallback
              try {
                visionModule = await import(
                  "https://unpkg.com/@mediapipe/tasks-vision@0.10.0/vision_bundle.js"
                );
              } catch (e2) {
                // Try without .js extension
                visionModule = await import(
                  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0"
                );
              }
            }
            FaceLandmarker = visionModule.FaceLandmarker || visionModule.default?.FaceLandmarker;
            FilesetResolver = visionModule.FilesetResolver || visionModule.default?.FilesetResolver;
          } catch (importError1) {
            // Fallback: try loading via script tag
            await this._loadMediaPipeViaScript();
            if (window.FaceLandmarker && window.FilesetResolver) {
              FaceLandmarker = window.FaceLandmarker;
              FilesetResolver = window.FilesetResolver;
            } else {
              throw new Error("Could not load MediaPipe: vision_bundle.js not found and script tag approach failed");
            }
          }
        }

        if (!FaceLandmarker || !FilesetResolver) {
          throw new Error("FaceLandmarker or FilesetResolver not available");
        }

        // Try CDN WASM first, fallback to local
        let vision;
        try {
          console.log("📥 Loading WASM from CDN...");
          vision = await FilesetResolver.forVisionTasks(
            "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm"
          );
          console.log("✅ CDN WASM loaded");
        } catch (wasmError) {
          console.warn("⚠️ CDN WASM failed, trying local:", wasmError);
          vision = await FilesetResolver.forVisionTasks(
            `${window.location.origin}/wasm`
          );
          console.log("✅ Local WASM loaded");
        }

        this.faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
            delegate: "GPU",
          },
          runningMode: "VIDEO",
          numFaces: 1,
          minFaceDetectionConfidence: 0.4,
          minFacePresenceConfidence: 0.4,
          minTrackingConfidence: 0.4,
          outputFaceBlendshapes: false,
          outputFacialTransformationMatrixes: false,
        });

        console.log("✅ Face Landmarker initialized successfully");
      } catch (e) {
        console.error("❌ Failed to init Face Landmarker:", e);
        console.warn("⚠️ Face tracking will not be available");
        this.faceLandmarker = null;
      }
    })();

    return this._faceLibPromise;
  }

  // Helper to load MediaPipe via script tag as fallback
  _loadMediaPipeViaScript() {
    return new Promise((resolve, reject) => {
      // Check if already loaded
      if (window.FaceLandmarker && window.FilesetResolver) {
        resolve();
        return;
      }

      // Check if script already exists
      const existingScript = document.querySelector('script[src*="vision_bundle"]');
      if (existingScript) {
        // Wait for it to load
        existingScript.addEventListener('load', resolve);
        existingScript.addEventListener('error', reject);
        return;
      }

      // Create and load script
      const script = document.createElement('script');
      script.type = 'module';
      script.src = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/vision_bundle.js';
      script.onload = () => {
        // Wait a bit for globals to be set
        setTimeout(() => {
          if (window.FaceLandmarker && window.FilesetResolver) {
            resolve();
          } else {
            reject(new Error("MediaPipe loaded but globals not available"));
          }
        }, 100);
      };
      script.onerror = () => reject(new Error("Failed to load vision_bundle.js script"));
      document.head.appendChild(script);
    });
  }

  // Cover transform: video dùng object-fit: cover nên cần scale + offset crop để map đúng
  _getCoverTransform(videoW, videoH, canvasW, canvasH) {
    const scale = Math.max(canvasW / videoW, canvasH / videoH);
    const drawW = videoW * scale;
    const drawH = videoH * scale;
    const offsetX = (drawW - canvasW) / 2;
    const offsetY = (drawH - canvasH) / 2;
    return { scale, drawW, drawH, offsetX, offsetY };
  }

  _mapNormalizedToCanvasCover(p, videoW, videoH, canvasW, canvasH, mirror = true) {
    const { scale, offsetX, offsetY } = this._getCoverTransform(videoW, videoH, canvasW, canvasH);
    const x = (p.x * videoW) * scale - offsetX;
    const y = (p.y * videoH) * scale - offsetY;
    return mirror ? { x: canvasW - x, y } : { x, y };
  }

  startFaceTrackingLoop(video, canvas) {
    if (this.faceTrackingLoopHandle) {
      cancelAnimationFrame(this.faceTrackingLoopHandle);
    }

    const ctx = this.faceTrackingCtx;
    if (!ctx) {
      console.error("❌ No canvas context available");
      return;
    }

    console.log("🎬 Face tracking loop starting with video:", video.videoWidth, "x", video.videoHeight);

    // Tracking state
    let lastBox = null;
    let lastFacePoints = null;
    let noDetectionCount = 0;
    let frameCount = 0;
    
    // Smoothing nhẹ hơn: nhạy hơn, giống social app (0.25–0.35 / 0.30–0.45)
    const smoothingFactor = 0.3;
    const landmarkSmoothingFactor = 0.38;
    // FIXED: Reduce max frames to hold overlay when face lost
    const maxNoDetectionFrames = 10; // Reduced from 20-40

    const loop = () => {
      this.faceTrackingLoopHandle = requestAnimationFrame(loop);

      if (!video.videoWidth || !video.videoHeight || video.paused) return;

      frameCount++;

      this.updateMicLevel();

      // Clear previous frame
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      try {
        const nowMs = performance.now();
        const result = this.faceLandmarker.detectForVideo(video, nowMs);

        const landmarks = result?.faceLandmarks?.[0];
        if (landmarks && landmarks.length) {
          // Log first successful detection
          if (frameCount === 1) {
            console.log("🎉 First face detected! Landmarks:", landmarks.length);
          }
          // Calculate bounding box from landmarks (normalized 0-1)
          let minX = 1, maxX = 0, minY = 1, maxY = 0;
          
          for (const p of landmarks) {
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.y > maxY) maxY = p.y;
          }

          // Map bbox theo cover (video object-fit: cover) — scale + offset crop
          const canvasW = canvas.width;
          const canvasH = canvas.height;
          const vW = video.videoWidth;
          const vH = video.videoHeight;
          const pad = 0.08;
          const p1 = { x: Math.max(0, minX - pad), y: Math.max(0, minY - pad) };
          const p2 = { x: Math.min(1, maxX + pad), y: Math.min(1, maxY + pad) };
          const t1 = this._mapNormalizedToCanvasCover(p1, vW, vH, canvasW, canvasH, false);
          const t2 = this._mapNormalizedToCanvasCover(p2, vW, vH, canvasW, canvasH, false);
          const rawX = Math.min(t1.x, t2.x);
          const rawY = Math.min(t1.y, t2.y);
          const rawW = Math.abs(t2.x - t1.x);
          const rawH = Math.abs(t2.y - t1.y);

          // Apply smoothing
          let box;
          if (lastBox) {
            box = {
              x: lastBox.x * smoothingFactor + rawX * (1 - smoothingFactor),
              y: lastBox.y * smoothingFactor + rawY * (1 - smoothingFactor),
              w: lastBox.w * smoothingFactor + rawW * (1 - smoothingFactor),
              h: lastBox.h * smoothingFactor + rawH * (1 - smoothingFactor),
            };
          } else {
            box = { x: rawX, y: rawY, w: rawW, h: rawH };
            console.log("📦 Initial box:", box);
          }
          lastBox = box;
          noDetectionCount = 0;

          // Face feature points từ landmark thật (MediaPipe 468), fallback từ box
          const boxCenterX = (minX + maxX) / 2;
          const boxCenterY = (minY + maxY) / 2;
          const boxTop = minY;
          const boxHeight = maxY - minY;
          const boxWidth = maxX - minX;
          const fallbackCenter = { x: boxCenterX, y: boxCenterY };
          const pick = (i, fallback) =>
            landmarks[i] != null
              ? { x: landmarks[i].x, y: landmarks[i].y }
              : fallback;

          const rawForeheadTop = pick(10, { x: boxCenterX, y: boxTop + boxHeight * 0.08 });
          const rawLeftEye = pick(33, { x: boxCenterX - boxWidth * 0.18, y: boxTop + boxHeight * 0.42 });
          const rawRightEye = pick(263, { x: boxCenterX + boxWidth * 0.18, y: boxTop + boxHeight * 0.42 });
          const rawLeftCheek = pick(234, { x: boxCenterX - boxWidth * 0.25, y: boxTop + boxHeight * 0.6 });
          const rawRightCheek = pick(454, { x: boxCenterX + boxWidth * 0.25, y: boxTop + boxHeight * 0.6 });
          const rawNoseTip = pick(1, fallbackCenter);
          const rawMouth = pick(13, { x: boxCenterX, y: boxTop + boxHeight * 0.68 });

          let foreheadTop, leftEye, rightEye, leftCheek, rightCheek, noseTip, mouth;
          if (lastFacePoints) {
            const smooth = (last, raw, factor) => ({
              x: last.x * factor + raw.x * (1 - factor),
              y: last.y * factor + raw.y * (1 - factor),
            });
            foreheadTop = smooth(lastFacePoints.foreheadTop, rawForeheadTop, landmarkSmoothingFactor);
            leftEye = smooth(lastFacePoints.leftEye, rawLeftEye, landmarkSmoothingFactor);
            rightEye = smooth(lastFacePoints.rightEye, rawRightEye, landmarkSmoothingFactor);
            leftCheek = smooth(lastFacePoints.leftCheek, rawLeftCheek, landmarkSmoothingFactor);
            rightCheek = smooth(lastFacePoints.rightCheek, rawRightCheek, landmarkSmoothingFactor);
            noseTip = smooth(lastFacePoints.noseTip || rawNoseTip, rawNoseTip, landmarkSmoothingFactor);
            mouth = smooth(lastFacePoints.mouth || rawMouth, rawMouth, landmarkSmoothingFactor);
          } else {
            foreheadTop = rawForeheadTop;
            leftEye = rawLeftEye;
            rightEye = rawRightEye;
            leftCheek = rawLeftCheek;
            rightCheek = rawRightCheek;
            noseTip = rawNoseTip;
            mouth = rawMouth;
          }
          lastFacePoints = { foreheadTop, leftEye, rightEye, leftCheek, rightCheek, noseTip, mouth };
          const facePoints = { foreheadTop, leftEye, rightEye, leftCheek, rightCheek, noseTip, mouth };

          // Draw overlay
          this._drawFaceOverlayForStyle(ctx, canvas, box, landmarks, facePoints, video);
        } else {
          noDetectionCount++;
          // Keep last overlay for a few frames to reduce flicker
          if (lastBox && lastFacePoints && noDetectionCount < maxNoDetectionFrames) {
            const alpha = 1 - (noDetectionCount / maxNoDetectionFrames);
            ctx.globalAlpha = alpha;
            this._drawFaceOverlayForStyle(ctx, canvas, lastBox, null, lastFacePoints, video);
            ctx.globalAlpha = 1;
          } else {
            lastBox = null;
            lastFacePoints = null;
            noDetectionCount = 0;
          }
        }
      } catch (e) {
        console.error("❌ Face tracking error:", e);
      }
    };

    this.faceTrackingLoopHandle = requestAnimationFrame(loop);
  }

  stopFaceTracking() {
    if (this.faceTrackingLoopHandle) {
      cancelAnimationFrame(this.faceTrackingLoopHandle);
      this.faceTrackingLoopHandle = null;
    }
    if (this.faceTrackingCtx && this.faceTrackingCanvas) {
      this.faceTrackingCtx.clearRect(
        0,
        0,
        this.faceTrackingCanvas.width,
        this.faceTrackingCanvas.height
      );
    }
  }

  _drawFaceOverlayForStyle(ctx, canvas, box, landmarks, facePoints = null, video = null) {
    const { x, y, w, h } = box;
    ctx.save();
    
    // Map normalized point to canvas: cover transform + mirror (video selfie đang lật)
    const canvasW = canvas.width;
    const canvasH = canvas.height;
    const vW = video?.videoWidth || 720;
    const vH = video?.videoHeight || 1280;
    const mapPoint = (p, videoEl) => {
      if (!p) return null;
      return this._mapNormalizedToCanvasCover(p, vW, vH, canvasW, canvasH, true);
    };

    // FIXED: Box center calculation after mirroring
    const mirroredX = canvas.width - x - w;
    const cx = mirroredX + w / 2;
    const top = y;

    // Remap display order to existing drawing cases:
    // currentStyleVariant:
    //   0 -> Spark Pop (old case 2)
    //   1 -> Blow Balloon (old case 1)
    const drawStyleVariant =
      this.currentStyleVariant === 0 ? 2 : 1;

    switch (drawStyleVariant) {
      // Old Style 0 (cat ears) is no longer reachable after remap.
      case 0: {
        const earW = w * 0.22;
        const earH = h * 0.25;
        
        let leftEarX, rightEarX, earY;
        
        if (facePoints && facePoints.foreheadTop) {
          const forehead = mapPoint(facePoints.foreheadTop, video);
          if (forehead) {
            earY = forehead.y - earH * 0.4;
            
            // Calculate ear distance based on eye positions
            let eyeDistance = w * 0.28;
            if (facePoints.leftEye && facePoints.rightEye) {
              const leftEyePt = mapPoint(facePoints.leftEye, video);
              const rightEyePt = mapPoint(facePoints.rightEye, video);
              if (leftEyePt && rightEyePt) {
                eyeDistance = Math.abs(rightEyePt.x - leftEyePt.x) * 0.5;
              }
            }
            
            // FIXED: After mirroring, positions are correct
            leftEarX = forehead.x - eyeDistance;
            rightEarX = forehead.x + eyeDistance;
          } else {
            // Fallback
            const earYOffset = earH * 0.6;
            leftEarX = cx - w * 0.28;
            rightEarX = cx + w * 0.28;
            earY = top - earYOffset;
          }
        } else {
          // Fallback
          const earYOffset = earH * 0.6;
          leftEarX = cx - w * 0.28;
          rightEarX = cx + w * 0.28;
          earY = top - earYOffset;
        }

        // Draw ears
        const drawEar = (ex) => {
          const grad = ctx.createLinearGradient(ex, earY - earH, ex, earY);
          grad.addColorStop(0, "#f97316");
          grad.addColorStop(1, "#ec4899");
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.moveTo(ex, earY - earH);
          ctx.lineTo(ex - earW / 2, earY);
          ctx.lineTo(ex + earW / 2, earY);
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = "rgba(248,250,252,0.9)";
          ctx.lineWidth = 2;
          ctx.stroke();
        };

        ctx.shadowColor = "rgba(249,115,22,0.8)";
        ctx.shadowBlur = 18;
        drawEar(leftEarX);
        drawEar(rightEarX);

        // Blush
        ctx.shadowBlur = 0;
        ctx.fillStyle = "rgba(248,113,113,0.55)";
        const cheekR = h * 0.055;
        
        if (facePoints && facePoints.leftCheek && facePoints.rightCheek) {
          const leftCheekPt = mapPoint(facePoints.leftCheek, video);
          const rightCheekPt = mapPoint(facePoints.rightCheek, video);
          
          if (leftCheekPt && rightCheekPt) {
            ctx.beginPath();
            ctx.ellipse(leftCheekPt.x, leftCheekPt.y, cheekR * 1.4, cheekR, 0, 0, 2 * Math.PI);
            ctx.fill();
            ctx.beginPath();
            ctx.ellipse(rightCheekPt.x, rightCheekPt.y, cheekR * 1.4, cheekR, 0, 0, 2 * Math.PI);
            ctx.fill();
          } else {
            // Fallback
            const cheekY = y + h * 0.65;
            const cheekOffsetX = w * 0.22;
            [cx - cheekOffsetX, cx + cheekOffsetX].forEach((px) => {
              ctx.beginPath();
              ctx.ellipse(px, cheekY, cheekR * 1.4, cheekR, 0, 0, 2 * Math.PI);
              ctx.fill();
            });
          }
        } else {
          // Fallback
          const cheekY = y + h * 0.65;
          const cheekOffsetX = w * 0.22;
          [cx - cheekOffsetX, cx + cheekOffsetX].forEach((px) => {
            ctx.beginPath();
            ctx.ellipse(px, cheekY, cheekR * 1.4, cheekR, 0, 0, 2 * Math.PI);
            ctx.fill();
          });
        }

        break;
      }

      // Style 1: Blow Balloon (mic volume)
      case 1: {
        const blow = this.updateMicLevel();

        if (!this.balloon.popped) {
          const TH = 0.08;
          const inflate = blow > TH ? (blow * 0.055) : -0.002;
          this.balloon.value = Math.max(0, Math.min(1, this.balloon.value + inflate));
          if (this.balloon.value >= 1) {
            this.balloon.popped = true;
            this.balloon.popTimer = 18;
          }
        } else {
          this.balloon.popTimer -= 1;
          if (this.balloon.popTimer <= 0) {
            this.balloon.popped = false;
            this.balloon.value = 0.15;
          }
        }

        let mouthPt = null;
        if (facePoints?.mouth) mouthPt = mapPoint(facePoints.mouth, video);
        if (!mouthPt && facePoints?.noseTip) {
          const nose = mapPoint(facePoints.noseTip, video);
          mouthPt = nose ? { x: nose.x, y: nose.y + h * 0.18 } : null;
        }
        if (!mouthPt) mouthPt = { x: cx, y: y + h * 0.65 };

        const baseR = h * 0.06;
        const maxR = h * 0.24;
        const rBalloon = baseR + (maxR - baseR) * this.balloon.value;

        ctx.strokeStyle = "rgba(15,23,42,0.35)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(mouthPt.x, mouthPt.y + rBalloon * 0.9);
        ctx.lineTo(mouthPt.x, mouthPt.y + rBalloon * 2.2);
        ctx.stroke();

        if (!this.balloon.popped) {
          ctx.fillStyle = "rgba(236,72,153,0.70)";
          ctx.beginPath();
          ctx.ellipse(mouthPt.x, mouthPt.y, rBalloon * 0.85, rBalloon, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "rgba(255,255,255,0.35)";
          ctx.beginPath();
          ctx.ellipse(mouthPt.x - rBalloon * 0.25, mouthPt.y - rBalloon * 0.25, rBalloon * 0.18, rBalloon * 0.28, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "rgba(15,23,42,0.65)";
          ctx.font = "600 12px system-ui";
          ctx.textAlign = "center";
          const balloonHint = this.micEnabled ? "Blow to inflate!" : "Enable mic to play";
          ctx.fillText(balloonHint, mouthPt.x, mouthPt.y + rBalloon + 18);
        } else {
          ctx.strokeStyle = "rgba(236,72,153,0.85)";
          ctx.lineWidth = 3;
          const popR = rBalloon * 1.2;
          ctx.beginPath();
          ctx.arc(mouthPt.x, mouthPt.y, popR, 0, Math.PI * 2);
          ctx.stroke();
        }

        break;
      }

      // Style 2: Spark Pop (open mouth → sparkles burst)
      case 2: {
        const clamp01 = (v) => Math.max(0, Math.min(1, v));
        const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
        const lmPt = (i) => (landmarks && landmarks[i] ? mapPoint(landmarks[i], video) : null);

        const lEye = lmPt(33);
        const rEye = lmPt(263);
        const upperLip = lmPt(13);
        const lowerLip = lmPt(14);

        const leftCheekPt = facePoints?.leftCheek ? mapPoint(facePoints.leftCheek, video) : null;
        const rightCheekPt = facePoints?.rightCheek ? mapPoint(facePoints.rightCheek, video) : null;
        const mouthCenter = facePoints?.mouth ? mapPoint(facePoints.mouth, video) : null;

        const cheekR = h * 0.08;
        const drawCheekGlow = (cxCheek, cyCheek) => {
          const grad = ctx.createRadialGradient(cxCheek, cyCheek, 0, cxCheek, cyCheek, cheekR);
          grad.addColorStop(0, "rgba(255,182,193,0.5)");
          grad.addColorStop(0.5, "rgba(236,72,153,0.25)");
          grad.addColorStop(1, "rgba(248,113,113,0)");
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.ellipse(cxCheek, cyCheek, cheekR * 1.2, cheekR, 0, 0, Math.PI * 2);
          ctx.fill();
        };
        const drawSmallSparkle = (sx, sy, size, rot) => {
          ctx.save();
          ctx.translate(sx, sy);
          ctx.rotate(rot);
          ctx.beginPath();
          ctx.moveTo(0, -size);
          ctx.lineTo(size * 0.35, -size * 0.35);
          ctx.lineTo(size, 0);
          ctx.lineTo(size * 0.35, size * 0.35);
          ctx.lineTo(0, size);
          ctx.lineTo(-size * 0.35, size * 0.35);
          ctx.lineTo(-size, 0);
          ctx.lineTo(-size * 0.35, -size * 0.35);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        };
        const cheekSparkleR = w * 0.018;
        const rotT = performance.now() * 0.001;
        if (leftCheekPt && rightCheekPt) {
          drawCheekGlow(leftCheekPt.x, leftCheekPt.y);
          drawCheekGlow(rightCheekPt.x, rightCheekPt.y);
          ctx.fillStyle = "rgba(236,72,153,0.75)";
          ctx.globalAlpha = 0.9;
          drawSmallSparkle(leftCheekPt.x, leftCheekPt.y, cheekSparkleR, rotT);
          drawSmallSparkle(rightCheekPt.x, rightCheekPt.y, cheekSparkleR, rotT * 1.1);
          ctx.globalAlpha = 1;
        } else {
          const cheekY = y + h * 0.65;
          const cheekOffsetX = w * 0.22;
          [cx - cheekOffsetX, cx + cheekOffsetX].forEach((px) => {
            drawCheekGlow(px, cheekY);
            ctx.fillStyle = "rgba(236,72,153,0.75)";
            ctx.globalAlpha = 0.9;
            drawSmallSparkle(px, cheekY, cheekSparkleR, rotT);
            ctx.globalAlpha = 1;
          });
        }

        let mouthNorm = 0;
        if (upperLip && lowerLip) {
          const gap = dist(upperLip, lowerLip);
          const eyeDist = lEye && rEye ? dist(lEye, rEye) : w * 0.25;
          mouthNorm = clamp01((gap / eyeDist - 0.06) / 0.18);
        }

        const base = mouthCenter || { x: cx, y: y + h * 0.62 };
        const speed = 1.8 + mouthNorm * 2;
        const maxLife = 55;

        if (mouthNorm > 0.1 && this.dreamyBlushParticles.length < 100) {
          const n = Math.floor(2 + mouthNorm * 4);
          for (let i = 0; i < n; i++) {
            const angle = Math.random() * Math.PI * 2;
            this.dreamyBlushParticles.push({
              x: base.x,
              y: base.y,
              vx: Math.cos(angle) * speed,
              vy: Math.sin(angle) * speed - 0.5,
              life: 0,
              maxLife,
              size: w * (0.012 + Math.random() * 0.015),
            });
          }
        }

        const drawSparkle = (sx, sy, size, rot) => {
          ctx.save();
          ctx.translate(sx, sy);
          ctx.rotate(rot);
          ctx.beginPath();
          ctx.moveTo(0, -size);
          ctx.lineTo(size * 0.35, -size * 0.35);
          ctx.lineTo(size, 0);
          ctx.lineTo(size * 0.35, size * 0.35);
          ctx.lineTo(0, size);
          ctx.lineTo(-size * 0.35, size * 0.35);
          ctx.lineTo(-size, 0);
          ctx.lineTo(-size * 0.35, -size * 0.35);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        };

        const kept = [];
        const t = performance.now() / 1000;
        ctx.fillStyle = "rgba(236,72,153,0.9)";
        for (const p of this.dreamyBlushParticles) {
          p.x += p.vx;
          p.y += p.vy;
          p.life += 1;
          if (p.life > p.maxLife) continue;
          const fade = 1 - p.life / p.maxLife;
          const s = p.size * fade;
          if (s < 0.5) continue;
          ctx.save();
          ctx.globalAlpha = fade;
          drawSparkle(p.x, p.y, s, t + p.life * 0.1);
          ctx.restore();
          kept.push(p);
        }
        this.dreamyBlushParticles = kept;

        if (mouthNorm < 0.12) {
          ctx.save();
          ctx.globalAlpha = 0.7;
          ctx.fillStyle = "rgba(17,24,39,0.6)";
          ctx.textAlign = "center";
          ctx.font = "600 12px system-ui, -apple-system, Segoe UI, Roboto";
          ctx.fillText("Open your mouth", base.x, base.y + h * 0.18);
          ctx.restore();
        }

        break;
      }

    }

    ctx.restore();
  }
}
