// All of the window's selections and data, in one store (src/ui-context.js
// createStore): views subscribe by topic, tests reset it as a whole.
const store = window.UiContext.createStore(() => ({
  profiles: [],
  sessions: [],
  filteredSessions: [],
  ui: window.UiContext.create(),
  sessionView: 'compact',
  sessionOrder: 'recent',
  sessionSort: { key: 'updatedAt', direction: 'desc' },
  query: '',
  theme: null,
  agentOrder: [],
  detailMode: 'session',
  detailBeforeRemote: 'session',
  utilityDialog: null,
  activity: {},
  quotas: {},
  quotaError: null,
  quotaAnchor: null,
  // 档案或额度浮层打开期间被操作的那只猫；平时为空，等于正在看的那只。
  actionAgentId: null,
  profileQuitBehavior: 'close',
  welcomed: false,
  onboardingProgress: { completedVersion: 0, completedAt: null },
  startupStage: 'created',
  firstUse: {
    mode: 'guide',
    model: null,
    busy: false
  },
  updateInfo: null,
  tools: null,
  mesh: {
    overview: null,
    sessionSource: 'none',
    sessionErrorCode: null,
    loading: false,
    errorCode: null,
    message: '',
    invitation: null,
    permissionDeviceId: null,
    diagnosticDeviceId: null,
    diagnostics: null,
    diagnosticsLoading: false,
    diagnosticsError: null,
    networkLoading: false,
    deviceJourney: null,
    editingAgentId: null,
    removingAgentId: null,
    removingSlotKey: null,
    relationAgentId: null,
    assigningSlotKey: null,
    provisioningAppByAgentAndDevice: {},
    provisioningBusyKey: null,
    remoteSessions: [],
    transfers: [],
    transferLoading: false,
    transferMessage: ''
  },
  // 调度中枢：Main 推过来的后台对话（公开字段）。pending 是信封还在路上的那几段，落地后才进账本。
  hub: {
    runs: new Map(),
    pending: new Map(),
    fresh: new Set(),
    overrides: new Map(),
    lastStartByCaller: new Map(),
    sent: [],
    ticker: null,
    // 档案里的两个开关与系统页的文件夹、上限：只在桌面窗口里改，数据来自 Main 的 hub:state
    accounts: [],
    clients: {},
    folders: [],
    maxConcurrent: 2,
    saving: false
  },
  taskPackages: {
    history: [],
    exportPreview: null,
    exportSource: null,
    exportBusy: false,
    exportCode: null,
    exportDelivery: 'portable',
    directTargetDeviceId: null,
    directTransfer: null,
    directBusyTransferId: null,
    importDraft: null,
    importPreview: null,
    importBusy: false,
    importMode: 'portable',
    importTransferId: null
  },
  appMeta: {
    claude: { label: 'Claude', tagColor: '#d96f33', taskPackageMode: 'unsupported' },
    codex: { label: 'Codex', tagColor: '#2f9e8f', taskPackageMode: 'native' }
  }
}));
const state = store.state;

const els = {
  accountRoster: document.querySelector('#accountRoster'),
  rosterAllCard: document.querySelector('#rosterAllCard'),
  rosterAllMeta: document.querySelector('#rosterAllMeta'),
  sessionTitle: document.querySelector('#sessionTitle'),
  accountCardTemplate: document.querySelector('#accountCardTemplate'),
  presenterCount: document.querySelector('#presenterCount'),
  quotaChipAll: document.querySelector('#quotaChipAll'),
  topbarContext: document.querySelector('#topbarContext'),
  remoteActivityBtn: document.querySelector('#remoteActivityBtn'),
  langToggle: document.querySelector('#langToggle'),
  agentManageDialog: document.querySelector('#agentManageDialog'),
  agentManageName: document.querySelector('#agentManageName'),
  agentManageLocations: document.querySelector('#agentManageLocations'),
  agentManageNoLocation: document.querySelector('#agentManageNoLocation'),
  agentManageAccountsNote: document.querySelector('#agentManageAccountsNote'),
  agentManageStatus: document.querySelector('#agentManageStatus'),
  agentManageSummary: document.querySelector('#agentManageSummary'),
  agentManageRuntimeLabel: document.querySelector('#agentManageRuntimeLabel'),
  yardManageActions: document.querySelector('#yardManageActions'),
  addRuntimeLocationBtn: document.querySelector('#addRuntimeLocationBtn'),
  systemBtn: document.querySelector('#systemBtn'),
  activityCenterBtn: document.querySelector('#activityCenterBtn'),
  activityCountBadge: document.querySelector('#activityCountBadge'),
  deviceCenterBtn: document.querySelector('#deviceCenterBtn'),
  deviceLensSelect: document.querySelector('#deviceLensSelect'),
  deviceCountBadge: document.querySelector('#deviceCountBadge'),
  mainGrid: document.querySelector('#mainGrid'),
  detailPanel: document.querySelector('#detailPanel'),
  sessionPane: document.querySelector('#sessionPane'),
  remoteWorkspaceHost: document.querySelector('#remoteWorkspaceHost'),
  deviceCenterDialog: document.querySelector('#deviceCenterDialog'),
  deviceCenterMoreMenu: document.querySelector('#deviceCenterMoreMenu'),
  deviceCenterStatus: document.querySelector('#deviceCenterStatus'),
  meshStateBadge: document.querySelector('#meshStateBadge'),
  meshEmptyState: document.querySelector('#meshEmptyState'),
  meshReadyState: document.querySelector('#meshReadyState'),
  meshPreviewStats: document.querySelector('#meshPreviewStats'),
  meshSummary: document.querySelector('#meshSummary'),
  deviceShelfMeta: document.querySelector('#deviceShelfMeta'),
  agentCatalogMeta: document.querySelector('#agentCatalogMeta'),
  deviceList: document.querySelector('#deviceList'),
  deviceDetail: document.querySelector('#deviceDetail'),
  deviceDetailKind: document.querySelector('#deviceDetailKind'),
  deviceDetailName: document.querySelector('#deviceDetailName'),
  deviceDetailMeta: document.querySelector('#deviceDetailMeta'),
  deviceDetailStatus: document.querySelector('#deviceDetailStatus'),
  deviceDetailStats: document.querySelector('#deviceDetailStats'),
  deviceDetailActions: document.querySelector('#deviceDetailActions'),
  meshAgentList: document.querySelector('#meshAgentList'),
  initializeMeshBtn: document.querySelector('#initializeMeshBtn'),
  showJoinMeshBtn: document.querySelector('#showJoinMeshBtn'),
  meshJoinCode: document.querySelector('#meshJoinCode'),
  createDeviceInviteBtn: document.querySelector('#createDeviceInviteBtn'),
  receiveConnectionsBtn: document.querySelector('#receiveConnectionsBtn'),
  networkSettingsBtn: document.querySelector('#networkSettingsBtn'),
  meshInvitePanel: document.querySelector('#meshInvitePanel'),
  meshInviteShortCode: document.querySelector('#meshInviteShortCode'),
  meshInviteCode: document.querySelector('#meshInviteCode'),
  copyDeviceInviteBtn: document.querySelector('#copyDeviceInviteBtn'),
  closeDeviceInviteBtn: document.querySelector('#closeDeviceInviteBtn'),
  resetMeshBtn: document.querySelector('#resetMeshBtn'),
  deviceJourneyDialog: document.querySelector('#deviceJourneyDialog'),
  deviceJourneyCloseBtn: document.querySelector('#deviceJourneyCloseBtn'),
  deviceJourneyProgress: document.querySelector('#deviceJourneyProgress'),
  deviceJourneyIdentity: document.querySelector('#deviceJourneyIdentity'),
  deviceJourneyIdentityLead: document.querySelector('#deviceJourneyIdentityLead'),
  deviceJourneyHost: document.querySelector('#deviceJourneyHost'),
  deviceJourneyInviteEmpty: document.querySelector('#deviceJourneyInviteEmpty'),
  deviceJourneyInvite: document.querySelector('#deviceJourneyInvite'),
  deviceJourneyShortCode: document.querySelector('#deviceJourneyShortCode'),
  deviceJourneyInviteExpiry: document.querySelector('#deviceJourneyInviteExpiry'),
  deviceJourneyInviteCode: document.querySelector('#deviceJourneyInviteCode'),
  deviceJourneyCopyBtn: document.querySelector('#deviceJourneyCopyBtn'),
  deviceJourneyJoin: document.querySelector('#deviceJourneyJoin'),
  deviceJourneyIdentityCard: document.querySelector('#deviceJourneyIdentityCard'),
  deviceJourneyIdentityKind: document.querySelector('#deviceJourneyIdentityKind'),
  deviceJourneyDeviceName: document.querySelector('#deviceJourneyDeviceName'),
  deviceJourneyDeviceMeta: document.querySelector('#deviceJourneyDeviceMeta'),
  deviceJourneyFingerprint: document.querySelector('#deviceJourneyFingerprint'),
  deviceJourneyIdentityConfirm: document.querySelector('#deviceJourneyIdentityConfirm'),
  deviceJourneyFacts: document.querySelector('#deviceJourneyFacts'),
  deviceJourneyFactsLead: document.querySelector('#deviceJourneyFactsLead'),
  deviceJourneyFactList: document.querySelector('#deviceJourneyFactList'),
  deviceJourneyComplete: document.querySelector('#deviceJourneyComplete'),
  deviceJourneyCompleteLead: document.querySelector('#deviceJourneyCompleteLead'),
  deviceJourneyStatus: document.querySelector('#deviceJourneyStatus'),
  deviceJourneyAdvancedBtn: document.querySelector('#deviceJourneyAdvancedBtn'),
  deviceJourneySecondaryBtn: document.querySelector('#deviceJourneySecondaryBtn'),
  deviceJourneyPrimaryBtn: document.querySelector('#deviceJourneyPrimaryBtn'),
  devicePermissionsDialog: document.querySelector('#devicePermissionsDialog'),
  devicePermissionsTitle: document.querySelector('#devicePermissionsTitle'),
  devicePermissionList: document.querySelector('#devicePermissionList'),
  saveDevicePermissionsBtn: document.querySelector('#saveDevicePermissionsBtn'),
  revokeDeviceBtn: document.querySelector('#revokeDeviceBtn'),
  meshDiagnosticsDialog: document.querySelector('#meshDiagnosticsDialog'),
  meshDiagnosticsTitle: document.querySelector('#meshDiagnosticsTitle'),
  meshDiagnosticsStatus: document.querySelector('#meshDiagnosticsStatus'),
  meshDiagnosticsBody: document.querySelector('#meshDiagnosticsBody'),
  refreshMeshDiagnosticsBtn: document.querySelector('#refreshMeshDiagnosticsBtn'),
  meshNetworkDialog: document.querySelector('#meshNetworkDialog'),
  meshSignalingUrls: document.querySelector('#meshSignalingUrls'),
  meshStunUrls: document.querySelector('#meshStunUrls'),
  meshNetworkStatus: document.querySelector('#meshNetworkStatus'),
  saveMeshNetworkBtn: document.querySelector('#saveMeshNetworkBtn'),
  sessionSendDialog: document.querySelector('#sessionSendDialog'),
  sessionSendTarget: document.querySelector('#sessionSendTarget'),
  fileSendDialog: document.querySelector('#fileSendDialog'),
  fileSendTarget: document.querySelector('#fileSendTarget'),
  fileSendStatus: document.querySelector('#fileSendStatus'),
  chooseFilesBtn: document.querySelector('#chooseFilesBtn'),
  confirmSessionSendBtn: document.querySelector('#confirmSessionSendBtn'),
  sessionSendStatus: document.querySelector('#sessionSendStatus'),
  importTaskPackageBtn: document.querySelector('#importTaskPackageBtn'),
  inboxRecords: document.querySelector('#inboxRecords'),
  activityCenterDialog: document.querySelector('#activityCenterDialog'),
  systemDialog: document.querySelector('#systemDialog'),
  refreshTransfersBtn: document.querySelector('#refreshTransfersBtn'),
  transferList: document.querySelector('#transferList'),
  taskPackageHistory: document.querySelector('#taskPackageHistory'),
  taskPackageHistoryCount: document.querySelector('#taskPackageHistoryCount'),
  taskPackageHistoryList: document.querySelector('#taskPackageHistoryList'),
  taskPackageHistoryEmpty: document.querySelector('#taskPackageHistoryEmpty'),
  incomingTaskPackages: document.querySelector('#incomingTaskPackages'),
  incomingTaskPackageCount: document.querySelector('#incomingTaskPackageCount'),
  incomingTaskPackageList: document.querySelector('#incomingTaskPackageList'),
  toolCenterStatus: document.querySelector('#toolCenterStatus'),
  toolSummary: document.querySelector('#toolSummary'),
  toolCheckedAt: document.querySelector('#toolCheckedAt'),
  desktopToolList: document.querySelector('#desktopToolList'),
  supportedToolList: document.querySelector('#supportedToolList'),
  cliToolList: document.querySelector('#cliToolList'),
  checkToolsBtn: document.querySelector('#checkToolsBtn'),
  attentionInbox: document.querySelector('#attentionInbox'),
  attentionCount: document.querySelector('#attentionCount'),
  attentionItems: document.querySelector('#attentionItems'),
  attentionEmpty: document.querySelector('#attentionEmpty'),
  themeToggle: document.querySelector('#themeToggle'),
  profileQuitBehavior: document.querySelector('#profileQuitBehavior'),
  updateBtn: document.querySelector('#updateBtn'),
  helpBtn: document.querySelector('#helpBtn'),
  addProfileBtn: document.querySelector('#addProfileBtn'),
  editProfileBtn: document.querySelector('#editProfileBtn'),
  removeProfileBtn: document.querySelector('#removeProfileBtn'),
  manageAgentRelationsBtn: document.querySelector('#manageAgentRelationsBtn'),
  pathConfigBtn: document.querySelector('#pathConfigBtn'),
  diagnosticsBtn: document.querySelector('#diagnosticsBtn'),
  stopProfileBtn: document.querySelector('#stopProfileBtn'),
  cleanCrashpadBtn: document.querySelector('#cleanCrashpadBtn'),
  profileFolderBtn: document.querySelector('#profileFolderBtn'),
  refreshBtn: document.querySelector('#refreshBtn'),
  quotaOverview: document.querySelector('#quotaOverview'),
  quotaOverviewList: document.querySelector('#quotaOverviewList'),
  quotaOverviewMeta: document.querySelector('#quotaOverviewMeta'),
  quotaPopover: document.querySelector('#quotaPopover'),
  quotaPopoverTitle: document.querySelector('#quotaPopoverTitle'),
  quotaPopoverClose: document.querySelector('#quotaPopoverClose'),
  quotaSummary: document.querySelector('#quotaSummary'),
  quotaPlan: document.querySelector('#quotaPlan'),
  quotaStateBadge: document.querySelector('#quotaStateBadge'),
  quotaRefreshBtn: document.querySelector('#quotaRefreshBtn'),
  quotaMeters: document.querySelector('#quotaMeters'),
  quotaMessage: document.querySelector('#quotaMessage'),
  sessionCount: document.querySelector('#sessionCount'),
  searchInput: document.querySelector('#searchInput'),
  sessionCompactBtn: document.querySelector('#sessionCompactBtn'),
  sessionDetailBtn: document.querySelector('#sessionDetailBtn'),
  sessionDisplayMenu: document.querySelector('#sessionDisplayMenu'),
  sessionPane: document.querySelector('#sessionPane'),
  clearSessionFiltersBtn: document.querySelector('#clearSessionFiltersBtn'),
  markAllSeenBtn: document.querySelector('#markAllSeenBtn'),
  tagCheckedSessionsBtn: document.querySelector('#tagCheckedSessionsBtn'),
  sessionDisplayLabel: document.querySelector('#sessionDisplayLabel'),
  sessionSelectionBar: document.querySelector('#sessionSelectionBar'),
  sessionSelectionCount: document.querySelector('#sessionSelectionCount'),
  sessionSelectionNotice: document.querySelector('#sessionSelectionNotice'),
  sessionSelectionIssue: document.querySelector('#sessionSelectionIssue'),
  clearSessionSelectionBtn: document.querySelector('#clearSessionSelectionBtn'),
  sessionTable: document.querySelector('#sessionTable'),
  sessionHead: document.querySelector('#sessionHead'),
  sessionRows: document.querySelector('#sessionRows'),
  hubLinks: document.querySelector('#hubLinks'),
  hubFooter: document.querySelector('#hubFooter'),
  hubCallingSection: document.querySelector('#hubCallingSection'),
  hubCallingName: document.querySelector('#hubCallingName'),
  hubAllowCall: document.querySelector('#hubAllowCall'),
  hubAllowWrite: document.querySelector('#hubAllowWrite'),
  hubAllowCallState: document.querySelector('#hubAllowCallState'),
  hubAllowWriteState: document.querySelector('#hubAllowWriteState'),
  hubCallingNotes: document.querySelector('#hubCallingNotes'),
  hubAddFolderBtn: document.querySelector('#hubAddFolderBtn'),
  hubFolderList: document.querySelector('#hubFolderList'),
  hubMaxConcurrent: document.querySelector('#hubMaxConcurrent'),
  sendSessionInfoLabel: document.querySelector('#sendSessionInfoLabel'),
  deskParked: document.querySelector('#deskParked'),
  copySessionInfoBtn: document.querySelector('#copySessionInfoBtn'),
  sendSessionInfoBtn: document.querySelector('#sendSessionInfoBtn'),
  statusBar: document.querySelector('#statusBar'),
  statusText: document.querySelector('#statusText'),
  chooseSessionReplicaBtn: document.querySelector('#chooseSessionReplicaBtn'),
  sessionReplicaPicker: document.querySelector('#sessionReplicaPicker'),
  sessionReplicaOptions: document.querySelector('#sessionReplicaOptions'),
  sessionDirectoryDialog: document.querySelector('#sessionDirectoryDialog'),
  sessionDirectoryOptions: document.querySelector('#sessionDirectoryOptions'),
  sessionDirectoryStatus: document.querySelector('#sessionDirectoryStatus'),
  openSessionFileBtn: document.querySelector('#openSessionFileBtn'),
  exportSessionBtn: document.querySelector('#exportSessionBtn'),
  taskPackageActionBtn: document.querySelector('#taskPackageActionBtn'),
  taskPackageDialog: document.querySelector('#taskPackageDialog'),
  taskPackageCloseBtn: document.querySelector('#taskPackageCloseBtn'),
  taskPackageCancelBtn: document.querySelector('#taskPackageCancelBtn'),
  taskPackagePreview: document.querySelector('#taskPackagePreview'),
  taskPackageSender: document.querySelector('#taskPackageSender'),
  taskPackageObjective: document.querySelector('#taskPackageObjective'),
  taskPackageCompleted: document.querySelector('#taskPackageCompleted'),
  taskPackageNext: document.querySelector('#taskPackageNext'),
  taskPackageBlockers: document.querySelector('#taskPackageBlockers'),
  taskPackageAcceptance: document.querySelector('#taskPackageAcceptance'),
  taskPackageIncludeProject: document.querySelector('#taskPackageIncludeProject'),
  taskPackageIncludeAttachments: document.querySelector('#taskPackageIncludeAttachments'),
  taskPackageDeliveryPortable: document.querySelector('#taskPackageDeliveryPortable'),
  taskPackageDeliveryDirect: document.querySelector('#taskPackageDeliveryDirect'),
  taskPackageDirectTargetField: document.querySelector('#taskPackageDirectTargetField'),
  taskPackageDirectTarget: document.querySelector('#taskPackageDirectTarget'),
  taskPackageDirectAvailability: document.querySelector('#taskPackageDirectAvailability'),
  taskPackageSecurity: document.querySelector('#taskPackageSecurity'),
  taskPackageExportResult: document.querySelector('#taskPackageExportResult'),
  taskPackageUnlockCode: document.querySelector('#taskPackageUnlockCode'),
  copyTaskPackageCodeBtn: document.querySelector('#copyTaskPackageCodeBtn'),
  taskPackageDirectResult: document.querySelector('#taskPackageDirectResult'),
  taskPackageDirectResultDetail: document.querySelector('#taskPackageDirectResultDetail'),
  taskPackageSwitchPortableBtn: document.querySelector('#taskPackageSwitchPortableBtn'),
  taskPackageStatus: document.querySelector('#taskPackageStatus'),
  exportTaskPackageBtn: document.querySelector('#exportTaskPackageBtn'),
  taskPackageImportDialog: document.querySelector('#taskPackageImportDialog'),
  taskPackageImportCloseBtn: document.querySelector('#taskPackageImportCloseBtn'),
  taskPackageImportCancelBtn: document.querySelector('#taskPackageImportCancelBtn'),
  taskPackagePortableImportSource: document.querySelector('#taskPackagePortableImportSource'),
  taskPackageDirectImportSource: document.querySelector('#taskPackageDirectImportSource'),
  taskPackageDirectImportTitle: document.querySelector('#taskPackageDirectImportTitle'),
  taskPackageDirectImportMeta: document.querySelector('#taskPackageDirectImportMeta'),
  chooseTaskPackageFileBtn: document.querySelector('#chooseTaskPackageFileBtn'),
  taskPackageImportFile: document.querySelector('#taskPackageImportFile'),
  taskPackageImportCode: document.querySelector('#taskPackageImportCode'),
  inspectTaskPackageBtn: document.querySelector('#inspectTaskPackageBtn'),
  taskPackageImportPreview: document.querySelector('#taskPackageImportPreview'),
  taskPackageTargetField: document.querySelector('#taskPackageTargetField'),
  taskPackageTargetProfile: document.querySelector('#taskPackageTargetProfile'),
  taskPackageOpenField: document.querySelector('#taskPackageOpenField'),
  taskPackageOpenAfter: document.querySelector('#taskPackageOpenAfter'),
  taskPackageImportStatus: document.querySelector('#taskPackageImportStatus'),
  commitTaskPackageBtn: document.querySelector('#commitTaskPackageBtn'),
  profileDialog: document.querySelector('#profileDialog'),
  recruitDialog: document.querySelector('#recruitDialog'),
  onboardingCodexImportBtn: document.querySelector('#onboardingCodexImportBtn'),
  agentCreateDialog: document.querySelector('#agentCreateDialog'),
  newAgentName: document.querySelector('#newAgentName'),
  newAgentApp: document.querySelector('#newAgentApp'),
  newAgentGroup: document.querySelector('#newAgentGroup'),
  newAgentNote: document.querySelector('#newAgentNote'),
  confirmAddAgentBtn: document.querySelector('#confirmAddAgentBtn'),
  profileDialogTitle: document.querySelector('#profileDialogTitle'),
  newProfileMeshAssignment: document.querySelector('#newProfileMeshAssignment'),
  newProfileMode: document.querySelector('#newProfileMode'),
  newProfileAgentField: document.querySelector('#newProfileAgentField'),
  newProfileAgent: document.querySelector('#newProfileAgent'),
  newProfileBindingField: document.querySelector('#newProfileBindingField'),
  newProfileBinding: document.querySelector('#newProfileBinding'),
  newProfileAssignmentHint: document.querySelector('#newProfileAssignmentHint'),
  newProfileApp: document.querySelector('#newProfileApp'),
  newProfileName: document.querySelector('#newProfileName'),
  newProfileGroup: document.querySelector('#newProfileGroup'),
  newProfileNote: document.querySelector('#newProfileNote'),
  confirmAddProfileBtn: document.querySelector('#confirmAddProfileBtn'),
  editDialog: document.querySelector('#editDialog'),
  editDialogTitle: document.querySelector('#editDialogTitle'),
  editAgentHint: document.querySelector('#editAgentHint'),
  editIdentityField: document.querySelector('#editIdentityField'),
  editName: document.querySelector('#editName'),
  editIdentity: document.querySelector('#editIdentity'),
  editGroup: document.querySelector('#editGroup'),
  editNote: document.querySelector('#editNote'),
  confirmEditBtn: document.querySelector('#confirmEditBtn'),
  editCatCanvas: document.querySelector('#editCatCanvas'),
  editCatLookName: document.querySelector('#editCatLookName'),
  editCatLookNote: document.querySelector('#editCatLookNote'),
  editCatRandom: document.querySelector('#editCatRandom'),
  editBreedSwatches: document.querySelector('#editBreedSwatches'),
  editCollarSwatches: document.querySelector('#editCollarSwatches'),
  editAccSwatches: document.querySelector('#editAccSwatches'),
  removeCatalogDialog: document.querySelector('#removeCatalogDialog'),
  removeCatalogIntro: document.querySelector('#removeCatalogIntro'),
  removeCatalogImpact: document.querySelector('#removeCatalogImpact'),
  removeLocalRegistrationField: document.querySelector('#removeLocalRegistrationField'),
  removeLocalRegistration: document.querySelector('#removeLocalRegistration'),
  confirmRemoveCatalogBtn: document.querySelector('#confirmRemoveCatalogBtn'),
  agentRelationsDialog: document.querySelector('#agentRelationsDialog'),
  agentRelationsSummary: document.querySelector('#agentRelationsSummary'),
  mergeAgentTarget: document.querySelector('#mergeAgentTarget'),
  confirmMergeAgentBtn: document.querySelector('#confirmMergeAgentBtn'),
  splitAccountBinding: document.querySelector('#splitAccountBinding'),
  splitAgentName: document.querySelector('#splitAgentName'),
  confirmSplitBindingBtn: document.querySelector('#confirmSplitBindingBtn'),
  agentRelationsStatus: document.querySelector('#agentRelationsStatus'),
  slotAssignmentDialog: document.querySelector('#slotAssignmentDialog'),
  slotAssignmentSummary: document.querySelector('#slotAssignmentSummary'),
  slotAssignmentMode: document.querySelector('#slotAssignmentMode'),
  slotAssignmentAgentField: document.querySelector('#slotAssignmentAgentField'),
  slotAssignmentAgent: document.querySelector('#slotAssignmentAgent'),
  slotAssignmentBindingField: document.querySelector('#slotAssignmentBindingField'),
  slotAssignmentBinding: document.querySelector('#slotAssignmentBinding'),
  slotAssignmentName: document.querySelector('#slotAssignmentName'),
  slotAssignmentGroup: document.querySelector('#slotAssignmentGroup'),
  slotAssignmentNote: document.querySelector('#slotAssignmentNote'),
  slotAssignmentStatus: document.querySelector('#slotAssignmentStatus'),
  confirmSlotAssignmentBtn: document.querySelector('#confirmSlotAssignmentBtn'),
  groupOptions: document.querySelector('#groupOptions'),
  welcomeDialog: document.querySelector('#welcomeDialog'),
  welcomeDialogCloseBtn: document.querySelector('#welcomeDialogCloseBtn'),
  welcomeDialogKicker: document.querySelector('#welcomeDialogKicker'),
  welcomeDialogTitle: document.querySelector('#welcomeDialogTitle'),
  welcomeDialogLead: document.querySelector('#welcomeDialogLead'),
  welcomeGuideContent: document.querySelector('#welcomeGuideContent'),
  onboardingContent: document.querySelector('#onboardingContent'),
  onboardingProgress: document.querySelector('#onboardingProgress'),
  onboardingMigration: document.querySelector('#onboardingMigration'),
  onboardingMigrationList: document.querySelector('#onboardingMigrationList'),
  onboardingAgent: document.querySelector('#onboardingAgent'),
  onboardingAgentName: document.querySelector('#onboardingAgentName'),
  onboardingAgentClient: document.querySelector('#onboardingAgentClient'),
  onboardingMigrationSummary: document.querySelector('#onboardingMigrationSummary'),
  onboardingPreparation: document.querySelector('#onboardingPreparation'),
  onboardingPreparationIcon: document.querySelector('#onboardingPreparationIcon'),
  onboardingPreparationState: document.querySelector('#onboardingPreparationState'),
  onboardingPreparationDetail: document.querySelector('#onboardingPreparationDetail'),
  onboardingExisting: document.querySelector('#onboardingExisting'),
  onboardingExistingAgents: document.querySelector('#onboardingExistingAgents'),
  onboardingComplete: document.querySelector('#onboardingComplete'),
  onboardingStatus: document.querySelector('#onboardingStatus'),
  onboardingFooter: document.querySelector('#onboardingFooter'),
  onboardingAdvancedBtn: document.querySelector('#onboardingAdvancedBtn'),
  onboardingBackBtn: document.querySelector('#onboardingBackBtn'),
  onboardingSecondaryBtn: document.querySelector('#onboardingSecondaryBtn'),
  onboardingPrimaryBtn: document.querySelector('#onboardingPrimaryBtn'),
  pathDialog: document.querySelector('#pathDialog'),
  profilePathInput: document.querySelector('#profilePathInput'),
  sessionRootInput: document.querySelector('#sessionRootInput'),
  executablePathInput: document.querySelector('#executablePathInput'),
  pickProfilePathBtn: document.querySelector('#pickProfilePathBtn'),
  pickSessionRootBtn: document.querySelector('#pickSessionRootBtn'),
  pickExecutablePathBtn: document.querySelector('#pickExecutablePathBtn'),
  confirmPathBtn: document.querySelector('#confirmPathBtn'),
  diagnosticsDialog: document.querySelector('#diagnosticsDialog'),
  diagnosticsBody: document.querySelector('#diagnosticsBody'),
  copyDiagnosticsBtn: document.querySelector('#copyDiagnosticsBtn')
};

let lastDiagnostics = null;
let quotaHasLoaded = false;
let quotaRequestedAt = 0;
const QUOTA_REFRESH_INTERVAL = 5 * 60_000;
const FOREGROUND_SESSION_REFRESH_INTERVAL = 2_000;
// The cards follow the 8-second activity poll; the list follows it too when a
// listed account wrote something new, but reloads at most this often (each
// reload rescans the listed accounts).
const ACTIVITY_SESSION_REFRESH_INTERVAL = 30_000;

// The functions handed over here are looked up when called (they live in the
// view modules, which run after this script).
const toolCenter = window.createToolCenter({
  document,
  manager: window.manager,
  els,
  tr: (...args) => tr(...args),
  compactDate: (...args) => compactDate(...args),
  currentProfileId: (...args) => currentProfileId(...args),
  setStatus: (...args) => setStatus(...args)
});
state.tools = toolCenter.state;
const { refreshToolInventory, renderToolCenter, handleToolProgress } = toolCenter;
// 招募：一个弹窗四段（新来一只、把已有的领回来、拖进来、交给 AI）。
const recruitDialog = window.createRecruitDialog({
  document,
  manager: window.manager,
  tr: (...args) => tr(...args),
  platform: window.manager.windowPlatform,
  getApps: () => Object.entries(state.appMeta).map(([id, meta]) => ({ id, ...meta })),
  isMeshReady: () => state.mesh.overview?.initialized === true,
  createWithMesh: ({ displayName, appId }) => createAgentAndPrepare({ displayName, requestedAppId: appId }),
  afterAccountChange: (profileId) => afterRecruitedAccount(profileId),
  openDialog: (dialog) => openDialog(dialog)
});

// 会话的记号：新回复、在跑、颜色标签与搜索框左边那排筛选（docs/SESSION_MARKS_PLAN.md）。
const sessionMarks = window.createSessionMarks({
  document,
  manager: window.manager,
  tr: (...args) => tr(...args),
  keyOf: (session) => window.SessionTable.markKeyOf(session),
  rerender: () => applySessionFilter(),
  setStatus: (message, tone) => setStatus(message, tone),
  onChange: () => { applySessionFilter(); renderAccountRoster(); }
});

// 启动阶段同时广播出去：开灯编排（pixel/boot.js）据此在页脚如实说正在等什么。
function setStartupStage(stage, step = null) {
  state.startupStage = stage;
  document.dispatchEvent(new CustomEvent('agentdesk:startup', { detail: { stage, step } }));
}

window.addEventListener('DOMContentLoaded', async () => {
  document.documentElement.dataset.windowPlatform = window.manager.windowPlatform || 'browser';
  setStartupStage('settings-loading');
  await loadUserSettings();
  await sessionMarks.load();
  sessionMarks.setOrder(state.sessionOrder);
  initTheme();
  mountWorkspaceSurfaces();
  bindEvents();
  await loadApps();
  setStartupStage('settings-loading', 'devices');
  await loadDeviceOverview({ silent: true, skipWorkspaceRefresh: true });
  setStartupStage('profiles-loading');
  await loadProfiles(null, { presentFirstUseBeforeSessions: true });
  setStartupStage('task-package-history-loading');
  await loadTaskPackageHistory();
  setStartupStage('ready');
  loadActivity();
  loadQuotas();
  // 卡片中的活动和最近活跃在可见时定时刷新。
  // 8 秒一轮：干活/在岗要跟得上会话节奏，60 秒太钝会漏掉短生成；应用在后台时不扫。
  setInterval(() => {
    if (!document.hidden) loadActivity();
  }, 8000);
  // 额度查询走独立的慢轮询和主进程缓存，绝不混入 8 秒活跃度探测。
  setInterval(() => {
    if (!document.hidden) loadQuotas();
  }, QUOTA_REFRESH_INTERVAL);
  // 从最小化/后台切回前台时立刻刷新一次，别等下一轮
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    refreshSessionsOnForeground();
    loadActivity();
    if (Date.now() - quotaRequestedAt >= QUOTA_REFRESH_INTERVAL) loadQuotas();
  });
  window.addEventListener('focus', refreshSessionsOnForeground);
});

function bindEvents() {
  // Main's change notifications become store topics; the handlers below subscribe.
  bindMainEvents();
  bindEntryEvents();
  bindAgentCreationEvents();
  bindFirstUseEvents();
  bindCatalogDialogEvents();
  bindUpdateEvents();
  bindSettingsEvents();
  bindUtilityDialogEvents();
  bindDeviceEvents();
  bindSystemEvents();
  bindMeshChangeEvents();
  bindHubEvents();
  bindTransferChangeEvents();
  bindRemoteEvents();
  bindAgentManageEvents();
  bindQuotaEvents();
  bindContextMenuRules();
  bindQuotaRefreshEvents();
  bindSessionTableEvents();
  bindSessionActionEvents();
  bindTransferEvents();
  bindTaskPackageEvents();
  bindTransferDialogEvents();
  bindSessionFileEvents();
}

// ── 猫咪档案卡（编辑对话框换装） ─────────────────────
// 只有三项：毛色（分三组）、项圈颜色、一件配饰。左边的预览按批准的动作逐帧在动。
let catDraft = { look: 'orange', collar: '#c94f2e', accessory: 'none' };
let catBase = null;
let editingProfile = null;
let catSwatchesBuilt = false;

// 换语言时，编辑器里的组名和小样说明跟着换
window.addEventListener('i18n:changed', () => {
  if (!catSwatchesBuilt) return;
  els.editBreedSwatches.querySelectorAll('[data-cat-group]').forEach((title) => { title.textContent = tr('cat.group.' + title.dataset.catGroup); });
  els.editBreedSwatches.querySelectorAll('.cc-tile[data-look]').forEach((tile) => {
    const label = catLookName(tile.dataset.look);
    tile.setAttribute('aria-label', label);
    tile.title = label;
  });
  els.editAccSwatches.querySelectorAll('.cc-tile[data-accessory]').forEach((tile) => {
    const label = tr('cat.acc.' + tile.dataset.accessory);
    tile.setAttribute('aria-label', label);
    tile.title = label;
  });
  els.editCollarSwatches.dataset.choices = '';
  syncCatSwatches();
});

// 一个卡片对应一个 Agent，活动、可信额度和运行位置均从同一账号组呈现。
const CARD_STATE_DOT = {
  working: '#6d9440', onduty: '#3d6aa8', arriving: '#e0a63a', confused: '#c94f2e',
  play: '#d05a7a', rest: '#9a8b6a', nap: '#8a7fa8', hibernate: '#6a6a8a'
};

const DEPLOYMENT_STATE_DOT = {
  ready: '#4f8a42',
  absent: '#8f8778',
  planning: '#3d6aa8',
  preparing: '#3d6aa8',
  verifying: '#3d6aa8',
  'waiting-install': '#c1852d',
  'waiting-login': '#c1852d',
  error: '#c94f2e',
  unsupported: '#7d6c9d',
  offline: '#77736c',
  retired: '#77736c'
};

const READINESS_BADGE = {
  absent: 'plus', planning: 'dots', preparing: 'dots', verifying: 'dots',
  'waiting-install': 'dl', 'waiting-login': 'key', error: 'bang',
  unsupported: 'ban', offline: 'cloud', retired: 'ban'
};

// （旧侧栏行渲染器 appendAccountRow 已随侧栏移除，账号呈现改为 renderAccountRoster 卡片）

const HUB_ACTIVE = new Set(['starting', 'running']);

// What the acceptance run, the hidden-window check and the snapshot tool may
// read or call in this window (docs/ARCHITECTURE_PLAN.md phase 6). They reach
// the renderer only through this object, so its code can move into modules
// without them noticing. Each entry is looked up when it is called.
// replace(name, fn) swaps one listed function for the rest of the run and
// returns the previous one; only continueFirstPreparation can be swapped
// (the acceptance run holds the official-client launch at waiting-login).
const INSPECT_REPLACEABLE = new Set(['continueFirstPreparation']);
window.AgentDeskInspect = Object.freeze({
  get state() { return state; },
  actionAgentId: (...args) => actionAgentId(...args),
  applySessionFilter: (...args) => applySessionFilter(...args),
  collectAttentionItems: (...args) => collectAttentionItems(...args),
  currentAgentId: (...args) => currentAgentId(...args),
  currentCatalogRevision: (...args) => currentCatalogRevision(...args),
  currentSlotKey: (...args) => currentSlotKey(...args),
  enrichMeshSession: (...args) => enrichMeshSession(...args),
  focusSession: (...args) => focusSession(...args),
  loadDeviceOverview: (...args) => loadDeviceOverview(...args),
  openAgentOrProfileEditor: (...args) => openAgentOrProfileEditor(...args),
  openAgentOrProfileRemoval: (...args) => openAgentOrProfileRemoval(...args),
  openAgentRelationsDialog: (...args) => openAgentRelationsDialog(...args),
  openFileSendDialog: (...args) => openFileSendDialog(...args),
  openProfileCreationDialog: (...args) => openProfileCreationDialog(...args),
  openSlotAssignmentDialog: (...args) => openSlotAssignmentDialog(...args),
  openTransferCenter: (...args) => openTransferCenter(...args),
  openUtilityDialog: (...args) => openUtilityDialog(...args),
  renderAccountHeader: (...args) => renderAccountHeader(...args),
  renderAccountRoster: (...args) => renderAccountRoster(...args),
  renderAccounts: (...args) => renderAccounts(...args),
  renderDeviceLens: (...args) => renderDeviceLens(...args),
  renderFirstUse: (...args) => renderFirstUse(...args),
  renderIncomingTaskPackages: (...args) => renderIncomingTaskPackages(...args),
  renderMeshAgentList: (...args) => renderMeshAgentList(...args),
  renderRemoteActivity: (...args) => renderRemoteActivity(...args),
  renderSelectedDeviceDetail: (...args) => renderSelectedDeviceDetail(...args),
  renderSessions: (...args) => renderSessions(...args),
  renderTopbarContext: (...args) => renderTopbarContext(...args),
  rerenderLocalizedText: (...args) => rerenderLocalizedText(...args),
  rosterIsInteracting: (...args) => rosterIsInteracting(...args),
  selectAgent: (...args) => selectAgent(...args),
  sessionAtReplica: (...args) => sessionAtReplica(...args),
  updateLangToggle: (...args) => updateLangToggle(...args),
  validateSessionContext: (...args) => validateSessionContext(...args),
  validateUiContext: (...args) => validateUiContext(...args),
  replace(name, fn) {
    if (!INSPECT_REPLACEABLE.has(name) || typeof fn !== 'function') throw new TypeError('inspect-not-replaceable');
    return replaceContinueFirstPreparation(fn);
  }
});
