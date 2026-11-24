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

// Remote inventory reads are deliberately on demand: selecting one remote
// device may open one authenticated peer, while startup and the "all devices"
// lens must not fan out into an N² connection mesh. Coalesce concurrent user
// intents for the same device so Lens navigation, device-center navigation and
// the explicit rescan action cannot launch duplicate full snapshots.
const remoteInventoryRefreshes = new Map();
let pendingDeviceOverviewReload = false;
let deviceOverviewReloadPromise = null;

function currentDeviceLensId() {
  return state.ui.selectedDeviceLensId || 'all';
}

function currentAgentId() {
  return window.UiContext.selectedAgentId(state.ui);
}

// 卡片上的动作作用于哪只猫：档案或额度打开时可以不是正在看的那只，
// 这样在别的猫身上做事不会带动下面的会话列表。
function actionAgentId() {
  const id = state.actionAgentId;
  if (id && id !== currentAgentId() && identityGroups().some((group) => group.key === id)) return id;
  return currentAgentId();
}

function setActionAgent(agentId) {
  const next = agentId && agentId !== currentAgentId() ? agentId : null;
  if (state.actionAgentId === next) return;
  state.actionAgentId = next;
  renderAccountHeader();
}

function currentSlotKey() {
  return window.UiContext.selectedSlotKey(state.ui, currentDeviceLensId(), actionAgentId());
}

function activeOutgoingRemoteSessions() {
  return state.mesh.remoteSessions.filter((item) => (
    item.direction === 'outgoing'
    && !['error', 'rejected', 'disconnected'].includes(item.state)
  ));
}

function currentProfileId() {
  const group = identityGroups().find((item) => item.key === actionAgentId());
  return cardActionProfile(group)?.id || null;
}

function updateUi(next) {
  state.ui = next;
}

// 受管客户端元数据（label / 配色）由主进程注册表提供，UI 不再写死 claude/codex
async function loadApps() {
  try {
    const list = await window.manager.listApps();
    if (Array.isArray(list) && list.length) {
      state.appMeta = Object.fromEntries(list.map((a) => [
        a.id,
        {
          label: a.label,
          tagColor: a.tagColor,
          providerNamespace: a.providerNamespace || null,
          recruitDefault: a.recruitDefault === true,
          canExportTranscript: Boolean(a.canExportTranscript),
          taskPackageMode: ['native', 'transcript'].includes(a.taskPackageMode) ? a.taskPackageMode : 'unsupported',
          canLaunch: a.canLaunch !== false,
          canProvision: a.canProvision === true,
          provisioningClientForm: a.provisioningClientForm || null,
          signIn: a.signIn && typeof a.signIn === 'object' ? a.signIn : null,
          discoveryKind: a.discoveryKind || null,
          defaultOnly: a.defaultOnly === true
        }
      ]));
    }
  } catch (_error) {
    // 保留内置默认
  }
  // 新增对话框的「应用」下拉按注册表填充
  if (els.newProfileApp) {
    els.newProfileApp.replaceChildren();
    for (const [id, meta] of Object.entries(state.appMeta)) {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = meta.label;
      els.newProfileApp.append(option);
    }
  }
}

function appLabel(appId) {
  return (state.appMeta[appId] && state.appMeta[appId].label) || appId;
}
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
// Each list load takes the next number; an answer applies only while its
// number is still the latest, so a slower earlier load cannot overwrite it.
let sessionsLoadGeneration = 0;
let quotaHasLoaded = false;
let quotaRequestedAt = 0;
let foregroundSessionRefreshAt = 0;
const QUOTA_REFRESH_INTERVAL = 5 * 60_000;
const FOREGROUND_SESSION_REFRESH_INTERVAL = 2_000;
// The cards follow the 8-second activity poll; the list follows it too when a
// listed account wrote something new, but reloads at most this often (each
// reload rescans the listed accounts).
const ACTIVITY_SESSION_REFRESH_INTERVAL = 30_000;
let activitySessionRefreshAt = 0;
const listedActivityAt = new Map();

// Local accounts whose sessions the list currently shows.
function listedProfileIds() {
  const local = new Set(state.profiles.map((profile) => String(profile.id)));
  const groups = identityGroups();
  const scoped = state.ui.agentScope === 'all' ? groups : groups.filter((group) => group.key === currentAgentId());
  return scoped.flatMap((group) => group.members.map((member) => String(member.id))).filter((id) => local.has(id));
}

function refreshSessionsOnActivity() {
  if (document.hidden || state.startupStage !== 'ready') return;
  let advanced = false;
  for (const id of listedProfileIds()) {
    const at = Number(state.activity[id]?.latestMtime) || 0;
    const known = listedActivityAt.get(id);
    if (known === undefined) listedActivityAt.set(id, at);
    else if (at > known) advanced = true;
  }
  if (!advanced) return;
  const now = Date.now();
  if (now - activitySessionRefreshAt < ACTIVITY_SESSION_REFRESH_INTERVAL) return;
  activitySessionRefreshAt = now;
  for (const id of listedProfileIds()) listedActivityAt.set(id, Number(state.activity[id]?.latestMtime) || 0);
  void loadSessions();
}

function refreshSessionsOnForeground() {
  if (document.hidden || state.startupStage !== 'ready') return;
  const now = Date.now();
  if (now - foregroundSessionRefreshAt < FOREGROUND_SESSION_REFRESH_INTERVAL) return;
  foregroundSessionRefreshAt = now;
  void loadSessions();
}

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

// localStorage keys an older build may still hold. The yard view, reminder,
// scene and ledger keys belong to retired features and are no longer read.
const LEGACY_SETTING_KEYS = {
  theme: 'agentdesk-theme',
  welcomed: 'agentdesk-welcomed'
};
let settingsWriteQueue = Promise.resolve();

function localSetting(key) {
  try {
    return localStorage.getItem(key);
  } catch (_error) {
    return null;
  }
}

function legacyUserSettings() {
  const legacy = {};
  const theme = localSetting(LEGACY_SETTING_KEYS.theme);
  const welcomed = localSetting(LEGACY_SETTING_KEYS.welcomed);
  if (theme !== null) legacy.theme = theme;
  if (welcomed !== null) legacy.welcomed = welcomed === '1';
  return legacy;
}

function applyUserSettings(value = {}) {
  state.agentOrder = Array.isArray(value.agentOrder) ? value.agentOrder : [];
  state.theme = value.theme === 'light' || value.theme === 'dark' ? value.theme : null;
  state.ui = window.UiContext.create({
    ...state.ui,
    selectedDeviceLensId: value.selectedDeviceLensId || 'all',
    selectedAgentIdByDeviceLens: value.selectedAgentIdByDeviceLens,
    selectedSlotKeyByAgentAndLens: value.selectedSlotKeyByAgentAndLens,
    agentScope: value.sessionScope === 'all' ? 'all' : 'current'
  });
  state.sessionView = value.sessionView === 'detail' ? 'detail' : 'compact';
  state.sessionOrder = ['recent', 'fresh', 'tag'].includes(value.sessionOrder) ? value.sessionOrder : 'recent';
  state.profileQuitBehavior = value.profileQuitBehavior === 'keep' ? 'keep' : 'close';
  if (els.profileQuitBehavior) els.profileQuitBehavior.value = state.profileQuitBehavior;
  window.PixelUi?.setSound?.(value);
  state.welcomed = value.welcomed === true;
  state.onboardingProgress = window.OnboardingState
    ? window.OnboardingState.normalizeProgress(value.onboarding)
    : { completedVersion: 0, completedAt: null };
  // i18n：优先用户存过的语言，否则跟随系统；init 会替换所有 data-i18n 静态文案
  if (window.I18N) window.I18N.init(value.lang);
  updateLangToggle();
}

async function loadUserSettings() {
  const legacy = legacyUserSettings();
  try {
    applyUserSettings(await window.manager.getSettings(legacy));
  } catch (_error) {
    applyUserSettings(legacy);
  }
}

function mirrorLegacySettings(patch) {
  try {
    if (Object.prototype.hasOwnProperty.call(patch, 'theme')) {
      if (patch.theme) localStorage.setItem(LEGACY_SETTING_KEYS.theme, patch.theme);
      else localStorage.removeItem(LEGACY_SETTING_KEYS.theme);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'welcomed')) {
      localStorage.setItem(LEGACY_SETTING_KEYS.welcomed, patch.welcomed ? '1' : '0');
    }
  } catch (_error) {
    // The stable userData JSON store remains canonical if localStorage fails.
  }
}

function persistSettings(patch) {
  mirrorLegacySettings(patch);
  let request;
  try {
    // Dispatch immediately so a quick window close cannot strand the change
    // behind a renderer microtask. Main-process handlers merge patches
    // synchronously, so multiple in-flight calls remain non-destructive.
    request = Promise.resolve(window.manager.updateSettings(patch)).catch(() => null);
  } catch (_error) {
    request = Promise.resolve(null);
  }
  settingsWriteQueue = Promise.all([
    settingsWriteQueue.catch(() => null),
    request
  ]).then(([, saved]) => saved);
  return request;
}

function uiSelectionSettingsPatch() {
  return {
    selectedDeviceLensId: currentDeviceLensId(),
    selectedAgentIdByDeviceLens: { ...state.ui.selectedAgentIdByDeviceLens },
    selectedSlotKeyByAgentAndLens: { ...state.ui.selectedSlotKeyByAgentAndLens }
  };
}

function persistUiSelectionMemory(extra = {}) {
  return persistSettings({ ...uiSelectionSettingsPatch(), ...extra });
}

function initTheme() {
  const theme = state.theme || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.dataset.theme = theme;
  updateThemeToggle();
}

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

async function loadProfiles(preferredId = null, options = {}) {
  state.profiles = await window.manager.listProfiles();
  const liveIds = new Set(state.profiles.map((profile) => profile.id));
  state.quotas = Object.fromEntries(
    Object.entries(state.quotas).filter(([profileId]) => liveIds.has(profileId))
  );
  if (preferredId) {
    if (setProfileContext(preferredId)) persistUiSelectionMemory();
  } else if (!state.mesh.overview?.initialized && !currentAgentId() && state.profiles[0]) {
    // Pure-local mode keeps the released product's first-slot startup behavior.
    // Mesh mode intentionally starts with no implicit Agent selection.
    setProfileContext(state.profiles[0].id);
  } else if (
    state.mesh.overview?.initialized
    && !currentAgentId()
    && ['all', state.mesh.overview.localDeviceId].includes(currentDeviceLensId())
  ) {
    const selection = window.AgentWorkspace.resolveUnambiguousLocalSelection({
      overview: state.mesh.overview,
      profiles: state.profiles
    });
    if (selection) {
      state.ui = window.UiContext.setAgent(state.ui, selection.agentId, {
        slotKey: selection.slotKey
      });
      persistUiSelectionMemory();
    }
  }
  validateUiContext();
  if (options.presentFirstUseBeforeSessions === true) {
    // Profiles are the last fact required for migration preview. Present first
    // use before workspace rendering, session scans, TaskPackage history,
    // activity or quota work so none of those secondary tasks can strand a
    // fresh user on an empty workspace.
    state.startupStage = 'first-use-presenting';
    maybeShowWelcome();
    state.startupStage = els.welcomeDialog?.open
      ? 'first-use-presented'
      : 'first-use-not-required';
  }
  renderAccounts();
  renderAccountHeader();
  renderSessionControls();
  await loadSessions();
  renderAttentionInbox();
  // Profile edits invalidate the main-process cache. Refresh in the background
  // after the first quota request, without making profile/session UI wait.
  if (quotaHasLoaded) loadQuotas();
  // Mesh 目录由本机 Profile 派生；新增、编辑或删除运行位置后同步刷新设备摘要。
  if (options.skipDeviceOverview !== true) void loadDeviceOverview({ silent: true });
}

async function loadSessions() {
  const generation = ++sessionsLoadGeneration;
  if (!currentAgentId() && state.ui.agentScope === 'current') {
    // 没有选中的猫就是看全部：名册上高亮“全部”，不留一张要解释的空表。
    state.ui = window.UiContext.setAgentScope(state.ui, 'all');
    renderSessionControls();
    renderAccounts();
  }

  if (state.mesh.overview?.initialized && window.manager.listMeshSessions) {
    const keyState = state.mesh.overview?.keyState || 'available';
    const meshResult = keyState === 'available'
      ? await loadMeshSessions(null, { generation })
      : { ok: false, reasonCode: keyState };
    if (meshResult.ok || generation !== sessionsLoadGeneration) return;

    const lens = currentDeviceLensId();
    const canShowLocal = lens === 'all' || lens === state.mesh.overview.localDeviceId;
    if (canShowLocal) {
      const localResult = await loadLocalSessions({ source: 'local-fallback', generation });
      if (localResult.stale) return;
      state.mesh.sessionErrorCode = meshResult.reasonCode;
      setStatus(tr('status.sessionsLocalFallback', {
        n: localResult.count
      }), 'warning');
      return;
    }

    // A local fallback must never masquerade as the selected remote device.
    // Retain only rows already proven to belong to that lens; otherwise show
    // an honest empty result until the encrypted inventory is available.
    state.sessions = state.sessions.filter((row) => row._deviceId === lens && row._localFallback !== true);
    state.mesh.sessionSource = 'remote-unavailable';
    state.mesh.sessionErrorCode = meshResult.reasonCode;
    validateSessionContext();
    applySessionFilter();
    setStatus(tr('status.sessionsRemoteUnavailable', { code: meshResult.reasonCode }), 'warning');
    return;
  }

  await loadLocalSessions({ source: 'local', generation });
}

async function loadLocalSessions(options = {}) {
  const generation = options.generation ?? ++sessionsLoadGeneration;
  // 当前账号：合流同一登录身份的全部形态；全部账号：一次扫描所有身份组。
  // 每条记录都带归属槽位 + 账号组元数据，跨账号排序、选择和操作仍能回到正确槽位。
  const groups = identityGroups();
  const currentGroup = groups.find((group) => group.key === currentAgentId()) || null;
  const scopedGroups = state.ui.agentScope === 'all'
    ? groups
    : (currentGroup ? [currentGroup] : []);
  const localProfileIds = new Set(state.profiles.map((profile) => String(profile.id)));
  const descriptors = new Map();
  for (const group of scopedGroups) {
    for (const member of group.members) {
      if (!localProfileIds.has(String(member.id))) continue;
      descriptors.set(member.id, {
        member,
        accountKey: group.key,
        accountName: group.primary.name
      });
    }
  }

  // 一个槽位扫描失败只丢它自己的会话，不清空其它账号。
  const results = await Promise.all([...descriptors.values()].map(async (descriptor) => {
    const { member, accountKey, accountName } = descriptor;
    try {
      const records = await window.manager.listSessions(member);
      const owned = (Array.isArray(records) ? records : [])
        .map((record) => ({ ...record, _profileId: member.id }));
      return {
        ok: true,
        profileId: member.id,
        records: owned.map((record) => ({
          ...record,
          _accountKey: accountKey,
          _accountName: accountName,
          _profileName: member.name,
          _appLabel: appLabel(record.appId || member.appId),
          _agentId: accountKey,
          _accountBindingId: member._accountBindingId || null,
          _deviceId: member._meshDeviceId || state.mesh.overview?.localDeviceId || null,
          _deviceName: member._meshDeviceName || tr('devices.device.local'),
          _replicaId: member._meshDeviceId
            ? `${member._meshDeviceId}:${member.id}:${record.address || record.id || record.filePath || ''}`
            : null,
          _remote: false,
          _stale: false,
          _localFallback: options.source === 'local-fallback'
        }))
      };
    } catch (_error) {
      // A failed scan is not "no sessions": keep this account's last rows.
      return {
        ok: false,
        profileId: member.id,
        records: state.sessions.filter((row) => String(row._profileId) === String(member.id) && row._remote !== true)
      };
    }
  }));

  if (generation !== sessionsLoadGeneration) return { ok: true, stale: true, count: state.sessions.length };
  const loaded = results.flatMap((result) => result.records);

  state.sessions = loaded
    .sort((a, b) => (
      new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime()
    ));
  validateSessionContext();
  applySessionFilter();
  state.mesh.sessionSource = options.source === 'local-fallback' ? 'local-fallback' : 'local';
  if (options.source !== 'local-fallback') state.mesh.sessionErrorCode = null;
  return { ok: true, count: state.sessions.length };
}

async function loadMeshSessions(prefetchedRows = null, options = {}) {
  const generation = options.generation ?? ++sessionsLoadGeneration;
  let rows = Array.isArray(prefetchedRows) ? prefetchedRows : [];
  if (!Array.isArray(prefetchedRows)) {
    try {
      const result = await window.manager.listMeshSessions();
      if (generation !== sessionsLoadGeneration) return { ok: true, stale: true, count: state.sessions.length };
      if (!result?.ok || !Array.isArray(result.sessions)) {
        return { ok: false, reasonCode: result?.reasonCode || 'inventory-list-failed' };
      }
      rows = result.sessions;
    } catch (error) {
      return { ok: false, reasonCode: error?.message || 'inventory-list-failed' };
    }
  }
  const overview = state.mesh.overview;
  const lens = currentDeviceLensId();
  if (lens !== 'all') {
    rows = rows.flatMap((row) => {
      const replicas = (row.replicas || []).filter((item) => item.deviceId === lens);
      if (!replicas.length) return [];
      return [{ ...sessionAtReplica(row, replicas[0], overview), replicas }];
    });
  }
  if (state.ui.agentScope === 'current') {
    const agentId = currentAgentId();
    rows = agentId ? rows.filter((row) => row._agentId === agentId) : [];
  }
  state.sessions = rows.map((row) => enrichMeshSession(row, overview));
  state.mesh.sessionSource = 'mesh';
  state.mesh.sessionErrorCode = null;
  validateSessionContext();
  applySessionFilter();
  return { ok: true, count: state.sessions.length };
}

function sessionAtReplica(row, replica, overview) {
  const device = overview?.devices?.find((item) => item.deviceId === replica.deviceId);
  return {
    ...row,
    id: replica.adapterConversationKey || row.id,
    address: replica.adapterConversationKey || row.address,
    appId: replica.appId,
    title: replica.title,
    createdAt: replica.createdAt,
    updatedAt: replica.updatedAt,
    projectPath: replica.projectPathHint,
    filePath: replica.sourceFileHint,
    source: replica.source,
    status: replica.status,
    model: replica.model,
    _agentId: replica.agentId,
    _accountBindingId: replica.accountBindingId,
    _profileId: replica.profileId,
    _deviceId: replica.deviceId,
    _deviceName: replica.deviceName || device?.name || replica.deviceId,
    _replicaId: replica.replicaId,
    _remote: replica.deviceId !== overview?.localDeviceId,
    _stale: replica.stale === true
  };
}

function enrichMeshSession(row, overview) {
  const agent = overview?.agents?.find((item) => item.agentId === row._agentId);
  const slot = overview?.slots?.find((item) => (
    item.deviceId === row._deviceId && String(item.profileId) === String(row._profileId)
  ));
  const device = overview?.devices?.find((item) => item.deviceId === row._deviceId);
  return {
    ...row,
    _accountKey: row._agentId,
    _accountName: agent?.displayName || slot?.localLabel || '-',
    _profileName: slot?.localLabel || row._profileId,
    _appLabel: appLabel(row.appId || slot?.appId),
    _deviceName: row._deviceName || device?.name || row._deviceId
  };
}

// 合流列表里每条会话真正归属的槽位（操作要用它，不能用当前选中槽位）
function sessionOwnerProfile(session) {
  for (const group of identityGroups()) {
    const profile = group.members.find((item) => (
      String(item._meshProfileId || item.id) === String(session?._profileId)
      && (!session?._deviceId || item._meshDeviceId === session._deviceId)
    ));
    if (profile) return profile;
  }
  return selectedGroupProfile(identityGroups().find((group) => group.key === currentAgentId()) || null);
}

async function setSessionScope(scope) {
  const next = scope === 'all' ? 'all' : 'current';
  if (next === state.ui.agentScope) {
    renderSessionControls();
    return;
  }
  state.ui = window.UiContext.setAgentScope(state.ui, next);
  persistSettings({ sessionScope: next });
  renderSessionControls();
  await loadSessions();
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

let deviceJourneyPollTimer = null;
let deviceJourneyPollPromise = null;

function requestDeviceOverviewReload() {
  pendingDeviceOverviewReload = true;
  flushPendingDeviceOverviewReload();
}

function flushPendingDeviceOverviewReload() {
  if (
    !pendingDeviceOverviewReload
    || state.mesh.loading
    || deviceOverviewReloadPromise
    || !window.manager.listDevices
  ) return;
  pendingDeviceOverviewReload = false;
  const operation = loadDeviceOverview({ silent: true });
  deviceOverviewReloadPromise = operation;
  const finish = () => {
    if (deviceOverviewReloadPromise === operation) deviceOverviewReloadPromise = null;
    flushPendingDeviceOverviewReload();
  };
  operation.then(finish, finish);
}

function deviceJourneyErrorText(code) {
  if (!code) return '';
  const known = {
    'device-invite-inspection-unavailable': 'deviceJourney.error.inspectionUnavailable',
    'device-invite-preview-incomplete': 'deviceJourney.error.previewIncomplete',
    'device-identity-confirmation-required': 'deviceJourney.error.identityRequired',
    'device-invitation-incomplete': 'deviceJourney.error.invitationIncomplete'
  };
  return known[code]
    ? tr(known[code])
    : tr('deviceJourney.error.generic', { code });
}

function deviceJourneyModel() {
  const model = state.mesh.deviceJourney;
  if (!model || !window.DeviceJourney) return null;
  state.mesh.deviceJourney = window.DeviceJourney.transition(model, {
    type: 'overview'
  }, state.mesh.overview);
  return state.mesh.deviceJourney;
}

function openDeviceJourney(role, trigger = document.activeElement, options = {}) {
  if (!els.deviceJourneyDialog || !window.DeviceJourney) return;
  const existing = state.mesh.deviceJourney;
  const resume = existing && existing.role === role && existing.phase !== 'complete';
  if (!resume) {
    state.mesh.deviceJourney = window.DeviceJourney.create({
      role,
      baselineDeviceIds: role === 'host'
        ? (state.mesh.overview?.devices || []).map((device) => device.deviceId)
        : [],
      targetDeviceId: options.targetDeviceId,
      invitation: role === 'host' ? state.mesh.invitation : null,
      overview: state.mesh.overview
    });
  }
  renderDeviceJourney();
  openChildDialog(els.deviceJourneyDialog, trigger);
  startDeviceJourneyPolling();
  if (role === 'host') void refreshPairingClaims();
  requestAnimationFrame(() => {
    const model = deviceJourneyModel();
    if (model?.role === 'join' && !model.preview) els.meshJoinCode?.focus();
    else els.deviceJourneyPrimaryBtn?.focus();
  });
}

function applyPairingClaims(claims, options = {}) {
  const list = Array.isArray(claims) ? claims : [];
  const inviteId = state.mesh.deviceJourney?.invitation?.inviteId || state.mesh.invitation?.inviteId;
  const claim = list.find((item) => !inviteId || item?.inviteId === inviteId) || null;
  if (!claim || !window.DeviceJourney) return;
  if (!state.mesh.deviceJourney || state.mesh.deviceJourney.role !== 'host') {
    state.mesh.deviceJourney = window.DeviceJourney.create({
      role: 'host',
      baselineDeviceIds: (state.mesh.overview?.devices || []).map((device) => device.deviceId),
      invitation: state.mesh.invitation,
      overview: state.mesh.overview
    });
  }
  state.mesh.deviceJourney = window.DeviceJourney.transition(state.mesh.deviceJourney, {
    type: 'claim',
    claim
  }, state.mesh.overview);
  renderDeviceJourney();
  if (options.open === true && !els.deviceJourneyDialog?.open) {
    openDeviceJourney('host', els.createDeviceInviteBtn || document.activeElement);
  }
}

async function refreshPairingClaims() {
  if (typeof window.manager.listPairingClaims !== 'function') return;
  try {
    const result = await window.manager.listPairingClaims();
    if (result?.ok) applyPairingClaims(result.claims);
  } catch (_error) {
    // A missing approval list cannot be treated as trust.
  }
}

function stopDeviceJourneyPolling() {
  clearInterval(deviceJourneyPollTimer);
  deviceJourneyPollTimer = null;
}

function startDeviceJourneyPolling() {
  stopDeviceJourneyPolling();
  if (!els.deviceJourneyDialog?.open) return;
  deviceJourneyPollTimer = setInterval(() => {
    void refreshDeviceJourneyFacts();
  }, 2500);
}

async function refreshDeviceJourneyFacts() {
  if (
    !els.deviceJourneyDialog?.open
    || !window.manager.listDevices
    || deviceJourneyPollPromise
  ) return;
  const operation = (async () => {
    try {
      const result = await window.manager.listDevices();
      if (!result?.ok || !result.overview) return;
      state.mesh.overview = result.overview;
      validateUiContext();
      state.mesh.deviceJourney = window.DeviceJourney.transition(
        state.mesh.deviceJourney,
        { type: 'overview' },
        result.overview
      );
      renderDeviceCenter();
      renderDeviceJourney();
    } catch (_error) {
      // The current facts remain visible; explicit actions surface errors.
    }
  })();
  deviceJourneyPollPromise = operation;
  try {
    await operation;
  } finally {
    if (deviceJourneyPollPromise === operation) deviceJourneyPollPromise = null;
  }
}

function renderDeviceJourneyProgress(model) {
  if (!els.deviceJourneyProgress) return;
  const states = window.DeviceJourney.stepStates(model, state.mesh.overview);
  for (const item of els.deviceJourneyProgress.querySelectorAll('[data-step]')) {
    const value = states[item.dataset.step] || 'pending';
    item.dataset.state = value;
    if (value === 'current') item.setAttribute('aria-current', 'step');
    else item.removeAttribute('aria-current');
  }
}

function deviceJourneyIdentity(model, value) {
  if (model.role === 'join' && model.preview) {
    return {
      kind: tr('deviceJourney.identity.inviter'),
      name: model.preview.sourceDeviceName || tr('devices.value.unknown'),
      meta: [
        platformLabel(model.preview.platform),
        model.preview.appVersion ? `AgentDesk ${model.preview.appVersion}` : null,
        model.preview.expiresAt ? tr('deviceJourney.identity.expires', { time: compactDate(model.preview.expiresAt) }) : null
      ].filter(Boolean).join(' · '),
      fingerprint: model.preview.sourceFingerprint || '—'
    };
  }
  if (model.role === 'host' && model.claim) {
    return {
      kind: tr('deviceJourney.identity.joiner'),
      name: model.claim.name || tr('devices.value.unknown'),
      meta: [
        platformLabel(model.claim.platform),
        model.claim.arch,
        model.claim.appVersion ? `AgentDesk ${model.claim.appVersion}` : null,
        model.claim.expiresAt ? tr('deviceJourney.identity.expires', { time: compactDate(model.claim.expiresAt) }) : null
      ].filter(Boolean).join(' · '),
      fingerprint: model.claim.fingerprint || '—'
    };
  }
  if (value.target) {
    return {
      kind: tr('deviceJourney.identity.joiner'),
      name: value.target.name,
      meta: [
        platformLabel(value.target.platform),
        value.target.arch,
        value.target.appVersion ? `AgentDesk ${value.target.appVersion}` : null
      ].filter(Boolean).join(' · '),
      fingerprint: value.target.fingerprint || '—'
    };
  }
  return null;
}

function renderDeviceJourneyIdentity(model, value) {
  if (els.deviceJourneyHost) els.deviceJourneyHost.hidden = model.role !== 'host';
  if (els.deviceJourneyJoin) els.deviceJourneyJoin.hidden = model.role !== 'join' || Boolean(model.preview);
  if (els.deviceJourneyIdentityLead) {
    els.deviceJourneyIdentityLead.textContent = tr(model.role === 'host'
      ? 'deviceJourney.host.lead'
      : 'deviceJourney.join.lead');
  }
  if (els.deviceJourneyInviteEmpty) els.deviceJourneyInviteEmpty.hidden = Boolean(model.invitation);
  if (els.deviceJourneyInvite) els.deviceJourneyInvite.hidden = !model.invitation;
  if (model.invitation) {
    if (els.deviceJourneyShortCode) els.deviceJourneyShortCode.textContent = model.invitation.shortCode || '—';
    if (els.deviceJourneyInviteExpiry) {
      els.deviceJourneyInviteExpiry.textContent = model.invitation.expiresAt
        ? tr('deviceJourney.host.expires', { time: compactDate(model.invitation.expiresAt) })
        : '';
    }
    if (els.deviceJourneyInviteCode) els.deviceJourneyInviteCode.value = model.invitation.code;
  }

  const identity = deviceJourneyIdentity(model, value);
  if (els.deviceJourneyIdentityCard) els.deviceJourneyIdentityCard.hidden = !identity;
  if (!identity) return;
  if (els.deviceJourneyIdentityKind) els.deviceJourneyIdentityKind.textContent = identity.kind;
  if (els.deviceJourneyDeviceName) els.deviceJourneyDeviceName.textContent = identity.name;
  if (els.deviceJourneyDeviceMeta) els.deviceJourneyDeviceMeta.textContent = identity.meta;
  if (els.deviceJourneyFingerprint) els.deviceJourneyFingerprint.textContent = identity.fingerprint;
  if (els.deviceJourneyIdentityConfirm) {
    els.deviceJourneyIdentityConfirm.checked = model.identityConfirmed;
    els.deviceJourneyIdentityConfirm.disabled = model.busy;
  }
}

function deviceJourneyFactState(complete, current, unavailable = false) {
  if (complete) return 'complete';
  if (unavailable) return 'error';
  return current ? 'current' : 'pending';
}

function renderDeviceJourneyFacts(model, value) {
  if (!els.deviceJourneyFactList) return;
  const rows = [
    ['trust', value.trusted, model.identityConfirmed, false],
    ['connect', value.connected, value.trusted, false],
    ['catalog', value.catalogReady, value.connected, value.catalogUnavailable],
    ['inventory', value.inventoryReady, value.connected, false]
  ];
  els.deviceJourneyFactList.replaceChildren();
  for (const [key, complete, current, unavailable] of rows) {
    const row = document.createElement('div');
    const status = deviceJourneyFactState(complete, current, unavailable);
    row.dataset.state = status;
    const mark = document.createElement('span');
    mark.textContent = complete ? '✓' : (unavailable ? '!' : (current ? '⋯' : '·'));
    const copy = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = tr(`deviceJourney.fact.${key}`);
    const detail = document.createElement('small');
    detail.textContent = tr(`deviceJourney.fact.${key}.${status}`);
    copy.append(title, detail);
    row.append(mark, copy);
    els.deviceJourneyFactList.append(row);
  }
  if (els.deviceJourneyFactsLead) {
    els.deviceJourneyFactsLead.textContent = tr(`deviceJourney.phase.${model.phase}`);
  }
}

function renderDeviceJourneyActions(model, value) {
  const primary = els.deviceJourneyPrimaryBtn;
  const secondary = els.deviceJourneySecondaryBtn;
  if (!primary || !secondary) return;
  primary.hidden = false;
  primary.disabled = model.busy;
  secondary.hidden = true;
  secondary.disabled = model.busy;
  if (els.deviceJourneyCloseBtn) els.deviceJourneyCloseBtn.disabled = model.busy;
  if (els.deviceJourneyAdvancedBtn) els.deviceJourneyAdvancedBtn.disabled = model.busy;

  if (model.role === 'host' && !model.invitation && !value.target && !model.claim) {
    primary.dataset.action = 'invite';
    primary.textContent = tr('deviceJourney.action.invite');
  } else if (model.role === 'host' && !value.target && !model.claim) {
    primary.dataset.action = '';
    primary.textContent = tr('deviceJourney.action.waitingDevice');
    primary.disabled = true;
    secondary.hidden = false;
    secondary.dataset.action = 'cancel-invite';
    secondary.textContent = tr('deviceJourney.action.cancelInvite');
  } else if (model.role === 'join' && !model.preview) {
    primary.dataset.action = 'inspect';
    primary.textContent = tr('deviceJourney.action.inspect');
    primary.disabled = model.busy || !String(els.meshJoinCode?.value || '').trim();
  } else if (!model.identityConfirmed) {
    primary.dataset.action = '';
    primary.textContent = tr('deviceJourney.action.confirmIdentity');
    primary.disabled = true;
    if (model.role === 'join') {
      secondary.hidden = false;
      secondary.dataset.action = 'edit-code';
      secondary.textContent = tr('deviceJourney.action.editCode');
    } else if (model.claim) {
      secondary.hidden = false;
      secondary.dataset.action = 'reject-claim';
      secondary.textContent = tr('deviceJourney.action.rejectClaim');
    }
  } else if (!value.trusted && model.role === 'join') {
    primary.dataset.action = 'join';
    primary.textContent = tr('deviceJourney.action.join');
  } else if (!value.trusted && model.role === 'host' && model.claim && !model.approvalSubmitted) {
    primary.dataset.action = 'approve-claim';
    primary.textContent = tr('deviceJourney.action.approveClaim');
    secondary.hidden = false;
    secondary.dataset.action = 'reject-claim';
    secondary.textContent = tr('deviceJourney.action.rejectClaim');
  } else if (!value.trusted) {
    primary.dataset.action = '';
    primary.textContent = tr('deviceJourney.action.waitingTrust');
    primary.disabled = true;
  } else if (!value.connected) {
    primary.dataset.action = 'connect';
    primary.textContent = tr('deviceJourney.action.connect');
  } else if (!value.catalogReady || !value.inventoryReady) {
    primary.dataset.action = 'sync';
    primary.textContent = tr(value.catalogUnavailable
      ? 'deviceJourney.action.recheck'
      : 'deviceJourney.action.continueSync');
  } else {
    primary.dataset.action = 'finish';
    primary.textContent = tr('deviceJourney.action.viewDevice');
  }
}

function renderDeviceJourney() {
  const model = deviceJourneyModel();
  if (!model || !els.deviceJourneyDialog) return;
  const value = window.DeviceJourney.facts(model, state.mesh.overview);
  renderDeviceJourneyProgress(model);
  if (els.deviceJourneyIdentity) els.deviceJourneyIdentity.hidden = model.identityConfirmed && Boolean(value.target);
  if (els.deviceJourneyFacts) els.deviceJourneyFacts.hidden = !model.identityConfirmed || value.usable;
  if (els.deviceJourneyComplete) els.deviceJourneyComplete.hidden = !value.usable;
  renderDeviceJourneyIdentity(model, value);
  renderDeviceJourneyFacts(model, value);
  if (els.deviceJourneyCompleteLead) {
    els.deviceJourneyCompleteLead.textContent = tr('deviceJourney.complete.lead', {
      name: value.target?.name || tr('devices.value.unknown')
    });
  }
  const error = deviceJourneyErrorText(model.errorCode);
  if (els.deviceJourneyStatus) {
    els.deviceJourneyStatus.hidden = !error;
    els.deviceJourneyStatus.textContent = error;
  }
  renderDeviceJourneyActions(model, value);
}

function setDeviceJourneyBusy(busy) {
  if (!state.mesh.deviceJourney) return;
  state.mesh.deviceJourney = window.DeviceJourney.transition(state.mesh.deviceJourney, {
    type: 'busy',
    busy
  }, state.mesh.overview);
  renderDeviceJourney();
}

async function createDeviceJourneyInvitation() {
  const model = deviceJourneyModel();
  if (!model || model.busy || !window.manager.createDeviceInvite) return;
  setDeviceJourneyBusy(true);
  try {
    const result = await window.manager.createDeviceInvite();
    if (!result?.ok || !result.invitation) throw new Error(result?.reasonCode || 'pairing-invite-failed');
    state.mesh.invitation = result.invitation;
    state.mesh.deviceJourney = window.DeviceJourney.transition(state.mesh.deviceJourney, {
      type: 'invitation',
      invitation: result.invitation
    }, state.mesh.overview);
  } catch (error) {
    state.mesh.deviceJourney = window.DeviceJourney.transition(state.mesh.deviceJourney, {
      type: 'failed',
      reasonCode: error?.message || 'pairing-invite-failed'
    }, state.mesh.overview);
  } finally {
    setDeviceJourneyBusy(false);
    renderDeviceCenter();
  }
}

async function inspectDeviceJourneyInvitation() {
  const model = deviceJourneyModel();
  const code = String(els.meshJoinCode?.value || '').trim();
  if (!model || model.busy || !code) return;
  if (typeof window.manager.inspectDeviceInvitation !== 'function') {
    state.mesh.deviceJourney = window.DeviceJourney.transition(model, {
      type: 'failed',
      reasonCode: 'device-invite-inspection-unavailable'
    }, state.mesh.overview);
    renderDeviceJourney();
    return;
  }
  state.mesh.deviceJourney = window.DeviceJourney.transition(model, { type: 'code', code }, state.mesh.overview);
  setDeviceJourneyBusy(true);
  try {
    const result = await window.manager.inspectDeviceInvitation({ code });
    if (!result?.ok || !result.preview) throw new Error(result?.reasonCode || 'device-invite-preview-incomplete');
    state.mesh.deviceJourney = window.DeviceJourney.transition(state.mesh.deviceJourney, {
      type: 'preview',
      preview: result.preview
    }, state.mesh.overview);
  } catch (error) {
    state.mesh.deviceJourney = window.DeviceJourney.transition(state.mesh.deviceJourney, {
      type: 'failed',
      reasonCode: error?.message || 'device-invite-preview-failed'
    }, state.mesh.overview);
  } finally {
    setDeviceJourneyBusy(false);
  }
}

async function joinFromDeviceJourney() {
  const model = deviceJourneyModel();
  if (!model || model.busy || !model.identityConfirmed || !model.preview || !window.manager.joinDeviceMesh) return;
  setDeviceJourneyBusy(true);
  try {
    const result = await window.manager.joinDeviceMesh({
      code: model.inviteCode,
      inviteId: model.preview.inviteId,
      confirmationToken: model.preview.confirmationToken
    });
    if (!result?.ok || !result.overview) throw new Error(result?.reasonCode || 'pairing-join-failed');
    state.mesh.overview = result.overview;
    const target = (result.overview.devices || []).find((device) => !device.isLocal);
    state.mesh.deviceJourney = window.DeviceJourney.transition(state.mesh.deviceJourney, {
      type: 'target',
      deviceId: target?.deviceId
    }, result.overview);
    state.mesh.deviceJourney = window.DeviceJourney.transition(state.mesh.deviceJourney, {
      type: 'connection-result',
      ok: Boolean(result.connection),
      reasonCode: result.connectionError
    }, result.overview);
    validateUiContext();
    renderTopbarContext();
    await loadProfiles(currentProfileId(), { skipDeviceOverview: true });
  } catch (error) {
    state.mesh.deviceJourney = window.DeviceJourney.transition(state.mesh.deviceJourney, {
      type: 'failed',
      reasonCode: error?.message || 'pairing-join-failed'
    }, state.mesh.overview);
  } finally {
    setDeviceJourneyBusy(false);
    renderDeviceCenter();
  }
}

async function decideDeviceJourneyClaim(confirmed) {
  const model = deviceJourneyModel();
  const claim = model?.claim;
  if (!model || model.busy || !claim || typeof window.manager.decidePairingClaim !== 'function') return;
  setDeviceJourneyBusy(true);
  try {
    const result = await window.manager.decidePairingClaim({
      approvalId: claim.approvalId,
      confirmed: confirmed === true
    });
    if (!result?.ok) throw new Error(result?.reasonCode || 'pairing-approval-failed');
    state.mesh.deviceJourney = window.DeviceJourney.transition(state.mesh.deviceJourney, {
      type: 'claim-decision',
      confirmed: confirmed === true
    }, state.mesh.overview);
    if (!confirmed) setStatus(tr('deviceJourney.status.claimRejected'));
  } catch (error) {
    state.mesh.deviceJourney = window.DeviceJourney.transition(state.mesh.deviceJourney, {
      type: 'failed',
      reasonCode: error?.message || 'pairing-approval-failed'
    }, state.mesh.overview);
  } finally {
    setDeviceJourneyBusy(false);
    void refreshDeviceJourneyFacts();
  }
}

async function connectFromDeviceJourney() {
  const model = deviceJourneyModel();
  const value = model ? window.DeviceJourney.facts(model, state.mesh.overview) : null;
  if (!model || model.busy || !value?.target || !window.manager.connectDevice) return;
  setDeviceJourneyBusy(true);
  try {
    const result = await window.manager.connectDevice(value.target.deviceId);
    if (!result?.ok || !result.overview) throw new Error(result?.reasonCode || 'peer-connect-failed');
    state.mesh.overview = result.overview;
    state.mesh.deviceJourney = window.DeviceJourney.transition(state.mesh.deviceJourney, {
      type: 'connection-result',
      ok: true
    }, result.overview);
    validateUiContext();
    await loadSessions();
  } catch (error) {
    state.mesh.deviceJourney = window.DeviceJourney.transition(state.mesh.deviceJourney, {
      type: 'connection-result',
      ok: false,
      reasonCode: error?.message || 'peer-connect-failed'
    }, state.mesh.overview);
  } finally {
    setDeviceJourneyBusy(false);
    renderDeviceCenter();
  }
}

function finishDeviceJourney() {
  const model = deviceJourneyModel();
  const value = model ? window.DeviceJourney.facts(model, state.mesh.overview) : null;
  if (!value?.usable || !value.target) return;
  state.ui = window.UiContext.selectDeviceDetail(state.ui, value.target.deviceId);
  renderDeviceCenter();
  els.deviceJourneyDialog?.close();
}

async function loadDeviceOverview(options = {}) {
  if (!window.manager.listDevices || state.mesh.loading) return;
  const silent = options.silent === true;
  if (!silent) {
    state.mesh.loading = true;
    state.mesh.errorCode = null;
    state.mesh.message = tr('devices.status.loading');
    renderDeviceCenter();
  }
  try {
    const result = await window.manager.listDevices({
      requestSecureAccess: options.requestSecureAccess === true
    });
    if (!result?.ok) throw new Error(result?.reasonCode || 'mesh-operation-failed');
    state.mesh.overview = result.overview;
    validateUiContext();
    state.mesh.errorCode = null;
    if (!silent) state.mesh.message = '';
  } catch (error) {
    state.mesh.errorCode = error?.message || 'mesh-operation-failed';
  } finally {
    if (!silent) state.mesh.loading = false;
    renderDeviceCenter();
    renderTopbarContext();
    if (state.mesh.overview?.initialized && options.skipWorkspaceRefresh !== true) {
      renderAccounts();
      renderAccountHeader();
      await loadSessions();
    }
  }
}

function renderDeviceCenter() {
  if (!els.deviceCenterBtn) return;
  // Mesh mutations render once after releasing state.mesh.loading. That common
  // point also drains an inventory-synced event that arrived while the mutation
  // was busy, instead of losing the reload until the next four-minute snapshot.
  flushPendingDeviceOverviewReload();
  const overview = state.mesh.overview;
  const initialized = overview?.initialized === true;
  const storageIncomplete = overview?.storageIncomplete === true;
  const keyError = initialized && overview?.keyState && overview.keyState !== 'available'
    ? overview.keyState
    : null;

  if (els.deviceCountBadge) {
    const onlineCount = (overview?.devices || []).filter((device) => device.status === 'online').length;
    els.deviceCountBadge.textContent = String(onlineCount);
    els.deviceCountBadge.hidden = !initialized || onlineCount === 0;
  }
  renderDeviceLens(overview);
  if (els.meshEmptyState) els.meshEmptyState.hidden = initialized;
  if (els.meshReadyState) els.meshReadyState.hidden = !initialized;
  if (els.initializeMeshBtn) {
    els.initializeMeshBtn.disabled = state.mesh.loading || storageIncomplete || overview?.keyState === 'os-key-protection-unavailable';
  }
  if (els.showJoinMeshBtn) els.showJoinMeshBtn.disabled = state.mesh.loading || storageIncomplete;
  if (els.confirmJoinMeshBtn) els.confirmJoinMeshBtn.disabled = state.mesh.loading;
  if (els.createDeviceInviteBtn) els.createDeviceInviteBtn.disabled = state.mesh.loading;
  if (els.networkSettingsBtn) els.networkSettingsBtn.disabled = state.mesh.loading || state.mesh.networkLoading;
  if (els.receiveConnectionsBtn) {
    const active = overview?.reachability?.userEnabled === true;
    els.receiveConnectionsBtn.disabled = state.mesh.loading;
    els.receiveConnectionsBtn.classList.toggle('primary', active);
    els.receiveConnectionsBtn.textContent = tr(active
      ? 'devices.reachability.disable'
      : 'devices.reachability.enable');
  }
  if (els.resetMeshBtn) {
    els.resetMeshBtn.hidden = !initialized && !storageIncomplete;
    els.resetMeshBtn.disabled = state.mesh.loading;
  }

  if (els.meshStateBadge) {
    els.meshStateBadge.dataset.state = state.mesh.errorCode || keyError || storageIncomplete
      ? 'error'
      : (initialized ? 'ready' : 'local');
    els.meshStateBadge.textContent = tr(
      state.mesh.errorCode || keyError || storageIncomplete
        ? 'devices.state.attention'
        : (initialized ? 'devices.state.ready' : 'devices.state.local')
    );
  }

  if (els.deviceCenterStatus) {
    let message = state.mesh.message;
    let tone = state.mesh.loading ? 'busy' : 'idle';
    if (state.mesh.errorCode || keyError || storageIncomplete) {
      tone = 'error';
      message = meshErrorText(state.mesh.errorCode || keyError || 'mesh-storage-incomplete');
    } else if (!message) {
      message = tr(initialized ? 'devices.status.readyMesh' : 'devices.status.ready');
    }
    els.deviceCenterStatus.dataset.state = tone;
    els.deviceCenterStatus.textContent = message;
  }

  renderMeshPreview(overview?.localPreview);
  if (!initialized) return;
  if (els.meshJoinPanel) els.meshJoinPanel.hidden = true;
  if (els.meshInvitePanel) els.meshInvitePanel.hidden = !state.mesh.invitation;
  if (els.meshInviteShortCode) els.meshInviteShortCode.textContent = state.mesh.invitation?.shortCode || '';
  if (els.meshInviteCode) els.meshInviteCode.value = state.mesh.invitation?.code || '';
  renderMeshSummary(overview);
  renderDeviceList(overview);
  renderSelectedDeviceDetail(overview);
  renderMeshAgentList(overview);
}

function renderMeshPreview(preview) {
  if (!els.meshPreviewStats) return;
  const value = preview || {
    name: tr('devices.preview.thisDevice'),
    agentCount: identityGroups().length,
    slotCount: state.profiles.length,
    sessionCount: state.sessions.length
  };
  fillMeshStats(els.meshPreviewStats, [
    [tr('devices.stat.device'), value.name || tr('devices.preview.thisDevice')],
    [tr('devices.stat.agents'), value.agentCount || 0],
    [tr('devices.stat.slots'), value.slotCount || 0]
  ]);
}

function renderDeviceLensMenu(overview) {
  if (!window.PixelUi) return;
  const initialized = overview?.initialized === true;
  const devices = initialized ? (overview.devices || []) : [];
  const online = devices.filter((device) => device.isLocal || device.status === 'online').length;
  const onlineLabel = initialized ? tr('devices.lens.online', { online, total: devices.length }) : '';
  window.PixelUi.renderLens({
    initialized,
    current: currentDeviceLensId(),
    allLabel: tr('devices.lens.all'),
    localLabel: tr('devices.device.local'),
    onlineLabel,
    devices: devices.map((device) => ({
      id: device.deviceId,
      name: device.isLocal ? tr('devices.lens.localNamed', { name: device.name }) : device.name,
      online: device.isLocal || device.status === 'online',
      meta: tr(`devices.status.${device.isLocal ? 'online' : (device.status || 'offline')}`)
    }))
  });
  window.PixelUi.setGlobal(initialized ? tr('footer.devices', { online, total: devices.length }) : tr('footer.localOnly'));
}

function renderDeviceLens(overview) {
  if (!els.deviceLensSelect) return;
  const initialized = overview?.initialized === true;
  els.deviceLensSelect.hidden = !initialized;
  renderDeviceLensMenu(overview);
  if (!initialized) return;
  const current = currentDeviceLensId();
  els.deviceLensSelect.replaceChildren();
  const all = document.createElement('option');
  all.value = 'all';
  all.textContent = tr('devices.lens.all');
  els.deviceLensSelect.append(all);
  for (const device of overview.devices || []) {
    const option = document.createElement('option');
    option.value = device.deviceId;
    option.textContent = device.isLocal
      ? tr('devices.lens.localNamed', { name: device.name })
      : device.name;
    els.deviceLensSelect.append(option);
  }
  const valid = [...els.deviceLensSelect.options].some((option) => option.value === current);
  els.deviceLensSelect.value = valid ? current : 'all';
}

function renderMeshSummary(overview) {
  if (!els.meshSummary) return;
  const online = (overview.devices || []).filter((device) => device.status === 'online').length;
  fillMeshStats(els.meshSummary, [
    [tr('devices.stat.mesh'), overview.mesh?.displayName || 'Personal Agent Mesh'],
    [tr('devices.stat.online'), tr('devices.value.online', { online, total: overview.devices.length })],
    [tr('devices.stat.catalogRevision'), `r${overview.mesh?.catalogRevision || 0}`]
  ]);
  if (els.deviceShelfMeta) {
    const signaling = overview.reachability?.signaling;
    els.deviceShelfMeta.textContent = `${tr('devices.meta.deviceCount', { n: overview.devices.length })} · ${tr('devices.meta.signaling', {
      state: diagnosticCode(signaling?.state || 'disabled')
    })}`;
  }
}

function fillMeshStats(container, rows) {
  container.replaceChildren();
  for (const [label, value] of rows) {
    const item = document.createElement('div');
    item.className = 'mesh-stat';
    const small = document.createElement('small');
    small.textContent = label;
    const strong = document.createElement('strong');
    strong.textContent = String(value);
    strong.title = String(value);
    item.append(small, strong);
    container.append(item);
  }
}

function renderDeviceList(overview) {
  if (!els.deviceList) return;
  els.deviceList.replaceChildren();
  const selected = selectedDeviceDetail(overview);
  for (const device of overview.devices || []) {
    const connection = (overview.connections || []).find((item) => item.deviceId === device.deviceId);
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'device-list-item';
    card.setAttribute('aria-current', String(selected?.deviceId === device.deviceId));
    const dot = document.createElement('i');
    dot.className = 'device-online-dot';
    if (device.status !== 'online') dot.style.background = 'var(--ink-tertiary)';
    const copy = document.createElement('span');
    copy.className = 'device-list-copy';
    const name = document.createElement('strong');
    name.textContent = device.name;
    const meta = document.createElement('small');
    meta.textContent = [
      tr(`devices.status.${device.status || 'offline'}`),
      platformLabel(device.platform),
      connection?.authenticated ? connectionPathText(connection) : null
    ].filter(Boolean).join(' · ');
    copy.append(name, meta);
    const count = document.createElement('span');
    count.className = 'device-list-count';
    count.textContent = tr('devices.list.agentCount', { n: device.agentCount || 0 });
    card.append(dot, copy, count);
    card.addEventListener('click', () => {
      state.ui = window.UiContext.selectDeviceDetail(state.ui, device.deviceId);
      renderDeviceCenter();
    });
    els.deviceList.append(card);
  }
}

function selectedDeviceDetail(overview) {
  return (overview?.devices || []).find((device) => device.deviceId === state.ui.selectedDeviceDetailId) || null;
}

function ensureDeviceDetailForEntry() {
  const overview = state.mesh.overview;
  if (!overview?.initialized || selectedDeviceDetail(overview)) return;
  const lensDevice = currentDeviceLensId() !== 'all'
    ? overview.devices.find((device) => device.deviceId === currentDeviceLensId())
    : null;
  const target = lensDevice || overview.devices.find((device) => device.isLocal) || overview.devices[0];
  if (target) state.ui = window.UiContext.selectDeviceDetail(state.ui, target.deviceId);
}

function renderSelectedDeviceDetail(overview) {
  const device = selectedDeviceDetail(overview);
  if (!els.deviceDetail) return;
  if (!device) {
    if (els.deviceDetailKind) els.deviceDetailKind.textContent = '';
    if (els.deviceDetailName) els.deviceDetailName.textContent = tr('devices.detail.unselected');
    if (els.deviceDetailMeta) els.deviceDetailMeta.textContent = tr('devices.detail.unselectedHint');
    if (els.deviceDetailStatus) {
      els.deviceDetailStatus.textContent = '';
      els.deviceDetailStatus.removeAttribute('data-state');
    }
    if (els.deviceDetailStats) els.deviceDetailStats.replaceChildren();
    if (els.deviceDetailActions) els.deviceDetailActions.replaceChildren();
    return;
  }
  const connection = (overview.connections || []).find((item) => item.deviceId === device.deviceId);
  if (els.deviceDetailKind) {
    els.deviceDetailKind.textContent = device.isLocal
      ? tr('devices.device.local')
      : tr('devices.device.remote');
  }
  if (els.deviceDetailName) els.deviceDetailName.textContent = device.name;
  if (els.deviceDetailMeta) {
    els.deviceDetailMeta.textContent = [
      platformLabel(device.platform),
      device.arch,
      `AgentDesk ${device.appVersion}`,
      connection?.authenticated ? connectionPathText(connection) : null,
      tr('devices.device.fingerprint', { value: device.fingerprint || '-' })
    ].filter(Boolean).join(' · ');
  }
  if (els.deviceDetailStatus) {
    els.deviceDetailStatus.dataset.state = device.status === 'online' ? 'ready' : 'local';
    els.deviceDetailStatus.textContent = [
      tr(`devices.status.${device.status || 'offline'}`),
      !device.isLocal && device.inventoryGeneratedAt
        ? tr('devices.device.lastSync', { time: compactDate(device.inventoryGeneratedAt) })
        : null
    ].filter(Boolean).join(' · ');
  }
  if (els.deviceDetailStats) {
    els.deviceDetailStats.replaceChildren();
    for (const [value, label] of [
      [device.agentCount, tr('devices.stat.agents')],
      [device.slotCount, tr('devices.stat.slots')],
      [device.sessionCount, tr('devices.stat.sessions')]
    ]) {
      const item = document.createElement('div');
      item.className = 'device-detail-stat';
      const count = document.createElement('b');
      count.textContent = String(value || 0);
      const caption = document.createElement('small');
      caption.textContent = label;
      item.append(count, caption);
      els.deviceDetailStats.append(item);
    }
  }
  renderSelectedDeviceActions(device, connection, overview);
}

function deviceActionButton(label, listener, options = {}) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.disabled = options.disabled === true;
  if (options.className) button.className = options.className;
  if (options.title) button.title = options.title;
  button.addEventListener('click', listener);
  return button;
}

function deviceMoreMenu(buttons) {
  const menu = document.createElement('details');
  menu.className = 'device-action-more context-menu';
  const summary = document.createElement('summary');
  summary.textContent = tr('common.more');
  const panel = document.createElement('div');
  panel.className = 'context-menu-panel';
  for (const button of buttons) panel.append(button);
  menu.append(summary, panel);
  return menu;
}

function refreshRemoteInventoryForDevice(deviceOrId) {
  const deviceId = typeof deviceOrId === 'string' ? deviceOrId : deviceOrId?.deviceId;
  const device = state.mesh.overview?.devices?.find((item) => item.deviceId === deviceId)
    || (deviceOrId && typeof deviceOrId === 'object' ? deviceOrId : null);
  if (!device || device.isLocal || !window.manager.refreshMeshInventory) return Promise.resolve(null);

  const existing = remoteInventoryRefreshes.get(deviceId);
  if (existing) return existing;

  const deviceName = device.name || deviceId || '-';
  const operation = (async () => {
    setStatus(tr('status.refreshRemoteWorking', { name: deviceName }));
    let result = null;
    try {
      result = await window.manager.refreshMeshInventory(deviceId);
    } catch (_error) {
      result = null;
    }
    if (!result?.ok) {
      // Cached sessions were rendered before this request and remain intact.
      // A failed on-demand connection must never turn an offline snapshot into
      // an empty table or pretend that the cached data is current.
      setStatus(remoteInventoryRefreshFailureText(result?.reasonCode, deviceName));
      return null;
    }

    if (result.overview) {
      state.mesh.overview = result.overview;
      validateUiContext();
    }
    state.mesh.errorCode = null;
    renderDeviceLens(state.mesh.overview);
    renderAccounts();
    renderAccountHeader();
    renderDeviceCenter();
    renderTopbarContext();
    if (Array.isArray(result.sessions)) await loadMeshSessions(result.sessions);
    else await loadSessions();
    setStatus(tr('status.refreshRemoteDone', { name: deviceName }));
    return result;
  })();

  remoteInventoryRefreshes.set(deviceId, operation);
  const clear = () => {
    if (remoteInventoryRefreshes.get(deviceId) === operation) {
      remoteInventoryRefreshes.delete(deviceId);
    }
  };
  operation.then(clear, clear);
  return operation;
}

async function viewDeviceSessions(device, overview) {
  closeUtilityDialog(els.deviceCenterDialog);
  updateUi(window.UiContext.viewDeviceSessions(state.ui, device.deviceId));
  persistUiSelectionMemory({ sessionScope: 'all' });
  setWorkspaceMode('sessions');
  renderDeviceLens(overview);
  if (els.searchInput) els.searchInput.value = state.query;
  renderAccounts();
  renderAccountHeader();
  await loadSessions();
  await refreshRemoteInventoryForDevice(device);
}

async function viewDeviceAgentSessions(device, agent, overview) {
  const groups = identityGroupsForLens(device.deviceId);
  const group = groups.find((item) => item.key === agent.agentId);
  const slot = preferredSlot(group?.members || []);
  updateUi(window.UiContext.viewDeviceAgentSessions(state.ui, {
    deviceId: device.deviceId,
    agentId: agent.agentId,
    slotKey: slot?._meshSlotKey || slot?.id
  }));
  persistUiSelectionMemory({ sessionScope: 'current' });
  closeUtilityDialog(els.deviceCenterDialog);
  setWorkspaceMode('sessions');
  renderDeviceLens(overview);
  if (els.searchInput) els.searchInput.value = state.query;
  renderAccounts();
  renderAccountHeader();
  await loadSessions();
  await refreshRemoteInventoryForDevice(device);
}

function renderSelectedDeviceActions(device, connection, overview) {
  if (!els.deviceDetailActions) return;
  els.deviceDetailActions.replaceChildren();
  const viewSessions = deviceActionButton(
    tr('devices.viewAllSessions'),
    () => void viewDeviceSessions(device, overview),
    { disabled: state.mesh.loading }
  );

  if (device.isLocal) {
    const rename = deviceActionButton(tr('devices.rename'), () => renameLocalDevice(device), {
      disabled: state.mesh.loading
    });
    const probe = deviceActionButton(
      state.mesh.loading ? tr('devices.probe.running') : tr('devices.probe.action'),
      () => runMeshTransportProbe(),
      { disabled: state.mesh.loading }
    );
    const diagnostics = deviceDiagnosticsButton(device);
    const history = deviceActionButton(tr('transfers.center.action'), () => openTransferCenter(history));
    els.deviceDetailActions.append(viewSessions, rename, deviceMoreMenu([probe, diagnostics, history]));
    return;
  }

  const remoteSession = state.mesh.remoteSessions.find((item) => (
    item.deviceId === device.deviceId
    && !['error', 'rejected', 'disconnected'].includes(item.state)
  ));
  const canView = (device.permissions || []).includes('screen.view');
  const canReachRemote = Boolean(remoteSession)
    || connection?.authenticated === true
    || device.status === 'online';
  const remote = deviceActionButton(
    tr(remoteSession ? 'remote.action.focus' : 'remote.action.view'),
    () => openRemoteDevice(device),
    {
      disabled: state.mesh.loading || !canView || !canReachRemote,
      title: !canView
        ? tr('remote.action.permissionRequired')
        : (canReachRemote ? tr('remote.action.hint') : remoteErrorText('offline', device.name))
    }
  );
  remote.className = 'remote-control-action';
  const connect = deviceActionButton(
    tr(connection?.authenticated
      ? 'devices.connection.disconnect'
      : (device.status === 'connecting' ? 'devices.connection.connecting' : 'devices.connection.connect')),
    () => connection?.authenticated ? disconnectMeshDevice(device) : connectMeshDevice(device),
    { disabled: state.mesh.loading || device.status === 'connecting' }
  );
  const transfer = deviceActionButton(
    tr('devices.transfer.files'),
    () => void openFileSendDialog(device.deviceId, transfer),
    {
      disabled: state.mesh.loading || crossDeviceActionsPaused(),
      title: crossDeviceActionsPaused() ? tr('status.crossDevicePaused') : ''
    }
  );
  const permissions = deviceActionButton(
    tr('devices.permissions.action'),
    () => openDevicePermissions(device, permissions),
    { disabled: state.mesh.loading }
  );
  const diagnostics = deviceDiagnosticsButton(device);
  const revoke = deviceActionButton(
    tr('devices.revoke.short'),
    () => openDevicePermissions(device, revoke),
    { className: 'danger-text', disabled: state.mesh.loading }
  );
  const connectionState = document.createElement('span');
  connectionState.className = 'device-connection-state';
  connectionState.textContent = connection?.authenticated
    ? tr('devices.connection.ready')
    : tr('devices.connection.onDemand');
  const history = deviceActionButton(tr('transfers.center.action'), () => openTransferCenter(history));
  els.deviceDetailActions.append(remote, viewSessions, transfer, connectionState, deviceMoreMenu([
    connect,
    diagnostics,
    permissions,
    history,
    revoke
  ]));
}

function renderMeshAgentList(overview) {
  if (!els.meshAgentList) return;
  els.meshAgentList.replaceChildren();
  if (els.agentCatalogMeta) els.agentCatalogMeta.textContent = '';
  const selectedDevice = selectedDeviceDetail(overview);
  if (!selectedDevice) return;
  const deviceAgents = overview.agents.filter((agent) => overview.slots.some((slot) => (
    slot.agentId === agent.agentId
    && slot.accountBindingId
    && slot.assignmentState === 'linked'
    && slot.deviceId === selectedDevice.deviceId
  )));
  const unassignedSlots = overview.slots.filter((slot) => (
    slot.deviceId === selectedDevice.deviceId
    && (slot.assignmentState !== 'linked' || !slot.agentId || !slot.accountBindingId)
  ));
  if (els.agentCatalogMeta) {
    const slotCount = overview.slots.filter((slot) => slot.deviceId === selectedDevice?.deviceId).length;
    els.agentCatalogMeta.textContent = tr('devices.meta.deviceAgentSlotCount', {
      agents: deviceAgents.length,
      slots: slotCount
    });
  }
  if (!deviceAgents.length && !unassignedSlots.length) {
    const empty = document.createElement('p');
    empty.className = 'mesh-catalog-empty';
    empty.textContent = overview.agents.length
      ? tr('devices.agents.emptyOnDevice')
      : tr('devices.agents.empty');
    els.meshAgentList.append(empty);
    return;
  }
  for (const agent of deviceAgents) {
    const slots = overview.slots.filter((slot) => (
      slot.agentId === agent.agentId
      && slot.accountBindingId
      && slot.assignmentState === 'linked'
    ));
    const deviceSlots = slots.filter((slot) => slot.deviceId === selectedDevice.deviceId);
    const deviceBindingIds = new Set(deviceSlots.map((slot) => slot.accountBindingId));
    const bindings = overview.accountBindings.filter((binding) => (
      binding.agentId === agent.agentId && deviceBindingIds.has(binding.accountBindingId)
    ));
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'mesh-agent-card';
    const name = document.createElement('strong');
    name.textContent = agent.displayName;
    const count = document.createElement('span');
    count.textContent = tr('devices.agents.devicePositions', { slots: deviceSlots.length });
    const providers = document.createElement('small');
    providers.textContent = bindings.length
      ? bindings.map((binding) => binding.providerNamespace).join(' · ')
      : tr('devices.agents.noBinding');
    card.append(name, count, providers);
    card.addEventListener('click', () => void viewDeviceAgentSessions(selectedDevice, agent, overview));
    els.meshAgentList.append(card);
  }
  if (unassignedSlots.length) {
    const heading = document.createElement('div');
    heading.className = 'mesh-unassigned-heading';
    const title = document.createElement('span');
    title.textContent = tr('catalog.unassigned.title');
    const count = document.createElement('span');
    count.textContent = tr('catalog.unassigned.count', { n: unassignedSlots.length });
    heading.append(title, count);
    els.meshAgentList.append(heading);
    for (const slot of unassignedSlots) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'mesh-agent-card is-unassigned';
      const name = document.createElement('strong');
      name.textContent = slot.localLabel || slot.profileId;
      const action = document.createElement('span');
      action.textContent = tr('catalog.unassigned.action');
      const meta = document.createElement('small');
      meta.textContent = `${appLabel(slot.appId)} · ${slot.assignmentState || 'pending'}`;
      card.append(name, action, meta);
      card.addEventListener('click', () => openSlotAssignmentDialog(slot));
      els.meshAgentList.append(card);
    }
  }
}

async function toggleMeshReachability() {
  if (state.mesh.loading || !window.manager.setDeviceReachable) return;
  const enabled = state.mesh.overview?.reachability?.userEnabled !== true;
  state.mesh.loading = true;
  state.mesh.errorCode = null;
  state.mesh.message = tr(enabled ? 'devices.reachability.enabling' : 'devices.reachability.disabling');
  renderDeviceCenter();
  const result = await window.manager.setDeviceReachable(enabled);
  state.mesh.loading = false;
  if (!result?.ok) {
    state.mesh.errorCode = result?.reasonCode || 'mesh-reachability-failed';
    state.mesh.message = '';
  } else {
    state.mesh.overview = result.overview;
    state.mesh.message = tr(enabled ? 'devices.reachability.enabled' : 'devices.reachability.disabled');
  }
  renderDeviceCenter();
}

async function connectMeshDevice(device) {
  if (state.mesh.loading || !window.manager.connectDevice) return;
  state.mesh.loading = true;
  state.mesh.errorCode = null;
  state.mesh.message = tr('devices.connection.connectingNamed', { name: device.name });
  renderDeviceCenter();
  const result = await window.manager.connectDevice(device.deviceId);
  state.mesh.loading = false;
  if (!result?.ok) {
    state.mesh.errorCode = result?.reasonCode || 'peer-connect-failed';
    state.mesh.message = '';
  } else {
    state.mesh.overview = result.overview;
    state.mesh.message = tr('devices.connection.connected', { name: device.name });
  }
  renderDeviceCenter();
  if (result?.ok) await loadSessions();
}

async function openRemoteDevice(device) {
  if (state.mesh.loading || !window.manager.openRemoteControl) return;
  state.mesh.loading = true;
  state.mesh.errorCode = null;
  state.mesh.message = tr('remote.action.opening', { name: device.name });
  renderDeviceCenter();
  const result = await window.manager.openRemoteControl(device.deviceId);
  state.mesh.loading = false;
  if (!result?.ok) {
    state.mesh.errorCode = result?.reasonCode || 'remote-open-failed';
    state.mesh.message = '';
    setStatus(remoteErrorText(state.mesh.errorCode, device.name));
  } else {
    state.mesh.remoteSessions = Array.isArray(result.sessions) ? result.sessions : state.mesh.remoteSessions;
    state.mesh.message = tr('remote.action.waitingConsent', { name: device.name });
    state.ui = window.UiContext.openRemote(state.ui, result.session?.sessionId);
    closeUtilityDialog(els.deviceCenterDialog);
    setWorkspaceMode('remote');
  }
  renderDeviceCenter();
}

async function disconnectMeshDevice(device) {
  if (state.mesh.loading || !window.manager.disconnectDevice) return;
  state.mesh.loading = true;
  const result = await window.manager.disconnectDevice(device.deviceId);
  state.mesh.loading = false;
  if (!result?.ok) {
    state.mesh.errorCode = result?.reasonCode || 'peer-disconnect-failed';
  } else {
    state.mesh.overview = result.overview;
    state.mesh.errorCode = null;
    state.mesh.message = tr('devices.connection.disconnected', { name: device.name });
  }
  renderDeviceCenter();
}

function deviceDiagnosticsButton(device) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = tr('devices.diagnostics.action');
  button.disabled = state.mesh.loading;
  button.addEventListener('click', () => openDeviceDiagnostics(device, button));
  return button;
}

async function openMeshNetworkSettings(returnFocus = document.activeElement) {
  if (!els.meshNetworkDialog || state.mesh.networkLoading || !window.manager.getDeviceNetworkConfig) return;
  const focusContext = captureChildDialogReturnFocus(returnFocus);
  state.mesh.networkLoading = true;
  els.networkSettingsBtn.disabled = true;
  const result = await window.manager.getDeviceNetworkConfig();
  state.mesh.networkLoading = false;
  els.networkSettingsBtn.disabled = false;
  if (!result?.ok) {
    state.mesh.errorCode = result?.reasonCode || 'network-config-read-failed';
    renderDeviceCenter();
    return;
  }
  els.meshSignalingUrls.value = (result.config?.signalingUrls || []).join('\n');
  els.meshStunUrls.value = (result.config?.stunUrls || []).join('\n');
  els.meshNetworkStatus.dataset.state = 'idle';
  els.meshNetworkStatus.textContent = tr('devices.network.ready');
  openChildDialog(els.meshNetworkDialog, focusContext);
}

async function saveMeshNetworkSettings() {
  if (state.mesh.networkLoading || !window.manager.updateDeviceNetworkConfig) return;
  state.mesh.networkLoading = true;
  els.saveMeshNetworkBtn.disabled = true;
  els.meshNetworkStatus.dataset.state = 'busy';
  els.meshNetworkStatus.textContent = tr('devices.network.saving');
  const result = await window.manager.updateDeviceNetworkConfig({
    signalingUrls: splitNetworkLines(els.meshSignalingUrls.value),
    stunUrls: splitNetworkLines(els.meshStunUrls.value)
  });
  state.mesh.networkLoading = false;
  els.saveMeshNetworkBtn.disabled = false;
  if (!result?.ok) {
    els.meshNetworkStatus.dataset.state = 'error';
    els.meshNetworkStatus.textContent = tr('devices.network.failed', { code: result?.reasonCode || 'network-config-invalid' });
    return;
  }
  els.meshSignalingUrls.value = (result.config?.signalingUrls || []).join('\n');
  els.meshStunUrls.value = (result.config?.stunUrls || []).join('\n');
  if (state.mesh.overview?.reachability && result.network) {
    state.mesh.overview.reachability = {
      ...state.mesh.overview.reachability,
      signaling: result.network.signaling,
      ice: result.network.ice
    };
  }
  state.mesh.message = tr('devices.network.saved');
  els.meshNetworkDialog.close();
  renderDeviceCenter();
  await loadDeviceOverview({ silent: true });
}

function splitNetworkLines(value) {
  return [...new Set(String(value || '')
    .split(/[\r\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean))]
    .slice(0, 8);
}

function connectionPathText(connection) {
  const path = ['lan', 'direct', 'relay'].includes(connection?.networkPath)
    ? connection.networkPath
    : 'unknown';
  return tr(`devices.path.${path}`);
}

async function openDeviceDiagnostics(device, returnFocus = document.activeElement) {
  if (!els.meshDiagnosticsDialog || !device?.deviceId) return;
  state.mesh.diagnosticDeviceId = device.deviceId;
  state.mesh.diagnostics = null;
  state.mesh.diagnosticsError = null;
  if (els.meshDiagnosticsTitle) {
    els.meshDiagnosticsTitle.textContent = tr('devices.diagnostics.named', { name: device.name });
  }
  openChildDialog(els.meshDiagnosticsDialog, returnFocus);
  renderDeviceDiagnostics();
  await refreshDeviceDiagnostics();
}

async function refreshDeviceDiagnostics(options = {}) {
  const deviceId = state.mesh.diagnosticDeviceId;
  if (!deviceId || state.mesh.diagnosticsLoading || !window.manager.getDeviceDiagnostics) return;
  state.mesh.diagnosticsLoading = true;
  state.mesh.diagnosticsError = null;
  if (!options.quiet) renderDeviceDiagnostics();
  const result = await window.manager.getDeviceDiagnostics(deviceId);
  state.mesh.diagnosticsLoading = false;
  if (!result?.ok) {
    state.mesh.diagnosticsError = result?.reasonCode || 'device-diagnostics-failed';
  } else {
    state.mesh.diagnostics = result.diagnostics;
  }
  renderDeviceDiagnostics();
}

function renderDeviceDiagnostics() {
  if (!els.meshDiagnosticsBody || !els.meshDiagnosticsStatus) return;
  els.refreshMeshDiagnosticsBtn.disabled = state.mesh.diagnosticsLoading;
  if (state.mesh.diagnosticsLoading) {
    els.meshDiagnosticsStatus.dataset.state = 'busy';
    els.meshDiagnosticsStatus.textContent = tr('devices.diagnostics.checking');
  } else if (state.mesh.diagnosticsError) {
    els.meshDiagnosticsStatus.dataset.state = 'error';
    els.meshDiagnosticsStatus.textContent = tr('devices.diagnostics.failed', { code: state.mesh.diagnosticsError });
  } else if (state.mesh.diagnostics) {
    els.meshDiagnosticsStatus.dataset.state = 'ready';
    els.meshDiagnosticsStatus.textContent = tr('devices.diagnostics.checked', {
      time: diagnosticTime(state.mesh.diagnostics.checkedAt)
    });
  } else {
    els.meshDiagnosticsStatus.dataset.state = 'idle';
    els.meshDiagnosticsStatus.textContent = '';
  }

  els.meshDiagnosticsBody.replaceChildren();
  const value = state.mesh.diagnostics;
  if (!value) return;
  appendDiagnosticSection(els.meshDiagnosticsBody, tr('devices.diagnostics.identity'), [
    [tr('devices.diagnostics.deviceStatus'), diagnosticCode(value.device.status)],
    [tr('devices.diagnostics.appProtocol'), `${value.device.platform} ${value.device.arch} · AgentDesk ${value.device.appVersion} · ${value.device.protocolVersion}`],
    [tr('devices.diagnostics.fingerprint'), value.device.fingerprint || '-'],
    [tr('devices.diagnostics.inventory'), `r${value.device.inventoryRevision || 0}`]
  ]);

  const signaling = value.signaling || {};
  const services = (signaling.services || []).map((item) => (
    `${item.service} · ${diagnosticCode(item.state)}`
  )).join('\n') || tr('devices.value.none');
  appendDiagnosticSection(els.meshDiagnosticsBody, tr('devices.diagnostics.reachability'), [
    [tr('devices.diagnostics.signaling'), diagnosticCode(signaling.state)],
    [tr('devices.diagnostics.signalingServices'), services],
    [tr('devices.diagnostics.stun'), configuredText(value.ice?.stunConfigured, value.ice?.stunUrlCount)],
    [tr('devices.diagnostics.turn'), configuredText(value.ice?.turnConfigured, value.ice?.turnUrlCount)],
    [tr('devices.diagnostics.turnExpiry'), value.ice?.turnCredentialExpiresAt ? diagnosticTime(value.ice.turnCredentialExpiresAt) : tr('devices.value.none')],
    [tr('devices.diagnostics.lanEndpoint'), value.localEndpoint?.active
      ? tr('devices.value.activeCount', { n: value.localEndpoint.endpointCount || 0 })
      : tr('devices.value.inactive')]
  ]);

  appendDiagnosticSection(els.meshDiagnosticsBody, tr('devices.diagnostics.connection'), [
    [tr('devices.diagnostics.authenticated'), diagnosticCode(value.connection?.authenticated ? 'authenticated' : 'not-authenticated')],
    [tr('devices.diagnostics.signalPath'), diagnosticCode(value.connection?.signalingPath)],
    [tr('devices.diagnostics.mediaPath'), diagnosticCode(value.connection?.networkPath)],
    [tr('devices.diagnostics.candidates'), (value.connection?.candidateTypes || []).join(' + ') || tr('devices.value.none')],
    [tr('devices.diagnostics.transport'), (value.connection?.protocols || []).join(' + ') || tr('devices.value.none')],
    [tr('devices.diagnostics.pairState'), diagnosticCode(value.connection?.selectedPairState)]
  ]);

  appendDiagnosticSection(els.meshDiagnosticsBody, tr('devices.diagnostics.permissions'), [
    [tr('devices.diagnostics.screen'), diagnosticCode(value.permissions?.screen)],
    [tr('devices.diagnostics.input'), diagnosticCode(value.permissions?.input)],
    [tr('devices.diagnostics.file'), diagnosticCode(value.permissions?.file)],
    [tr('devices.diagnostics.pointer'), diagnosticCode(value.permissions?.sessionPointer)]
  ]);
}

function appendDiagnosticSection(container, title, rows) {
  const section = document.createElement('section');
  section.className = 'device-diagnostics-section';
  const heading = document.createElement('h4');
  heading.textContent = title;
  const list = document.createElement('dl');
  for (const [label, value] of rows) {
    const term = document.createElement('dt');
    term.textContent = label;
    const detail = document.createElement('dd');
    detail.textContent = String(value ?? '-');
    list.append(term, detail);
  }
  section.append(heading, list);
  container.append(section);
}

function configuredText(configured, count) {
  return configured
    ? tr('devices.value.configuredCount', { n: Number(count) || 0 })
    : tr('devices.value.notConfigured');
}

function diagnosticCode(code) {
  const key = String(code || 'none').toLowerCase();
  if (['online', 'offline', 'connecting', 'sleeping', 'revoked'].includes(key)) {
    return tr(`devices.status.${key}`);
  }
  const known = new Set([
    'degraded', 'disabled', 'stopped',
    'lan', 'signaling', 'direct', 'relay', 'unknown', 'none',
    'authenticated', 'not-authenticated', 'succeeded',
    'allowed', 'not-allowed', 'available', 'unavailable', 'unsupported',
    'granted', 'denied', 'restricted', 'not-determined'
  ]);
  return known.has(key) ? tr(`devices.value.${key}`) : key;
}

function diagnosticTime(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : '-';
}

function openDevicePermissions(device, returnFocus = document.activeElement) {
  if (!els.devicePermissionsDialog || device.isLocal) return;
  state.mesh.permissionDeviceId = device.deviceId;
  if (els.devicePermissionsTitle) {
    els.devicePermissionsTitle.textContent = tr('devices.permissions.named', { name: device.name });
  }
  const supported = new Set(device.capabilities || []);
  const enabled = new Set(device.permissions || []);
  for (const checkbox of els.devicePermissionList?.querySelectorAll('input[data-capability]') || []) {
    const capability = checkbox.dataset.capability;
    checkbox.checked = enabled.has(capability);
    checkbox.disabled = !supported.has(capability);
  }
  openChildDialog(els.devicePermissionsDialog, returnFocus);
}

async function saveRemoteDevicePermissions() {
  const deviceId = state.mesh.permissionDeviceId;
  if (!deviceId || state.mesh.loading || !window.manager.updateDevicePermissions) return;
  const permissions = {};
  for (const checkbox of els.devicePermissionList?.querySelectorAll('input[data-capability]') || []) {
    if (!checkbox.disabled) permissions[checkbox.dataset.capability] = checkbox.checked;
  }
  state.mesh.loading = true;
  const result = await window.manager.updateDevicePermissions({ deviceId, permissions });
  state.mesh.loading = false;
  if (!result?.ok) {
    state.mesh.errorCode = result?.reasonCode || 'device-permissions-failed';
    state.mesh.message = '';
  } else {
    state.mesh.overview = result.overview;
    state.mesh.errorCode = null;
    state.mesh.message = tr('devices.permissions.saved');
    els.devicePermissionsDialog.close();
  }
  renderDeviceCenter();
}

async function revokeRemoteDevice() {
  const deviceId = state.mesh.permissionDeviceId;
  const device = state.mesh.overview?.devices?.find((item) => item.deviceId === deviceId);
  if (!device || device.isLocal || state.mesh.loading || !window.manager.revokeDevice) return;
  if (!window.confirm(tr('devices.revoke.confirm', { name: device.name }))) return;
  state.mesh.loading = true;
  const result = await window.manager.revokeDevice({ deviceId, remove: true });
  state.mesh.loading = false;
  if (!result?.ok) {
    state.mesh.errorCode = result?.reasonCode || 'device-revoke-failed';
    state.mesh.message = '';
  } else {
    state.mesh.overview = result.overview;
    state.mesh.errorCode = null;
    state.mesh.message = tr('devices.revoke.done', { name: device.name });
    state.mesh.permissionDeviceId = null;
    els.devicePermissionsDialog.close();
  }
  renderDeviceCenter();
  renderTopbarContext();
}

async function renameLocalDevice(device) {
  const name = window.prompt(tr('devices.rename.prompt'), device.name);
  if (name === null || !name.trim() || name.trim() === device.name) return;
  state.mesh.loading = true;
  state.mesh.errorCode = null;
  state.mesh.message = tr('devices.status.renaming');
  renderDeviceCenter();
  const result = await window.manager.renameDevice({ deviceId: device.deviceId, name: name.trim() });
  state.mesh.loading = false;
  if (!result?.ok) {
    state.mesh.errorCode = result?.reasonCode || 'mesh-operation-failed';
    state.mesh.message = '';
  } else {
    state.mesh.overview = result.overview;
    state.mesh.message = tr('devices.status.renamed');
  }
  renderDeviceCenter();
}

async function runMeshTransportProbe() {
  if (state.mesh.loading || !window.manager.probeMeshTransport) return;
  state.mesh.loading = true;
  state.mesh.errorCode = null;
  state.mesh.message = tr('devices.probe.starting');
  renderDeviceCenter();
  const result = await window.manager.probeMeshTransport();
  state.mesh.loading = false;
  if (!result?.ok) {
    state.mesh.errorCode = result?.reasonCode || 'webrtc-probe-failed';
    state.mesh.message = '';
  } else {
    const probe = result.result;
    const path = [
      ...(probe.candidateTypes || []),
      ...(probe.protocols || [])
    ].join(' / ') || tr('devices.probe.localPath');
    state.mesh.message = tr('devices.probe.success', {
      ms: probe.elapsedMs,
      path
    });
  }
  renderDeviceCenter();
}

function meshErrorText(code) {
  const known = {
    'os-key-protection-unavailable': 'devices.error.keyProtection',
    'mesh-storage-incomplete': 'devices.error.storageIncomplete',
    'mesh-key-store-without-database': 'devices.error.keyWithoutStore',
    'mesh-key-store-unreadable': 'devices.error.keyUnreadable',
    'mesh-database-newer-than-app': 'devices.error.databaseNewer',
    'device-not-found': 'devices.error.deviceNotFound',
    'remote-device-rename-not-available': 'devices.error.remoteRename',
    'capability-denied:file.receive': 'transfers.error.permission',
    'file-disk-space': 'transfers.error.disk',
    'file-checksum-failed': 'transfers.error.checksum',
    'file-selection-too-large': 'transfers.error.size',
    'file-selection-total-too-large': 'transfers.error.size',
    'file-destination-required': 'transfers.error.destination',
    'file-destination-invalid': 'transfers.error.destination',
    'file-destination-not-directory': 'transfers.error.destination'
  };
  if (String(code || '').startsWith('pairing-')) return tr('devices.error.pairing', { code });
  if (String(code || '').startsWith('device-') || String(code || '').startsWith('capability-')) {
    return tr('devices.error.deviceAction', { code });
  }
  if (known[code]) return tr(known[code]);
  if (String(code || '').startsWith('file-')) return tr('transfers.error.generic', { code });
  if (String(code || '').startsWith('remote-')) return tr('remote.error.generic', { code });
  if (String(code || '').startsWith('webrtc-') || String(code || '').startsWith('datachannel-') || String(code || '').startsWith('ice-')) {
    return tr('devices.probe.failed', { code });
  }
  return tr('devices.error.generic', { code: code || '-' });
}

function remoteInventoryRefreshFailureText(code, deviceName = '-') {
  const value = String(code || 'inventory-refresh-failed');
  if (/capability-denied:inventory\.read|device-revoked/.test(value)) {
    return tr('status.refreshRemoteDenied', { name: deviceName });
  }
  if (/protocol|version|peer-message-type-unknown/.test(value)) {
    return tr('status.refreshRemoteVersion', { name: deviceName });
  }
  if (/route|endpoint|fetch|signal.*unavailable|device-unavailable/.test(value)) {
    return tr('status.refreshRemoteNoRoute', { name: deviceName });
  }
  if (/timeout|peer-disconnected|peer-not-connected|peer-not-authenticated/.test(value)) {
    return tr('status.refreshRemoteTimeout', { name: deviceName });
  }
  return tr('status.refreshRemoteFailedReason', { name: deviceName, code: value });
}

function remoteErrorText(code, deviceName = '-') {
  const value = String(code || 'remote-failed');
  const rules = [
    [/revoked|device-not-found/, 'remote.error.revoked'],
    [/protocol|version|incompatible/, 'remote.error.version'],
    [/capability-denied:screen\.view|screen.*(permission|denied|restricted)|permission.*screen|display-unavailable|desktop-capturer-unavailable|media-not-allowed/, 'remote.error.screenPermission'],
    [/capability-denied:input\.control|input.*(permission|denied|restricted)|permission.*input/, 'remote.error.inputPermission'],
    [/rejected|user-denied|consent-denied/, 'remote.error.rejected'],
    [/input-owner|input-busy|input-target-conflict|exclusive|already-control/, 'remote.error.exclusive'],
    [/relay-unavailable|turn-unavailable/, 'remote.error.relayUnavailable'],
    [/direct-failed.*relay|relay-available/, 'remote.error.directFailedRelay'],
    [/offline|peer-not-connected|device-unavailable|peer-route-unavailable|signal.*unavailable/, 'remote.error.offline'],
    [/timeout|ice-failed|connect-failed|peer-disconnected|peer-not-authenticated|media-failed/, 'remote.error.unreachable']
  ];
  const matched = rules.find(([pattern]) => pattern.test(value));
  return matched
    ? tr(matched[1], { name: deviceName, code: value })
    : tr('remote.error.generic', { code: value });
}

function platformLabel(platform) {
  const key = `devices.platform.${platform}`;
  const label = tr(key);
  return label === key ? platform : label;
}

// ── 本机工具维护 ────────────────────────────────────
// ── 统一提醒入口 ─────────────────────────────────────
function collectAttentionItems() {
  const items = [];
  const now = Date.now();
  if (window.YardCats) {
    for (const profile of state.profiles) {
      const activityState = window.YardCats.deriveState(now, profile, state.activity[profile.id]);
      if (activityState === 'confused') {
        items.push({
          kind: 'error',
          title: tr('attention.confused.title', { name: profile.name }),
          detail: tr('attention.confused.detail'),
          profileId: profile.id,
          action: 'diagnostics'
        });
      }
      const energy = window.YardEnergy
        ? window.YardEnergy.deriveEnergy(state.quotas[profile.id], now)
        : 'unknown';
      if (energy === 'exhausted') {
        items.push({
          kind: 'warning',
          title: tr('attention.lowquota.title', { name: profile.name }),
          detail: tr('attention.lowquota.detail'),
          profileId: profile.id,
          action: 'quota'
        });
      }
    }
  }
  if (state.updateInfo?.updateAvailable) {
    items.push({
      kind: 'info',
      title: tr('attention.update.title', { version: state.updateInfo.latestVersion }),
      detail: tr('attention.update.detail'),
      action: 'update'
    });
  }
  if (state.mesh.overview?.initialized) {
    for (const slot of state.mesh.overview.slots || []) {
      if (slot.assignmentState === 'linked' && slot.agentId && slot.accountBindingId) continue;
      const device = state.mesh.overview.devices.find((item) => item.deviceId === slot.deviceId);
      items.push({
        kind: slot.assignmentState === 'identity-changed' ? 'error' : 'warning',
        title: tr('attention.catalog.title', { name: slot.localLabel || appLabel(slot.appId) }),
        detail: tr('attention.catalog.detail', {
          device: device?.name || slot.deviceId,
          state: slot.assignmentState || 'pending'
        }),
        slotKey: catalogSlotKey(slot),
        action: 'assign-slot'
      });
    }
  }
  return items.slice(0, 8);
}

function renderAttentionInbox() {
  if (!els.attentionInbox) return;
  const items = collectAttentionItems();
  els.attentionInbox.hidden = items.length === 0;
  if (els.attentionEmpty) els.attentionEmpty.hidden = items.length > 0 || incomingTaskPackageTransfers().length > 0;
  updateActivityBadge(items.length);
  els.attentionCount.textContent = String(items.length);
  els.attentionItems.replaceChildren();
  for (const item of items) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'attention-item';
    button.dataset.kind = item.kind || 'info';
    const title = document.createElement('b');
    title.textContent = item.title;
    const detail = document.createElement('small');
    detail.textContent = item.detail || tr('attention.detail.fallback');
    button.append(title, detail);
    button.addEventListener('click', async () => {
      if (item.profileId && item.profileId !== currentProfileId()) await selectProfile(item.profileId);
      if (item.action === 'diagnostics') await showDiagnostics();
      else if (item.action === 'quota') {
        const anchor = selectedCardControl('.account-card-quota-summary');
        closeUtilityDialog(els.activityCenterDialog, { restoreFocus: !anchor || anchor.disabled });
        openQuotaPopover(anchor);
      }
      else if (item.action === 'update') await handleUpdateClick();
      else if (item.action === 'assign-slot') openSlotAssignmentDialog(catalogSlotByKey(item.slotKey));
    });
    els.attentionItems.append(button);
  }
}

// i18n 便捷取词（window.I18N 由 src/i18n/ 提供；未加载时回退到 key，永不抛错）
function tr(key, params) {
  return window.I18N ? window.I18N.t(key, params) : key;
}

// 日期格式跟随界面语言（BCP-47）；新增语言时在此登记
function dateLocale() {
  const map = { zh: 'zh-CN', en: 'en-US', ja: 'ja-JP' };
  const lang = window.I18N ? window.I18N.getLang() : 'zh';
  return map[lang] || 'zh-CN';
}

// 顶栏语言按钮显示当前语言缩写（中 / EN / 日）
function updateLangToggle() {
  if (!els.langToggle || !window.I18N) return;
  const map = { zh: '中文', en: 'English', ja: '日本語' };
  els.langToggle.textContent = map[window.I18N.getLang()] || '文';
  updateThemeToggle();
}

// 外观按钮上写的是现在的样子，点一下换成另一个。
function updateThemeToggle() {
  const label = els.themeToggle?.querySelector('span');
  if (!label) return;
  label.removeAttribute('data-i18n');
  label.textContent = tr(document.documentElement.dataset.theme === 'dark' ? 'system.theme.dark' : 'system.theme.light');
}

// 语言切换后重刷所有「运行时用 tr 生成」的文案（静态 data-i18n 由 I18N.apply 处理）
function rerenderLocalizedText() {
  renderTopbarContext();
  renderAccounts();
  renderAccountHeader();
  renderSessions();
  renderQuotaSummary();
  renderAttentionInbox();
  renderToolCenter();
  renderDeviceCenter();
  renderHubSystem();
  if (els.recruitDialog?.open) recruitDialog.render();
  if (els.welcomeDialog?.open) {
    if (state.firstUse.mode === 'onboarding') renderFirstUse();
    else prepareWelcomeGuide();
  }
}

let activityLoading = false;
let busySignature = '';

async function loadActivity() {
  if (activityLoading) return; // 上一轮还没回来就跳过，避免请求堆积
  activityLoading = true;
  let polled = false;
  try {
    const list = await window.manager.listActivity();
    state.activity = Object.fromEntries(list.map((item) => [item.profileId, item]));
    polled = true;
  } catch (_error) {
    // A failed probe is not "every cat idle": keep the last known activity.
  } finally {
    activityLoading = false;
  }
  if (polled) refreshSessionsOnActivity();
  // 新回复与在跑：探测结果交给会话记号；这一轮新冒出来的新回复交给声音层（它决定响不响）。
  const added = sessionMarks.updateFromActivity(Object.values(state.activity), hubWritingKeys());
  if (added > 0) document.dispatchEvent(new CustomEvent('agentdesk:replies', { detail: { added } }));
  const marksSignature = Object.values(state.activity)
    .map((item) => `${(item.writingKeys || []).join(',')};${(item.freshKeys || []).map((entry) => entry.key).join(',')}`)
    .join('|');
  const signature = Object.values(state.activity)
    .map((item) => `${item.profileId}:${item.activeNow || 0}:${item.writingNow ?? ''}`)
    .join('|');
  if (signature !== busySignature) {
    busySignature = signature;
    renderAccountHeader();
  } else {
    renderAccountRoster();
    renderTopbarContext();
  }
  if (marksSignature !== replySignature) {
    replySignature = marksSignature;
    applySessionFilter();
  }
  renderAttentionInbox();
}

let replySignature = '';

// 调度中枢正在跑的那几段：AgentDesk 亲手中转的，知道是哪一条会话就给它画“在跑”。
function hubWritingKeys() {
  const keys = [];
  for (const run of state.hub.runs.values()) {
    if (!HUB_ACTIVE.has(run.state) || !run.session?.id || !run.target?.id) continue;
    keys.push(`${run.target.id}::${run.session.id}`);
  }
  return keys;
}

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

function renderTopbarContext() {
  if (!els.topbarContext) return;
  const deviceContext = selectedDeviceLensLabel();
  if (state.ui.workspaceMode === 'remote') {
    const session = state.mesh.remoteSessions.find((item) => item.sessionId === state.ui.activeRemoteSessionId)
      || state.mesh.remoteSessions.find((item) => item.direction === 'outgoing');
    els.topbarContext.textContent = [deviceContext, tr('remote.workspace.context', {
      name: session?.deviceName || '-'
    })].filter(Boolean).join(' · ');
    return;
  }
  const profile = selectedProfile();
  const selectedGroup = identityGroups().find((group) => group.key === currentAgentId()) || null;
  if (!profile) {
    const remoteCount = activeOutgoingRemoteSessions().length;
    els.topbarContext.textContent = [
      deviceContext,
      selectedGroup?.agent?.displayName || selectedGroup?.primary?.name || tr('ctx.noAgent'),
      selectedGroup ? deploymentStateLabel(selectedGroup.readiness?.state) : null,
      remoteCount ? tr('remote.workspace.activeCount', { n: remoteCount }) : null
    ].filter(Boolean).join(' · ');
    return;
  }
  const activityState = window.YardCats
    ? window.YardCats.deriveState(Date.now(), profile, state.activity[profile.id])
    : 'rest';
  const remoteCount = activeOutgoingRemoteSessions().length;
  els.topbarContext.textContent = [
    deviceContext,
    profile.name,
    tr('state.' + activityState),
    remoteCount ? tr('remote.workspace.activeCount', { n: remoteCount }) : null
  ].filter(Boolean).join(' · ');
}

// （旧侧栏行渲染器 appendAccountRow 已随侧栏移除，账号呈现改为 renderAccountRoster 卡片）

// 账号身份分组：同一登录账号的多个槽位归为一组（identityKey 或指纹关联）。
// 庭院一只猫 = 一个账号组；会话与额度也按组聚合。
function identityGroups() {
  return identityGroupsForLens(currentDeviceLensId());
}

function identityGroupsForLens(lensId = 'all') {
  const overview = state.mesh.overview;
  if (overview?.initialized) {
    return window.AgentWorkspace.projectMeshAgentGroups({
      overview,
      profiles: state.profiles,
      lensId: lensId || 'all'
    });
  }
  if (!window.IdentityGroups) return state.profiles.map((profile) => ({ key: profile.id, primary: profile, members: [profile] }));
  return window.IdentityGroups.groupProfilesByIdentity(state.profiles);
}

function groupOfProfile(profileId) {
  if (!profileId) return null;
  return identityGroups().find((group) => group.members.some((member) => member.id === profileId)) || null;
}

function selectedGroupProfile(group) {
  if (!group) return null;
  const key = window.UiContext.selectedSlotKey(state.ui, currentDeviceLensId(), group.key);
  return group.members.find((member) => member._meshSlotKey === key || member.id === key)
    || (group.members.length === 1 ? group.members[0] : null);
}

function preferredGroupSlot(group) {
  const key = window.UiContext.selectedSlotKey(state.ui, currentDeviceLensId(), group.key);
  return preferredSlot(group.members, key);
}

function preferredSlot(members, key = currentSlotKey()) {
  return (members || []).find((member) => member._meshSlotKey === key || member.id === key)
    || (members || []).find((member) => !member._remote && member._deviceStatus !== 'offline')
    || (members || []).find((member) => member._deviceStatus === 'online')
    || (members || [])[0]
    || null;
}

function setProfileContext(profileId) {
  const group = groupOfProfile(profileId);
  if (!group) return false;
  const member = group.members.find((item) => item.id === profileId) || preferredSlot(group.members);
  if (!member) return false;
  if (state.actionAgentId && group.key === state.actionAgentId && group.key !== currentAgentId()) {
    // 正在别的猫的档案里做事：只更新它的运行位置，正在看的那只不变。
    state.ui = window.UiContext.setAgentSlot(state.ui, group.key, member._meshSlotKey || member.id);
    return true;
  }
  state.ui = window.UiContext.setAgent(state.ui, group.key, {
    slotKey: member._meshSlotKey || member.id
  });
  return true;
}

function setAgentContext(agentId) {
  const group = identityGroups().find((item) => item.key === agentId);
  if (!group) return false;
  const member = preferredGroupSlot(group);
  state.ui = window.UiContext.setAgent(state.ui, group.key, {
    slotKey: member?._meshSlotKey || member?.id || null
  });
  if (!member) state.ui = window.UiContext.setSlot(state.ui, null);
  return true;
}

function validateUiContext() {
  const overview = state.mesh.overview;
  if (!overview?.initialized) {
    const groups = identityGroupsForLens('all');
    const validAgentIdsByLens = { all: groups.map((group) => group.key) };
    const validSlotKeysByAgentAndLens = Object.fromEntries(groups.map((group) => [
      window.UiContext.slotMemoryKey('all', group.key),
      group.members.map((member) => member._meshSlotKey || member.id)
    ]));
    state.ui = window.UiContext.clearInvalid(state.ui, {
      validLensIds: ['all'],
      validAgentIdsByLens,
      validSlotKeysByAgentAndLens,
      validDeviceDetailIds: [],
      validRemoteSessionIds: []
    });
    return;
  }

  const lensIds = ['all', ...(overview.devices || []).map((device) => device.deviceId)];
  const validAgentIdsByLens = {};
  const validSlotKeysByAgentAndLens = {};
  for (const lens of lensIds) {
    const groups = identityGroupsForLens(lens);
    validAgentIdsByLens[lens] = groups.map((group) => group.key);
    for (const group of groups) {
      validSlotKeysByAgentAndLens[window.UiContext.slotMemoryKey(lens, group.key)] = group.members.map((member) => (
        member._meshSlotKey || member.id
      ));
    }
  }
  state.ui = window.UiContext.clearInvalid(state.ui, {
    validLensIds: lensIds,
    validAgentIdsByLens,
    validSlotKeysByAgentAndLens,
    validDeviceDetailIds: (overview.devices || []).map((device) => device.deviceId),
    validRemoteSessionIds: state.mesh.remoteSessions
      .filter((session) => session.direction === 'outgoing')
      .map((session) => session.sessionId)
  });
}

function validateSessionContext() {
  const validConversationIds = state.sessions.map(sessionKey);
  const validReplicaIdsByConversation = Object.fromEntries(state.sessions.map((session) => [
    sessionKey(session),
    (session.replicas || []).map((replica) => replica.replicaId)
  ]));
  state.ui = window.UiContext.clearInvalid(state.ui, {
    validConversationIds,
    validReplicaIdsByConversation
  });
}

async function selectDeviceLens(lensId) {
  const groups = identityGroupsForLens(lensId);
  updateUi(window.UiContext.setDeviceLens(state.ui, lensId, {
    validAgentIds: groups.map((group) => group.key)
  }));
  persistUiSelectionMemory();
  renderDeviceLens(state.mesh.overview);
  renderAccounts();
  renderAccountHeader();
  await loadSessions();
  await refreshRemoteInventoryForDevice(lensId);
}

function selectedDeviceLensLabel() {
  const overview = state.mesh.overview;
  if (!overview?.initialized) return null;
  if (currentDeviceLensId() === 'all') return tr('devices.lens.all');
  return overview.devices?.find((device) => device.deviceId === currentDeviceLensId())?.name
    || tr('devices.lens.all');
}

function populateIdentityDatalist() {
  const datalist = document.querySelector('#identityOptions');
  if (!datalist) return;
  datalist.replaceChildren();
  const keys = [...new Set(state.profiles.map((item) => item.identityKey).filter(Boolean))];
  for (const key of keys) {
    const option = document.createElement('option');
    option.value = key;
    datalist.append(option);
  }
}

async function selectProfile(profileId) {
  if (!setProfileContext(profileId)) return;
  persistUiSelectionMemory();
  renderAccounts();
  renderAccountHeader();
  await loadSessions();
  renderAttentionInbox();
}

async function selectAgent(agentId) {
  if (!setAgentContext(agentId)) return;
  persistUiSelectionMemory();
  renderAccounts();
  renderAccountHeader();
  await loadSessions();
  renderAttentionInbox();
}

function selectSlot(profileId) {
  const group = groupOfProfile(profileId);
  const member = group?.members.find((item) => item.id === profileId);
  if (!group || !member || group.key !== actionAgentId()) return;
  updateUi(window.UiContext.setAgentSlot(state.ui, group.key, member._meshSlotKey || member.id));
  persistUiSelectionMemory();
  renderAccounts();
  renderAccountHeader();
}

function populateGroupDatalist() {
  const groups = [...new Set(state.profiles.map((profile) => profile.group).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'zh-CN'));
  els.groupOptions.replaceChildren();
  for (const group of groups) {
    const option = document.createElement('option');
    option.value = group;
    els.groupOptions.append(option);
  }
}

function provisioningChoiceKey(agentId, deviceId) {
  return `${String(agentId || '')}::${String(deviceId || '')}`;
}

function supportedProvisioningApps() {
  return Object.entries(state.appMeta)
    .filter(([, meta]) => meta.canProvision === true)
    .map(([appId, meta]) => ({
      appId,
      clientForm: meta.provisioningClientForm || 'desktop',
      label: meta.label || appId
    }));
}

function selectedProvisioningApp(group, deviceId, profile = null) {
  if (!group || !deviceId) return null;
  const remembered = state.mesh.provisioningAppByAgentAndDevice[
    provisioningChoiceKey(group.key, deviceId)
  ];
  const deployment = group.deployments?.find((item) => item.deviceId === deviceId) || null;
  const fromExistingSlot = (group.allMembers || group.members || []).find((member) => (
    member._meshDeviceId === deviceId && state.appMeta[member.appId]?.canProvision === true
  )) || (group.allMembers || group.members || []).find((member) => state.appMeta[member.appId]?.canProvision === true);
  const appId = profile?.appId
    || remembered?.appId
    || deployment?.adapterId
    || group.blueprint?.preferredAppId
    || fromExistingSlot?.appId
    || null;
  if (!appId) return null;
  return {
    appId,
    clientForm: remembered?.clientForm
      || profile?._clientForm
      || group.blueprint?.preferredClientForm
      || 'desktop'
  };
}

function currentAgentActionContext(group = null, profile = selectedProfile()) {
  const selectedGroup = group || identityGroups().find((item) => item.key === actionAgentId()) || null;
  const overview = state.mesh.overview;
  if (!overview?.initialized || !selectedGroup) {
    return { group: selectedGroup, profile, meshMode: false };
  }
  const lensId = currentDeviceLensId();
  const deviceId = profile?._meshDeviceId
    || (lensId !== 'all' ? lensId : overview.localDeviceId);
  const device = (overview.devices || []).find((item) => item.deviceId === deviceId) || null;
  const deployment = (selectedGroup.deployments || []).find((item) => item.deviceId === deviceId) || null;
  const readiness = window.AgentWorkspace.resolveReadiness({
    overview,
    agentId: selectedGroup.key,
    lensId: deviceId,
    deployments: selectedGroup.deployments,
    allMembers: selectedGroup.allMembers,
    members: (selectedGroup.allMembers || []).filter((member) => member._meshDeviceId === deviceId)
  });
  const requested = selectedProvisioningApp(selectedGroup, deviceId, profile);
  const activeJob = (overview.provisioningJobs || []).find((job) => (
    job.agentId === selectedGroup.key
    && job.deviceId === deviceId
    && (!requested?.appId || job.requestedAppId === requested.appId)
  )) || null;
  return {
    meshMode: true,
    group: selectedGroup,
    profile,
    agent: selectedGroup.agent,
    device,
    deviceId,
    deployment,
    readiness,
    requested,
    activeJob,
    isRemote: deviceId !== overview.localDeviceId,
    busy: state.mesh.provisioningBusyKey === provisioningChoiceKey(selectedGroup.key, deviceId)
  };
}

function rememberProvisioningChoice(group, deviceId, appId, clientForm = 'desktop') {
  if (!group || !deviceId || !appId) return;
  state.mesh.provisioningAppByAgentAndDevice = {
    ...state.mesh.provisioningAppByAgentAndDevice,
    [provisioningChoiceKey(group.key, deviceId)]: { appId, clientForm }
  };
}

function provisioningButtonLabel(action) {
  if (action?.busy) return tr('deployment.action.preparing');
  const deploymentState = action?.readiness?.state || 'absent';
  if (deploymentState === 'ready' && action.profile) return tr('account.open');
  if (deploymentState === 'waiting-login') return tr('deployment.action.continueLogin');
  if (deploymentState === 'waiting-install') return tr('deployment.action.continueInstall');
  if (deploymentState === 'error' || deploymentState === 'unsupported') return tr('deployment.action.retry');
  if (window.AgentWorkspace?.isPreparationActive(deploymentState)) return tr('deployment.action.continue');
  return tr('deployment.action.firstOpen');
}

function provisioningResultMessage(result = {}, name = null) {
  const agentName = name || currentAgentActionContext()?.agent?.displayName || tr('account.noneAgent');
  if (result.state === 'ready' && result.ok) return tr('status.opened', { name: agentName });
  if (result.state === 'waiting-install') return tr('status.provisioning.waitingInstall', { name: agentName });
  if (result.state === 'waiting-login') return tr('status.provisioning.waitingLogin', { name: agentName });
  if (result.state === 'verifying') return tr('status.provisioning.verifying', { name: agentName });
  if (result.state === 'waiting-consent') return tr('status.provisioning.waitingConsent', { name: agentName });
  if (result.state === 'planning' || result.state === 'preparing') {
    return tr('status.provisioning.preparing', { name: agentName });
  }
  if (result.reasonCode === 'provisioning-client-required') return tr('status.provisioning.chooseClient');
  if (result.reasonCode === 'target-declined') return tr('status.provisioning.targetDeclined');
  if (String(result.reasonCode || '').startsWith('capability-denied:')) {
    return tr('status.provisioning.remotePermission');
  }
  if (String(result.reasonCode || '').startsWith('capability-unsupported:')) {
    return tr('status.provisioning.remoteUnsupported');
  }
  return tr('status.provisioning.failed', { code: result.reasonCode || result.reason || 'provisioning-failed' });
}

// 打开落在这只猫卡片上显示的那个运行位置。它不是正在看的那只时，
// 刷新账号数据但不把选择带过去，所以下面的会话列表不会跟着变。
async function openAgent(agentId) {
  const group = identityGroups().find((item) => item.key === agentId) || null;
  if (!group) return { ok: false, reasonCode: 'agent-required' };
  const profile = cardActionProfile(group);
  const viewing = agentId === currentAgentId();
  const reselect = (profileId) => (viewing ? profileId : null);
  const meshMode = state.mesh.overview?.initialized === true;
  if (!meshMode) {
    if (!profile) return { ok: false, reasonCode: 'profile-required' };
    const result = await window.manager.launchProfile(profile.id);
    if (!result.ok) {
      setStatus(result.reason || tr('status.openFail'));
      return result;
    }
    await loadProfiles(reselect(profile.id));
    setStatus(result.warning || tr('status.opened', { name: profile.name }));
    return result;
  }

  const action = currentAgentActionContext(group, profile);
  if (!action.agent || !action.deviceId) return { ok: false, reasonCode: 'agent-required' };
  if (!action.requested?.appId) {
    const result = { ok: false, reasonCode: 'provisioning-client-required' };
    setStatus(provisioningResultMessage(result, action.agent.displayName));
    accountCardControl(agentId, '.account-card-runtime select')?.focus();
    return result;
  }
  if (action.isRemote) {
    const busyKey = provisioningChoiceKey(action.group.key, action.deviceId);
    if (state.mesh.provisioningBusyKey === busyKey) return { ok: false, reasonCode: 'provisioning-busy' };
    state.mesh.provisioningBusyKey = busyKey;
    renderAccountHeader();
    let result;
    try {
      result = profile
        ? await window.manager.launchRemoteAgent({
            agentId: action.group.key,
            deviceId: action.deviceId,
            profileId: profile.id
          })
        : await window.manager.prepareRemoteAgent({
            agentId: action.group.key,
            deviceId: action.deviceId,
            requestedAppId: action.requested.appId,
            requestedClientForm: action.requested.clientForm || 'desktop'
          });
      if (result?.overview) state.mesh.overview = result.overview;
      validateUiContext();
      renderAccounts();
      renderDeviceCenter();
      setStatus(provisioningResultMessage(result, action.agent.displayName));
      if (result?.state === 'ready') requestDeviceOverviewReload();
      return result;
    } catch (error) {
      result = { ok: false, reasonCode: error?.message || 'remote-agent-action-failed' };
      setStatus(provisioningResultMessage(result, action.agent.displayName));
      return result;
    } finally {
      if (state.mesh.provisioningBusyKey === busyKey) state.mesh.provisioningBusyKey = null;
      renderAccountHeader();
    }
  }

  if (profile && state.appMeta[profile.appId]?.canProvision !== true) {
    const result = await window.manager.launchProfile(profile.id);
    if (!result.ok) {
      setStatus(result.reason || tr('status.openFail'));
      return result;
    }
    await loadProfiles(reselect(profile.id));
    setStatus(result.warning || tr('status.opened', { name: action.agent.displayName }));
    return result;
  }

  const busyKey = provisioningChoiceKey(action.group.key, action.deviceId);
  if (state.mesh.provisioningBusyKey === busyKey) return { ok: false, reasonCode: 'provisioning-busy' };
  state.mesh.provisioningBusyKey = busyKey;
  renderAccountHeader();
  let result;
  try {
    result = await window.manager.ensureAgentReady({
      agentId: action.group.key,
      deviceId: action.deviceId,
      requestedAppId: action.requested.appId,
      requestedClientForm: action.requested.clientForm || 'desktop'
    });
    if (result?.overview) state.mesh.overview = result.overview;
    if (result?.state === 'ready') {
      await loadProfiles(reselect(result.slot?.profileId || profile?.id || null));
    } else {
      await loadDeviceOverview({ silent: true });
    }
    setStatus(provisioningResultMessage(result, action.agent.displayName));
    return result;
  } catch (error) {
    result = { ok: false, reasonCode: error?.message || 'provisioning-failed' };
    setStatus(provisioningResultMessage(result, action.agent.displayName));
    return result;
  } finally {
    if (state.mesh.provisioningBusyKey === busyKey) state.mesh.provisioningBusyKey = null;
    renderAccountHeader();
  }
}

async function openSessionSendDialog(preselectedDeviceId = null, returnFocus = document.activeElement) {
  if (!els.sessionSendDialog) return;
  if (crossDeviceActionsPaused()) {
    setStatus(tr('status.crossDevicePaused'));
    return;
  }
  const sessions = resolvedActionSessions();
  const selections = sessions.map((session) => ({
    conversationId: session.conversationId,
    replicaId: session._replicaId
  })).filter((item) => item.conversationId && item.replicaId);
  if (!selections.length) return;
  const remotes = (state.mesh.overview?.devices || []).filter((device) => !device.isLocal);
  const targetDeviceId = populateTransferTargets(els.sessionSendTarget, remotes, preselectedDeviceId);
  state.ui = window.UiContext.createSessionPointerDraft(state.ui, {
    targetDeviceId,
    selections,
    message: remotes.length ? tr('transfers.ready', { n: selections.length }) : tr('transfers.noDevice')
  });
  renderSessionSendStatus();
  openChildDialog(els.sessionSendDialog, returnFocus);
}

async function openFileSendDialog(preselectedDeviceId = null, returnFocus = document.activeElement) {
  if (!els.fileSendDialog) return;
  if (crossDeviceActionsPaused()) {
    setStatus(tr('status.crossDevicePaused'));
    return;
  }
  const remotes = (state.mesh.overview?.devices || []).filter((device) => !device.isLocal);
  const targetDeviceId = populateTransferTargets(els.fileSendTarget, remotes, preselectedDeviceId);
  state.ui = window.UiContext.createFileDraft(state.ui, {
    targetDeviceId,
    message: remotes.length ? tr('transfers.filesReady') : tr('transfers.noDevice')
  });
  renderFileSendStatus();
  openChildDialog(els.fileSendDialog, returnFocus);
}

function directTaskPackageTargets() {
  if (crossDeviceActionsPaused()) return [];
  const overview = state.mesh.overview || {};
  const connections = new Map((overview.connections || [])
    .filter((connection) => connection?.authenticated === true)
    .map((connection) => [connection.deviceId, connection]));
  return (overview.devices || []).filter((device) => {
    if (!device || device.isLocal) return false;
    const connection = connections.get(device.deviceId);
    return Array.isArray(device.capabilities)
      && device.capabilities.includes('task.package.receive')
      && Array.isArray(device.permissions)
      && device.permissions.includes('task.package.receive')
      && Array.isArray(connection?.protocolFeatures)
      && connection.protocolFeatures.includes('task.package.transfer.v1');
  });
}

function renderTaskPackageDeliveryOptions() {
  const targets = directTaskPackageTargets();
  const hasDirectTarget = targets.length > 0;
  if (state.taskPackages.exportDelivery === 'direct' && !hasDirectTarget) {
    state.taskPackages.exportDelivery = 'portable';
    state.taskPackages.directTargetDeviceId = null;
  }
  if (els.taskPackageDeliveryPortable) {
    els.taskPackageDeliveryPortable.checked = state.taskPackages.exportDelivery !== 'direct';
  }
  if (els.taskPackageDeliveryDirect) {
    els.taskPackageDeliveryDirect.disabled = !hasDirectTarget;
    els.taskPackageDeliveryDirect.checked = state.taskPackages.exportDelivery === 'direct';
  }
  if (els.taskPackageDirectTarget) {
    const preferred = targets.some((item) => item.deviceId === state.taskPackages.directTargetDeviceId)
      ? state.taskPackages.directTargetDeviceId
      : targets[0]?.deviceId;
    els.taskPackageDirectTarget.replaceChildren();
    for (const device of targets) {
      const option = document.createElement('option');
      option.value = device.deviceId;
      option.textContent = `${device.name} · ${tr('devices.status.online')}`;
      option.selected = device.deviceId === preferred;
      els.taskPackageDirectTarget.append(option);
    }
    state.taskPackages.directTargetDeviceId = preferred || null;
  }
  const direct = state.taskPackages.exportDelivery === 'direct';
  if (els.taskPackageDirectTargetField) els.taskPackageDirectTargetField.hidden = !direct;
  if (els.taskPackageDirectAvailability) {
    els.taskPackageDirectAvailability.textContent = hasDirectTarget
      ? tr('taskPackage.delivery.available', { n: targets.length })
      : tr('taskPackage.delivery.unavailable');
  }
  if (els.taskPackageSecurity) {
    els.taskPackageSecurity.textContent = tr(direct
      ? 'taskPackage.security.direct'
      : 'taskPackage.security');
  }
  if (els.exportTaskPackageBtn && !state.taskPackages.exportBusy) {
    els.exportTaskPackageBtn.textContent = tr(direct
      ? 'taskPackage.direct.send'
      : 'taskPackage.export');
    els.exportTaskPackageBtn.disabled = !state.taskPackages.exportPreview || (direct && !state.taskPackages.directTargetDeviceId);
  }
}

async function openTaskPackageExportDialog(returnFocus = document.activeElement) {
  const sessions = resolvedActionSessions();
  if (sessions.length !== 1) return;
  const session = sessions[0];
  const profile = sessionOwnerProfile(session);
  if (!session || !profile || !els.taskPackageDialog || !window.manager.previewTaskPackageExport) return;
  resetTaskPackageExportState();
  state.taskPackages.exportBusy = true;
  lockTaskPackageDialog('export', true);
  setTaskPackageStatus('export', tr('taskPackage.status.reading'), 'busy');
  openChildDialog(els.taskPackageDialog, returnFocus);
  let result;
  try {
    result = await window.manager.previewTaskPackageExport({
      profileId: profile.id,
      sessionId: session.id
    });
  } catch (_error) {
    result = { ok: false, reasonCode: 'task-package-preview-failed' };
  } finally {
    state.taskPackages.exportBusy = false;
    lockTaskPackageDialog('export', false);
  }
  if (!result?.ok || !result.preview?.supported) {
    state.taskPackages.exportPreview = null;
    setTaskPackageStatus('export', taskPackageErrorText(result?.reasonCode || 'task-package-source-unsupported'), 'error');
    if (els.exportTaskPackageBtn) els.exportTaskPackageBtn.disabled = true;
    return;
  }
  state.taskPackages.exportPreview = result.preview;
  state.taskPackages.exportSource = {
    profileId: profile.id,
    sessionId: session.id,
    conversationId: session.conversationId || null
  };
  renderTaskPackageExportPreview();
  renderTaskPackageDeliveryOptions();
  setTaskPackageStatus('export', tr(
    result.preview.mode === 'native' ? 'taskPackage.status.nativeReady' : 'taskPackage.status.transcriptReady'
  ), 'idle');
  if (els.exportTaskPackageBtn) els.exportTaskPackageBtn.disabled = false;
}

function resetTaskPackageExportState() {
  if (els.taskPackageDialog) delete els.taskPackageDialog.dataset.flow;
  state.taskPackages.exportPreview = null;
  state.taskPackages.exportSource = null;
  state.taskPackages.exportBusy = false;
  state.taskPackages.exportCode = null;
  state.taskPackages.exportDelivery = 'portable';
  state.taskPackages.directTargetDeviceId = null;
  state.taskPackages.directTransfer = null;
  if (els.taskPackagePreview) els.taskPackagePreview.replaceChildren();
  for (const field of [
    els.taskPackageSender,
    els.taskPackageObjective,
    els.taskPackageCompleted,
    els.taskPackageNext,
    els.taskPackageBlockers,
    els.taskPackageAcceptance
  ]) {
    if (field) field.value = '';
  }
  if (els.taskPackageIncludeProject) els.taskPackageIncludeProject.checked = true;
  if (els.taskPackageIncludeAttachments) els.taskPackageIncludeAttachments.checked = false;
  if (els.taskPackageExportResult) els.taskPackageExportResult.hidden = true;
  if (els.taskPackageDirectResult) els.taskPackageDirectResult.hidden = true;
  if (els.taskPackageDirectResultDetail) els.taskPackageDirectResultDetail.textContent = '';
  if (els.taskPackageSwitchPortableBtn) els.taskPackageSwitchPortableBtn.hidden = true;
  if (els.taskPackageUnlockCode) els.taskPackageUnlockCode.textContent = '';
  if (els.taskPackageStatus) {
    els.taskPackageStatus.textContent = '';
    els.taskPackageStatus.dataset.state = 'idle';
  }
  if (els.exportTaskPackageBtn) {
    els.exportTaskPackageBtn.hidden = false;
    els.exportTaskPackageBtn.disabled = true;
    els.exportTaskPackageBtn.textContent = tr('taskPackage.export');
  }
  renderTaskPackageDeliveryOptions();
  lockTaskPackageDialog('export', false);
}

function renderTaskPackageExportPreview() {
  if (!els.taskPackagePreview) return;
  els.taskPackagePreview.replaceChildren();
  const preview = state.taskPackages.exportPreview;
  if (!preview) return;
  const title = document.createElement('strong');
  title.textContent = preview.title;
  const meta = document.createElement('span');
  meta.textContent = [preview.sourceAgentName, preview.appLabel, preview.projectName].filter(Boolean).join(' · ');
  const badge = document.createElement('b');
  badge.textContent = preview.mode === 'native'
    ? tr('taskPackage.mode.nativeCount', { n: preview.nativeRecordCount })
    : tr('taskPackage.mode.transcript');
  els.taskPackagePreview.append(title, meta, badge);
}

async function exportCurrentTaskPackage() {
  if (state.taskPackages.exportBusy || !state.taskPackages.exportPreview || !state.taskPackages.exportSource) return;
  if (!els.taskPackageObjective?.value.trim()) {
    setTaskPackageStatus('export', tr('taskPackage.status.objectiveRequired'), 'error');
    els.taskPackageObjective?.focus();
    return;
  }
  const source = state.taskPackages.exportSource;
  const direct = state.taskPackages.exportDelivery === 'direct';
  const targetDeviceId = state.taskPackages.directTargetDeviceId;
  if (direct && crossDeviceActionsPaused()) {
    state.taskPackages.exportDelivery = 'portable';
    state.taskPackages.directTargetDeviceId = null;
    renderTaskPackageDeliveryOptions();
    setTaskPackageStatus('export', tr('status.crossDevicePaused'), 'error');
    return;
  }
  if (direct && !targetDeviceId) {
    setTaskPackageStatus('export', tr('taskPackage.delivery.unavailable'), 'error');
    return;
  }
  state.taskPackages.exportBusy = true;
  lockTaskPackageDialog('export', true);
  if (els.exportTaskPackageBtn) els.exportTaskPackageBtn.disabled = true;
  setTaskPackageStatus('export', tr(direct
    ? 'taskPackage.direct.status.preparing'
    : 'taskPackage.status.exporting'), 'busy');
  let result;
  const input = {
    profileId: source.profileId,
    sessionId: source.sessionId,
    conversationId: source.conversationId,
    senderLabel: els.taskPackageSender?.value || '',
    checkpoint: {
      objective: els.taskPackageObjective?.value || '',
      completed: els.taskPackageCompleted?.value || '',
      next: els.taskPackageNext?.value || '',
      blockers: els.taskPackageBlockers?.value || '',
      acceptance: els.taskPackageAcceptance?.value || ''
    },
    includeProject: els.taskPackageIncludeProject?.checked !== false,
    includeAttachments: els.taskPackageIncludeAttachments?.checked === true
  };
  try {
    result = direct
      ? await window.manager.sendTaskPackageToDevice({ ...input, targetDeviceId })
      : await window.manager.exportTaskPackage(input);
  } catch (_error) {
    result = { ok: false, reasonCode: direct
      ? 'task-package-direct-send-failed'
      : 'task-package-export-failed' };
  } finally {
    state.taskPackages.exportBusy = false;
    lockTaskPackageDialog('export', false);
  }
  if (result?.cancelled) {
    if (els.exportTaskPackageBtn) els.exportTaskPackageBtn.disabled = false;
    setTaskPackageStatus('export', tr('taskPackage.status.cancelled'), 'idle');
    return;
  }
  if (!result?.ok) {
    if (els.exportTaskPackageBtn) els.exportTaskPackageBtn.disabled = false;
    setTaskPackageStatus('export', taskPackageErrorText(result?.reasonCode), 'error');
    if (direct && els.taskPackageDirectResult) {
      els.taskPackageDirectResult.hidden = false;
      if (els.taskPackageDirectResultDetail) {
        els.taskPackageDirectResultDetail.textContent = tr('taskPackage.direct.status.fallback', {
          reason: taskPackageErrorText(result?.reasonCode)
        });
      }
      if (els.taskPackageSwitchPortableBtn) els.taskPackageSwitchPortableBtn.hidden = false;
    }
    return;
  }
  if (direct) {
    state.taskPackages.directTransfer = result.transfer || null;
    state.mesh.transfers = result.transfers || state.mesh.transfers;
    state.taskPackages.history = result.history || state.taskPackages.history;
    if (els.taskPackageDirectResult) els.taskPackageDirectResult.hidden = false;
    if (els.taskPackageExportResult) els.taskPackageExportResult.hidden = true;
    const target = directTaskPackageTargets().find((item) => item.deviceId === targetDeviceId);
    const failed = result.transfer?.state === 'failed';
    if (els.taskPackageDirectResultDetail) {
      els.taskPackageDirectResultDetail.textContent = failed
        ? tr('taskPackage.direct.status.fallback', {
            reason: taskPackageErrorText(result.transfer?.lastError)
          })
        : tr('taskPackage.direct.status.queued', { name: target?.name || '-' });
    }
    if (els.taskPackageSwitchPortableBtn) {
      els.taskPackageSwitchPortableBtn.hidden = !failed;
    }
    if (els.exportTaskPackageBtn) {
      els.exportTaskPackageBtn.disabled = true;
      els.exportTaskPackageBtn.textContent = tr('taskPackage.direct.sent');
    }
    setTaskPackageStatus('export', failed
      ? tr('taskPackage.direct.status.failed')
      : tr('taskPackage.direct.status.waiting'), failed ? 'error' : 'idle');
    renderTransferList();
    renderIncomingTaskPackages();
    renderTaskPackageHistory();
    return;
  }
  state.taskPackages.exportCode = result.exported.unlockCode;
  state.taskPackages.history = result.history || state.taskPackages.history;
  if (els.taskPackageUnlockCode) els.taskPackageUnlockCode.textContent = result.exported.unlockCode;
  if (els.taskPackageExportResult) els.taskPackageExportResult.hidden = false;
  if (els.exportTaskPackageBtn) {
    els.exportTaskPackageBtn.disabled = true;
    els.exportTaskPackageBtn.textContent = tr('taskPackage.export.done');
  }
  setTaskPackageStatus('export', tr('taskPackage.status.exported'), 'idle');
  renderTaskPackageHistory();
}

async function saveOrSwitchTaskPackageToPortable() {
  const transfer = state.taskPackages.directTransfer;
  if (transfer?.canSavePortable && window.manager.saveTaskPackageFallback) {
    state.taskPackages.exportBusy = true;
    lockTaskPackageDialog('export', true);
    setTaskPackageStatus('export', tr('taskPackage.direct.status.savingFallback'), 'busy');
    let result;
    try {
      result = await window.manager.saveTaskPackageFallback(transfer.transferId);
    } catch (_error) {
      result = { ok: false, reasonCode: 'task-package-portable-fallback-failed' };
    } finally {
      state.taskPackages.exportBusy = false;
      lockTaskPackageDialog('export', false);
    }
    if (result?.cancelled) {
      setTaskPackageStatus('export', tr('taskPackage.status.cancelled'), 'idle');
      return;
    }
    if (!result?.ok) {
      setTaskPackageStatus('export', taskPackageErrorText(result?.reasonCode), 'error');
      return;
    }
    state.taskPackages.exportCode = result.saved.unlockCode;
    state.mesh.transfers = result.transfers || state.mesh.transfers;
    if (els.taskPackageUnlockCode) els.taskPackageUnlockCode.textContent = result.saved.unlockCode;
    if (els.taskPackageExportResult) els.taskPackageExportResult.hidden = false;
    if (els.taskPackageDirectResult) els.taskPackageDirectResult.hidden = true;
    if (els.taskPackageSwitchPortableBtn) els.taskPackageSwitchPortableBtn.hidden = true;
    setTaskPackageStatus('export', tr('taskPackage.direct.status.fallbackSaved'), 'idle');
    renderTransferList();
    return;
  }
  state.taskPackages.exportDelivery = 'portable';
  state.taskPackages.directTransfer = null;
  if (els.taskPackageDirectResult) els.taskPackageDirectResult.hidden = true;
  if (els.taskPackageSwitchPortableBtn) els.taskPackageSwitchPortableBtn.hidden = true;
  renderTaskPackageDeliveryOptions();
  setTaskPackageStatus('export', tr('taskPackage.direct.status.switchedPortable'), 'idle');
}

function openTaskPackageImportDialog(returnFocus = document.activeElement, options = {}) {
  if (!els.taskPackageImportDialog) return;
  resetTaskPackageImportState();
  if (options.mode === 'direct' && options.prepared?.draft && options.prepared?.inspected) {
    state.taskPackages.importMode = 'direct';
    state.taskPackages.importTransferId = options.transfer?.transferId || null;
    state.taskPackages.importDraft = options.prepared.draft;
    state.taskPackages.importPreview = options.prepared.inspected;
    if (els.taskPackagePortableImportSource) els.taskPackagePortableImportSource.hidden = true;
    if (els.taskPackageDirectImportSource) els.taskPackageDirectImportSource.hidden = false;
    const manifest = options.prepared.inspected.manifest;
    if (els.taskPackageDirectImportTitle) {
      els.taskPackageDirectImportTitle.textContent = manifest.session.originalTitle;
    }
    if (els.taskPackageDirectImportMeta) {
      els.taskPackageDirectImportMeta.textContent = [
        options.transfer?.receivedFromName,
        manifest.source.agentName,
        formatBytes(manifest.bytesTotal)
      ].filter(Boolean).join(' · ');
    }
    renderTaskPackageImportPreview();
    setTaskPackageStatus('import', options.prepared.inspected.compatibleProfiles.length
      ? tr('taskPackage.import.status.verified')
      : tr('taskPackage.import.status.noTarget'), options.prepared.inspected.compatibleProfiles.length ? 'idle' : 'error');
  }
  openChildDialog(els.taskPackageImportDialog, returnFocus);
}

function resetTaskPackageImportState() {
  state.taskPackages.importDraft = null;
  state.taskPackages.importPreview = null;
  state.taskPackages.importBusy = false;
  state.taskPackages.importMode = 'portable';
  state.taskPackages.importTransferId = null;
  if (els.taskPackagePortableImportSource) els.taskPackagePortableImportSource.hidden = false;
  if (els.taskPackageDirectImportSource) els.taskPackageDirectImportSource.hidden = true;
  if (els.taskPackageDirectImportTitle) els.taskPackageDirectImportTitle.textContent = '';
  if (els.taskPackageDirectImportMeta) els.taskPackageDirectImportMeta.textContent = '';
  if (els.taskPackageImportFile) els.taskPackageImportFile.textContent = tr('taskPackage.import.noFile');
  if (els.taskPackageImportCode) els.taskPackageImportCode.value = '';
  if (els.taskPackageImportPreview) {
    els.taskPackageImportPreview.hidden = true;
    els.taskPackageImportPreview.replaceChildren();
  }
  if (els.taskPackageTargetField) els.taskPackageTargetField.hidden = true;
  if (els.taskPackageOpenField) els.taskPackageOpenField.hidden = true;
  if (els.taskPackageTargetProfile) els.taskPackageTargetProfile.replaceChildren();
  if (els.taskPackageOpenAfter) els.taskPackageOpenAfter.checked = true;
  if (els.inspectTaskPackageBtn) els.inspectTaskPackageBtn.disabled = false;
  if (els.chooseTaskPackageFileBtn) els.chooseTaskPackageFileBtn.disabled = false;
  if (els.commitTaskPackageBtn) {
    els.commitTaskPackageBtn.disabled = true;
    els.commitTaskPackageBtn.textContent = tr('taskPackage.import.commit');
  }
  lockTaskPackageDialog('import', false);
  if (els.taskPackageImportStatus) {
    els.taskPackageImportStatus.textContent = tr('taskPackage.import.status.choose');
    els.taskPackageImportStatus.dataset.state = 'idle';
  }
}

async function chooseTaskPackageImportFile() {
  if (state.taskPackages.importBusy || !window.manager.chooseTaskPackageImport) return;
  await cancelTaskPackageImportDraft();
  clearTaskPackageImportInspection();
  if (els.taskPackageImportFile) els.taskPackageImportFile.textContent = tr('taskPackage.import.noFile');
  if (els.taskPackageImportCode) els.taskPackageImportCode.value = '';
  state.taskPackages.importBusy = true;
  lockTaskPackageDialog('import', true);
  if (els.chooseTaskPackageFileBtn) els.chooseTaskPackageFileBtn.disabled = true;
  setTaskPackageStatus('import', tr('taskPackage.import.status.choosing'), 'busy');
  let result;
  try {
    result = await window.manager.chooseTaskPackageImport();
  } catch (_error) {
    result = { ok: false, reasonCode: 'task-package-import-choose-failed' };
  } finally {
    state.taskPackages.importBusy = false;
    lockTaskPackageDialog('import', false);
    if (els.chooseTaskPackageFileBtn) els.chooseTaskPackageFileBtn.disabled = false;
  }
  if (result?.cancelled) {
    setTaskPackageStatus('import', tr('taskPackage.status.cancelled'), 'idle');
    return;
  }
  if (!result?.ok) {
    setTaskPackageStatus('import', taskPackageErrorText(result?.reasonCode), 'error');
    return;
  }
  state.taskPackages.importDraft = result.draft;
  state.taskPackages.importPreview = null;
  if (els.taskPackageImportFile) {
    els.taskPackageImportFile.textContent = `${result.draft.fileName} · ${formatBytes(result.draft.size)}`;
  }
  if (els.commitTaskPackageBtn) els.commitTaskPackageBtn.disabled = true;
  setTaskPackageStatus('import', tr('taskPackage.import.status.enterCode'), 'idle');
}

async function inspectTaskPackageImport() {
  const draft = state.taskPackages.importDraft;
  if (!draft || state.taskPackages.importBusy) return;
  const unlockCode = els.taskPackageImportCode?.value || '';
  if (!unlockCode.trim()) {
    setTaskPackageStatus('import', tr('taskPackage.import.status.codeRequired'), 'error');
    return;
  }
  state.taskPackages.importBusy = true;
  lockTaskPackageDialog('import', true);
  if (els.inspectTaskPackageBtn) els.inspectTaskPackageBtn.disabled = true;
  setTaskPackageStatus('import', tr('taskPackage.import.status.inspecting'), 'busy');
  let result;
  try {
    result = await window.manager.inspectTaskPackageImport({ token: draft.token, unlockCode });
  } catch (_error) {
    result = { ok: false, reasonCode: 'task-package-import-inspect-failed' };
  } finally {
    state.taskPackages.importBusy = false;
    lockTaskPackageDialog('import', false);
    if (els.inspectTaskPackageBtn) els.inspectTaskPackageBtn.disabled = false;
  }
  if (!result?.ok) {
    state.taskPackages.importPreview = null;
    if (els.commitTaskPackageBtn) els.commitTaskPackageBtn.disabled = true;
    setTaskPackageStatus('import', taskPackageErrorText(result?.reasonCode), 'error');
    return;
  }
  state.taskPackages.importPreview = result.inspected;
  renderTaskPackageImportPreview();
  setTaskPackageStatus('import', result.inspected.compatibleProfiles.length
    ? tr('taskPackage.import.status.verified')
    : tr('taskPackage.import.status.noTarget'), result.inspected.compatibleProfiles.length ? 'idle' : 'error');
}

function renderTaskPackageImportPreview() {
  const inspected = state.taskPackages.importPreview;
  if (!inspected || !els.taskPackageImportPreview) return;
  const manifest = inspected.manifest;
  els.taskPackageImportPreview.replaceChildren();
  const title = document.createElement('strong');
  title.textContent = manifest.session.originalTitle;
  const meta = document.createElement('span');
  meta.textContent = [
    manifest.source.senderLabel,
    manifest.source.agentName,
    manifest.project?.name,
    formatBytes(manifest.bytesTotal)
  ].filter(Boolean).join(' · ');
  const badge = document.createElement('b');
  badge.textContent = tr(manifest.session.mode === 'native' ? 'taskPackage.mode.native' : 'taskPackage.mode.transcript');
  els.taskPackageImportPreview.append(title, meta, badge);
  const details = document.createElement('div');
  details.className = 'task-package-import-preview-details';
  appendTaskPackagePreviewSection(details, tr('taskPackage.objective'), manifest.checkpoint.objective
    ? [manifest.checkpoint.objective]
    : []);
  appendTaskPackagePreviewSection(details, tr('taskPackage.completed'), manifest.checkpoint.completed);
  appendTaskPackagePreviewSection(details, tr('taskPackage.next'), manifest.checkpoint.next);
  appendTaskPackagePreviewSection(details, tr('taskPackage.blockers'), manifest.checkpoint.blockers);
  appendTaskPackagePreviewSection(details, tr('taskPackage.acceptance'), manifest.checkpoint.acceptance);
  if (manifest.project) {
    const projectFacts = [
      manifest.project.name,
      manifest.project.branch,
      manifest.project.head ? manifest.project.head.slice(0, 12) : null,
      tr(manifest.project.dirty ? 'taskPackage.import.preview.gitDirty' : 'taskPackage.import.preview.gitClean')
    ].filter(Boolean);
    appendTaskPackagePreviewSection(details, tr('taskPackage.import.preview.project'), projectFacts);
  }
  const attachmentCount = manifest.entries.filter((entry) => entry.kind === 'attachment').length;
  if (attachmentCount) {
    appendTaskPackagePreviewSection(details, tr('taskPackage.import.preview.attachments'), [
      tr('taskPackage.import.preview.attachmentCount', { n: attachmentCount })
    ]);
  }
  els.taskPackageImportPreview.append(details);
  els.taskPackageImportPreview.hidden = false;

  if (els.taskPackageTargetProfile) {
    els.taskPackageTargetProfile.replaceChildren();
    for (const profile of inspected.compatibleProfiles) {
      const option = document.createElement('option');
      option.value = profile.profileId;
      option.textContent = [
        profile.agentName,
        profile.name !== profile.agentName ? profile.name : null,
        profile.appLabel
      ].filter(Boolean).join(' · ');
      els.taskPackageTargetProfile.append(option);
    }
  }
  const hasTargets = inspected.compatibleProfiles.length > 0;
  if (els.taskPackageTargetField) els.taskPackageTargetField.hidden = !hasTargets;
  if (els.taskPackageOpenField) els.taskPackageOpenField.hidden = !hasTargets;
  if (els.commitTaskPackageBtn) els.commitTaskPackageBtn.disabled = !hasTargets;
}

function appendTaskPackagePreviewSection(container, label, values = []) {
  const section = document.createElement('section');
  const heading = document.createElement('strong');
  heading.textContent = label;
  section.append(heading);
  const lines = (Array.isArray(values) ? values : []).map((value) => String(value || '').trim()).filter(Boolean);
  if (!lines.length) {
    const empty = document.createElement('span');
    empty.textContent = tr('taskPackage.import.preview.notProvided');
    section.append(empty);
  } else {
    const list = document.createElement('ul');
    for (const value of lines) {
      const item = document.createElement('li');
      item.textContent = value;
      list.append(item);
    }
    section.append(list);
  }
  container.append(section);
}

async function commitTaskPackageImport() {
  const draft = state.taskPackages.importDraft;
  const inspected = state.taskPackages.importPreview;
  const targetProfileId = els.taskPackageTargetProfile?.value || '';
  if (!draft || !inspected || !targetProfileId || state.taskPackages.importBusy) return;
  state.taskPackages.importBusy = true;
  lockTaskPackageDialog('import', true);
  if (els.commitTaskPackageBtn) els.commitTaskPackageBtn.disabled = true;
  setTaskPackageStatus('import', tr('taskPackage.import.status.importing'), 'busy');
  let result;
  try {
    result = await window.manager.commitTaskPackageImport({
      token: draft.token,
      targetProfileId,
      openAfterImport: els.taskPackageOpenAfter?.checked !== false
    });
  } catch (_error) {
    result = { ok: false, reasonCode: 'task-package-import-commit-failed' };
  } finally {
    state.taskPackages.importBusy = false;
    lockTaskPackageDialog('import', false);
  }
  if (result?.cancelled) {
    if (els.commitTaskPackageBtn) els.commitTaskPackageBtn.disabled = false;
    setTaskPackageStatus('import', tr('taskPackage.import.status.destinationCancelled'), 'idle');
    return;
  }
  if (!result?.ok) {
    if (els.commitTaskPackageBtn) els.commitTaskPackageBtn.disabled = false;
    setTaskPackageStatus('import', taskPackageErrorText(result?.reasonCode), 'error');
    return;
  }
  state.taskPackages.history = result.history || state.taskPackages.history;
  state.taskPackages.importDraft = null;
  state.taskPackages.importTransferId = null;
  if (els.commitTaskPackageBtn) {
    els.commitTaskPackageBtn.disabled = true;
    els.commitTaskPackageBtn.textContent = tr('taskPackage.import.done');
  }
  const targetName = result.imported.targetAgentName || result.imported.targetProfileName;
  const completedText = tr(
    result.imported.sessionMode === 'native'
      ? 'taskPackage.import.status.nativeDone'
      : 'taskPackage.import.status.materialsDone',
    { name: targetName }
  );
  setTaskPackageStatus('import', result.imported.openFailed
    ? `${completedText} ${tr('taskPackage.import.status.openFailed')}`
    : completedText, result.imported.openFailed ? 'error' : 'idle');
  setStatus(tr('taskPackage.status.received', { name: targetName }));
  renderTaskPackageHistory();
  renderIncomingTaskPackages();
  if (result.imported.sessionMode === 'native') await loadProfiles();
}

async function cancelTaskPackageImportDraft() {
  const token = state.taskPackages.importDraft?.token;
  state.taskPackages.importDraft = null;
  state.taskPackages.importPreview = null;
  if (token && window.manager.cancelTaskPackageImport) {
    try { await window.manager.cancelTaskPackageImport(token); } catch (_error) { /* Main also expires drafts. */ }
  }
}

function clearTaskPackageImportInspection() {
  state.taskPackages.importPreview = null;
  if (els.taskPackageImportPreview) {
    els.taskPackageImportPreview.hidden = true;
    els.taskPackageImportPreview.replaceChildren();
  }
  if (els.taskPackageTargetField) els.taskPackageTargetField.hidden = true;
  if (els.taskPackageOpenField) els.taskPackageOpenField.hidden = true;
  if (els.taskPackageTargetProfile) els.taskPackageTargetProfile.replaceChildren();
  if (els.commitTaskPackageBtn) els.commitTaskPackageBtn.disabled = true;
}

function lockTaskPackageDialog(kind, locked) {
  const controls = kind === 'import'
    ? [els.taskPackageImportCloseBtn, els.taskPackageImportCancelBtn]
    : [els.taskPackageCloseBtn, els.taskPackageCancelBtn];
  for (const control of controls) {
    if (control) control.disabled = Boolean(locked);
  }
}

async function loadTaskPackageHistory() {
  if (!window.manager.listTaskPackages) return;
  const result = await window.manager.listTaskPackages();
  if (result?.ok) state.taskPackages.history = result.history || [];
  renderTaskPackageHistory();
  renderIncomingTaskPackages();
}

function handledIncomingTaskPackageTransferIds() {
  return new Set((state.taskPackages.history || [])
    .filter((item) => item.direction === 'imported' && item.transferId)
    .map((item) => item.transferId));
}

function incomingTaskPackageTransfers() {
  const handled = handledIncomingTaskPackageTransferIds();
  return (state.mesh.transfers || []).filter((transfer) => (
    transfer.type === 'task-package'
      && transfer.direction === 'incoming'
      && !handled.has(transfer.transferId)
  ));
}

function pendingIncomingTaskPackageCount() {
  return incomingTaskPackageTransfers().filter((transfer) => (
    transfer.acceptRequired
      || transfer.state === 'receiving'
      || (transfer.state === 'completed' && transfer.canImport)
  )).length;
}

function updateActivityBadge(attentionCount = collectAttentionItems().length) {
  if (!els.activityCountBadge) return;
  const total = Number(attentionCount || 0) + pendingIncomingTaskPackageCount();
  els.activityCountBadge.hidden = total === 0;
  els.activityCountBadge.textContent = String(total);
}

function renderIncomingTaskPackages() {
  if (!els.incomingTaskPackages || !els.incomingTaskPackageList) return;
  const transfers = incomingTaskPackageTransfers();
  els.incomingTaskPackages.hidden = transfers.length === 0;
  els.incomingTaskPackageList.replaceChildren();
  if (els.incomingTaskPackageCount) els.incomingTaskPackageCount.textContent = String(transfers.length);
  for (const transfer of transfers) {
    els.incomingTaskPackageList.append(createIncomingTaskPackageCard(transfer));
  }
  if (els.attentionEmpty) {
    els.attentionEmpty.hidden = transfers.length > 0 || collectAttentionItems().length > 0;
  }
  updateActivityBadge();
}

function createIncomingTaskPackageCard(transfer) {
  const summary = transfer.taskPackage || {};
  const card = document.createElement('article');
  card.className = 'incoming-task-package-card';
  const head = document.createElement('div');
  head.className = 'incoming-task-package-card-head';
  const identity = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = summary.title || tr('taskPackage.history.untitled');
  const meta = document.createElement('small');
  meta.textContent = [
    transfer.receivedFromName,
    summary.sourceAgentName,
    summary.senderLabel,
    summary.appId ? appLabel(summary.appId) : null,
    formatBytes(transfer.bytesTotal || 0)
  ].filter(Boolean).join(' · ');
  identity.append(title, meta);
  const status = document.createElement('span');
  status.className = 'incoming-task-package-state';
  status.textContent = taskPackageTransferStateText(transfer);
  head.append(identity, status);
  card.append(head);
  if (summary.objective) {
    const objective = document.createElement('small');
    objective.textContent = summary.objective;
    card.append(objective);
  }
  if (summary.attachmentCount) {
    const attachments = document.createElement('small');
    attachments.textContent = tr('taskPackage.incoming.attachments', { n: summary.attachmentCount });
    card.append(attachments);
  }
  if (['receiving', 'sending'].includes(transfer.state)) {
    const progress = document.createElement('progress');
    progress.max = Math.max(1, transfer.bytesTotal || 0);
    progress.value = Math.min(progress.max, transfer.bytesTransferred || 0);
    progress.setAttribute('aria-label', tr('transfers.progress'));
    card.append(progress);
  }
  const actions = createTaskPackageTransferActions(transfer, { returnFocus: null });
  if (actions.childElementCount) card.append(actions);
  return card;
}

function taskPackageTransferStateText(transfer) {
  if (transfer.acceptRequired) return tr('taskPackage.incoming.state.awaiting');
  if (transfer.state === 'receiving') return tr('taskPackage.incoming.state.receiving');
  if (transfer.state === 'completed' && transfer.canImport) return tr('taskPackage.incoming.state.ready');
  if (transfer.requiresNewPackage || transfer.secretUnavailable) return tr('taskPackage.incoming.state.resend');
  return tr(`transfers.state.${transfer.state}`);
}

function createTaskPackageTransferActions(transfer, options = {}) {
  const actions = document.createElement('div');
  actions.className = 'incoming-task-package-actions transfer-card-actions';
  const busy = state.taskPackages.directBusyTransferId === transfer.transferId;
  const add = (label, primary, handler) => {
    const button = document.createElement('button');
    button.type = 'button';
    if (primary) button.className = 'primary';
    button.textContent = label;
    button.disabled = busy;
    button.addEventListener('click', () => handler(button));
    actions.append(button);
  };
  if (transfer.direction === 'incoming' && transfer.acceptRequired) {
    add(tr('taskPackage.incoming.accept'), true, (button) => acceptIncomingTaskPackage(transfer, button));
    add(tr('taskPackage.incoming.reject'), false, (button) => rejectIncomingTaskPackage(transfer, button));
  } else if (transfer.direction === 'incoming' && transfer.state === 'completed' && transfer.canImport) {
    add(tr('taskPackage.incoming.inspect'), true, (button) => prepareIncomingTaskPackage(transfer, button));
  }
  if (transfer.direction === 'outgoing' && transfer.state === 'failed' && transfer.canSavePortable) {
    add(tr('taskPackage.direct.savePortable'), false, (button) => saveTaskPackageTransferFallback(transfer, button, options.returnFocus));
  }
  return actions;
}

async function acceptIncomingTaskPackage(transfer) {
  if (state.taskPackages.directBusyTransferId || !window.manager.acceptIncomingTaskPackage) return;
  state.taskPackages.directBusyTransferId = transfer.transferId;
  renderIncomingTaskPackages();
  let result;
  try {
    result = await window.manager.acceptIncomingTaskPackage(transfer.transferId);
  } catch (_error) {
    result = { ok: false, reasonCode: 'task-package-direct-accept-failed' };
  } finally {
    state.taskPackages.directBusyTransferId = null;
  }
  if (result?.ok) {
    state.mesh.transfers = result.transfers || state.mesh.transfers;
    setStatus(tr('taskPackage.incoming.accepted'));
  } else {
    setStatus(taskPackageErrorText(result?.reasonCode));
  }
  renderIncomingTaskPackages();
  renderTransferList();
}

async function rejectIncomingTaskPackage(transfer) {
  if (state.taskPackages.directBusyTransferId || !window.manager.rejectIncomingTaskPackage) return;
  state.taskPackages.directBusyTransferId = transfer.transferId;
  renderIncomingTaskPackages();
  let result;
  try {
    result = await window.manager.rejectIncomingTaskPackage(transfer.transferId);
  } catch (_error) {
    result = { ok: false, reasonCode: 'task-package-direct-reject-failed' };
  } finally {
    state.taskPackages.directBusyTransferId = null;
  }
  if (result?.ok) {
    state.mesh.transfers = result.transfers || state.mesh.transfers;
    setStatus(tr('taskPackage.incoming.rejected'));
  } else {
    setStatus(taskPackageErrorText(result?.reasonCode));
  }
  renderIncomingTaskPackages();
  renderTransferList();
}

async function prepareIncomingTaskPackage(transfer, returnFocus = document.activeElement) {
  if (state.taskPackages.directBusyTransferId || !window.manager.prepareIncomingTaskPackage) return;
  state.taskPackages.directBusyTransferId = transfer.transferId;
  renderIncomingTaskPackages();
  let result;
  try {
    result = await window.manager.prepareIncomingTaskPackage(transfer.transferId);
  } catch (_error) {
    result = { ok: false, reasonCode: 'task-package-direct-prepare-failed' };
  } finally {
    state.taskPackages.directBusyTransferId = null;
  }
  if (!result?.ok) {
    setStatus(taskPackageErrorText(result?.reasonCode));
    if (result?.transfers) state.mesh.transfers = result.transfers;
    renderIncomingTaskPackages();
    renderTransferList();
    return;
  }
  state.mesh.transfers = result.transfers || state.mesh.transfers;
  openTaskPackageImportDialog(returnFocus, {
    mode: 'direct',
    transfer,
    prepared: { draft: result.draft, inspected: result.inspected }
  });
  renderIncomingTaskPackages();
  renderTransferList();
}

async function saveTaskPackageTransferFallback(transfer, returnFocus = document.activeElement) {
  if (state.taskPackages.directBusyTransferId || !window.manager.saveTaskPackageFallback) return;
  state.taskPackages.directBusyTransferId = transfer.transferId;
  renderTransferList();
  let result;
  try {
    result = await window.manager.saveTaskPackageFallback(transfer.transferId);
  } catch (_error) {
    result = { ok: false, reasonCode: 'task-package-portable-fallback-failed' };
  } finally {
    state.taskPackages.directBusyTransferId = null;
  }
  if (result?.cancelled) {
    setStatus(tr('taskPackage.status.cancelled'));
  } else if (!result?.ok) {
    setStatus(taskPackageErrorText(result?.reasonCode));
  } else {
    state.mesh.transfers = result.transfers || state.mesh.transfers;
    showTaskPackageFallbackResult(result.saved, returnFocus);
  }
  renderTransferList();
}

function showTaskPackageFallbackResult(saved, returnFocus = document.activeElement) {
  if (!saved?.unlockCode || !els.taskPackageDialog) return;
  resetTaskPackageExportState();
  els.taskPackageDialog.dataset.flow = 'fallback';
  state.taskPackages.exportCode = saved.unlockCode;
  if (els.taskPackageUnlockCode) els.taskPackageUnlockCode.textContent = saved.unlockCode;
  if (els.taskPackageExportResult) els.taskPackageExportResult.hidden = false;
  if (els.exportTaskPackageBtn) els.exportTaskPackageBtn.hidden = true;
  setTaskPackageStatus('export', tr('taskPackage.direct.status.fallbackSaved'), 'idle');
  openChildDialog(els.taskPackageDialog, returnFocus);
}

function renderTaskPackageHistory() {
  if (!els.taskPackageHistoryList) return;
  const history = state.taskPackages.history || [];
  els.taskPackageHistoryList.replaceChildren();
  if (els.taskPackageHistoryCount) els.taskPackageHistoryCount.textContent = String(history.length);
  if (els.taskPackageHistoryEmpty) els.taskPackageHistoryEmpty.hidden = history.length > 0;
  for (const item of history.slice(0, 12)) {
    const card = document.createElement('article');
    card.className = 'task-package-history-card';
    const title = document.createElement('strong');
    title.textContent = item.title || tr('taskPackage.history.untitled');
    const meta = document.createElement('small');
    const direction = tr(item.direction === 'imported'
      ? 'taskPackage.history.imported'
      : 'taskPackage.history.exported');
    const mode = tr(item.sessionMode === 'native' ? 'taskPackage.mode.native' : 'taskPackage.mode.transcript');
    meta.textContent = [direction, mode, item.sourceAgentName, item.targetAgentName, compactDate(item.recordedAt || item.createdAt)].filter(Boolean).join(' · ');
    card.append(title, meta);
    if (item.canReveal) {
      const reveal = document.createElement('button');
      reveal.type = 'button';
      reveal.textContent = tr('taskPackage.history.reveal');
      reveal.addEventListener('click', async () => {
        const result = await window.manager.revealTaskPackage({
          packageId: item.packageId,
          direction: item.direction
        });
        if (!result?.ok) setStatus(taskPackageErrorText(result?.reasonCode));
      });
      card.append(reveal);
    }
    els.taskPackageHistoryList.append(card);
  }
}

function setTaskPackageStatus(kind, message, tone = 'idle') {
  const element = kind === 'import' ? els.taskPackageImportStatus : els.taskPackageStatus;
  if (!element) return;
  element.textContent = message || '';
  element.dataset.state = tone;
}

function taskPackageErrorText(code) {
  const value = String(code || 'task-package-failed');
  if (/task-package-rejected/.test(value)) return tr('taskPackage.error.rejected');
  if (/direct-connection|required.*connection|peer-not-connected|device-offline/.test(value)) return tr('taskPackage.error.directOffline');
  if (/feature-unavailable|protocol-feature-unavailable|unsupported.*task/.test(value)) return tr('taskPackage.error.directFeature');
  if (/capability|permission/.test(value)) return tr('taskPackage.error.directPermission');
  if (/secret-unavailable|requires-new-package/.test(value)) return tr('taskPackage.error.resend');
  if (/portable-fallback/.test(value)) return tr('taskPackage.error.fallback');
  if (/unlock|decrypt/.test(value)) return tr('taskPackage.error.unlock');
  if (/session-conflict|file-conflict/.test(value)) return tr('taskPackage.error.conflict');
  if (/target-(incompatible|not-codex)|native-adapter-unsupported/.test(value)) return tr('taskPackage.error.target');
  if (/source-unsupported/.test(value)) return tr('taskPackage.error.source');
  if (/git-patch-too-large/.test(value)) return tr('taskPackage.error.patchLarge');
  if (/git-snapshot-failed/.test(value)) return tr('taskPackage.error.gitSnapshot');
  if (/attachment-count/.test(value)) return tr('taskPackage.error.attachmentCount');
  if (/attachment-(changing|short-read|invalid|write)/.test(value)) return tr('taskPackage.error.attachmentChanged');
  if (/record-limit/.test(value)) return tr('taskPackage.error.recordLimit');
  if (/format|schema|manifest|hash|truncated|trailing|entry|jsonl|session-meta/.test(value)) return tr('taskPackage.error.invalid');
  if (/changing/.test(value)) return tr('taskPackage.error.changing');
  return tr('taskPackage.error.generic', { code: value });
}

function populateTransferTargets(select, devices, preselectedDeviceId) {
  if (!select) return null;
  select.replaceChildren();
  const preferred = devices.some((device) => device.deviceId === preselectedDeviceId)
    ? preselectedDeviceId
    : devices[0]?.deviceId;
  for (const device of devices) {
    const option = document.createElement('option');
    option.value = device.deviceId;
    option.textContent = `${device.name} · ${tr(`devices.status.${device.status || 'offline'}`)}`;
    option.selected = device.deviceId === preferred;
    select.append(option);
  }
  return preferred || null;
}

// 传输记录在收件箱的“记录”一段：打开收件箱、读一次最新记录，再把那一段滚到眼前。
async function openTransferCenter() {
  openUtilityDialog('activity');
  renderAttentionInbox();
  await Promise.all([loadTransfers(), loadTaskPackageHistory()]);
  els.inboxRecords?.scrollIntoView({ block: 'start' });
  els.inboxRecords?.querySelector('button')?.focus({ preventScroll: true });
}

async function chooseFilesForTransfer() {
  if (state.mesh.transferLoading || !window.manager.chooseFileTransfer) return;
  const draft = state.ui.transferDraft;
  if (draft?.kind !== 'files') return;
  const targetDeviceId = String(draft.targetDeviceId || '');
  if (!targetDeviceId) return;
  state.mesh.transferLoading = true;
  state.ui = window.UiContext.updateTransferDraft(state.ui, {
    message: tr('transfers.filesPreparing'),
    tone: 'busy'
  });
  renderFileSendStatus();
  const result = await window.manager.chooseFileTransfer({ targetDeviceId });
  state.mesh.transferLoading = false;
  if (!result?.ok) {
    state.ui = window.UiContext.updateTransferDraft(state.ui, {
      message: meshErrorText(result?.reasonCode || 'file-transfer-create-failed'),
      tone: 'error'
    });
  } else if (result.cancelled) {
    state.ui = window.UiContext.updateTransferDraft(state.ui, {
      message: tr('transfers.filePickerCancelled'),
      tone: 'idle'
    });
  } else {
    state.mesh.transfers = result.transfers || state.mesh.transfers;
    state.ui = window.UiContext.updateTransferDraft(state.ui, {
      message: tr(
        result.transfer?.state === 'completed' ? 'transfers.filesSent' : 'transfers.filesOffered',
        { n: result.transfer?.itemCount || 0 }
      ),
      tone: 'idle'
    });
  }
  renderFileSendStatus();
  renderTransferList();
}

async function sendSelectedSessionsToDevice() {
  if (state.mesh.transferLoading || !window.manager.createSessionPointerTransfer) return;
  const draft = state.ui.transferDraft;
  if (draft?.kind !== 'session-pointer') return;
  const targetDeviceId = String(draft.targetDeviceId || '');
  const selections = draft.selections || [];
  if (!targetDeviceId || !selections.length) return;
  state.mesh.transferLoading = true;
  state.ui = window.UiContext.updateTransferDraft(state.ui, {
    message: tr('transfers.sending'),
    tone: 'busy'
  });
  renderSessionSendStatus();
  const result = await window.manager.createSessionPointerTransfer({ targetDeviceId, selections });
  state.mesh.transferLoading = false;
  if (!result?.ok) {
    state.ui = window.UiContext.updateTransferDraft(state.ui, {
      message: meshErrorText(result?.reasonCode || 'transfer-create-failed'),
      tone: 'error'
    });
  } else {
    state.ui = window.UiContext.updateTransferDraft(state.ui, {
      message: tr(
        result.transfer?.state === 'completed' ? 'transfers.sent' : 'transfers.queued',
        { n: result.transfer?.itemCount || selections.length }
      ),
      tone: 'idle'
    });
  }
  renderSessionSendStatus();
  if (result?.ok && result.transfer?.transferId) {
    // 信封等送出的弹窗合上以后，从这几行飞到顶栏的设备那里（见 deskSendFlights）
    state.hub.sent.push({
      transferId: result.transfer.transferId,
      keys: actionSessions().map((session) => sessionKey(session)),
      state: result.transfer.state,
      flown: false,
      delivered: false
    });
    state.hub.sent = state.hub.sent.slice(-8);
  }
  await loadTransfers();
}

async function loadTransfers() {
  if (!window.manager.listTransfers) return;
  const result = await window.manager.listTransfers();
  if (result?.ok) state.mesh.transfers = result.transfers || [];
  else state.mesh.transferMessage = meshErrorText(result?.reasonCode || 'transfer-list-failed');
  renderSessionSendStatus();
  renderFileSendStatus();
  renderTransferList();
  renderIncomingTaskPackages();
}

function renderSessionSendStatus() {
  const draft = state.ui.transferDraft;
  if (!els.sessionSendStatus || draft?.kind !== 'session-pointer') return;
  els.sessionSendStatus.textContent = draft.message || tr('transfers.ready', { n: draft.selections.length });
  els.sessionSendStatus.dataset.state = draft.tone || 'idle';
  if (els.confirmSessionSendBtn) {
    els.confirmSessionSendBtn.disabled = state.mesh.transferLoading
      || !draft.targetDeviceId
      || draft.selections.length === 0;
  }
}

function renderFileSendStatus() {
  const draft = state.ui.transferDraft;
  if (!els.fileSendStatus || draft?.kind !== 'files') return;
  els.fileSendStatus.textContent = draft.message || tr('transfers.filesReady');
  els.fileSendStatus.dataset.state = draft.tone || 'idle';
  const target = (state.mesh.overview?.devices || []).find((device) => device.deviceId === draft.targetDeviceId);
  const canReceiveFiles = Array.isArray(target?.permissions) && target.permissions.includes('file.receive');
  if (els.chooseFilesBtn) {
    els.chooseFilesBtn.disabled = state.mesh.transferLoading || !target || !canReceiveFiles;
    els.chooseFilesBtn.title = canReceiveFiles ? '' : tr('transfers.filePermissionRequired');
  }
}

function renderTransferList() {
  if (!els.transferList) return;
  els.transferList.replaceChildren();
  if (!state.mesh.transfers.length) {
    const empty = document.createElement('p');
    empty.className = 'transfer-empty';
    empty.textContent = tr('transfers.empty');
    els.transferList.append(empty);
    return;
  }
  for (const transfer of state.mesh.transfers) {
    const card = document.createElement('article');
    card.className = 'transfer-card';
    const head = document.createElement('div');
    head.className = 'transfer-card-head';
    const title = document.createElement('strong');
    title.textContent = transfer.type === 'task-package'
      ? tr(transfer.direction === 'incoming'
        ? 'taskPackage.transfer.incoming'
        : 'taskPackage.transfer.outgoing', {
          title: transfer.taskPackage?.title || tr('taskPackage.history.untitled'),
          name: transfer.receivedFromName || transfer.targetName || '-'
        })
      : tr(transfer.direction === 'incoming' ? 'transfers.incoming' : 'transfers.outgoing', {
          n: transfer.itemCount,
          name: transfer.receivedFromName || transfer.targetName || '-'
        });
    const stateLabel = document.createElement('span');
    stateLabel.dataset.state = transfer.state;
    stateLabel.textContent = tr(`transfers.state.${transfer.state}`);
    head.append(title, stateLabel);
    const meta = document.createElement('small');
    const typeLabel = transfer.type === 'task-package'
      ? tr('transfers.type.taskPackage')
      : tr(transfer.type === 'file' ? 'transfers.type.file' : 'transfers.type.pointer');
    meta.textContent = `${compactDate(transfer.updatedAt)} · ${typeLabel}`;
    card.append(head, meta);

    if (transfer.direction === 'incoming' && Array.isArray(transfer.items)) {
      const itemList = document.createElement('div');
      itemList.className = 'transfer-item-list';
      transfer.items.forEach((item, index) => {
        const row = document.createElement('div');
        const coordinate = document.createElement('code');
        coordinate.textContent = `${index + 1}. ${item.path || '-'}\n${item.coordinate || '-'}`;
        row.append(coordinate);
        if (item.projectId && !item.mapping?.mapped) {
          const map = document.createElement('button');
          map.type = 'button';
          map.textContent = tr('transfers.mapProject');
          map.addEventListener('click', async () => {
            const result = await window.manager.chooseProjectBinding({
              projectId: item.projectId,
              sourceDeviceId: transfer.sourceDeviceId
            });
            if (result?.ok && !result.cancelled) {
              state.mesh.transfers = result.transfers || state.mesh.transfers;
              state.mesh.transferMessage = tr('transfers.projectMapped');
              setStatus(state.mesh.transferMessage);
              renderTransferList();
            }
          });
          row.append(map);
        } else if (item.mapping?.mapped) {
          const mapped = document.createElement('small');
          mapped.textContent = tr('transfers.mappedPath', { path: item.mapping.targetPath });
          row.append(mapped);
        }
        itemList.append(row);
      });
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'primary';
      copy.textContent = tr('transfers.copyReceived');
      copy.addEventListener('click', async () => {
        const value = window.SessionLocation.formatLocations(transfer.items, {
          path: tr('session.location.path'),
          coordinate: tr('session.location.coordinate'),
          empty: tr('common.unrecorded')
        });
        await window.manager.writeClipboard(value);
        setStatus(tr('status.sessionInfosCopied', { n: transfer.items.length }));
      });
      card.append(itemList, copy);
    }

    if (transfer.type === 'file' && Array.isArray(transfer.files)) {
      const files = document.createElement('ul');
      files.className = 'transfer-file-list';
      for (const file of transfer.files) {
        const item = document.createElement('li');
        const name = document.createElement('span');
        name.textContent = file.name;
        name.title = file.name;
        const size = document.createElement('span');
        size.textContent = formatBytes(file.size);
        item.append(name, size);
        files.append(item);
      }
      const progress = document.createElement('progress');
      progress.className = 'transfer-progress';
      progress.max = Math.max(1, transfer.bytesTotal || 0);
      progress.value = Math.min(progress.max, transfer.bytesTransferred || 0);
      progress.setAttribute('aria-label', tr('transfers.progress'));
      card.append(files, progress);
    }
    if (transfer.type === 'task-package') {
      const progress = document.createElement('progress');
      progress.className = 'transfer-progress';
      progress.max = Math.max(1, transfer.bytesTotal || 0);
      progress.value = Math.min(progress.max, transfer.bytesTransferred || 0);
      progress.setAttribute('aria-label', tr('transfers.progress'));
      card.append(progress);
    }

    const canRetry = transfer.state === 'failed'
      && (transfer.direction === 'outgoing' || transfer.type === 'file');
    const canCancel = ['file', 'task-package'].includes(transfer.type)
      ? !['completed', 'cancelled', 'expired'].includes(transfer.state)
      : transfer.direction === 'outgoing' && ['queued', 'failed', 'awaiting-ack'].includes(transfer.state);
    const canAccept = transfer.type === 'file' && transfer.direction === 'incoming' && transfer.acceptRequired;
    const canOpen = transfer.type === 'file' && transfer.direction === 'incoming' && transfer.canOpen;
    const taskActions = transfer.type === 'task-package'
      ? createTaskPackageTransferActions(transfer, { returnFocus: els.activityCenterDialog })
      : null;
    if (canRetry || canCancel || canAccept || canOpen || taskActions?.childElementCount) {
      const actions = document.createElement('div');
      actions.className = 'transfer-card-actions';
      if (taskActions?.childElementCount) actions.append(...taskActions.children);
      if (canAccept) {
        const accept = document.createElement('button');
        accept.type = 'button';
        accept.className = 'primary';
        accept.textContent = tr('transfers.acceptFiles');
        accept.addEventListener('click', async () => {
          state.mesh.transferMessage = tr('transfers.choosingDestination');
          setStatus(state.mesh.transferMessage);
          const result = await window.manager.acceptFileTransfer(transfer.transferId);
          if (!result?.ok) state.mesh.transferMessage = meshErrorText(result?.reasonCode || 'file-transfer-accept-failed');
          else if (!result.cancelled) state.mesh.transfers = result.transfers || state.mesh.transfers;
          setStatus(state.mesh.transferMessage);
          renderTransferList();
        });
        actions.append(accept);
      }
      if (canOpen) {
        const open = document.createElement('button');
        open.type = 'button';
        open.className = 'primary';
        open.textContent = tr('transfers.openFiles');
        open.addEventListener('click', async () => {
          const result = await window.manager.openReceivedFile(transfer.transferId);
          if (!result?.ok) setStatus(meshErrorText(result?.reasonCode || 'file-received-location-failed'));
        });
        actions.append(open);
      }
      if (canRetry) {
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.textContent = tr('transfers.retry');
        retry.addEventListener('click', async () => {
          await window.manager.retryTransfer(transfer.transferId);
          await loadTransfers();
        });
        actions.append(retry);
      }
      if (canCancel && !(transfer.type === 'task-package' && transfer.direction === 'incoming' && transfer.acceptRequired)) {
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.textContent = tr('transfers.cancel');
        cancel.addEventListener('click', async () => {
          await window.manager.cancelTransfer(transfer.transferId);
          await loadTransfers();
        });
        actions.append(cancel);
      }
      card.append(actions);
    }
    els.transferList.append(card);
  }
}

function selectedProfile() {
  const profileId = currentProfileId();
  for (const group of identityGroups()) {
    const profile = group.members.find((member) => member.id === profileId);
    if (profile) return profile;
  }
  return null;
}

function sessionKey(session) {
  if (window.SessionTable) return window.SessionTable.keyOf(session);
  if (!session) return '';
  return `${session._profileId || ''}::${session.address || session.id || session.filePath || ''}`;
}

function compactDate(value) {
  if (!value) return tr('common.unrecorded');
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return tr('common.unrecorded');
  const now = new Date();
  const sameYear = date.getFullYear() === now.getFullYear();
  const sameDay = date.toDateString() === now.toDateString();
  const options = sameDay
    ? { hour: '2-digit', minute: '2-digit' }
    : sameYear
      ? { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }
      : { year: 'numeric', month: 'numeric', day: 'numeric' };
  return new Intl.DateTimeFormat(dateLocale(), options).format(date);
}

function fullDate(value) {
  if (!value) return tr('common.unrecorded');
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return tr('common.unrecorded');
  return new Intl.DateTimeFormat(dateLocale(), {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function shortPath(value) {
  if (!value) return '-';
  return String(value).replace(/^\/Users\/[^/]+/, '~').replace(/^C:\\Users\\[^\\]+/i, '~');
}

function formatBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return '-';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function setStatus(message, tone = 'neutral') {
  els.statusText.parentElement.dataset.tone = tone;
  els.statusText.removeAttribute('data-i18n');
  els.statusText.textContent = message;
  // 档案开着时主窗口的页脚被遮住，同一句话也写在档案页脚。
  if (els.agentManageStatus && els.agentManageDialog?.open) els.agentManageStatus.textContent = message;
}

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
