// View layer — renders all screens and modal sheets from app state.
// Display screens use escaped template strings; stateful sheets use a tiny
// `h()` helper (text nodes auto-escape). All dynamic, user-controlled content
// (URLs, domains, pasted input) is HTML-escaped to prevent injection.

import {
  localized,
  riskGuidance,
  riskTitle,
  OFFICIAL_CHANNELS,
  type AppLanguage,
  type EvidenceRecord,
  type ReportChannel,
  type RiskLevel,
  type URLCheckResult,
} from "../core/models";
import { buildWarningMessage } from "../core/report-builder";
import { Store, type AppState, type DatasetUpdateState } from "../app/state";
import {
  datasetFailureTitle,
  datasetSourceTitle,
  t,
  type L10nKey,
} from "./i18n";

// ---- helpers ----

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

type Child = Node | string | null | false | undefined;
function h(
  tag: string,
  attrs: Record<string, unknown> = {},
  children: Child | Child[] = [],
): HTMLElement {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = String(v);
    else if (k.startsWith("on") && typeof v === "function") {
      e.addEventListener(k.slice(2), v as EventListener);
    } else if (v === true) e.setAttribute(k, "");
    else e.setAttribute(k, String(v));
  }
  const list = Array.isArray(children) ? children : [children];
  for (const c of list) {
    if (c == null || c === false) continue;
    e.append(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return e;
}

const GLYPH: Record<RiskLevel, string> = {
  confirmedScam: "⛔",
  highRisk: "⚠️",
  needsVerification: "❓",
  noPublicReport: "ℹ️",
};

function evidenceGlyph(kind: EvidenceRecord["kind"]): string {
  switch (kind) {
    case "officialDataset": return "✅";
    case "localHeuristic": return "📈";
    case "externalSignal": return "🛡️";
    case "noMatch": return "ℹ️";
  }
}

function evidenceContextLabel(value: string | undefined, language: AppLanguage): string {
  if (!value || value.length === 0) return language === "zh-TW" ? "即時判定" : "Live decision";
  switch (value.toLowerCase()) {
    case "local": return language === "zh-TW" ? "本機規則" : "Local rules";
    case "latest bundled sample": return language === "zh-TW" ? "本機資料包" : "Bundled dataset";
    default: return value;
  }
}

function fmtDate(iso: string | null, language: AppLanguage): string {
  if (!iso) return t("unavailableValue", language);
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(language === "zh-TW" ? "zh-TW" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as { standalone?: boolean }).standalone === true
  );
}

let toastTimer: number | undefined;
function toast(message: string): void {
  document.querySelector(".toast")?.remove();
  const el = h("div", { class: "toast", role: "status" }, message);
  document.body.append(el);
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.remove(), 2200);
}

// ---- mount ----

export function mountApp(store: Store, root: HTMLElement): void {
  root.innerHTML = `
    <div class="app">
      <header class="topbar">
        <div class="brand"><span class="zh">鏈證</span><span class="en">LinkProof</span></div>
      </header>
      <main class="screen" id="screen"></main>
      <nav class="tabbar" id="tabbar"></nav>
    </div>`;

  const screen = root.querySelector<HTMLElement>("#screen")!;
  const tabbar = root.querySelector<HTMLElement>("#tabbar")!;

  const render = (state: AppState) => {
    tabbar.innerHTML = tabbarHTML(state);
    screen.innerHTML = screenHTML(state);
    bindScreen(store, screen, state);
  };

  // Global click delegation for [data-act].
  root.addEventListener("click", (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-act]");
    if (!target) return;
    handleAct(store, target.dataset.act!, target);
  });

  store.subscribe(render);
  render(store.getState());
}

// ---- actions ----

function handleAct(store: Store, act: string, el: HTMLElement): void {
  const state = store.getState();
  const index = el.dataset.index ? Number(el.dataset.index) : -1;
  switch (act) {
    case "tab":
      store.setTab(el.dataset.tab as AppState["tab"]);
      break;
    case "submit":
      void store.submitCheck();
      break;
    case "reset":
      store.resetCheck();
      break;
    case "paste":
      void pasteIntoInput();
      break;
    case "useHistory":
      store.useHistoryResult(state.history[index]!);
      break;
    case "deleteHistory":
      store.deleteHistory(index);
      break;
    case "deleteReport":
      store.deleteReport(index);
      break;
    case "setLang":
      store.setLanguage(el.dataset.lang as AppLanguage);
      break;
    case "updateDataset":
      void store.updateDataset(false);
      break;
    case "clearData":
      if (confirm(t("clearLocalData", state.language))) store.clearLocalData();
      break;
    case "copyUrl":
      void copyUrlAction(state);
      break;
    case "warnFamily":
      void warnFamilyAction(state);
      break;
    case "openReport":
      openReportSheet(store);
      break;
    case "openEmergency":
      openEmergencySheet(state.language);
      break;
    case "viewEvidence":
      if (state.currentResult) openEvidenceSheet(state.currentResult, state.language);
      break;
  }
}

async function pasteIntoInput(): Promise<void> {
  const input = document.querySelector<HTMLTextAreaElement>("#urlInput");
  if (!input) return;
  try {
    const text = await navigator.clipboard.readText();
    if (text) {
      input.value = text;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.focus();
    }
  } catch {
    input.focus();
  }
}

async function copyUrlAction(state: AppState): Promise<void> {
  if (!state.currentResult) return;
  const ok = await copyText(state.currentResult.normalizedURL);
  if (ok) toast(t("copiedNormalizedURL", state.language));
}

async function warnFamilyAction(state: AppState): Promise<void> {
  if (!state.currentResult) return;
  const message = buildWarningMessage(state.currentResult, state.language);
  await copyText(message);
  const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void> };
  if (typeof nav.share === "function") {
    try {
      await nav.share({ text: message });
      return;
    } catch {
      /* user cancelled — message is already on the clipboard */
    }
  }
  toast(t("warningMessageCopied", state.language));
}

// ---- tab bar ----

function tabbarHTML(state: AppState): string {
  const tabs: { id: AppState["tab"]; glyph: string; key: L10nKey }[] = [
    { id: "home", glyph: "🔎", key: "home" },
    { id: "history", glyph: "🕘", key: "history" },
    { id: "settings", glyph: "⚙️", key: "settings" },
  ];
  return tabs
    .map(
      (tab) => `
      <button class="tab" data-act="tab" data-tab="${tab.id}" aria-selected="${state.tab === tab.id}">
        <span class="glyph">${tab.glyph}</span><span>${esc(t(tab.key, state.language))}</span>
      </button>`,
    )
    .join("");
}

// ---- screens ----

function screenHTML(state: AppState): string {
  switch (state.tab) {
    case "home": return homeHTML(state);
    case "history": return historyHTML(state);
    case "settings": return settingsHTML(state);
  }
}

function homeHTML(state: AppState): string {
  const lang = state.language;
  const header = `
    <div class="header">
      <h1><span class="zh">鏈證</span><span class="en">LinkProof</span></h1>
      <p class="subtitle">${esc(t("appSubtitle", lang))}</p>
    </div>`;

  let body: string;
  switch (state.phase.kind) {
    case "validating":
      body = checkingHTML(lang);
      break;
    case "resolved":
      body = state.currentResult
        ? resultHTML(state.currentResult, lang, state.lastCheckDegraded)
        : inputHTML(state);
      break;
    case "blocked":
      body = blockedHTML(state.phase.message, lang) + inputHTML(state);
      break;
    default:
      body = inputHTML(state);
  }
  return header + body;
}

function inputHTML(state: AppState): string {
  const lang = state.language;
  const disabled = state.rawInput.trim().length === 0;
  const loading = state.datasetStatus.source === "missing" || state.datasetUpdateState === "updating";
  const datasetNote = loading
    ? `<p class="footnote">⏳ ${esc(t("loadingDataset", lang))}</p>`
    : "";
  const installNote = !isStandalone()
    ? `<p class="footnote">📲 ${esc(t("installHint", lang))}</p>`
    : "";
  return `
    <section class="surface stack">
      <h2>${esc(t("inputSectionTitle", lang))}</h2>
      <p class="help">${esc(t("inputHelper", lang))}</p>
      <textarea id="urlInput" class="field" inputmode="url" autocapitalize="off"
        autocomplete="off" spellcheck="false"
        placeholder="${esc(t("urlPlaceholder", lang))}">${esc(state.rawInput)}</textarea>
      <div class="btn-row">
        <button class="btn btn-secondary" data-act="paste">📋 ${esc(t("pasteURL", lang))}</button>
        <button class="btn btn-primary" id="checkBtn" data-act="submit" ${disabled ? "disabled" : ""}>🛡️ ${esc(t("checkURL", lang))}</button>
      </div>
      ${datasetNote}
      <p class="footnote">${esc(t("firstLoadHint", lang))}</p>
      ${installNote}
    </section>
    ${recentChecksHTML(state)}`;
}

function recentChecksHTML(state: AppState): string {
  const lang = state.language;
  const items = state.history.slice(0, 3);
  const rows = items.length
    ? items
        .map(
          (r, i) => `
        <button class="row" data-act="useHistory" data-index="${i}">
          <span class="glyph ${r.riskLevel}">${GLYPH[r.riskLevel]}</span>
          <span class="stack-sm">
            <span class="t">${esc(riskTitle(r.riskLevel, lang))}</span>
            <span class="s">${esc(r.domain)}</span>
          </span>
        </button>`,
        )
        .join("")
    : `<p class="help">${esc(t("noRecentChecks", lang))}</p>`;
  return `<section class="surface stack"><h2>${esc(t("recentChecks", lang))}</h2>${rows}</section>`;
}

function checkingHTML(lang: AppLanguage): string {
  const step = (k: L10nKey) => `<div class="row static"><span class="glyph trust">•</span><span class="t">${esc(t(k, lang))}</span></div>`;
  return `
    <section class="surface stack">
      <div class="row static"><span class="spinner"></span><span class="t">${esc(t("checking", lang))}</span></div>
      ${step("normalizeURL")}${step("comparePublicData")}${step("prepareEvidence")}
      <button class="btn btn-secondary" data-act="reset">✕ ${esc(t("clear", lang))}</button>
    </section>`;
}

function blockedHTML(message: string, lang: AppLanguage): string {
  return `
    <section class="surface stack">
      <div class="row static"><span class="glyph caution">⚠️</span><span class="t">${esc(message)}</span></div>
      <p class="help">${esc(t("urlPlaceholder", lang))}</p>
    </section>`;
}

function resultHTML(result: URLCheckResult, lang: AppLanguage, degraded: boolean): string {
  const allowsHandoff = result.riskLevel === "needsVerification" || result.riskLevel === "noPublicReport";
  const showsEmergency = result.riskLevel === "confirmedScam" || result.riskLevel === "highRisk";
  const tell165Class = result.riskLevel === "needsVerification" ? "caution" : "";

  const defangNotice = result.defangedInput
    ? `<div class="notice">
        <span class="glyph">🔗</span>
        <span class="stack-sm">
          <span class="t">${esc(t("defangedURLRestored", lang))}</span>
          <span class="b">${esc(t("defangedURLRestoredBody", lang))}</span>
          <span class="mono">${esc(result.defangedInput)}</span>
        </span>
      </div>`
    : "";

  const copyInVerdict = allowsHandoff
    ? `<button class="btn btn-secondary" data-act="copyUrl">📄 ${esc(t("copyNormalizedURL", lang))}</button>`
    : "";

  const verdict = `
    <div class="verdict is-${result.riskLevel}">
      <div class="accent"></div>
      <div class="body">
        <h2 class="title"><span class="glyph">${GLYPH[result.riskLevel]}</span>${esc(riskTitle(result.riskLevel, lang))}</h2>
        <p class="guidance">${esc(riskGuidance(result.riskLevel, lang))}</p>
        <div class="urlbox stack-sm">
          <span class="label">${esc(t("normalizedURL", lang))}</span>
          <span class="url">${esc(result.normalizedURL)}</span>
        </div>
        ${defangNotice}
        ${copyInVerdict}
      </div>
    </div>`;

  const emergency = showsEmergency
    ? `<div class="banner ${result.riskLevel === "confirmedScam" ? "risk" : "caution"}">
        <div class="head">📞 ${esc(t("urgentHelpTitle", lang))}</div>
        <p class="b">${esc(t("urgentHelpBody", lang))}</p>
        <button class="btn btn-primary ${result.riskLevel === "confirmedScam" ? "risk" : "caution"}" data-act="openEmergency">📋 ${esc(t("emergencyGuideOpen", lang))}</button>
      </div>`
    : "";

  const sourceDate = evidenceContextLabel(result.evidence[0]?.datasetDate, lang);
  const evidenceRows = result.evidence
    .slice(0, 3)
    .map(
      (ev) => `
      <div class="row static">
        <span class="glyph">${evidenceGlyph(ev.kind)}</span>
        <span class="stack-sm">
          <span class="t">${esc(localized(ev.sourceName, lang))}</span>
          <span class="s">${esc(localized(ev.summary, lang))}</span>
        </span>
      </div>`,
    )
    .join("");

  const evidence = `
    <section class="surface stack">
      <span class="eyebrow">${esc(lang === "zh-TW" ? "資料來源 · " : "Sources · ")}${esc(sourceDate)}</span>
      <h2>${esc(t("evidence", lang))}</h2>
      ${evidenceRows}
      <button class="btn btn-secondary" data-act="viewEvidence">🔍 ${esc(t("viewEvidence", lang))}</button>
    </section>`;

  const tell165 = allowsHandoff
    ? `<button class="btn btn-primary ${tell165Class}" data-act="openReport">🏛️ ${esc(t("reportToGovernment", lang))}</button>`
    : "";

  const actions = `
    <div class="stack">
      <button class="btn btn-secondary" data-act="warnFamily">👥 ${esc(t("warnFamily", lang))}</button>
      ${tell165}
      <button class="btn btn-secondary" data-act="reset">＋ ${esc(t("checkURL", lang))}</button>
    </div>`;

  const degradedNote = degraded
    ? `<div class="banner caution"><p class="b">⚠️ ${esc(t("datasetOfflineNote", lang))}</p></div>`
    : "";

  return verdict + degradedNote + emergency + evidence + actions;
}

function historyHTML(state: AppState): string {
  const lang = state.language;
  const history = state.history.length
    ? state.history
        .map(
          (r, i) => `
        <div class="row">
          <button class="row" data-act="useHistory" data-index="${i}" style="padding:0">
            <span class="glyph ${r.riskLevel}">${GLYPH[r.riskLevel]}</span>
            <span class="stack-sm">
              <span class="t" style="color:var(--${colorVar(r.riskLevel)})">${esc(riskTitle(r.riskLevel, lang))}</span>
              <span class="s">${esc(r.domain)}</span>
              <span class="s">${esc(fmtDate(r.checkedAt, lang))}</span>
            </span>
          </button>
          <button class="btn-icon" data-act="deleteHistory" data-index="${i}" aria-label="${esc(t("clear", lang))}" style="margin-left:auto;background:none;border:none;color:var(--muted);cursor:pointer;font-size:18px">🗑️</button>
        </div>`,
        )
        .join("<hr class='divider'>")
    : `<p class="help">${esc(t("noHistory", lang))}</p>`;

  const reports = state.reports.length
    ? state.reports
        .map(
          (rec, i) => `
        <div class="row">
          <span class="stack-sm" style="flex:1">
            <span class="t" style="color:var(--trust)">${esc(localized(rec.statusText, lang))}</span>
            <span class="s">${esc(localized(rec.channel.title, lang))}</span>
            <span class="s mono" style="font-family:var(--mono);word-break:break-all">${esc(rec.normalizedURL)}</span>
          </span>
          <button data-act="deleteReport" data-index="${i}" aria-label="${esc(t("clear", lang))}" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:18px">🗑️</button>
        </div>`,
        )
        .join("<hr class='divider'>")
    : `<p class="help">${esc(t("noReports", lang))}</p>`;

  return `
    <div class="header"><h1>${esc(t("history", lang))}</h1></div>
    <section class="surface stack"><span class="eyebrow">${esc(t("history", lang))}</span>${history}</section>
    <section class="surface stack"><span class="eyebrow">${esc(t("reports", lang))}</span>${reports}</section>`;
}

function colorVar(risk: RiskLevel): string {
  if (risk === "confirmedScam") return "risk";
  if (risk === "noPublicReport") return "muted";
  return "caution";
}

function settingsHTML(state: AppState): string {
  const lang = state.language;
  const seg = `
    <div class="seg" role="tablist">
      <button data-act="setLang" data-lang="zh-TW" aria-selected="${lang === "zh-TW"}">繁體中文</button>
      <button data-act="setLang" data-lang="en-US" aria-selected="${lang === "en-US"}">English</button>
    </div>`;

  const updating = state.datasetUpdateState === "updating";
  const updateBtn = `
    <button class="btn btn-secondary full" data-act="updateDataset" ${updating ? "disabled" : ""}>
      ${updating ? `<span class="spinner"></span> ${esc(t("updatingDataset", lang))}` : `🔄 ${esc(t("updateDataset", lang))}`}
    </button>`;

  const message = state.datasetUpdateMessage
    ? `<p class="footnote" style="color:${state.datasetUpdateState === "failed" ? "var(--risk)" : "var(--muted)"}">${esc(state.datasetUpdateMessage)}</p>`
    : "";

  const failureRow = state.datasetUpdateFailure
    ? labeled(t("datasetFailureReason", lang), datasetFailureTitle(state.datasetUpdateFailure, lang))
    : "";

  const datasetSection = `
    <section class="surface stack">
      <span class="eyebrow">${esc(t("datasetUpdateTitle", lang))}</span>
      <div class="row static">
        <span class="glyph ${updateStateTint(state.datasetUpdateState)}">${updateStateGlyph(state.datasetUpdateState)}</span>
        <span class="stack-sm" style="flex:1">
          <span class="t">${esc(t(updateStateKey(state.datasetUpdateState), lang))}</span>
          <span class="s">${esc(fmtDate(state.datasetLastCheckAt, lang))} · ${esc(state.datasetStatus.recordCount.toLocaleString(lang === "zh-TW" ? "zh-TW" : "en-US"))}</span>
        </span>
        <span class="chip">${esc(state.datasetStatus.version)}</span>
      </div>
      ${labeled(t("datasetSource", lang), datasetSourceTitle(state.datasetStatus.source, lang))}
      ${labeled(t("datasetRecordCount", lang), state.datasetStatus.recordCount.toLocaleString(lang === "zh-TW" ? "zh-TW" : "en-US"))}
      ${labeled(t("datasetLastChecked", lang), fmtDate(state.datasetLastCheckAt, lang))}
      ${failureRow}
      ${updateBtn}
      ${message}
      <p class="footnote">${esc(t("datasetStatusFootnote", lang))}</p>
    </section>`;

  return `
    <div class="header"><h1>${esc(t("settings", lang))}</h1></div>
    <section class="surface stack"><span class="eyebrow">${esc(t("language", lang))}</span>${seg}</section>
    <section class="surface stack">
      <span class="eyebrow">${esc(t("privacy", lang))}</span>
      <p class="help">${esc(t("privacyBody", lang))}</p>
      <p class="footnote">${esc(t("notGovernmentAgency", lang))}</p>
    </section>
    <section class="surface stack">
      <div class="row static"><span class="glyph risk">📞</span>
        <span class="stack-sm"><span class="t">${esc(t("emergencySettingsTitle", lang))}</span><span class="s">${esc(t("emergencySettingsBody", lang))}</span></span>
      </div>
      <button class="btn btn-secondary full" data-act="openEmergency">📋 ${esc(t("emergencyGuideOpen", lang))}</button>
    </section>
    ${datasetSection}
    <section class="surface"><button class="btn btn-danger full" data-act="clearData">🗑️ ${esc(t("clearLocalData", lang))}</button></section>`;
}

function labeled(k: string, v: string): string {
  return `<div class="labeled"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`;
}

function updateStateKey(s: DatasetUpdateState): L10nKey {
  return {
    idle: "datasetUpdateIdle",
    updating: "datasetUpdateChecking",
    succeeded: "datasetUpdateSucceededState",
    alreadyCurrent: "datasetUpdateAlreadyCurrentState",
    failed: "datasetUpdateFailedState",
  }[s] as L10nKey;
}
function updateStateGlyph(s: DatasetUpdateState): string {
  return { idle: "ℹ️", updating: "🔄", succeeded: "✅", alreadyCurrent: "✅", failed: "⚠️" }[s];
}
function updateStateTint(s: DatasetUpdateState): string {
  return { idle: "muted", updating: "caution", succeeded: "trust", alreadyCurrent: "trust", failed: "risk" }[s];
}

// ---- per-render binding (textarea input) ----

function bindScreen(store: Store, screen: HTMLElement, state: AppState): void {
  const input = screen.querySelector<HTMLTextAreaElement>("#urlInput");
  if (input) {
    input.addEventListener("input", () => {
      store.setRawInputSilent(input.value);
      const btn = screen.querySelector<HTMLButtonElement>("#checkBtn");
      if (btn) btn.disabled = input.value.trim().length === 0;
    });
    input.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key === "Enter" && (e as KeyboardEvent).metaKey) {
        e.preventDefault();
        void store.submitCheck();
      }
    });
  }
}

// ---- sheets ----

function presentSheet(title: string, lang: AppLanguage, content: HTMLElement): () => void {
  const close = () => backdrop.remove();
  const head = h("div", { class: "sheet-head" }, [
    h("h2", {}, title),
    h("button", { class: "close", onclick: close }, t("done", lang)),
  ]);
  const sheet = h("div", { class: "sheet" }, [h("div", { class: "grip" }), head, content]);
  const backdrop = h("div", {
    class: "sheet-backdrop",
    onclick: (e: Event) => {
      if (e.target === backdrop) close();
    },
  }, sheet);
  document.body.append(backdrop);
  return close;
}

function openEmergencySheet(lang: AppLanguage): void {
  const steps: { glyph: string; title: L10nKey; body: L10nKey }[] = [
    { glyph: "💳", title: "emergencyStepBankTitle", body: "emergencyStepBankBody" },
    { glyph: "📞", title: "emergencyStep165Title", body: "emergencyStep165Body" },
    { glyph: "📸", title: "emergencyStepEvidenceTitle", body: "emergencyStepEvidenceBody" },
    { glyph: "🔑", title: "emergencyStepPasswordTitle", body: "emergencyStepPasswordBody" },
  ];
  const content = h("div", { class: "stack" }, [
    h("p", { class: "help" }, t("emergencyGuideSubtitle", lang)),
    h("a", { class: "btn btn-primary risk full", href: "tel:165" }, `📞 ${t("call165", lang)}`),
    ...steps.map((s, i) =>
      h("div", { class: "step" }, [
        h("div", { class: "num" }, String(i + 1)),
        h("div", { class: "stack-sm" }, [
          h("p", { class: "t" }, `${s.glyph} ${t(s.title, lang)}`),
          h("p", { class: "b" }, t(s.body, lang)),
        ]),
      ]),
    ),
  ]);
  presentSheet(t("emergencyGuideTitle", lang), lang, content);
}

function openEvidenceSheet(result: URLCheckResult, lang: AppLanguage): void {
  const meta = h("section", { class: "surface stack-sm" }, [
    labeledNode(t("domain", lang), result.domain),
    labeledNode(t("datasetBundle", lang), result.bundleVersion, true),
    labeledNode(t("checked", lang), fmtDate(result.checkedAt, lang)),
  ]);
  const items = result.evidence.map((ev) =>
    h("section", { class: "surface stack-sm" }, [
      h("p", { class: "t", style: "font-weight:700" }, localized(ev.sourceName, lang)),
      h("p", { class: "s" }, localized(ev.category, lang)),
      h("p", {}, localized(ev.summary, lang)),
      ev.providerId ? labeledNode(t("externalProvider", lang), ev.providerId) : null,
      labeledNode(t("sourceUpdated", lang), evidenceContextLabel(ev.datasetDate, lang)),
      labeledNode(t("matchedValue", lang), ev.matchedValue, true),
    ]),
  );
  presentSheet(t("evidence", lang), lang, h("div", { class: "stack" }, [meta, ...items]));
}

function labeledNode(k: string, v: string, mono = false): HTMLElement {
  return h("div", { class: "labeled" }, [
    h("span", { class: "k" }, k),
    h("span", { class: mono ? "v mono" : "v" }, v),
  ]);
}

function openReportSheet(store: Store): void {
  const state = store.getState();
  const result = state.currentResult;
  if (!result) return;
  const lang = state.language;

  let selected: ReportChannel = OFFICIAL_CHANNELS[0]!;
  let consent = false;
  let opened = false;

  const container = h("div", { class: "stack" });
  const close = presentSheet(t("officialReport", lang), lang, container);

  const rerender = () => {
    const kids: (HTMLElement | null)[] = [
      // channel chooser
      h("section", { class: "surface stack" }, [
        h("p", { class: "t", style: "font-weight:700" }, `🏛️ ${t("chooseChannel", lang)}`),
        h("p", { class: "help" }, t("reportChannelExplanation", lang)),
        ...OFFICIAL_CHANNELS.map((channel) =>
          h("label", { class: "channel" }, [
            h("input", {
              type: "radio",
              name: "channel",
              checked: selected.id === channel.id,
              onchange: () => {
                selected = channel;
                rerender();
              },
            }),
            h("span", { class: "stack-sm" }, [
              h("span", { class: "t" }, localized(channel.title, lang)),
              h("span", { class: "d" }, localized(channel.detail, lang)),
              h("span", { class: "host" }, hostOf(channel.officialURL)),
            ]),
          ]),
        ),
      ]),
      // checklist
      h("section", { class: "surface stack" }, [
        h("p", { class: "t", style: "font-weight:700" }, `✅ ${t("reportChecklist", lang)}`),
        labeledNode(t("normalizedURL", lang), result.normalizedURL, true),
        labeledNode(t("evidence", lang), riskTitle(result.riskLevel, lang)),
        labeledNode(t("officialWebsite", lang), localized(selected.title, lang)),
        h("p", { class: "footnote" }, t("notGovernmentAgency", lang)),
        h("p", { class: "footnote" }, t("reportHandoffNote", lang)),
        h("button", {
          class: "btn btn-secondary full",
          onclick: async () => {
            const ok = await copyText(result.normalizedURL);
            if (ok) toast(t("copyReportURLDone", lang));
          },
        }, `📄 ${t("copyReportURL", lang)}`),
        h("label", { class: "consent" }, [
          h("input", {
            type: "checkbox",
            checked: consent,
            onchange: (e: Event) => {
              consent = (e.target as HTMLInputElement).checked;
              rerender();
            },
          }),
          h("span", {}, t("consentText", lang)),
        ]),
      ]),
      // confirmation
      opened
        ? h("section", { class: "surface stack-sm" }, [
            h("p", { class: "t", style: "color:var(--trust);font-weight:700" }, `✅ ${localized({ zhTW: "已開啟官方管道", enUS: "Official channel opened" }, lang)}`),
            h("p", {}, localized(selected.title, lang)),
          ])
        : null,
      // open button
      h("button", {
        class: "btn btn-primary full",
        disabled: !consent,
        onclick: async () => {
          await copyText(result.normalizedURL);
          store.recordOfficialHandoff(selected);
          opened = true;
          window.open(selected.officialURL, "_blank", "noopener,noreferrer");
          rerender();
        },
      }, `🌐 ${t("openOfficialChannel", lang)}`),
    ];
    container.replaceChildren(...kids.filter((n): n is HTMLElement => n !== null));
  };

  rerender();
  void close; // close handle retained by backdrop listeners
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
