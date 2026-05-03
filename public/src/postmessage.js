// postMessage helper with basic origin safety.

let parentOrigin = "*";

export function initPostMessageOrigin() {
  try {
    if (document.referrer) {
      const url = new URL(document.referrer);
      parentOrigin = url.origin;
    }
  } catch {
    parentOrigin = "*";
  }
}

export function sendMessage(message) {
  if (typeof window === "undefined" || !window.parent) return;
  try {
    window.parent.postMessage(message, parentOrigin);
  } catch {
    window.parent.postMessage(message, "*");
  }
}

export function sendCompletionMessage(summary) {
  sendMessage(summary);
}
