import { clearAllExtensionData, getOpenAIKeyForRequest, readPublicSettings, removeOpenAIKey, saveOpenAIKey, saveProviderPreferences } from "./settingsStorage";
import { isProviderReady } from "../shared/providers/catalog";
import { openAIProvider } from "../shared/providers/openai";
import { ProviderError } from "../shared/providers/provider";
import type { RuntimeReply, RuntimeRequest, RuntimeResponseMap } from "../shared/messages";
import type { ProviderId, QuestionDraft, QuestionOption, QuestionSource } from "../shared/types";
import { validateQuestionDraft } from "../shared/validateQuestion";

const extensionOrigin = `chrome-extension://${chrome.runtime.id}`;
const storageAccessReady = chrome.storage.local
  .setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })
  .then(() => true)
  .catch(() => false);

chrome.runtime.onInstalled.addListener(() => {
  void chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }).catch(() => undefined);
});

function isTrustedExtensionPage(sender: chrome.runtime.MessageSender): boolean {
  if (sender.id !== chrome.runtime.id || typeof sender.url !== "string") return false;
  try {
    const url = new URL(sender.url);
    return (
      url.origin === extensionOrigin &&
      ["/index.html", "/workspace.html", "/options.html"].includes(url.pathname)
    );
  } catch {
    return false;
  }
}

function isQuestionOption(value: unknown): value is QuestionOption {
  if (typeof value !== "object" || value === null) return false;
  const option = value as Partial<QuestionOption>;
  return typeof option.id === "string" && typeof option.label === "string" && typeof option.text === "string";
}

function isQuestionDraft(value: unknown): value is QuestionDraft {
  if (typeof value !== "object" || value === null) return false;
  const draft = value as Partial<QuestionDraft>;
  const validSource: QuestionSource[] = ["manual", "selected-text", "image"];
  return (
    typeof draft.question === "string" &&
    Array.isArray(draft.options) &&
    draft.options.every(isQuestionOption) &&
    typeof draft.source === "string" &&
    validSource.includes(draft.source as QuestionSource) &&
    (draft.imageDataUrl === undefined || typeof draft.imageDataUrl === "string") &&
    (draft.imageName === undefined || typeof draft.imageName === "string")
  );
}

function isRuntimeRequest(value: unknown): value is RuntimeRequest {
  if (typeof value !== "object" || value === null || !("type" in value)) return false;
  const request = value as Record<string, unknown>;
  switch (request.type) {
    case "GET_PUBLIC_SETTINGS":
    case "REMOVE_API_KEY":
    case "DELETE_ALL_DATA":
      return true;
    case "SAVE_PROVIDER_SETTINGS":
      return (
        typeof request.provider === "string" &&
        isProviderReady(request.provider as ProviderId) &&
        typeof request.model === "string"
      );
    case "SAVE_API_KEY":
      return typeof request.apiKey === "string";
    case "GENERATE_ANSWER":
      return "draft" in request && isQuestionDraft(request.draft) && validateQuestionDraft(request.draft) === null;
    default:
      return false;
  }
}

function failure<T>(code: string, message: string, retryable = false): RuntimeReply<T> {
  return { ok: false, error: { code, message, retryable } };
}

function toRuntimeError<T>(error: unknown): RuntimeReply<T> {
  if (error instanceof ProviderError) {
    return failure(error.code, error.message, error.retryable);
  }
  return failure("extension-error", "The extension could not complete that action. Please try again.", true);
}

async function handleRequest(
  request: RuntimeRequest,
): Promise<RuntimeResponseMap[RuntimeRequest["type"]]> {
  switch (request.type) {
    case "GET_PUBLIC_SETTINGS":
      return readPublicSettings();
    case "SAVE_PROVIDER_SETTINGS":
      return saveProviderPreferences(request);
    case "SAVE_API_KEY":
      return saveOpenAIKey(request.apiKey);
    case "REMOVE_API_KEY":
      return removeOpenAIKey();
    case "DELETE_ALL_DATA":
      return clearAllExtensionData();
    case "GENERATE_ANSWER": {
      const settings = await readPublicSettings();
      if (settings.provider !== "openai") {
        throw new ProviderError("The selected provider is not available yet.", "unavailable");
      }
      const apiKey = await getOpenAIKeyForRequest();
      const answer = await openAIProvider.generateAnswer({
        draft: request.draft,
        model: settings.model,
        apiKey,
      });
      return {
        answer,
        provider: "openai",
        model: settings.model,
      };
    }
  }
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (!isTrustedExtensionPage(sender)) {
    sendResponse(failure("untrusted-sender", "This request must come from a Study Desk extension page."));
    return;
  }
  if (!isRuntimeRequest(message)) {
    sendResponse(failure("invalid-request", "That extension request was not valid."));
    return;
  }

  void (async () => {
    if (!(await storageAccessReady)) {
      throw new ProviderError("Secure extension storage could not be initialized. Reload the extension and try again.", "unavailable");
    }
    return handleRequest(message);
  })()
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error: unknown) => sendResponse(toRuntimeError(error)));

  return true;
});
