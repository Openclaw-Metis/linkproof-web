// UI strings — port of the L10n table in LinkProofViewModel.swift, plus the
// dataset source / failure / update-state titles from the models + view model.
// Deep-check strings are omitted because that feature is disabled (it was a
// feature-flagged scaffold in the native app and is not rendered on the web).

import { localized, type AppLanguage, type LocalizedCopy } from "../core/models";
import type {
  RiskDatasetSourceKind,
  RiskDatasetUpdateFailure,
} from "../core/dataset-store";

export type L10nKey =
  | "genericCheckError" | "appTitle" | "appSubtitle" | "checkURL" | "pasteURL"
  | "urlPlaceholder" | "checking" | "comparePublicData" | "normalizeURL"
  | "prepareEvidence" | "clear" | "recentChecks" | "noRecentChecks"
  | "reportToGovernment" | "viewEvidence" | "evidence" | "officialReport"
  | "chooseChannel" | "openOfficialChannel" | "urgentHelpTitle" | "urgentHelpBody"
  | "call165" | "emergencyGuideOpen" | "emergencyGuideTitle" | "emergencyGuideSubtitle"
  | "emergencySettingsTitle" | "emergencySettingsBody" | "emergencyStepBankTitle"
  | "emergencyStepBankBody" | "emergencyStep165Title" | "emergencyStep165Body"
  | "emergencyStepEvidenceTitle" | "emergencyStepEvidenceBody" | "emergencyStepPasswordTitle"
  | "emergencyStepPasswordBody" | "warnFamily" | "warningMessageCopied" | "consentText"
  | "history" | "reports" | "settings" | "language" | "privacy" | "privacyBody"
  | "clearLocalData" | "noReports" | "noHistory" | "checked" | "sourceUpdated"
  | "normalizedURL" | "defangedURLRestored" | "defangedURLRestoredBody"
  | "notGovernmentAgency" | "done" | "home" | "inputSectionTitle" | "inputHelper"
  | "copyNormalizedURL" | "copiedNormalizedURL" | "reportChecklist"
  | "reportChannelExplanation" | "reportHandoffNote" | "copyReportURL" | "copyReportURLDone"
  | "officialWebsite" | "domain" | "datasetBundle" | "matchedValue" | "datasetUpdateTitle"
  | "advancedDatasetInfo" | "datasetUpdateStatus" | "datasetSource" | "datasetRecordCount"
  | "datasetLastChecked" | "datasetFailureReason" | "datasetStatusFootnote" | "updateDataset"
  | "updatingDataset" | "datasetUpdateIdle" | "datasetUpdateChecking"
  | "datasetUpdateSucceededState" | "datasetUpdateAlreadyCurrentState" | "datasetUpdateFailedState"
  | "datasetUpdateSucceeded" | "datasetAlreadyCurrent" | "datasetUpdateFailed"
  | "datasetUpdateRejected" | "datasetUpdateUnavailable" | "datasetBackgroundUpdateFailed"
  | "unavailableValue" | "externalProvider" | "category" | "installHint" | "shareUnsupported"
  | "loadingDataset" | "firstLoadHint" | "datasetOfflineNote";

const STRINGS: Record<L10nKey, LocalizedCopy> = {
  genericCheckError: { zhTW: "目前無法完成查核，請稍後再試。", enUS: "The check could not be completed. Please try again later." },
  appTitle: { zhTW: "鏈證", enUS: "LinkProof" },
  appSubtitle: { zhTW: "點開前，先查證。", enUS: "Check the link before the tap." },
  checkURL: { zhTW: "查詢網址", enUS: "Check URL" },
  pasteURL: { zhTW: "貼上", enUS: "Paste" },
  urlPlaceholder: { zhTW: "貼上 LINE、簡訊或瀏覽器中的可疑網址", enUS: "Paste a suspicious URL from LINE, SMS, or browser" },
  checking: { zhTW: "正在查核", enUS: "Checking" },
  comparePublicData: { zhTW: "比對本機公開資料包", enUS: "Matching local public-data bundle" },
  normalizeURL: { zhTW: "正規化網址", enUS: "Normalizing URL" },
  prepareEvidence: { zhTW: "整理判定依據", enUS: "Preparing evidence" },
  clear: { zhTW: "清除", enUS: "Clear" },
  recentChecks: { zhTW: "近期查核", enUS: "Recent checks" },
  noRecentChecks: { zhTW: "尚無查核紀錄", enUS: "No checks yet" },
  reportToGovernment: { zhTW: "告訴 165", enUS: "Tell 165" },
  viewEvidence: { zhTW: "查看依據", enUS: "View evidence" },
  evidence: { zhTW: "判定依據", enUS: "Evidence" },
  officialReport: { zhTW: "告訴 165", enUS: "Tell 165" },
  chooseChannel: { zhTW: "選擇官方管道", enUS: "Choose an official channel" },
  openOfficialChannel: { zhTW: "開啟官方管道", enUS: "Open official channel" },
  urgentHelpTitle: { zhTW: "已輸入資料或轉帳？", enUS: "Already entered data or sent money?" },
  urgentHelpBody: { zhTW: "先撥打 165 或銀行客服止血，保留截圖與對話紀錄。", enUS: "Call 165 or your bank first, then keep screenshots and conversation records." },
  call165: { zhTW: "撥打 165", enUS: "Call 165" },
  emergencyGuideOpen: { zhTW: "查看緊急處理", enUS: "View urgent steps" },
  emergencyGuideTitle: { zhTW: "已被詐騙？先做這 4 件事", enUS: "Already scammed? Do these 4 things first" },
  emergencyGuideSubtitle: { zhTW: "先止血，再保留證據。鏈證不會替你報案，但會把下一步說清楚。", enUS: "Stop further loss first, then keep evidence. LinkProof does not file reports for you, but it shows the next steps." },
  emergencySettingsTitle: { zhTW: "已被詐騙？", enUS: "Already scammed?" },
  emergencySettingsBody: { zhTW: "需要立即處理時，打開 4 步緊急清單。", enUS: "Open the 4-step urgent checklist when immediate action is needed." },
  emergencyStepBankTitle: { zhTW: "如果輸入過信用卡、帳密或轉帳：立刻聯絡銀行", enUS: "If card, login, or transfer details were entered: contact your bank" },
  emergencyStepBankBody: { zhTW: "撥打卡片背面或銀行官方網站上的客服電話，請銀行暫停異常交易或凍結帳戶。", enUS: "Call the number on the card or the bank's official website and ask them to stop suspicious transactions or freeze the account." },
  emergencyStep165Title: { zhTW: "撥打 165 反詐騙專線", enUS: "Call the 165 anti-fraud hotline" },
  emergencyStep165Body: { zhTW: "說明你點過的網址、輸入過的資料、是否已付款或轉帳。急迫風險請直接撥打，不要只填線上表單。", enUS: "Tell them the URL, what data was entered, and whether money was sent. For urgent risk, call directly instead of only using an online form." },
  emergencyStepEvidenceTitle: { zhTW: "截圖保留證據，不要刪訊息", enUS: "Screenshot evidence and do not delete messages" },
  emergencyStepEvidenceBody: { zhTW: "保留 LINE、簡訊、轉帳紀錄、網址與對方帳號。165 或警方事後可能需要這些資料。", enUS: "Keep LINE chats, SMS, payment records, URLs, and account names. 165 or police may need them later." },
  emergencyStepPasswordTitle: { zhTW: "如果輸入過密碼：改掉共用密碼", enUS: "If a password was entered: change reused passwords" },
  emergencyStepPasswordBody: { zhTW: "先改網銀、Email、購物與社群帳號。任何和該密碼相同或相近的帳號都要處理。", enUS: "Start with banking, email, shopping, and social accounts. Change any account using the same or similar password." },
  warnFamily: { zhTW: "警告家人朋友", enUS: "Warn family and friends" },
  warningMessageCopied: { zhTW: "已複製警告訊息", enUS: "Warning message copied" },
  consentText: { zhTW: "了解鏈證只會開啟官方管道，最後送出仍以官方頁面為準。", enUS: "LinkProof only opens the official channel. Final submission happens on the official page." },
  history: { zhTW: "紀錄", enUS: "History" },
  reports: { zhTW: "官方管道紀錄", enUS: "Official channel records" },
  settings: { zhTW: "設定", enUS: "Settings" },
  language: { zhTW: "語言", enUS: "Language" },
  privacy: { zhTW: "隱私", enUS: "Privacy" },
  privacyBody: { zhTW: "查核先在本機比對公開資料包；資料只留在這台裝置，不會上傳。告訴 165 前會再次確認資料。", enUS: "Checks run against the local public-data bundle. Data stays on this device and is never uploaded. Official handoff asks for confirmation first." },
  clearLocalData: { zhTW: "刪除本機紀錄", enUS: "Delete local records" },
  noReports: { zhTW: "尚無官方管道紀錄", enUS: "No official channel records yet" },
  noHistory: { zhTW: "尚無查核紀錄", enUS: "No check history yet" },
  checked: { zhTW: "查核時間", enUS: "Checked" },
  sourceUpdated: { zhTW: "來源日期", enUS: "Source date" },
  normalizedURL: { zhTW: "正規化網址", enUS: "Normalized URL" },
  defangedURLRestored: { zhTW: "已自動還原防誤點網址", enUS: "Defanged URL restored" },
  defangedURLRestoredBody: { zhTW: "只在鏈證內用於查核，沒有開啟連結。", enUS: "Used only inside LinkProof for checking. The link was not opened." },
  notGovernmentAgency: { zhTW: "鏈證不是政府機關，不會替你完成報案。", enUS: "LinkProof is not a government agency and does not complete reports for you." },
  done: { zhTW: "完成", enUS: "Done" },
  home: { zhTW: "查核", enUS: "Check" },
  inputSectionTitle: { zhTW: "輸入要查核的網址", enUS: "Enter a URL to check" },
  inputHelper: { zhTW: "可貼上完整網址，也可貼上包含網址的訊息內容。鏈證會擷取第一個可查核網址。", enUS: "Paste a full URL or a message that contains one. LinkProof checks the first detectable URL." },
  copyNormalizedURL: { zhTW: "複製網址", enUS: "Copy URL" },
  copiedNormalizedURL: { zhTW: "已複製網址", enUS: "URL copied" },
  reportChecklist: { zhTW: "開啟前準備", enUS: "Before opening" },
  reportChannelExplanation: { zhTW: "鏈證會協助你把已正規化的網址帶到官方管道旁邊；實際送出仍在官方網站完成。", enUS: "LinkProof helps you carry the normalized URL into the official channel; final submission still happens on the official website." },
  reportHandoffNote: { zhTW: "開啟官方網站前，建議先複製網址；若頁面要求登入、手機或驗證碼，請依官方網站指示完成。", enUS: "Copy the URL before opening the official website. If the page asks for login, phone verification, or a code, follow the official site's instructions." },
  copyReportURL: { zhTW: "複製查核網址", enUS: "Copy checked URL" },
  copyReportURLDone: { zhTW: "查核網址已複製", enUS: "Checked URL copied" },
  officialWebsite: { zhTW: "官方網站", enUS: "Official website" },
  domain: { zhTW: "網域", enUS: "Domain" },
  datasetBundle: { zhTW: "資料包版本", enUS: "Dataset bundle" },
  matchedValue: { zhTW: "命中值", enUS: "Matched value" },
  datasetUpdateTitle: { zhTW: "風險資料包", enUS: "Risk dataset" },
  advancedDatasetInfo: { zhTW: "進階資訊", enUS: "Advanced details" },
  datasetUpdateStatus: { zhTW: "同步狀態", enUS: "Sync status" },
  datasetSource: { zhTW: "資料來源", enUS: "Dataset source" },
  datasetRecordCount: { zhTW: "資料筆數", enUS: "Record count" },
  datasetLastChecked: { zhTW: "上次檢查", enUS: "Last checked" },
  datasetFailureReason: { zhTW: "失敗原因", enUS: "Failure reason" },
  datasetStatusFootnote: { zhTW: "鏈證會先驗證 manifest 與 SHA-256 校驗碼；若遠端資料異常，會保留目前可用資料包。", enUS: "LinkProof verifies the manifest and SHA-256 checksum first; if the remote dataset is invalid, it keeps the current usable bundle." },
  updateDataset: { zhTW: "更新資料包", enUS: "Update dataset" },
  updatingDataset: { zhTW: "正在更新資料包", enUS: "Updating dataset" },
  datasetUpdateIdle: { zhTW: "待檢查", enUS: "Idle" },
  datasetUpdateChecking: { zhTW: "正在檢查", enUS: "Checking" },
  datasetUpdateSucceededState: { zhTW: "已更新", enUS: "Updated" },
  datasetUpdateAlreadyCurrentState: { zhTW: "已是最新", enUS: "Current" },
  datasetUpdateFailedState: { zhTW: "更新失敗", enUS: "Update failed" },
  datasetUpdateSucceeded: { zhTW: "資料包已更新。", enUS: "Dataset updated." },
  datasetAlreadyCurrent: { zhTW: "目前已是最新資料包。", enUS: "Dataset is already current." },
  datasetUpdateFailed: { zhTW: "目前無法更新資料，將使用最近一次資料查核。", enUS: "Dataset update failed. LinkProof will keep using the latest available dataset." },
  datasetUpdateRejected: { zhTW: "資料包驗證失敗，已保留目前版本。", enUS: "Dataset verification failed. LinkProof kept the current version." },
  datasetUpdateUnavailable: { zhTW: "尚未設定遠端資料來源。", enUS: "Remote dataset source is not configured." },
  datasetBackgroundUpdateFailed: { zhTW: "背景更新失敗，已保留目前資料包。", enUS: "Background update failed. LinkProof kept the current dataset." },
  unavailableValue: { zhTW: "無", enUS: "Unavailable" },
  externalProvider: { zhTW: "外部來源", enUS: "External provider" },
  category: { zhTW: "分類", enUS: "Category" },
  installHint: { zhTW: "想隨時查證？用 Safari 的「加入主畫面」把鏈證裝到手機。", enUS: "Want it handy? Use Safari's \"Add to Home Screen\" to install LinkProof." },
  shareUnsupported: { zhTW: "此瀏覽器不支援分享，已複製到剪貼簿。", enUS: "Sharing is unsupported here; copied to the clipboard instead." },
  loadingDataset: { zhTW: "正在準備公開資料包…", enUS: "Preparing the public-data bundle…" },
  firstLoadHint: { zhTW: "首次使用需要連線下載公開資料包，之後可離線查核。", enUS: "First use downloads the public-data bundle; later checks work offline." },
  datasetOfflineNote: { zhTW: "公開資料包尚未載入，本次僅用本機規則判定，可能漏掉已在案的詐騙網站。連網後請再查一次。", enUS: "The public dataset is not loaded yet — this check used local rules only and may miss already-reported scams. Re-check once you're online." },
};

export function t(key: L10nKey, language: AppLanguage): string {
  return localized(STRINGS[key], language);
}

const SOURCE_TITLES: Record<RiskDatasetSourceKind, LocalizedCopy> = {
  unloaded: { zhTW: "尚未載入", enUS: "Not loaded" },
  bundled: { zhTW: "內建資料包", enUS: "Bundled dataset" },
  remoteCache: { zhTW: "已同步資料包", enUS: "Synced dataset" },
  missing: { zhTW: "找不到資料包", enUS: "Dataset missing" },
};

export function datasetSourceTitle(kind: RiskDatasetSourceKind, language: AppLanguage): string {
  return localized(SOURCE_TITLES[kind], language);
}

const FAILURE_TITLES: Record<RiskDatasetUpdateFailure, LocalizedCopy> = {
  sourceUnavailable: { zhTW: "遠端資料來源未設定", enUS: "Remote source not configured" },
  network: { zhTW: "網路連線或伺服器回應失敗", enUS: "Network or server response failed" },
  invalidManifest: { zhTW: "Manifest 格式無法解析", enUS: "Manifest could not be parsed" },
  invalidDataset: { zhTW: "資料包格式不符合 App 支援版本", enUS: "Dataset format is not supported" },
  checksumMismatch: { zhTW: "資料包校驗碼不一致", enUS: "Dataset checksum mismatch" },
  cacheWriteFailed: { zhTW: "本機快取寫入失敗", enUS: "Local cache write failed" },
};

export function datasetFailureTitle(failure: RiskDatasetUpdateFailure, language: AppLanguage): string {
  return localized(FAILURE_TITLES[failure], language);
}
