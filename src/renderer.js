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
  els.remoteActivityBtn?.addEventListener('click', () => {
    const sessions = activeOutgoingRemoteSessions();
    if (!sessions.length) return;
    const active = sessions.find((item) => item.sessionId === state.ui.activeRemoteSessionId) || sessions[0];
    state.ui = window.UiContext.openRemote(state.ui, active.sessionId);
    setWorkspaceMode('remote');
  });
  els.addProfileBtn.addEventListener('click', () => {
    if (onboardingNeedsPresentation() && openFirstUseDialog({ force: true })) return;
    recruitDialog.open('new');
  });
  // The first-use "导入 Codex" entry opens recruiting's drop section.
  els.onboardingCodexImportBtn?.addEventListener('click', () => {
    if (!state.firstUse.busy) recruitDialog.open('drop');
  });
  if (offersMainEvent('onProfileRegistrationsChanged')) onMainEvent('onProfileRegistrationsChanged', () => {
    void (async () => {
      if (state.mesh.overview?.initialized) {
        await loadDeviceOverview({ silent: true, skipWorkspaceRefresh: true });
      }
      await loadProfiles();
    })().catch(() => setStatus(tr('codexImport.refreshError')));
  });
  els.addRuntimeLocationBtn?.addEventListener('click', () => {
    openProfileCreationDialog({ agentId: actionAgentId() });
  });
  els.confirmAddAgentBtn?.addEventListener('click', () => void confirmAgentCreation());
  els.onboardingAgentName?.addEventListener('input', () => {
    if (!state.firstUse.model) return;
    state.firstUse.model = window.OnboardingState.transition(state.firstUse.model, {
      type: 'draft',
      displayName: els.onboardingAgentName.value
    });
    renderFirstUseActions(state.firstUse.model);
    if (els.onboardingStatus && state.firstUse.model.errorCode === null) {
      els.onboardingStatus.hidden = true;
      els.onboardingStatus.textContent = '';
    }
  });
  els.onboardingAgentClient?.addEventListener('change', () => {
    if (!state.firstUse.model) return;
    state.firstUse.model = window.OnboardingState.transition(state.firstUse.model, {
      type: 'draft',
      ...parseOnboardingClientValue(els.onboardingAgentClient.value)
    });
    renderFirstUseActions(state.firstUse.model);
  });
  els.onboardingBackBtn?.addEventListener('click', () => {
    if (!state.firstUse.model || state.firstUse.busy) return;
    state.firstUse.model = window.OnboardingState.transition(state.firstUse.model, { type: 'back' });
    renderFirstUse();
    focusFirstUseControl();
  });
  els.onboardingSecondaryBtn?.addEventListener('click', () => {
    if (els.onboardingSecondaryBtn.dataset.action === 'later') finishFirstUseLater();
  });
  els.onboardingPrimaryBtn?.addEventListener('click', () => {
    if (!state.firstUse.model || state.firstUse.busy) return;
    const action = els.onboardingPrimaryBtn.dataset.action;
    if (action === 'migration') {
      state.firstUse.model = window.OnboardingState.transition(state.firstUse.model, { type: 'continue' });
      renderFirstUse();
      focusFirstUseControl();
    } else if (action === 'create') {
      void startFirstAgentSetup();
    } else if (action === 'review') {
      state.firstUse.model = window.OnboardingState.transition(state.firstUse.model, { type: 'review-complete' });
      renderFirstUse();
    } else if (action === 'prepare') {
      void continueFirstPreparation();
    } else if (action === 'finish') {
      finishFirstUse();
    }
  });
  els.onboardingAdvancedBtn?.addEventListener('click', () => {
    if (state.firstUse.busy) return;
    recruitDialog.open('existing');
  });
  els.welcomeDialogCloseBtn?.addEventListener('click', () => {
    if (state.firstUse.busy) return;
    els.welcomeDialog?.close();
  });
  els.welcomeDialog?.addEventListener('cancel', (event) => {
    if (state.firstUse.busy) event.preventDefault();
  });
  els.welcomeDialog?.querySelector('form')?.addEventListener('submit', (event) => {
    if (state.firstUse.mode !== 'onboarding') return;
    event.preventDefault();
    if (!els.onboardingPrimaryBtn?.disabled) els.onboardingPrimaryBtn?.click();
  });
  els.newProfileMode?.addEventListener('change', () => syncProfileAssignmentControls());
  els.newProfileApp?.addEventListener('change', () => syncProfileAssignmentControls());
  els.newProfileAgent?.addEventListener('change', () => syncProfileAssignmentControls());
  els.newProfileBinding?.addEventListener('change', () => syncProfileAssignmentControls());
  els.confirmAddProfileBtn.addEventListener('click', (event) => {
    event.preventDefault();
    void confirmProfileCreation();
  });

  els.editProfileBtn.addEventListener('click', () => {
    openAgentOrProfileEditor();
  });
  els.confirmEditBtn.addEventListener('click', (event) => {
    event.preventDefault();
    void confirmAgentOrProfileEdit();
  });

  els.editCatRandom.addEventListener('click', () => {
    const cats = window.YardCats;
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    const look = pick(cats.LOOK_KEYS);
    catDraft = { look, collar: pick(catCollarChoices(look)), accessory: pick(cats.ACCESSORY_KEYS) };
    syncCatSwatches();
    renderCatPreview();
  });

  els.manageAgentRelationsBtn?.addEventListener('click', () => {
    openAgentRelationsDialog();
  });
  els.removeProfileBtn.addEventListener('click', () => {
    void openAgentOrProfileRemoval();
  });
  els.agentManageDialog?.addEventListener('close', () => {
    // 档案关上以后，被操作的猫回到正在看的那只。关闭事件晚到、档案已经为另一只猫重新打开时不动它。
    if (els.agentManageDialog.open) return;
    setActionAgent(null);
    renderAccounts();
  });
  els.removeCatalogDialog?.querySelectorAll('input[name="catalogRemoveScope"]').forEach((radio) => {
    radio.addEventListener('change', () => renderCatalogRemovalImpact());
  });
  els.confirmRemoveCatalogBtn?.addEventListener('click', () => void confirmCatalogRemoval());
  els.removeCatalogDialog?.addEventListener('close', () => {
    state.mesh.removingAgentId = null;
    state.mesh.removingSlotKey = null;
  });
  els.mergeAgentTarget?.addEventListener('change', () => {
    els.confirmMergeAgentBtn.disabled = !catalogAgentById(els.mergeAgentTarget.value);
  });
  els.confirmMergeAgentBtn?.addEventListener('click', () => void confirmAgentMerge());
  els.splitAccountBinding?.addEventListener('change', () => syncSplitAgentName());
  els.splitAgentName?.addEventListener('input', () => syncSplitConfirmState());
  els.confirmSplitBindingBtn?.addEventListener('click', () => void confirmBindingSplit());
  els.agentRelationsDialog?.addEventListener('close', () => {
    state.mesh.relationAgentId = null;
  });
  els.slotAssignmentMode?.addEventListener('change', () => syncSlotAssignmentControls());
  els.slotAssignmentAgent?.addEventListener('change', () => syncSlotAssignmentControls());
  els.slotAssignmentBinding?.addEventListener('change', () => syncSlotAssignmentControls());
  els.confirmSlotAssignmentBtn?.addEventListener('click', () => void confirmSlotAssignment());
  document.querySelector('#removeUnassignedSlotBtn')?.addEventListener('click', () => void removeUnassignedLocalSlot());
  els.slotAssignmentDialog?.addEventListener('close', () => {
    state.mesh.assigningSlotKey = null;
  });
  els.editDialog?.addEventListener('close', () => {
    state.mesh.editingAgentId = null;
  });

  els.updateBtn.addEventListener('click', async () => {
    await handleUpdateClick();
  });

  onMainEvent('onUpdateProgress', (progress) => {
    handleUpdateProgress(progress);
  });

  if (offersMainEvent('onProfileRuntimeIncident')) onMainEvent('onProfileRuntimeIncident', (incident) => {
    if (incident?.reason === 'crashpad-burst-contained') {
      setStatus(tr('status.crashpadContained'));
    } else if (incident?.reason === 'crashpad-repeated-signature') {
      setStatus(tr('status.crashpadFused'));
    } else if (incident?.reason === 'crashpad-limit-pruned') {
      setStatus(tr('status.crashpadPruned', { n: incident.removedFiles || 0 }));
    }
  });

  if (offersMainEvent('onProfileQuitBlocked')) onMainEvent('onProfileQuitBlocked', () => {
    setStatus(tr('status.profileQuitBlocked'));
  });

  els.themeToggle.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    state.theme = next;
    document.documentElement.dataset.theme = next;
    persistSettings({ theme: next });
    updateThemeToggle();
  });

  els.profileQuitBehavior?.addEventListener('change', () => {
    state.profileQuitBehavior = els.profileQuitBehavior.value === 'keep' ? 'keep' : 'close';
    persistSettings({ profileQuitBehavior: state.profileQuitBehavior });
    setStatus(tr(state.profileQuitBehavior === 'keep'
      ? 'status.profileQuitKeep'
      : 'status.profileQuitClose'));
  });

  // 语言切换：循环 中 → EN → 日 → 中，持久化到 settings；setLang 已替换静态文案，
  els.langToggle?.addEventListener('click', () => {
    if (!window.I18N) return;
    const next = window.I18N.setLang(window.I18N.next(), { persist: true });
    persistSettings({ lang: next });
    updateLangToggle();
    rerenderLocalizedText(); // apply() 只换静态 data-i18n；动态渲染的文案也要重刷一遍
  });

  els.helpBtn.addEventListener('click', () => {
    prepareWelcomeGuide();
    openChildDialog(els.welcomeDialog, els.helpBtn);
  });

  els.activityCenterBtn?.addEventListener('click', async () => {
    openUtilityDialog('activity');
    renderAttentionInbox();
    await Promise.all([loadTransfers(), loadTaskPackageHistory()]);
  });

  els.deviceCenterBtn?.addEventListener('click', async () => {
    openUtilityDialog('devices');
    await loadDeviceOverview({ requestSecureAccess: true });
    ensureDeviceDetailForEntry();
    renderDeviceCenter();
  });

  for (const [kind, button, dialog] of utilityDialogEntries()) {
    // One close path updates UI context and the native dialog synchronously.
    // It also avoids form validation or a delayed native close event retaining stale utility state.
    const close = dialog?.querySelector('.utility-dialog-close');
    if (close) {
      close.type = 'button';
      close.addEventListener('click', () => closeUtilityDialog(dialog));
    }
    dialog?.addEventListener('cancel', (event) => {
      event.preventDefault();
      closeUtilityDialog(dialog);
    });
    dialog?.addEventListener('close', () => {
      const wasCurrent = state.utilityDialog === kind;
      button?.setAttribute('aria-expanded', 'false');
      if (!dialog.open && state.utilityDialog === kind) state.utilityDialog = null;
      if (wasCurrent) {
        requestAnimationFrame(() => {
          if (!document.querySelector('dialog:modal')) utilityDialogFocusTarget(button)?.focus({ preventScroll: true });
        });
      }
    });
  }

  els.deviceLensSelect?.addEventListener('change', async () => {
    await selectDeviceLens(els.deviceLensSelect.value || 'all');
  });

  els.initializeMeshBtn?.addEventListener('click', async () => {
    if (state.mesh.loading || !window.manager.initializeMesh) return;
    state.mesh.loading = true;
    state.mesh.errorCode = null;
    state.mesh.message = tr('devices.status.initializing');
    renderDeviceCenter();
    const result = await window.manager.initializeMesh({});
    state.mesh.loading = false;
    if (!result?.ok) {
      state.mesh.errorCode = result?.reasonCode || 'mesh-operation-failed';
      state.mesh.message = '';
      renderDeviceCenter();
      return;
    }
    state.mesh.overview = result.overview;
    validateUiContext();
    state.mesh.message = tr('devices.status.initialized');
    renderDeviceCenter();
    renderTopbarContext();
    renderAccounts();
    renderAccountHeader();
    await loadSessions();
  });

  els.showJoinMeshBtn?.addEventListener('click', () => {
    openDeviceJourney('join', els.showJoinMeshBtn);
  });

  els.createDeviceInviteBtn?.addEventListener('click', async () => {
    openDeviceJourney('host', els.createDeviceInviteBtn);
  });

  els.deviceJourneyCloseBtn?.addEventListener('click', () => {
    if (state.mesh.deviceJourney?.busy) return;
    els.deviceJourneyDialog?.close();
  });
  els.deviceJourneyDialog?.addEventListener('cancel', (event) => {
    if (state.mesh.deviceJourney?.busy) event.preventDefault();
  });
  els.deviceJourneyDialog?.addEventListener('close', () => stopDeviceJourneyPolling());
  els.meshJoinCode?.addEventListener('input', () => {
    if (state.mesh.deviceJourney?.role !== 'join' || state.mesh.deviceJourney.preview) return;
    renderDeviceJourneyActions(
      state.mesh.deviceJourney,
      window.DeviceJourney.facts(state.mesh.deviceJourney, state.mesh.overview)
    );
  });
  els.deviceJourneyIdentityConfirm?.addEventListener('change', () => {
    if (!state.mesh.deviceJourney || state.mesh.deviceJourney.busy) return;
    state.mesh.deviceJourney = window.DeviceJourney.transition(state.mesh.deviceJourney, {
      type: 'confirm-identity',
      confirmed: els.deviceJourneyIdentityConfirm.checked
    }, state.mesh.overview);
    renderDeviceJourney();
  });
  els.deviceJourneyCopyBtn?.addEventListener('click', async () => {
    const code = state.mesh.deviceJourney?.invitation?.code;
    if (!code || state.mesh.deviceJourney?.busy) return;
    await window.manager.writeClipboard(code);
    setStatus(tr('deviceJourney.status.copied'));
  });
  els.deviceJourneySecondaryBtn?.addEventListener('click', async () => {
    const model = state.mesh.deviceJourney;
    if (!model || model.busy) return;
    if (els.deviceJourneySecondaryBtn.dataset.action === 'edit-code') {
      state.mesh.deviceJourney = window.DeviceJourney.transition(model, {
        type: 'code',
        code: els.meshJoinCode?.value
      }, state.mesh.overview);
      renderDeviceJourney();
      requestAnimationFrame(() => els.meshJoinCode?.focus());
    } else if (els.deviceJourneySecondaryBtn.dataset.action === 'cancel-invite') {
      const inviteId = model.invitation?.inviteId;
      setDeviceJourneyBusy(true);
      try {
        if (inviteId && window.manager.cancelDeviceInvite) await window.manager.cancelDeviceInvite(inviteId);
        state.mesh.invitation = null;
        state.mesh.deviceJourney = window.DeviceJourney.transition(state.mesh.deviceJourney, {
          type: 'reset-invitation'
        }, state.mesh.overview);
      } finally {
        setDeviceJourneyBusy(false);
        renderDeviceCenter();
      }
    } else if (els.deviceJourneySecondaryBtn.dataset.action === 'reject-claim') {
      await decideDeviceJourneyClaim(false);
    }
  });
  els.deviceJourneyPrimaryBtn?.addEventListener('click', () => {
    const action = els.deviceJourneyPrimaryBtn.dataset.action;
    if (action === 'invite') void createDeviceJourneyInvitation();
    else if (action === 'inspect') void inspectDeviceJourneyInvitation();
    else if (action === 'join') void joinFromDeviceJourney();
    else if (action === 'approve-claim') void decideDeviceJourneyClaim(true);
    else if (action === 'connect' || action === 'sync') void connectFromDeviceJourney();
    else if (action === 'finish') finishDeviceJourney();
  });
  els.deviceJourneyAdvancedBtn?.addEventListener('click', async () => {
    if (state.mesh.deviceJourney?.busy) return;
    els.deviceJourneyDialog?.close();
    await openMeshNetworkSettings(els.deviceJourneyAdvancedBtn);
  });

  els.receiveConnectionsBtn?.addEventListener('click', async () => {
    await toggleMeshReachability();
  });

  els.networkSettingsBtn?.addEventListener('click', async () => {
    await openMeshNetworkSettings(els.networkSettingsBtn);
  });

  els.saveMeshNetworkBtn?.addEventListener('click', async () => {
    await saveMeshNetworkSettings();
  });

  els.copyDeviceInviteBtn?.addEventListener('click', async () => {
    const code = state.mesh.invitation?.code;
    if (!code) return;
    await window.manager.writeClipboard(code);
    state.mesh.message = tr('devices.invite.copied');
    renderDeviceCenter();
  });

  els.closeDeviceInviteBtn?.addEventListener('click', async () => {
    const inviteId = state.mesh.invitation?.inviteId;
    state.mesh.invitation = null;
    renderDeviceCenter();
    if (window.manager.cancelDeviceInvite) await window.manager.cancelDeviceInvite(inviteId);
  });

  els.saveDevicePermissionsBtn?.addEventListener('click', async () => {
    await saveRemoteDevicePermissions();
  });

  els.revokeDeviceBtn?.addEventListener('click', async () => {
    await revokeRemoteDevice();
  });

  els.refreshMeshDiagnosticsBtn?.addEventListener('click', async () => {
    await refreshDeviceDiagnostics();
  });

  els.resetMeshBtn?.addEventListener('click', async () => {
    if (state.mesh.loading || !window.manager.resetMesh) return;
    if (!window.confirm(tr('devices.reset.confirm'))) return;
    state.mesh.loading = true;
    state.mesh.errorCode = null;
    state.mesh.message = tr('devices.status.resetting');
    renderDeviceCenter();
    const result = await window.manager.resetMesh();
    state.mesh.loading = false;
    if (!result?.ok) {
      state.mesh.errorCode = result?.reasonCode || 'mesh-operation-failed';
      state.mesh.message = '';
    } else {
      state.mesh.overview = result.overview;
      state.mesh.invitation = null;
      state.mesh.message = tr('devices.status.resetDone');
      validateUiContext();
    }
    renderDeviceCenter();
    renderTopbarContext();
  });

  // 「系统」入口：这台电脑上的工具和 AgentDesk 自己的设置在同一页。
  els.systemBtn?.addEventListener('click', async () => {
    openUtilityDialog('system');
    renderToolCenter();
    await refreshToolInventory(false);
  });

  els.checkToolsBtn?.addEventListener('click', async () => {
    await refreshToolInventory(true);
  });

  if (offersMainEvent('onToolProgress')) {
    onMainEvent('onToolProgress', handleToolProgress);
  }

  if (offersMainEvent('onAgentDeploymentsChanged')) {
    onMainEvent('onAgentDeploymentsChanged', (payload = {}) => {
      if (payload.overview?.initialized) state.mesh.overview = payload.overview;
      validateUiContext();
      renderAccounts();
      renderAccountHeader();
      renderDeviceCenter();
      if (payload.state === 'ready') {
        void loadProfiles().catch(() => {});
      }
    });
  }

  if (offersMainEvent('onAgentActionsChanged')) {
    onMainEvent('onAgentActionsChanged', (payload = {}) => {
      if (payload.overview?.initialized) state.mesh.overview = payload.overview;
      validateUiContext();
      renderAccounts();
      renderAccountHeader();
      renderDeviceCenter();
      const agentName = catalogAgentById(payload.agentId)?.displayName || null;
      setStatus(provisioningResultMessage(payload, agentName));
      if (payload.state === 'ready') requestDeviceOverviewReload();
    });
  }

  if (offersMainEvent('onDeviceConnectionState')) {
    onMainEvent('onDeviceConnectionState', (value) => {
      if (state.mesh.deviceJourney && window.DeviceJourney) {
        state.mesh.deviceJourney = window.DeviceJourney.transition(state.mesh.deviceJourney, {
          type: 'connection-state',
          ...value
        }, state.mesh.overview);
        renderDeviceJourney();
      }
      if (value?.state === 'authenticated' || value?.state === 'inventory-synced') {
        state.mesh.message = tr('devices.connection.connected', { name: value.deviceName || value.deviceId || '-' });
      } else if (value?.state === 'error') {
        state.mesh.errorCode = value.reason || 'peer-connect-failed';
      }
      requestDeviceOverviewReload();
    });
  }

  if (offersMainEvent('onDeviceNetworkState')) {
    onMainEvent('onDeviceNetworkState', (network) => {
      if (!state.mesh.overview?.reachability || !network) return;
      state.mesh.overview.reachability = {
        ...state.mesh.overview.reachability,
        signaling: network.signaling,
        ice: network.ice
      };
      renderDeviceCenter();
      if (state.mesh.diagnosticDeviceId) void refreshDeviceDiagnostics({ quiet: true });
    });
  }

  if (offersMainEvent('onPairingClaimsChanged')) {
    onMainEvent('onPairingClaimsChanged', (claims) => {
      applyPairingClaims(claims, { open: true });
    });
  }

  if (window.manager.hubState) void loadHub();
  if (offersMainEvent('onHubChanged')) onMainEvent('onHubChanged', (payload) => applyHubChange(payload?.run));
  window.AgentHubUi?.installTips?.(document, tr);
  els.hubAllowCall?.addEventListener('change', () => {
    const callable = els.hubAllowCall.checked;
    void saveHubAccess({ callable, writable: callable && els.hubAllowWrite.checked });
  });
  els.hubAllowWrite?.addEventListener('change', () => {
    void saveHubAccess({ callable: els.hubAllowCall.checked, writable: els.hubAllowCall.checked && els.hubAllowWrite.checked });
  });
  els.hubAddFolderBtn?.addEventListener('click', () => void addHubFolder());
  els.hubFolderList?.addEventListener('click', (event) => {
    const button = event.target.closest?.('button[data-folder-id]');
    if (button) void removeHubFolder(button.dataset.folderId);
  });
  els.hubMaxConcurrent?.addEventListener('change', () => void setHubLimit(Number(els.hubMaxConcurrent.value)));
  els.accountRoster?.addEventListener('scroll', () => renderHubLinks(), { passive: true });
  window.addEventListener('resize', () => renderHubLinks());

  if (offersMainEvent('onTransfersChanged')) {
    onMainEvent('onTransfersChanged', (transfers) => {
      const previousTransfers = state.mesh.transfers;
      state.mesh.transfers = Array.isArray(transfers) ? transfers : [];
      deskTransfersChanged(previousTransfers, state.mesh.transfers);
      const latest = state.mesh.transfers.find((item) => item.direction === 'incoming' && item.state === 'received');
      if (latest) {
        const messageKey = latest.type === 'task-package'
          ? 'taskPackage.incoming.received'
          : (latest.type === 'file' ? 'transfers.fileOfferReceived' : 'transfers.received');
        state.mesh.transferMessage = tr(messageKey, {
          n: latest.itemCount,
          name: latest.receivedFromName || '-'
        });
        setStatus(state.mesh.transferMessage);
      }
      renderTransferList();
      renderIncomingTaskPackages();
    });
  }

  if (offersMainEvent('onTaskPackagesChanged')) {
    onMainEvent('onTaskPackagesChanged', (history) => {
      state.taskPackages.history = Array.isArray(history) ? history : [];
      renderTaskPackageHistory();
      renderIncomingTaskPackages();
    });
  }

  if (offersMainEvent('onRemoteControlsChanged')) {
    onMainEvent('onRemoteControlsChanged', (sessions) => {
      const previousActiveSessionId = state.ui.activeRemoteSessionId;
      state.mesh.remoteSessions = Array.isArray(sessions) ? sessions : [];
      const outgoingIds = state.mesh.remoteSessions
        .filter((item) => item.direction === 'outgoing')
        .map((item) => item.sessionId);
      state.ui = previousActiveSessionId && !outgoingIds.includes(previousActiveSessionId)
        ? window.UiContext.disconnectRemote(state.ui, previousActiveSessionId, outgoingIds)
        : window.UiContext.clearInvalid(state.ui, { validRemoteSessionIds: outgoingIds });
      if (state.ui.workspaceMode === 'remote' && !outgoingIds.length) {
        setWorkspaceMode('sessions', { remoteAlreadyReleased: true });
      }
      const failed = state.mesh.remoteSessions.find((item) => (
        item.direction === 'outgoing'
        && ['error', 'rejected'].includes(item.state)
        && item.reason
      ));
      if (failed) setStatus(remoteErrorText(failed.reason, failed.deviceName));
      renderDeviceCenter();
      renderRemoteActivity();
      renderTopbarContext();
    });
  }

  if (offersMainEvent('onRemoteControlReturn')) {
    onMainEvent('onRemoteControlReturn', (value = {}) => {
      const destination = state.ui.workspaceMode === 'remote'
        ? (state.detailBeforeRemote || 'sessions')
        : state.detailMode;
      state.ui = window.UiContext.returnFromRemote(state.ui, value.activeSessionId);
      setWorkspaceMode(destination, { remoteAlreadyReleased: true });
      renderRemoteActivity();
      renderTopbarContext();
    });
  }

  els.pathConfigBtn.addEventListener('click', () => {
    const profile = selectedProfile();
    if (!profile) return;
    els.profilePathInput.value = profile.profilePath || '';
    els.sessionRootInput.value = profile.sessionRoot || '';
    els.executablePathInput.value = profile.executablePath || '';
    openDialog(els.pathDialog);
    els.profilePathInput.focus();
  });

  els.pickProfilePathBtn.addEventListener('click', async () => {
    const picked = await window.manager.pickDirectory({
      title: tr('picker.profileDir'),
      defaultPath: els.profilePathInput.value
    });
    if (picked) els.profilePathInput.value = picked;
  });

  els.pickSessionRootBtn.addEventListener('click', async () => {
    const picked = await window.manager.pickDirectory({
      title: tr('picker.sessionRoot'),
      defaultPath: els.sessionRootInput.value
    });
    if (picked) els.sessionRootInput.value = picked;
  });

  els.pickExecutablePathBtn.addEventListener('click', async () => {
    const picked = await window.manager.pickFile({
      title: tr('picker.executable'),
      defaultPath: els.executablePathInput.value || undefined
    });
    if (picked) els.executablePathInput.value = picked;
  });

  els.confirmPathBtn.addEventListener('click', async (event) => {
    event.preventDefault();
    const profile = selectedProfile();
    if (!profile) return;
    const profilePath = els.profilePathInput.value.trim();
    const sessionRoot = els.sessionRootInput.value.trim();
    if (!profilePath || !sessionRoot) {
      setStatus(tr('status.pathEmpty'));
      return;
    }
    await window.manager.updateProfile({
      id: profile.id,
      profilePath,
      sessionRoot,
      executablePath: els.executablePathInput.value.trim()
    });
    els.pathDialog.close();
    await loadProfiles(profile.id);
    setStatus(tr('status.pathSaved'));
  });

  els.diagnosticsBtn.addEventListener('click', async () => {
    await showDiagnostics();
  });

  els.stopProfileBtn?.addEventListener('click', async () => {
    const profile = selectedProfile();
    if (!profile) return;
    if (!window.confirm(tr('status.stopProfileConfirm', { name: profile.name }))) return;
    const result = await window.manager.stopProfile(profile.id);
    setStatus(result.ok
      ? tr('status.profileStopped', { name: profile.name })
      : tr('status.profileStopFailed', { code: result.reasonCode || 'profile-stop-failed' }));
    await loadActivity();
  });

  els.cleanCrashpadBtn?.addEventListener('click', async () => {
    const profile = selectedProfile();
    if (!profile) return;
    if (!window.confirm(tr('status.cleanCrashpadConfirm', { name: profile.name }))) return;
    const result = await window.manager.cleanProfileCrashpad(profile.id);
    setStatus(result.ok
      ? tr('status.crashpadCleaned', { n: result.removedFiles || 0 })
      : tr('status.crashpadCleanFailed', { code: result.reasonCode || 'crashpad-clean-failed' }));
  });

  els.copyDiagnosticsBtn.addEventListener('click', async () => {
    if (!lastDiagnostics) return;
    await window.manager.writeClipboard(formatDiagnosticsText(lastDiagnostics));
    setStatus(tr('status.diagCopied'));
  });

  els.profileFolderBtn.addEventListener('click', async () => {
    const profile = selectedProfile();
    if (!profile) return;
    const result = await window.manager.openPath(profile.profilePath);
    setStatus(result.message || result.reason || (result.ok ? tr('status.openAcctDirOk') : tr('status.openAcctDirFail')));
  });

  els.refreshBtn.addEventListener('click', async () => {
    const profile = selectedProfile();
    if (profile?._remote === true && window.manager.refreshMeshInventory) {
      await refreshRemoteInventoryForDevice(profile._meshDeviceId);
      return;
    }
    await loadSessions();
    await loadActivity();
    setStatus(tr('status.refreshList'));
  });

  els.quotaChipAll.addEventListener('click', (event) => {
    event.preventDefault();
    toggleQuotaPopover(event.currentTarget);
  });
  els.quotaPopoverClose.addEventListener('click', () => els.quotaPopover.hidePopover());
  els.quotaPopover.addEventListener('beforetoggle', (event) => {
    if (event.newState !== 'closed') return;
    state.quotaAnchor?.setAttribute('aria-expanded', 'false');
    state.quotaAnchor = null;
    // 额度浮层收起后，被操作的猫回到正在看的那只；档案开着时由档案负责。
    if (!els.agentManageDialog?.open) setActionAgent(null);
  });
  els.accountRoster.addEventListener('scroll', positionQuotaPopover, { passive: true });
  window.addEventListener('resize', positionQuotaPopover);

  bindContextMenuRules();

  els.quotaRefreshBtn.addEventListener('click', async () => {
    if (!selectedProfile()) return;
    setStatus(tr('status.quotaRefreshing'));
    await loadQuotas(true);
    const quota = selectedQuota();
    if (state.quotaError) {
      setStatus(tr('status.quotaRefreshFail', { err: state.quotaError }));
    } else if (quota?.status === 'ok') {
      setStatus(tr('status.quotaRefreshed', { headline: quotaHeadline(quota) }));
    } else {
      setStatus(quota?.reason || state.quotaError || tr('status.quotaUnavailable'));
    }
  });

  els.rosterAllCard?.addEventListener('click', () => {
    void pickRosterAll();
  });

  els.sessionCompactBtn?.addEventListener('click', () => {
    setSessionView('compact');
  });

  els.sessionDetailBtn?.addEventListener('click', () => {
    setSessionView('detail');
  });

  els.searchInput.addEventListener('input', () => {
    state.query = els.searchInput.value.trim().toLowerCase();
    applySessionFilter();
  });

  els.clearSessionFiltersBtn?.addEventListener('click', () => {
    sessionMarks.clearFilters();
    state.query = '';
    els.searchInput.value = '';
    applySessionFilter();
  });

  for (const button of document.querySelectorAll('[data-session-order]')) {
    button.addEventListener('click', () => {
      const next = button.dataset.sessionOrder;
      closeContextMenu(els.sessionDisplayMenu);
      sessionMarks.setOrder(next);
      if (next === state.sessionOrder) return;
      state.sessionOrder = sessionMarks.currentOrder();
      persistSettings({ sessionOrder: state.sessionOrder });
      applySessionFilter();
    });
  }

  els.markAllSeenBtn?.addEventListener('click', async () => {
    closeContextMenu(els.sessionDisplayMenu);
    const n = await sessionMarks.markSeen(state.sessions.filter((session) => sessionMarks.isFresh(session)));
    setStatus(tr('marks.status.allSeen', { n }));
  });

  els.tagCheckedSessionsBtn?.addEventListener('click', (event) => {
    sessionMarks.openPicker(checkedMarkKeys(), event.currentTarget);
  });

  // 选中一行后按 1–5 打标签，0 去掉；打字、弹窗和别处的焦点不受影响。
  document.addEventListener('keydown', (event) => {
    if (!/^[0-5]$/.test(event.key) || event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return;
    const target = event.target instanceof Element ? event.target : document.body;
    if (target.matches('input:not([type="checkbox"]), textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
    if (target.closest('[popover]') || document.querySelector('dialog[open]')) return;
    if (target !== document.body && !els.sessionPane?.contains(target)) return;
    const focused = state.ui.focusedConversationId;
    const session = focused && state.filteredSessions.find((item) => sessionKey(item) === focused);
    if (!session || session._hubRun) return;
    event.preventDefault();
    void sessionMarks.setTag(markTargets(session), Number(event.key));
  });

  els.copySessionInfoBtn.addEventListener('click', async () => {
    const sessions = resolvedActionSessions();
    if (!sessions.length || !window.SessionLocation) return;
    const value = window.SessionLocation.format(sessions, {
      path: tr('session.location.path'),
      coordinate: tr('session.location.coordinate'),
      empty: tr('common.unrecorded')
    });
    await window.manager.writeClipboard(value);
    setStatus(tr(
      sessions.length === 1 ? 'status.sessionInfoCopied' : 'status.sessionInfosCopied',
      { n: sessions.length }
    ));
    window.PixelUi?.copied(sessions.map((session) => sessionKey(session)), tr('fx.copied', { n: sessions.length }));
  });

  els.sendSessionInfoBtn?.addEventListener('click', async () => {
    await openSessionSendDialog(null, els.sendSessionInfoBtn);
  });

  els.clearSessionSelectionBtn?.addEventListener('click', () => {
    clearSessionActionSelection();
  });

  els.chooseSessionReplicaBtn.addEventListener('click', () => {
    renderReplicaPicker(actionSessions());
    openChildDialog(els.sessionReplicaPicker, els.chooseSessionReplicaBtn);
  });

  els.confirmSessionSendBtn?.addEventListener('click', async () => {
    await sendSelectedSessionsToDevice();
  });

  els.chooseFilesBtn?.addEventListener('click', async () => {
    await chooseFilesForTransfer();
  });

  els.sessionSendTarget?.addEventListener('change', () => {
    state.ui = window.UiContext.updateTransferDraft(state.ui, { targetDeviceId: els.sessionSendTarget.value });
    renderSessionSendStatus();
  });

  els.fileSendTarget?.addEventListener('change', () => {
    state.ui = window.UiContext.updateTransferDraft(state.ui, { targetDeviceId: els.fileSendTarget.value });
    renderFileSendStatus();
  });

  els.importTaskPackageBtn?.addEventListener('click', () => {
    openTaskPackageImportDialog(els.importTaskPackageBtn);
  });

  els.taskPackageActionBtn?.addEventListener('click', async () => {
    await openTaskPackageExportDialog(els.taskPackageActionBtn);
  });

  els.exportTaskPackageBtn?.addEventListener('click', async () => {
    await exportCurrentTaskPackage();
  });

  for (const control of [els.taskPackageDeliveryPortable, els.taskPackageDeliveryDirect]) {
    control?.addEventListener('change', () => {
      if (!control.checked) return;
      state.taskPackages.exportDelivery = control.value === 'direct' ? 'direct' : 'portable';
      state.taskPackages.directTransfer = null;
      renderTaskPackageDeliveryOptions();
    });
  }

  els.taskPackageDirectTarget?.addEventListener('change', () => {
    state.taskPackages.directTargetDeviceId = els.taskPackageDirectTarget.value || null;
    renderTaskPackageDeliveryOptions();
  });

  els.taskPackageSwitchPortableBtn?.addEventListener('click', async () => {
    await saveOrSwitchTaskPackageToPortable();
  });

  els.copyTaskPackageCodeBtn?.addEventListener('click', async () => {
    const code = state.taskPackages.exportCode;
    if (!code) return;
    await window.manager.writeClipboard(code);
    setTaskPackageStatus('export', tr('taskPackage.status.codeCopied'), 'idle');
  });

  els.chooseTaskPackageFileBtn?.addEventListener('click', async () => {
    await chooseTaskPackageImportFile();
  });

  els.inspectTaskPackageBtn?.addEventListener('click', async () => {
    await inspectTaskPackageImport();
  });

  els.commitTaskPackageBtn?.addEventListener('click', async () => {
    await commitTaskPackageImport();
  });

  els.taskPackageDialog?.addEventListener('close', () => {
    resetTaskPackageExportState();
  });

  for (const control of [els.taskPackageCloseBtn, els.taskPackageCancelBtn]) {
    control?.addEventListener('click', () => {
      if (!state.taskPackages.exportBusy) els.taskPackageDialog?.close('cancel');
    });
  }

  els.taskPackageDialog?.addEventListener('cancel', (event) => {
    if (state.taskPackages.exportBusy) event.preventDefault();
  });

  els.taskPackageImportDialog?.addEventListener('close', () => {
    void cancelTaskPackageImportDraft();
  });

  for (const control of [els.taskPackageImportCloseBtn, els.taskPackageImportCancelBtn]) {
    control?.addEventListener('click', () => {
      if (!state.taskPackages.importBusy) els.taskPackageImportDialog?.close('cancel');
    });
  }

  els.taskPackageImportDialog?.addEventListener('cancel', (event) => {
    if (state.taskPackages.importBusy) event.preventDefault();
  });

  els.sessionSendDialog?.addEventListener('close', () => deskSendFlights());
  els.sessionSendDialog?.addEventListener('close', () => {
    if (state.ui.transferDraft?.kind === 'session-pointer') {
      state.ui = window.UiContext.clearTransferDraft(state.ui);
    }
  });

  els.fileSendDialog?.addEventListener('close', () => {
    if (state.ui.transferDraft?.kind === 'files') {
      state.ui = window.UiContext.clearTransferDraft(state.ui);
    }
  });

  els.refreshTransfersBtn?.addEventListener('click', async () => {
    await loadTransfers();
  });

  els.openSessionFileBtn.addEventListener('click', () => void openSelectedSessionDirectories());
  els.exportSessionBtn.addEventListener('click', () => void exportSelectedSessions());
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
