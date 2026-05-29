// App state + store — port of LinkProofViewModel.swift for the web.
// A tiny observable store: actions mutate state and notify subscribers, which
// re-render the view. Persistence uses localStorage (data stays on-device and
// is never uploaded); the dataset lives in IndexedDB via DatasetStore.

import {
  newId,
  type AppLanguage,
  type EvidenceRecord,
  type NormalizedURL,
  type ReportChannel,
  type ReportRecord,
  type URLCheckResult,
} from "../core/models";
import { normalize } from "../core/url-normalizer";
import { URLNormalizationError } from "../core/domain-policy";
import { makeResult } from "../core/risk-decision-engine";
import {
  UNLOADED_STATUS,
  type DatasetService,
  type RiskDatasetStatus,
  type RiskDatasetUpdateFailure,
  type RiskDatasetUpdateResult,
} from "../core/dataset-store";
import { WorkerDatasetClient } from "./dataset-client";
import { t } from "../ui/i18n";

export type CheckPhase =
  | { kind: "empty" }
  | { kind: "drafting" }
  | { kind: "validating" }
  | { kind: "resolved" }
  | { kind: "blocked"; message: string };

export type Tab = "home" | "history" | "settings";

export type DatasetUpdateState =
  | "idle" | "updating" | "succeeded" | "alreadyCurrent" | "failed";

export interface AppState {
  language: AppLanguage;
  tab: Tab;
  rawInput: string;
  phase: CheckPhase;
  currentResult: URLCheckResult | null;
  history: URLCheckResult[];
  reports: ReportRecord[];
  datasetStatus: RiskDatasetStatus;
  datasetUpdateState: DatasetUpdateState;
  datasetUpdateMessage: string | null;
  datasetUpdateFailure: RiskDatasetUpdateFailure | null;
  datasetLastCheckAt: string | null;
  /** True when the last check ran without the public dataset (heuristics only). */
  lastCheckDegraded: boolean;
}

const KEYS = {
  language: "linkproof.language",
  history: "linkproof.history",
  reports: "linkproof.reports",
  lastCheck: "linkproof.datasetLastCheckAt",
} as const;

const HISTORY_LIMIT = 30;
const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable (private mode, quota) — non-fatal */
  }
}

function removeStorage(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

function loadJSON<T>(key: string, fallback: T): T {
  const raw = readStorage(key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export type Listener = (state: AppState) => void;

export class Store {
  private state: AppState;
  private listeners = new Set<Listener>();
  private readonly dataset: DatasetService;
  // Resolves when the first dataset-acquisition attempt finishes (success or
  // failure). submitCheck awaits this on first launch.
  private datasetReady: Promise<void> = Promise.resolve();

  constructor(dataset: DatasetService = new WorkerDatasetClient()) {
    this.dataset = dataset;
    const language = (readStorage(KEYS.language) as AppLanguage | null) ?? "zh-TW";
    this.state = {
      language: language === "en-US" ? "en-US" : "zh-TW",
      tab: "home",
      rawInput: "",
      phase: { kind: "empty" },
      currentResult: null,
      history: loadJSON<URLCheckResult[]>(KEYS.history, []),
      reports: loadJSON<ReportRecord[]>(KEYS.reports, []),
      datasetStatus: UNLOADED_STATUS,
      datasetUpdateState: "idle",
      datasetUpdateMessage: null,
      datasetUpdateFailure: null,
      datasetLastCheckAt: readStorage(KEYS.lastCheck),
      lastCheckDegraded: false,
    };
  }

  getState(): AppState {
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private set(partial: Partial<AppState>): void {
    this.state = { ...this.state, ...partial };
    for (const listener of this.listeners) listener(this.state);
  }

  // rawInput is tracked without a re-render to keep the textarea responsive.
  setRawInputSilent(value: string): void {
    this.state.rawInput = value;
    if (value.trim().length === 0) this.state.phase = { kind: "empty" };
    else if (this.state.phase.kind === "empty") this.state.phase = { kind: "drafting" };
  }

  setTab(tab: Tab): void {
    this.set({ tab });
  }

  setLanguage(language: AppLanguage): void {
    writeStorage(KEYS.language, language);
    this.set({ language });
  }

  async prepare(): Promise<void> {
    try {
      await this.dataset.load();
      this.set({ datasetStatus: await this.dataset.currentStatus() });
    } catch {
      // Worker unavailable at startup — keep the unloaded status; checks will
      // fall back to heuristics rather than hang.
    }
    this.datasetReady = this.updateDatasetIfNeeded();
    this.datasetReady.catch(() => {});
  }

  async submitCheck(): Promise<void> {
    const input = this.state.rawInput.trim();
    if (input.length === 0) return;
    this.set({ phase: { kind: "validating" } });

    let normalized: NormalizedURL;
    try {
      normalized = normalize(input);
    } catch (error) {
      const message =
        error instanceof URLNormalizationError
          ? error.message_(this.state.language)
          : t("genericCheckError", this.state.language);
      this.set({ phase: { kind: "blocked", message } });
      return;
    }

    // First launch: the dataset is still downloading in the worker. Wait for the
    // initial fetch so an official scam is not missed and shown as noPublicReport.
    if (this.state.datasetStatus.source === "missing") {
      try {
        await this.datasetReady;
      } catch {
        /* refresh failed (e.g. offline) — fall through to degraded mode */
      }
    }

    // Match against the dataset; degrade to heuristics if the worker is down.
    let evidence: EvidenceRecord[] = [];
    let bundleVersion = this.state.datasetStatus.version;
    let evidenceFailed = false;
    try {
      evidence = await this.dataset.evidenceFor(normalized);
      bundleVersion = await this.dataset.currentBundleVersion();
    } catch {
      evidence = [];
      evidenceFailed = true;
    }

    const degraded = this.state.datasetStatus.source === "missing" || evidenceFailed;
    const result = makeResult(input, normalized, evidence, bundleVersion);
    this.insertHistory(result);
    this.set({ currentResult: result, phase: { kind: "resolved" }, lastCheckDegraded: degraded });
  }

  resetCheck(): void {
    this.state.rawInput = "";
    this.set({ currentResult: null, phase: { kind: "empty" }, lastCheckDegraded: false });
  }

  useHistoryResult(result: URLCheckResult): void {
    this.state.rawInput = result.normalizedURL;
    this.set({ currentResult: result, tab: "home", phase: { kind: "resolved" }, lastCheckDegraded: false });
  }

  recordOfficialHandoff(channel: ReportChannel): void {
    const result = this.state.currentResult;
    if (!result) return;
    const record: ReportRecord = {
      id: newId(),
      checkId: result.id,
      channel,
      openedAt: new Date().toISOString(),
      normalizedURL: result.normalizedURL,
      statusText: { zhTW: "已開啟官方管道", enUS: "Official channel opened" },
    };
    const reports = [record, ...this.state.reports];
    writeStorage(KEYS.reports, JSON.stringify(reports));
    this.set({ reports });
  }

  deleteHistory(index: number): void {
    const history = this.state.history.slice();
    history.splice(index, 1);
    writeStorage(KEYS.history, JSON.stringify(history));
    this.set({ history });
  }

  deleteReport(index: number): void {
    const reports = this.state.reports.slice();
    reports.splice(index, 1);
    writeStorage(KEYS.reports, JSON.stringify(reports));
    this.set({ reports });
  }

  clearLocalData(): void {
    removeStorage(KEYS.history);
    removeStorage(KEYS.reports);
    this.set({ history: [], reports: [] });
  }

  private insertHistory(result: URLCheckResult): void {
    const deduped = this.state.history.filter((r) => r.normalizedURL !== result.normalizedURL);
    const history = [result, ...deduped].slice(0, HISTORY_LIMIT);
    writeStorage(KEYS.history, JSON.stringify(history));
    this.state.history = history;
  }

  get nextAutomaticCheckAt(): string | null {
    if (!this.state.datasetLastCheckAt) return null;
    const next = new Date(this.state.datasetLastCheckAt).getTime() + REFRESH_INTERVAL_MS;
    return new Date(next).toISOString();
  }

  private async updateDatasetIfNeeded(): Promise<void> {
    let configured = false;
    try {
      configured = await this.dataset.isRemoteUpdateConfigured();
    } catch {
      configured = false;
    }
    if (!configured) return;
    const status = this.state.datasetStatus;
    const last = this.state.datasetLastCheckAt;
    const stale = !last || Date.now() - new Date(last).getTime() >= REFRESH_INTERVAL_MS;
    if (status.source !== "missing" && !stale) return;
    await this.updateDataset(true);
  }

  async updateDataset(isAutomatic = false): Promise<void> {
    let configured = false;
    try {
      configured = await this.dataset.isRemoteUpdateConfigured();
    } catch {
      configured = false;
    }
    if (!configured) {
      this.set({
        datasetUpdateState: "failed",
        datasetUpdateMessage: t("datasetUpdateUnavailable", this.state.language),
      });
      return;
    }

    this.set({ datasetUpdateState: "updating", datasetUpdateMessage: null, datasetUpdateFailure: null });
    let result: RiskDatasetUpdateResult;
    try {
      result = await this.dataset.refreshFromRemote();
    } catch {
      // Worker crashed / timed out — treat as a network failure and keep going.
      result = { kind: "failed", status: this.state.datasetStatus, failure: "network" };
    }
    const checkedAt = new Date().toISOString();
    writeStorage(KEYS.lastCheck, checkedAt);

    const lang = this.state.language;
    if (result.kind === "updated") {
      this.set({
        datasetStatus: result.status,
        datasetUpdateState: "succeeded",
        datasetUpdateMessage: t("datasetUpdateSucceeded", lang),
        datasetUpdateFailure: null,
        datasetLastCheckAt: checkedAt,
      });
    } else if (result.kind === "alreadyCurrent") {
      this.set({
        datasetStatus: result.status,
        datasetUpdateState: "alreadyCurrent",
        datasetUpdateMessage: t("datasetAlreadyCurrent", lang),
        datasetUpdateFailure: null,
        datasetLastCheckAt: checkedAt,
      });
    } else {
      this.set({
        datasetStatus: result.status,
        datasetUpdateState: "failed",
        datasetUpdateFailure: result.failure,
        datasetUpdateMessage: messageForFailure(result.failure, isAutomatic, lang),
        datasetLastCheckAt: checkedAt,
      });
    }
  }
}

function messageForFailure(
  failure: RiskDatasetUpdateFailure,
  automatic: boolean,
  language: AppLanguage,
): string {
  switch (failure) {
    case "sourceUnavailable":
      return t("datasetUpdateUnavailable", language);
    case "checksumMismatch":
    case "invalidDataset":
    case "invalidManifest":
      return t("datasetUpdateRejected", language);
    case "network":
    case "cacheWriteFailed":
      return automatic
        ? t("datasetBackgroundUpdateFailed", language)
        : t("datasetUpdateFailed", language);
  }
}
