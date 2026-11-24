const state = {
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
};

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
let updateBusy = false;
let updateButtonTimer = null;
let quotaRequest = null;
let quotaForcedAfter = null;
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

const toolCenter = window.createToolCenter({
  document, manager: window.manager, els, tr, compactDate, currentProfileId, setStatus
});
state.tools = toolCenter.state;
const { refreshToolInventory, renderToolCenter, handleToolProgress } = toolCenter;
// 招募：一个弹窗四段（新来一只、把已有的领回来、拖进来、交给 AI）。
const recruitDialog = window.createRecruitDialog({
  document,
  manager: window.manager,
  tr,
  platform: window.manager.windowPlatform,
  getApps: () => Object.entries(state.appMeta).map(([id, meta]) => ({ id, ...meta })),
  isMeshReady: () => state.mesh.overview?.initialized === true,
  createWithMesh: ({ displayName, appId }) => createAgentAndPrepare({ displayName, requestedAppId: appId }),
  afterAccountChange: (profileId) => afterRecruitedAccount(profileId)
});

// 会话的记号：新回复、在跑、颜色标签与搜索框左边那排筛选（docs/SESSION_MARKS_PLAN.md）。
const sessionMarks = window.createSessionMarks({
  document,
  manager: window.manager,
  tr,
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

function onboardingNeedsPresentation() {
  return Boolean(window.OnboardingState?.needsPresentation(
    state.onboardingProgress,
    window.OnboardingState.CURRENT_VERSION
  ));
}

function onboardingClientValue(appId, clientForm = 'desktop') {
  return `${String(appId || '')}\u001f${String(clientForm || 'desktop')}`;
}

function parseOnboardingClientValue(value) {
  const [appId = '', clientForm = 'desktop'] = String(value || '').split('\u001f');
  return { appId, clientForm: clientForm || 'desktop' };
}

function prepareWelcomeGuide() {
  state.firstUse.mode = 'guide';
  state.firstUse.model = null;
  if (els.welcomeDialogCloseBtn) els.welcomeDialogCloseBtn.disabled = false;
  if (els.welcomeDialogKicker) els.welcomeDialogKicker.textContent = 'AGENTDESK GUIDE';
  if (els.welcomeDialogTitle) els.welcomeDialogTitle.textContent = tr('welcome.title');
  if (els.welcomeDialogLead) els.welcomeDialogLead.textContent = tr('welcome.lead');
  if (els.welcomeGuideContent) els.welcomeGuideContent.hidden = false;
  if (els.onboardingContent) els.onboardingContent.hidden = true;
  if (els.onboardingFooter) els.onboardingFooter.hidden = true;
  els.welcomeDialog?.classList.remove('is-onboarding');
}

function createFirstUseModel(options = {}) {
  const progress = options.force === true
    ? { completedVersion: 0, completedAt: null }
    : state.onboardingProgress;
  return window.OnboardingState.create({
    progress,
    profiles: state.profiles,
    clients: supportedProvisioningApps(),
    overview: state.mesh.overview
  });
}

function openFirstUseDialog(options = {}) {
  if (!window.OnboardingState || !els.welcomeDialog) return false;
  const model = createFirstUseModel(options);
  if (model.phase === 'done') return false;
  state.firstUse.mode = 'onboarding';
  state.firstUse.model = model;
  state.firstUse.busy = false;
  renderFirstUse();
  if (!els.welcomeDialog.open) els.welcomeDialog.showModal();
  focusFirstUseControl();
  return true;
}

// 全新安装从空台面上的“招募第一只猫”开始，不再一启动就弹窗。
// 台面上已经有东西时仍在启动时出现：旧安装要确认无损迁移，中途退出的首次使用要回到原来的步骤。
function maybeShowWelcome() {
  if (!onboardingNeedsPresentation()) return;
  const emptyDesk = !state.profiles.length && !(state.mesh.overview?.agents || []).length;
  if (emptyDesk) return;
  openFirstUseDialog();
}

function firstUseErrorText(reasonCode) {
  if (!reasonCode) return '';
  const known = {
    'agent-name-required': 'onboarding.error.nameRequired',
    'supported-client-required': 'onboarding.error.clientRequired',
    'first-agent-api-unavailable': 'onboarding.error.contractUnavailable',
    'first-agent-result-incomplete': 'onboarding.error.incompleteResult'
  };
  const key = known[reasonCode];
  return key ? tr(key) : tr('onboarding.error.generic', { code: reasonCode });
}

function preparationStateText(preparation = {}) {
  const key = `onboarding.prepare.state.${preparation.state || 'planning'}`;
  const fallback = tr('onboarding.prepare.state.preparing');
  const label = tr(key);
  return label === key ? fallback : label;
}

function preparationDetailText(preparation = {}) {
  const key = `onboarding.prepare.detail.${preparation.state || 'planning'}`;
  const fallback = tr('onboarding.prepare.detail.preparing');
  const label = tr(key);
  if (label !== key) return label;
  return preparation.reasonCode
    ? tr('onboarding.error.generic', { code: preparation.reasonCode })
    : fallback;
}

function renderOnboardingProgress(model) {
  if (!els.onboardingProgress) return;
  const order = { migration: 0, agent: 1, submitting: 1, preparing: 2, existing: 3, complete: 3 };
  const current = order[model.phase] ?? 0;
  const hasMigration = model.profiles.length > 0 && !model.initialized;
  for (const item of els.onboardingProgress.querySelectorAll('[data-step]')) {
    const step = item.dataset.step;
    const index = step === 'migration' ? 0 : (step === 'agent' ? 1 : 2);
    const skipped = step === 'migration' && !hasMigration;
    item.dataset.state = skipped || index < current ? 'complete' : (index === current ? 'current' : 'pending');
    item.setAttribute('aria-current', index === current && !skipped ? 'step' : 'false');
  }
}

function renderOnboardingMigration(model) {
  if (!els.onboardingMigrationList) return;
  els.onboardingMigrationList.replaceChildren();
  const selected = new Set(model.selectedProfileIds);
  for (const profile of model.profiles) {
    const label = document.createElement('label');
    label.className = 'onboarding-migration-item';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = selected.has(profile.profileId);
    checkbox.disabled = state.firstUse.busy;
    checkbox.addEventListener('change', () => {
      state.firstUse.model = window.OnboardingState.transition(state.firstUse.model, {
        type: 'toggle-profile',
        profileId: profile.profileId,
        selected: checkbox.checked
      });
      renderFirstUse();
    });
    const identity = document.createElement('span');
    const name = document.createElement('strong');
    name.textContent = profile.name;
    const meta = document.createElement('small');
    meta.textContent = [appLabel(profile.appId), profile.group].filter(Boolean).join(' · ');
    identity.append(name, meta);
    const stateLabel = document.createElement('b');
    stateLabel.textContent = tr(checkbox.checked
      ? 'onboarding.migration.included'
      : 'onboarding.migration.keptLocal');
    label.append(checkbox, identity, stateLabel);
    els.onboardingMigrationList.append(label);
  }
}

function renderOnboardingClientSelect(model) {
  if (!els.onboardingAgentClient) return;
  const expected = onboardingClientValue(
    model.draft.requestedAppId,
    model.draft.requestedClientForm
  );
  els.onboardingAgentClient.replaceChildren();
  for (const client of model.clients) {
    const option = document.createElement('option');
    option.value = onboardingClientValue(client.appId, client.clientForm);
    option.textContent = client.label;
    els.onboardingAgentClient.append(option);
  }
  if (!model.clients.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = tr('onboarding.agent.noClient');
    option.disabled = true;
    option.selected = true;
    els.onboardingAgentClient.append(option);
  } else {
    els.onboardingAgentClient.value = model.clients.some((item) => (
      onboardingClientValue(item.appId, item.clientForm) === expected
    )) ? expected : onboardingClientValue(model.clients[0].appId, model.clients[0].clientForm);
  }
  els.onboardingAgentClient.disabled = state.firstUse.busy || !model.clients.length;
}

function renderOnboardingExisting(model) {
  if (!els.onboardingExistingAgents) return;
  els.onboardingExistingAgents.replaceChildren();
  for (const agent of model.agents.slice(0, 8)) {
    const item = document.createElement('span');
    item.textContent = agent.displayName;
    els.onboardingExistingAgents.append(item);
  }
  if (model.agents.length > 8) {
    const more = document.createElement('span');
    more.textContent = tr('onboarding.existing.more', { n: model.agents.length - 8 });
    els.onboardingExistingAgents.append(more);
  }
}

function renderFirstUseActions(model) {
  const primary = els.onboardingPrimaryBtn;
  const secondary = els.onboardingSecondaryBtn;
  const back = els.onboardingBackBtn;
  const advanced = els.onboardingAdvancedBtn;
  if (!primary || !secondary || !back || !advanced) return;

  primary.hidden = false;
  primary.disabled = state.firstUse.busy;
  secondary.hidden = true;
  secondary.disabled = state.firstUse.busy;
  back.hidden = !(model.phase === 'agent' && model.originPhase === 'migration');
  back.disabled = state.firstUse.busy;
  advanced.hidden = !['migration', 'agent'].includes(model.phase);
  advanced.disabled = state.firstUse.busy;
  if (els.onboardingCodexImportBtn) {
    els.onboardingCodexImportBtn.hidden = !['migration', 'agent'].includes(model.phase);
    els.onboardingCodexImportBtn.disabled = state.firstUse.busy;
  }
  if (els.welcomeDialogCloseBtn) els.welcomeDialogCloseBtn.disabled = state.firstUse.busy;

  if (model.phase === 'migration') {
    primary.dataset.action = 'migration';
    primary.textContent = tr('onboarding.action.confirmMigration');
  } else if (model.phase === 'agent') {
    primary.dataset.action = 'create';
    primary.textContent = tr('onboarding.action.create');
    primary.disabled = state.firstUse.busy || !window.OnboardingState.canSubmit(model);
  } else if (model.phase === 'existing') {
    primary.dataset.action = 'review';
    primary.textContent = tr('onboarding.action.review');
  } else if (model.phase === 'preparing') {
    primary.dataset.action = 'prepare';
    primary.textContent = tr(['error', 'unsupported'].includes(model.preparation?.state)
      ? 'onboarding.action.retry'
      : 'onboarding.action.continuePrepare');
    secondary.hidden = false;
    secondary.dataset.action = 'later';
    secondary.textContent = tr('onboarding.action.later');
  } else if (model.phase === 'complete') {
    primary.dataset.action = 'finish';
    primary.textContent = tr('onboarding.action.enter');
    primary.disabled = state.firstUse.busy || model.completeShown !== true;
  } else {
    primary.dataset.action = '';
    primary.textContent = tr('onboarding.action.working');
    primary.disabled = true;
  }
}

function renderFirstUse() {
  const model = state.firstUse.model;
  if (!model || !els.onboardingContent) return;
  state.firstUse.mode = 'onboarding';
  els.welcomeDialog?.classList.add('is-onboarding');
  if (els.welcomeDialogKicker) els.welcomeDialogKicker.textContent = 'FIRST USE · V' + model.version;
  if (els.welcomeDialogTitle) els.welcomeDialogTitle.textContent = tr('onboarding.title');
  if (els.welcomeDialogLead) els.welcomeDialogLead.textContent = tr('onboarding.lead');
  if (els.welcomeGuideContent) els.welcomeGuideContent.hidden = true;
  els.onboardingContent.hidden = false;
  if (els.onboardingFooter) els.onboardingFooter.hidden = false;

  renderOnboardingProgress(model);
  for (const [element, phase] of [
    [els.onboardingMigration, 'migration'],
    [els.onboardingAgent, 'agent'],
    [els.onboardingExisting, 'existing'],
    [els.onboardingPreparation, 'preparing'],
    [els.onboardingComplete, 'complete']
  ]) {
    if (element) element.hidden = model.phase !== phase;
  }

  if (model.phase === 'migration') renderOnboardingMigration(model);
  if (model.phase === 'agent') {
    if (els.onboardingAgentName && els.onboardingAgentName.value !== model.draft.displayName) {
      els.onboardingAgentName.value = model.draft.displayName;
    }
    renderOnboardingClientSelect(model);
    if (els.onboardingMigrationSummary) {
      els.onboardingMigrationSummary.hidden = model.originPhase !== 'migration';
      els.onboardingMigrationSummary.textContent = tr('onboarding.migration.selected', {
        n: model.selectedProfileIds.length
      });
    }
  }
  if (model.phase === 'existing') renderOnboardingExisting(model);
  if (model.phase === 'preparing') {
    const preparation = model.preparation || { state: 'planning' };
    if (els.onboardingPreparationState) els.onboardingPreparationState.textContent = preparationStateText(preparation);
    if (els.onboardingPreparationDetail) els.onboardingPreparationDetail.textContent = preparationDetailText(preparation);
    if (els.onboardingPreparationIcon) {
      els.onboardingPreparationIcon.textContent = ['error', 'unsupported'].includes(preparation.state) ? '!' : '⋯';
      els.onboardingPreparationIcon.dataset.state = preparation.state || 'planning';
    }
  }

  const message = firstUseErrorText(model.errorCode);
  if (els.onboardingStatus) {
    els.onboardingStatus.hidden = !message;
    els.onboardingStatus.textContent = message;
  }
  renderFirstUseActions(model);

  if (model.phase === 'complete' && model.completeShown !== true) {
    requestAnimationFrame(() => {
      if (!els.welcomeDialog?.open || els.onboardingComplete?.hidden) return;
      state.firstUse.model = window.OnboardingState.transition(state.firstUse.model, {
        type: 'rendered',
        phase: 'complete'
      });
      renderFirstUseActions(state.firstUse.model);
    });
  }
}

function focusFirstUseControl() {
  const model = state.firstUse.model;
  if (!model || !els.welcomeDialog?.open) return;
  requestAnimationFrame(() => {
    if (model.phase === 'migration') els.onboardingMigrationList?.querySelector('input')?.focus();
    else if (model.phase === 'agent') els.onboardingAgentName?.focus();
    else els.onboardingPrimaryBtn?.focus();
  });
}

async function startFirstAgentSetup() {
  let model = state.firstUse.model;
  if (!model || model.phase !== 'agent' || state.firstUse.busy) return;
  model = window.OnboardingState.transition(model, {
    type: 'draft',
    displayName: els.onboardingAgentName?.value,
    ...parseOnboardingClientValue(els.onboardingAgentClient?.value)
  });
  model = window.OnboardingState.transition(model, { type: 'submit' });
  state.firstUse.model = model;
  if (model.phase !== 'submitting') {
    renderFirstUse();
    focusFirstUseControl();
    return;
  }

  state.firstUse.busy = true;
  renderFirstUse();
  try {
    const input = {
      displayName: model.draft.displayName,
      requestedAppId: model.draft.requestedAppId,
      requestedClientForm: model.draft.requestedClientForm,
      migrationProfileIds: [...model.selectedProfileIds],
      baseRevision: currentCatalogRevision()
    };
    let result;
    if (state.mesh.overview?.initialized) {
      result = await window.manager.createAgent({
        displayName: input.displayName,
        group: '',
        note: '',
        baseRevision: input.baseRevision
      });
    } else if (typeof window.manager.initializeFirstAgent === 'function') {
      result = await window.manager.initializeFirstAgent(input);
    } else {
      throw new Error('first-agent-api-unavailable');
    }
    if (!result?.ok) throw new Error(result?.reasonCode || 'first-agent-create-failed');
    const overview = result.overview;
    const agentId = result.agent?.agentId;
    const deviceId = result.deviceId || overview?.localDeviceId;
    const resultHasAgent = Array.isArray(overview?.agents)
      && overview.agents.some((agent) => agent.agentId === agentId);
    if (overview?.initialized !== true || !agentId || !deviceId || !resultHasAgent) {
      throw new Error('first-agent-result-incomplete');
    }
    state.firstUse.model = window.OnboardingState.transition(state.firstUse.model, {
      type: 'initialized',
      agentId,
      deviceId
    });
    if (state.firstUse.model.phase !== 'preparing') {
      renderFirstUse();
      return;
    }
    state.mesh.overview = overview;
    rememberProvisioningChoice({ key: agentId }, deviceId, input.requestedAppId, input.requestedClientForm);
    await refreshCatalogWorkspace(overview, { agentId });
    renderFirstUse();
    const initialPreparation = result.preparation || result.provisioning || null;
    if (initialPreparation?.state) {
      state.firstUse.model = window.OnboardingState.transition(state.firstUse.model, {
        type: 'preparation-result',
        result: initialPreparation
      });
      renderFirstUse();
    } else {
      state.firstUse.busy = false;
      await continueFirstPreparation();
      return;
    }
  } catch (error) {
    state.firstUse.model = window.OnboardingState.transition(state.firstUse.model, {
      type: 'failed',
      returnPhase: state.firstUse.model?.agentId ? 'preparing' : 'agent',
      reasonCode: error?.message || 'first-agent-create-failed'
    });
  } finally {
    state.firstUse.busy = false;
    renderFirstUse();
  }
}

async function continueFirstPreparation() {
  const model = state.firstUse.model;
  if (!model || model.phase !== 'preparing' || state.firstUse.busy) return;
  if (!model.agentId || !model.deviceId || typeof window.manager.ensureAgentReady !== 'function') {
    state.firstUse.model = window.OnboardingState.transition(model, {
      type: 'failed',
      returnPhase: 'preparing',
      reasonCode: 'first-agent-result-incomplete'
    });
    renderFirstUse();
    return;
  }
  state.firstUse.busy = true;
  state.firstUse.model = window.OnboardingState.transition(model, { type: 'retry' });
  renderFirstUse();
  try {
    const result = await window.manager.ensureAgentReady({
      agentId: model.agentId,
      deviceId: model.deviceId,
      requestedAppId: model.draft.requestedAppId,
      requestedClientForm: model.draft.requestedClientForm || 'desktop'
    });
    if (result?.overview) state.mesh.overview = result.overview;
    if (result?.state === 'ready') {
      await loadProfiles(result.slot?.profileId || null, { skipDeviceOverview: true });
    } else if (result?.overview) {
      await refreshCatalogWorkspace(result.overview, { agentId: model.agentId });
    }
    state.firstUse.model = window.OnboardingState.transition(state.firstUse.model, {
      type: 'preparation-result',
      result
    });
    setStatus(provisioningResultMessage(result, model.draft.displayName));
  } catch (error) {
    state.firstUse.model = window.OnboardingState.transition(state.firstUse.model, {
      type: 'failed',
      returnPhase: 'preparing',
      reasonCode: error?.message || 'provisioning-failed'
    });
  } finally {
    state.firstUse.busy = false;
    renderFirstUse();
  }
}

function finishFirstUseLater() {
  if (!state.firstUse.model || state.firstUse.busy) return;
  state.firstUse.model = window.OnboardingState.transition(state.firstUse.model, {
    type: 'finish-later'
  });
  renderFirstUse();
}

function finishFirstUse() {
  const patch = window.OnboardingState?.completionPatch(state.firstUse.model);
  if (!patch) return;
  recordFirstUseCompletion(patch);
  els.welcomeDialog?.close();
  setStatus(tr('onboarding.status.complete'));
}

function recordFirstUseCompletion(patch) {
  state.welcomed = true;
  state.onboardingProgress = patch.onboarding;
  persistSettings(patch);
}

// 猫的档案：一页五段（资料、位置、账号、调用、送走）。位置段列出这只猫在当前设备视角下的每个运行位置，
// 展开哪个，下面那排动作就作用于哪个；子流程叠在档案上面，做完回到这一页。
function renderAgentManageContext() {
  const group = identityGroups().find((item) => item.key === actionAgentId()) || null;
  if (els.agentManageDialog?.open && !group) {
    // 这只猫已经不在了（被送走或并入别的猫）。
    els.agentManageDialog.close();
    return;
  }
  const profile = selectedProfile();
  const localProfile = Boolean(profile && profile._remote !== true);
  const agent = catalogAgentById(actionAgentId());
  const agentName = agent?.displayName || group?.primary?.name || profile?.name || tr('account.noneAgent');
  if (els.agentManageName) els.agentManageName.textContent = agentName;
  if (els.agentManageSummary) els.agentManageSummary.textContent = tr('account.manageHint');
  renderAgentManageLocations(group, profile);
  renderHubCalling(group, profile);
  if (els.agentManageAccountsNote) {
    els.agentManageAccountsNote.hidden = state.mesh.overview?.initialized === true;
  }
  if (els.stopProfileBtn) els.stopProfileBtn.disabled = !localProfile;
  if (els.cleanCrashpadBtn) els.cleanCrashpadBtn.disabled = !localProfile;
}

function agentManageLocationLabel(member) {
  const device = member._remote ? member._meshDeviceName : tr('devices.device.local');
  return [device, appLabel(member.appId), member.name].filter(Boolean).join(' · ');
}

function renderAgentManageLocations(group, profile) {
  const list = els.agentManageLocations;
  const actions = els.yardManageActions;
  if (!list || !actions) return;
  const members = group?.members || [];
  if (els.agentManageRuntimeLabel) {
    // 有位置时下面的行已经写明了，段标题旁只在还没有位置时说明状态。
    els.agentManageRuntimeLabel.textContent = members.length
      ? ''
      : (group ? deploymentStateLabel(group.readiness?.state) : tr('devices.slot.choose'));
  }
  // 先把共用的那排动作挪回段尾，再重建位置行，避免它跟着旧行一起被移除。
  list.after(actions);
  list.replaceChildren();
  for (const member of members) {
    const expanded = Boolean(profile && member.id === profile.id);
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'dossier-location';
    row.dataset.profileId = member.id;
    row.setAttribute('aria-expanded', String(expanded));
    row.setAttribute('aria-controls', 'yardManageActions');
    const label = document.createElement('span');
    label.textContent = agentManageLocationLabel(member);
    const hint = document.createElement('small');
    hint.textContent = member._remote
      ? tr(member._deviceStatus === 'online' ? 'dossier.location.remoteOnline' : 'dossier.location.remoteOffline')
      : tr('dossier.location.local');
    const toggle = document.createElement('b');
    toggle.textContent = tr(expanded ? 'dossier.location.expanded' : 'dossier.location.expand');
    row.append(label, hint, toggle);
    row.addEventListener('click', () => {
      if (member.id !== currentProfileId()) selectSlot(member.id);
      renderAgentManageContext();
      els.agentManageLocations.querySelector('[aria-expanded="true"]')?.focus({ preventScroll: true });
    });
    list.append(row);
    if (expanded) row.after(actions);
  }
  actions.hidden = !profile;
  if (els.agentManageNoLocation) {
    els.agentManageNoLocation.hidden = members.length > 0;
    els.agentManageNoLocation.textContent = group
      ? tr('dossier.location.none', { state: deploymentStateLabel(group.readiness?.state) })
      : '';
  }
}

function openAgentManageDialog() {
  if (!els.agentManageDialog) return;
  if (els.agentManageStatus) els.agentManageStatus.textContent = '';
  renderAgentManageContext();
  if (!els.agentManageDialog.open) els.agentManageDialog.showModal();
}

// 从卡片打开档案：作用于这只猫，不选中它，所以正在看的会话列表不变。
function openAgentDossier(agentId) {
  if (!identityGroups().some((group) => group.key === agentId)) return;
  els.quotaPopover?.hidePopover();
  setActionAgent(agentId);
  openAgentManageDialog();
}

function bindEvents() {
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
  window.manager.onProfileRegistrationsChanged?.(() => {
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

  window.manager.onUpdateProgress((progress) => {
    handleUpdateProgress(progress);
  });

  window.manager.onProfileRuntimeIncident?.((incident) => {
    if (incident?.reason === 'crashpad-burst-contained') {
      setStatus(tr('status.crashpadContained'));
    } else if (incident?.reason === 'crashpad-repeated-signature') {
      setStatus(tr('status.crashpadFused'));
    } else if (incident?.reason === 'crashpad-limit-pruned') {
      setStatus(tr('status.crashpadPruned', { n: incident.removedFiles || 0 }));
    }
  });

  window.manager.onProfileQuitBlocked?.(() => {
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


  if (window.manager.onToolProgress) {
    window.manager.onToolProgress(handleToolProgress);
  }

  if (window.manager.onAgentDeploymentsChanged) {
    window.manager.onAgentDeploymentsChanged((payload = {}) => {
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

  if (window.manager.onAgentActionsChanged) {
    window.manager.onAgentActionsChanged((payload = {}) => {
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

  if (window.manager.onDeviceConnectionState) {
    window.manager.onDeviceConnectionState((value) => {
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

  if (window.manager.onDeviceNetworkState) {
    window.manager.onDeviceNetworkState((network) => {
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

  if (window.manager.onPairingClaimsChanged) {
    window.manager.onPairingClaimsChanged((claims) => {
      applyPairingClaims(claims, { open: true });
    });
  }

  if (window.manager.hubState) void loadHub();
  if (window.manager.onHubChanged) window.manager.onHubChanged((payload) => applyHubChange(payload?.run));
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

  if (window.manager.onTransfersChanged) {
    window.manager.onTransfersChanged((transfers) => {
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

  if (window.manager.onTaskPackagesChanged) {
    window.manager.onTaskPackagesChanged((history) => {
      state.taskPackages.history = Array.isArray(history) ? history : [];
      renderTaskPackageHistory();
      renderIncomingTaskPackages();
    });
  }

  if (window.manager.onRemoteControlsChanged) {
    window.manager.onRemoteControlsChanged((sessions) => {
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

  if (window.manager.onRemoteControlReturn) {
    window.manager.onRemoteControlReturn((value = {}) => {
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
    els.pathDialog.showModal();
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

  // 所有轻量菜单遵循同一规则：点菜单外、选择菜单项或按 Esc 后关闭。
  document.addEventListener('pointerdown', (event) => {
    for (const menu of document.querySelectorAll('details.context-menu[open]')) {
      if (!menu.contains(event.target)) menu.open = false;
    }
  });
  document.addEventListener('click', (event) => {
    const button = event.target.closest('.context-menu-panel button');
    const menu = button?.closest('details.context-menu');
    if (menu) menu.open = false;
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    for (const menu of document.querySelectorAll('details.context-menu[open]')) {
      if (menu.contains(document.activeElement)) menu.querySelector('summary')?.focus({ preventScroll: true });
      menu.open = false;
    }
  });

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
      if (els.sessionDisplayMenu) els.sessionDisplayMenu.open = false;
      sessionMarks.setOrder(next);
      if (next === state.sessionOrder) return;
      state.sessionOrder = sessionMarks.currentOrder();
      persistSettings({ sessionOrder: state.sessionOrder });
      applySessionFilter();
    });
  }

  els.markAllSeenBtn?.addEventListener('click', async () => {
    if (els.sessionDisplayMenu) els.sessionDisplayMenu.open = false;
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

// Must equal Main's providerNamespace() (src/mesh/domain/agent-catalog.js),
// which is what each binding records; test/catalog-provider-namespace.test.js
// checks every registered client.
function catalogProviderForApp(appId) {
  const value = String(appId || '').trim().toLowerCase();
  if (value === 'claude' || value === 'claude-cli') return 'claude';
  if (value === 'kimi' || value === 'kimi-work') return 'kimi';
  return value || 'unknown';
}

function catalogSlotKey(slot) {
  return slot ? `${slot.deviceId}:${slot.profileId}` : '';
}

function catalogSlotByKey(slotKey) {
  return (state.mesh.overview?.slots || []).find((slot) => catalogSlotKey(slot) === slotKey) || null;
}

function catalogAgentById(agentId) {
  return (state.mesh.overview?.agents || []).find((agent) => agent.agentId === agentId) || null;
}

function catalogBindingById(accountBindingId) {
  return (state.mesh.overview?.accountBindings || []).find((binding) => (
    binding.accountBindingId === accountBindingId
  )) || null;
}

function currentCatalogRevision() {
  return Number(state.mesh.overview?.mesh?.catalogRevision) || 0;
}

function appendSelectOption(select, value, label, options = {}) {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = label;
  option.disabled = options.disabled === true;
  select.append(option);
  return option;
}

function fillAgentAssignmentSelect(select, preferredAgentId = null, excludeAgentId = null) {
  if (!select) return [];
  const previous = preferredAgentId || select.value;
  const agents = (state.mesh.overview?.agents || []).filter((agent) => agent.agentId !== excludeAgentId);
  select.replaceChildren();
  appendSelectOption(select, '', tr('catalog.assignment.choose'), { disabled: true });
  for (const agent of agents) appendSelectOption(select, agent.agentId, agent.displayName);
  if (!agents.length) {
    select.options[0].textContent = tr('catalog.assignment.noAgent');
    select.value = '';
    return agents;
  }
  select.value = agents.some((agent) => agent.agentId === previous) ? previous : '';
  return agents;
}

function bindingOptionLabel(binding) {
  const agent = catalogAgentById(binding.agentId);
  return [agent?.displayName, binding.providerNamespace, binding.displayAlias].filter(Boolean).join(' · ');
}

function fillBindingAssignmentSelect(select, appId, preferredBindingId = null) {
  if (!select) return [];
  const previous = preferredBindingId || select.value;
  const provider = catalogProviderForApp(appId);
  const bindings = (state.mesh.overview?.accountBindings || []).filter((binding) => (
    binding.providerNamespace === provider
  ));
  select.replaceChildren();
  appendSelectOption(select, '', tr('catalog.assignment.choose'), { disabled: true });
  for (const binding of bindings) {
    appendSelectOption(select, binding.accountBindingId, bindingOptionLabel(binding));
  }
  if (!bindings.length) {
    select.options[0].textContent = tr('catalog.assignment.noCompatibleBinding');
    select.value = '';
    return bindings;
  }
  select.value = bindings.some((binding) => binding.accountBindingId === previous)
    ? previous
    : '';
  return bindings;
}

function openAgentCreationDialog() {
  if (!state.mesh.overview?.initialized || !els.agentCreateDialog) return;
  els.newAgentName.value = '';
  els.newAgentGroup.value = '';
  els.newAgentNote.value = '';
  els.newAgentApp.replaceChildren();
  for (const app of supportedProvisioningApps()) {
    const option = document.createElement('option');
    option.value = app.appId;
    option.textContent = app.label;
    els.newAgentApp.append(option);
  }
  els.confirmAddAgentBtn.disabled = !els.newAgentApp.value;
  els.agentCreateDialog.showModal();
  els.newAgentName.focus();
}

async function confirmAgentCreation() {
  const displayName = els.newAgentName.value.trim();
  if (!displayName) {
    setStatus(tr('status.agentNameFirst'));
    els.newAgentName.focus();
    return;
  }
  const requestedAppId = els.newAgentApp.value;
  if (!state.appMeta[requestedAppId]?.canProvision) return;
  els.confirmAddAgentBtn.disabled = true;
  try {
    const message = await createAgentAndPrepare({
      displayName,
      requestedAppId,
      group: els.newAgentGroup.value,
      note: els.newAgentNote.value,
      onCreated: () => els.agentCreateDialog.close()
    });
    setStatus(message);
  } finally {
    if (els.agentCreateDialog.open) els.confirmAddAgentBtn.disabled = false;
  }
}

// 新建全局 Agent 并在本机首次准备（打开官方客户端登录）。返回给用户看的一句话。
async function createAgentAndPrepare({ displayName, requestedAppId, group = '', note = '', onCreated = null }) {
  if (!state.appMeta[requestedAppId]?.canProvision) return tr('catalog.error.generic', { code: 'client-form-unsupported' });
  try {
    const result = await window.manager.createAgent({
      displayName,
      group,
      note,
      baseRevision: currentCatalogRevision()
    });
    if (!result?.ok) throw new Error(result?.reasonCode || 'agent-create-failed');
    onCreated?.();
    // The dialog explicitly prepares on this device, including when opened from a remote Lens.
    const agentId = result.agent.agentId;
    const deviceId = result.overview.localDeviceId;
    await refreshCatalogWorkspace(result.overview, { agentId, deviceLensId: deviceId });
    rememberProvisioningChoice({ key: agentId }, deviceId, requestedAppId);
    const preparation = await window.manager.ensureAgentReady({
      agentId, deviceId, requestedAppId, requestedClientForm: 'desktop'
    });
    if (preparation?.overview) await refreshCatalogWorkspace(preparation.overview, { agentId });
    return provisioningResultMessage(preparation, result.agent.displayName);
  } catch (error) {
    return tr('catalog.error.generic', { code: error?.message || 'agent-create-failed' });
  }
}

// 招募里登记、导入或新建成功之后：首次使用中途进来的就记下完成并收起首次使用，
// 刷新设备视角和账号列表，选中这个账号。
async function afterRecruitedAccount(profileId) {
  try {
    if (els.welcomeDialog?.open && state.firstUse.mode === 'onboarding') {
      const patch = window.OnboardingState.localImportCompletionPatch(state.firstUse.model);
      if (patch) recordFirstUseCompletion(patch);
      els.welcomeDialog.close();
    }
    if (state.mesh.overview?.initialized) {
      await loadDeviceOverview({ silent: true, skipWorkspaceRefresh: true });
      const localDeviceId = state.mesh.overview?.localDeviceId;
      if (localDeviceId && !['all', localDeviceId].includes(currentDeviceLensId())) {
        state.ui = window.UiContext.setDeviceLens(state.ui, localDeviceId);
        renderDeviceLens(state.mesh.overview);
      }
    }
    await loadProfiles(profileId || null);
  } catch (_error) {
    setStatus(tr('codexImport.refreshError'));
  }
}

function openProfileCreationDialog(options = {}) {
  const meshMode = state.mesh.overview?.initialized === true;
  els.profileDialogTitle.textContent = tr(meshMode ? 'dialog.addProfile.slotTitle' : 'dialog.addProfile.title');
  els.newProfileMeshAssignment.hidden = !meshMode;
  els.newProfileApp.value = selectedProfile()?.appId
    || (els.newProfileApp.options[0] ? els.newProfileApp.options[0].value : 'claude');
  els.newProfileName.value = '';
  els.newProfileGroup.value = '';
  els.newProfileNote.value = '';
  if (meshMode) {
    els.newProfileMode.value = options.agentId ? 'existing-agent' : '';
    els.newProfileAgent.value = options.agentId || '';
    els.newProfileBinding.value = '';
  }
  syncProfileAssignmentControls();
  if (meshMode && options.agentId) {
    els.newProfileAgent.value = options.agentId;
    syncProfileAssignmentControls();
  }
  els.profileDialog.showModal();
  (meshMode && !options.agentId ? els.newProfileMode : els.newProfileName).focus();
}


function syncProfileAssignmentControls() {
  const meshMode = state.mesh.overview?.initialized === true;
  if (!meshMode) {
    els.newProfileMeshAssignment.hidden = true;
    els.confirmAddProfileBtn.disabled = false;
    return;
  }
  els.newProfileMeshAssignment.hidden = false;
  const mode = els.newProfileMode.value;
  const agents = fillAgentAssignmentSelect(els.newProfileAgent);
  const bindings = fillBindingAssignmentSelect(els.newProfileBinding, els.newProfileApp.value);
  els.newProfileAgentField.hidden = mode !== 'existing-agent';
  els.newProfileBindingField.hidden = mode !== 'existing-binding';
  const hintKey = {
    'new-agent': 'catalog.assignment.hintNew',
    'existing-agent': agents.length ? 'catalog.assignment.hintExistingAgent' : 'catalog.assignment.noAgent',
    'existing-binding': bindings.length
      ? 'catalog.assignment.hintExistingBinding'
      : 'catalog.assignment.noCompatibleBinding'
  }[mode];
  els.newProfileAssignmentHint.textContent = hintKey ? tr(hintKey) : '';
  els.confirmAddProfileBtn.disabled = !mode
    || (mode === 'existing-agent' && !els.newProfileAgent.value)
    || (mode === 'existing-binding' && !els.newProfileBinding.value);
}

async function confirmProfileCreation() {
  const name = els.newProfileName.value.trim();
  if (!name) {
    setStatus(tr('status.nameFirst'));
    els.newProfileName.focus();
    return;
  }
  const meshMode = state.mesh.overview?.initialized === true;
  const mode = els.newProfileMode.value;
  if (meshMode && !mode) {
    setStatus(tr('catalog.add.choiceTitle'));
    els.newProfileMode.focus();
    return;
  }
  els.confirmAddProfileBtn.disabled = true;
  try {
    if (!meshMode) {
      const profile = await window.manager.addProfile({
        appId: els.newProfileApp.value,
        name,
        group: els.newProfileGroup.value,
        note: els.newProfileNote.value
      });
      els.profileDialog.close();
      await loadProfiles(profile.id);
      setStatus(tr('status.created', { name: profile.name }));
      return;
    }

    const result = await window.manager.addLocalAgentSlot({
      appId: els.newProfileApp.value,
      name,
      group: els.newProfileGroup.value,
      note: els.newProfileNote.value,
      mode,
      agentId: mode === 'existing-agent' ? els.newProfileAgent.value : undefined,
      accountBindingId: mode === 'existing-binding' ? els.newProfileBinding.value : undefined
    });
    if (!result?.ok) throw new Error(result?.reasonCode || 'slot-add-failed');
    state.mesh.overview = result.overview;
    els.profileDialog.close();
    await loadProfiles(result.profile.id);
    setStatus(tr('catalog.status.created'));
  } catch (error) {
    setStatus(tr('catalog.error.generic', { code: error?.message || 'slot-add-failed' }));
  } finally {
    if (els.profileDialog.open) syncProfileAssignmentControls();
  }
}

function openAgentOrProfileEditor() {
  const meshMode = state.mesh.overview?.initialized === true;
  if (meshMode) {
    const agent = catalogAgentById(actionAgentId());
    if (!agent) return;
    const profile = selectedProfile();
    const group = identityGroups().find((item) => item.key === agent.agentId);
    state.mesh.editingAgentId = agent.agentId;
    els.editDialogTitle.textContent = tr('catalog.edit.title');
    els.editAgentHint.hidden = false;
    els.editAgentHint.textContent = tr('catalog.edit.hint');
    els.editIdentityField.hidden = true;
    els.editName.value = agent.displayName;
    els.editGroup.value = agent.group || '';
    els.editIdentity.value = '';
    els.editNote.value = agent.note || '';
    openCatCustomizer({
      id: group?.primary?.id || agent.agentId,
      appId: profile?.appId || group?.primary?.appId || 'unknown',
      cat: agent.catAppearance || group?.primary?.cat || null,
      isProtected: false
    });
  } else {
    const profile = selectedProfile();
    if (!profile) return;
    state.mesh.editingAgentId = null;
    els.editDialogTitle.textContent = tr('dialog.editProfile.title');
    els.editAgentHint.hidden = true;
    els.editIdentityField.hidden = false;
    els.editName.value = profile.name;
    els.editGroup.value = profile.group || '';
    els.editIdentity.value = profile.identityKey || '';
    els.editNote.value = profile.note || '';
    populateIdentityDatalist();
    openCatCustomizer(profile);
  }
  els.editDialog.showModal();
  els.editName.focus();
}

async function confirmAgentOrProfileEdit() {
  const name = els.editName.value.trim();
  if (!name) {
    setStatus(tr('status.nameEmpty'));
    els.editName.focus();
    return;
  }
  if (state.mesh.overview?.initialized && state.mesh.editingAgentId) {
    const result = await window.manager.renameAgent({
      agentId: state.mesh.editingAgentId,
      displayName: name,
      group: els.editGroup.value,
      note: els.editNote.value,
      catAppearance: storedCatDraft(),
      baseRevision: currentCatalogRevision()
    });
    if (!result?.ok) {
      setStatus(tr('catalog.error.generic', { code: result?.reasonCode || 'agent-update-failed' }));
      return;
    }
    const agentId = state.mesh.editingAgentId;
    state.mesh.editingAgentId = null;
    els.editDialog.close();
    await refreshCatalogWorkspace(result.overview, { agentId });
    setStatus(tr('catalog.status.saved'));
    return;
  }

  const profile = selectedProfile();
  if (!profile) return;
  await window.manager.updateProfile({
    id: profile.id,
    name,
    group: els.editGroup.value,
    identityKey: els.editIdentity.value,
    note: els.editNote.value,
    cat: storedCatDraft()
  });
  els.editDialog.close();
  await loadProfiles(profile.id);
  setStatus(tr('status.savedProfileCat'));
}

async function refreshCatalogWorkspace(overview, options = {}) {
  state.mesh.overview = overview;
  if (options.deviceLensId) {
    state.ui = window.UiContext.setDeviceLens(state.ui, options.deviceLensId, {
      validAgentIds: identityGroupsForLens(options.deviceLensId).map((group) => group.key)
    });
    renderDeviceLens(overview);
  }
  if (options.agentId && catalogAgentById(options.agentId)) {
    const group = identityGroupsForLens(currentDeviceLensId()).find((item) => item.key === options.agentId);
    const member = (group?.members || []).find((item) => item._meshSlotKey === options.slotKey)
      || preferredSlot(group?.members || []);
    if (group) {
      state.ui = window.UiContext.setAgent(state.ui, group.key, {
        slotKey: member?._meshSlotKey || member?.id
      });
      if (!member) state.ui = window.UiContext.setSlot(state.ui, null);
      persistUiSelectionMemory();
    }
  }
  validateUiContext();
  renderDeviceCenter();
  renderAccounts();
  renderAccountHeader();
  renderSessionControls();
  await loadSessions();
  renderAttentionInbox();
}

async function openAgentOrProfileRemoval() {
  const profile = selectedProfile();
  if (!state.mesh.overview?.initialized) {
    if (!profile) return;
    if (!window.confirm(tr('status.removeConfirm', { name: profile.name }))) return;
    const result = await window.manager.removeProfile(profile.id);
    if (!result.ok) {
      setStatus(result.reason || tr('status.removeFail'));
      return;
    }
    await loadProfiles();
    setStatus(tr('status.removedSlot'));
    return;
  }

  const agent = catalogAgentById(actionAgentId());
  if (!agent) return;
  const slot = catalogSlotByKey(profile?._meshSlotKey || currentSlotKey());
  state.mesh.removingAgentId = agent.agentId;
  state.mesh.removingSlotKey = slot ? catalogSlotKey(slot) : null;
  els.removeCatalogIntro.textContent = tr('catalog.remove.intro', { name: agent.displayName });
  const radios = [...els.removeCatalogDialog.querySelectorAll('input[name="catalogRemoveScope"]')];
  const bindingRadio = radios.find((radio) => radio.value === 'account-binding');
  if (bindingRadio) bindingRadio.disabled = !slot?.accountBindingId;
  const slotRadio = radios.find((radio) => radio.value === 'slot');
  if (slotRadio) slotRadio.disabled = !slot;
  const agentRadio = radios.find((radio) => radio.value === 'agent');
  if (slotRadio && slot) slotRadio.checked = true;
  else if (agentRadio) agentRadio.checked = true;
  els.removeLocalRegistration.checked = false;
  renderCatalogRemovalImpact();
  els.removeCatalogDialog.showModal();
}

function catalogRemovalContext() {
  const overview = state.mesh.overview;
  const agent = catalogAgentById(state.mesh.removingAgentId);
  const slot = catalogSlotByKey(state.mesh.removingSlotKey);
  const binding = catalogBindingById(slot?.accountBindingId);
  const agentSlots = (overview?.slots || []).filter((item) => item.agentId === agent?.agentId);
  const bindingSlots = (overview?.slots || []).filter((item) => item.accountBindingId === binding?.accountBindingId);
  const bindings = (overview?.accountBindings || []).filter((item) => item.agentId === agent?.agentId);
  return { overview, agent, slot, binding, agentSlots, bindingSlots, bindings };
}

function renderCatalogRemovalImpact() {
  const context = catalogRemovalContext();
  if (!context.agent) return;
  let scope = els.removeCatalogDialog.querySelector('input[name="catalogRemoveScope"]:checked')?.value || 'agent';
  if (!context.slot && scope !== 'agent') {
    scope = 'agent';
    const agentRadio = els.removeCatalogDialog.querySelector('input[name="catalogRemoveScope"][value="agent"]');
    if (agentRadio) agentRadio.checked = true;
  }
  const devices = new Map((context.overview.devices || []).map((device) => [device.deviceId, device]));
  const affectedSlots = scope === 'agent'
    ? context.agentSlots
    : (scope === 'account-binding' ? context.bindingSlots : [context.slot]);
  const deviceCount = new Set(affectedSlots.map((slot) => slot.deviceId)).size;
  const sessionCount = affectedSlots.reduce((sum, slot) => sum + (Number(slot.sessionCount) || 0), 0);
  let message;
  if (scope === 'agent') {
    message = tr('catalog.remove.impactAgent', {
      name: context.agent.displayName,
      bindings: context.bindings.length,
      devices: deviceCount,
      slots: affectedSlots.length,
      sessions: sessionCount
    });
  } else if (scope === 'account-binding') {
    message = tr('catalog.remove.impactBinding', {
      binding: context.binding?.displayAlias || context.binding?.providerNamespace || '-',
      devices: deviceCount,
      slots: affectedSlots.length,
      sessions: sessionCount
    });
  } else {
    message = tr('catalog.remove.impactSlot', {
      device: devices.get(context.slot.deviceId)?.name || context.slot.deviceId,
      app: appLabel(context.slot.appId)
    });
  }
  const remaining = context.agentSlots.filter((slot) => !affectedSlots.includes(slot));
  if (scope !== 'agent' && remaining.length === 0) message += ` ${tr('catalog.remove.disappear')}`;
  els.removeCatalogImpact.dataset.state = 'idle';
  els.removeCatalogImpact.textContent = message;
  const localSlot = context.slot?.deviceId === context.overview.localDeviceId;
  els.removeLocalRegistrationField.hidden = !(scope === 'slot' && localSlot);
  if (scope !== 'slot') els.removeLocalRegistration.checked = false;
}

async function confirmCatalogRemoval() {
  const context = catalogRemovalContext();
  if (!context.agent) return;
  const scope = els.removeCatalogDialog.querySelector('input[name="catalogRemoveScope"]:checked')?.value || 'slot';
  if (scope !== 'agent' && !context.slot) return;
  els.confirmRemoveCatalogBtn.disabled = true;
  try {
    let result;
    if (scope === 'agent') {
      result = await window.manager.deleteAgent({
        agentId: context.agent.agentId,
        baseRevision: currentCatalogRevision()
      });
    } else if (scope === 'account-binding') {
      result = await window.manager.removeAccountBinding({
        accountBindingId: context.binding?.accountBindingId,
        baseRevision: currentCatalogRevision()
      });
    } else {
      result = await window.manager.removeLocalAgentSlot({
        deviceId: context.slot.deviceId,
        profileId: context.slot.profileId,
        baseRevision: currentCatalogRevision()
      });
    }
    if (!result?.ok) throw new Error(result?.reasonCode || 'catalog-remove-failed');
    state.mesh.overview = result.overview;
    let registrationError = null;
    const removeRegistration = scope === 'slot'
      && context.slot.deviceId === context.overview.localDeviceId
      && els.removeLocalRegistration.checked;
    if (removeRegistration) {
      const localResult = await window.manager.removeProfile(context.slot.profileId);
      if (!localResult?.ok) registrationError = localResult?.reason || 'profile-remove-failed';
    }
    state.mesh.removingAgentId = null;
    state.mesh.removingSlotKey = null;
    els.removeCatalogDialog.close();
    if (removeRegistration) {
      await loadProfiles();
    } else {
      await refreshCatalogWorkspace(result.overview);
    }
    setStatus(registrationError
      ? tr('catalog.error.generic', { code: registrationError })
      : tr('catalog.status.removed'));
  } catch (error) {
    els.removeCatalogImpact.dataset.state = 'error';
    els.removeCatalogImpact.textContent = tr('catalog.error.generic', {
      code: error?.message || 'catalog-remove-failed'
    });
  } finally {
    els.confirmRemoveCatalogBtn.disabled = false;
  }
}

function openAgentRelationsDialog() {
  const agent = catalogAgentById(actionAgentId());
  if (!agent || !state.mesh.overview?.initialized) return;
  state.mesh.relationAgentId = agent.agentId;
  const bindings = state.mesh.overview.accountBindings.filter((binding) => binding.agentId === agent.agentId);
  const slots = state.mesh.overview.slots.filter((slot) => slot.agentId === agent.agentId);
  els.agentRelationsSummary.textContent = tr('catalog.relations.summary', {
    name: agent.displayName,
    bindings: bindings.length,
    slots: slots.length
  });
  els.mergeAgentTarget.value = '';
  const targets = fillAgentAssignmentSelect(els.mergeAgentTarget, null, agent.agentId);
  els.confirmMergeAgentBtn.disabled = true;
  if (!targets.length) els.mergeAgentTarget.title = tr('catalog.merge.noTarget');
  else els.mergeAgentTarget.title = '';
  els.splitAccountBinding.replaceChildren();
  appendSelectOption(els.splitAccountBinding, '', tr('catalog.assignment.choose'), { disabled: true });
  for (const binding of bindings) {
    appendSelectOption(els.splitAccountBinding, binding.accountBindingId, bindingOptionLabel(binding));
  }
  if (!bindings.length) {
    els.splitAccountBinding.options[0].textContent = tr('catalog.split.noBinding');
  }
  els.splitAccountBinding.value = '';
  els.confirmSplitBindingBtn.disabled = true;
  syncSplitAgentName();
  els.agentRelationsStatus.dataset.state = 'idle';
  els.agentRelationsStatus.textContent = tr('catalog.remove.safety');
  els.agentRelationsDialog.showModal();
}

function syncSplitAgentName() {
  const binding = catalogBindingById(els.splitAccountBinding?.value);
  if (els.splitAgentName) {
    if (binding) els.splitAgentName.value = binding.displayAlias || binding.providerNamespace || '';
    else els.splitAgentName.value = '';
  }
  syncSplitConfirmState();
}

function syncSplitConfirmState() {
  const binding = catalogBindingById(els.splitAccountBinding?.value);
  if (els.confirmSplitBindingBtn) {
    els.confirmSplitBindingBtn.disabled = !binding || !els.splitAgentName?.value.trim();
  }
}

async function confirmAgentMerge() {
  const source = catalogAgentById(state.mesh.relationAgentId);
  const target = catalogAgentById(els.mergeAgentTarget.value);
  if (!source || !target) return;
  const bindings = state.mesh.overview.accountBindings.filter((binding) => binding.agentId === source.agentId);
  const slots = state.mesh.overview.slots.filter((slot) => slot.agentId === source.agentId);
  const confirmed = window.confirm(tr('catalog.merge.prompt', {
    source: source.displayName,
    target: target.displayName,
    bindings: bindings.length,
    slots: slots.length
  }));
  if (!confirmed) return;
  els.confirmMergeAgentBtn.disabled = true;
  const result = await window.manager.mergeAgents({
    sourceAgentId: source.agentId,
    targetAgentId: target.agentId,
    baseRevision: currentCatalogRevision()
  });
  if (!result?.ok) {
    els.agentRelationsStatus.dataset.state = 'error';
    els.agentRelationsStatus.textContent = tr('catalog.error.generic', {
      code: result?.reasonCode || 'agent-merge-failed'
    });
    els.confirmMergeAgentBtn.disabled = false;
    return;
  }
  state.mesh.relationAgentId = null;
  els.agentRelationsDialog.close();
  await refreshCatalogWorkspace(result.overview, { agentId: target.agentId });
  setStatus(tr('catalog.status.merged'));
}

async function confirmBindingSplit() {
  const binding = catalogBindingById(els.splitAccountBinding.value);
  const name = els.splitAgentName.value.trim();
  if (!binding || !name) {
    els.splitAgentName.focus();
    return;
  }
  const slots = state.mesh.overview.slots.filter((slot) => slot.accountBindingId === binding.accountBindingId);
  if (!window.confirm(tr('catalog.split.prompt', {
    binding: binding.displayAlias || binding.providerNamespace,
    slots: slots.length,
    name
  }))) return;
  els.confirmSplitBindingBtn.disabled = true;
  const previousAgentIds = new Set(state.mesh.overview.agents.map((agent) => agent.agentId));
  const result = await window.manager.splitAccountBinding({
    accountBindingId: binding.accountBindingId,
    displayName: name,
    baseRevision: currentCatalogRevision()
  });
  if (!result?.ok) {
    els.agentRelationsStatus.dataset.state = 'error';
    els.agentRelationsStatus.textContent = tr('catalog.error.generic', {
      code: result?.reasonCode || 'binding-split-failed'
    });
    els.confirmSplitBindingBtn.disabled = false;
    return;
  }
  const nextBinding = result.overview.accountBindings.find((item) => item.accountBindingId === binding.accountBindingId);
  const newAgent = result.overview.agents.find((agent) => !previousAgentIds.has(agent.agentId))
    || result.overview.agents.find((agent) => agent.agentId === nextBinding?.agentId);
  state.mesh.relationAgentId = null;
  els.agentRelationsDialog.close();
  await refreshCatalogWorkspace(result.overview, { agentId: newAgent?.agentId });
  setStatus(tr('catalog.status.split'));
}

function openSlotAssignmentDialog(slot) {
  const overview = state.mesh.overview;
  if (!overview?.initialized || !slot) return;
  state.mesh.assigningSlotKey = catalogSlotKey(slot);
  const device = overview.devices.find((item) => item.deviceId === slot.deviceId);
  els.slotAssignmentSummary.textContent = tr('catalog.assign.summary', {
    device: device?.name || slot.deviceId,
    app: appLabel(slot.appId),
    label: slot.localLabel || slot.profileId,
    state: slot.assignmentState || 'pending'
  });
  els.slotAssignmentName.value = slot.localLabel || appLabel(slot.appId);
  els.slotAssignmentGroup.value = '';
  els.slotAssignmentNote.value = '';
  els.slotAssignmentMode.value = '';
  els.slotAssignmentAgent.value = '';
  els.slotAssignmentBinding.value = '';
  els.slotAssignmentStatus.dataset.state = 'idle';
  els.slotAssignmentStatus.textContent = tr('catalog.remove.safety');
  document.querySelector('#removeUnassignedSlotBtn').hidden = slot.deviceId !== overview.localDeviceId
    || !state.profiles.some(profile => profile.id === slot.profileId);
  syncSlotAssignmentControls();
  els.slotAssignmentDialog.showModal();
  els.slotAssignmentMode.focus();
}

function syncSlotAssignmentControls() {
  const slot = catalogSlotByKey(state.mesh.assigningSlotKey);
  const mode = els.slotAssignmentMode?.value || '';
  const agents = fillAgentAssignmentSelect(els.slotAssignmentAgent);
  const bindings = fillBindingAssignmentSelect(els.slotAssignmentBinding, slot?.appId);
  els.slotAssignmentAgentField.hidden = mode !== 'existing-agent';
  els.slotAssignmentBindingField.hidden = mode !== 'existing-binding';
  els.confirmSlotAssignmentBtn.disabled = !slot || !mode
    || (mode === 'existing-agent' && (!agents.length || !els.slotAssignmentAgent.value))
    || (mode === 'existing-binding' && (!bindings.length || !els.slotAssignmentBinding.value));
}

async function removeUnassignedLocalSlot() {
  const slot = catalogSlotByKey(state.mesh.assigningSlotKey);
  const overview = state.mesh.overview;
  if (!slot || slot.deviceId !== overview?.localDeviceId || slot.assignmentState === 'linked') return;
  const profile = state.profiles.find(item => item.id === slot.profileId);
  if (!profile || !window.confirm(tr('status.removeConfirm', { name: profile.name }))) return;
  const button = document.querySelector('#removeUnassignedSlotBtn');
  button.disabled = true;
  try {
    const result = await window.manager.removeProfile(profile.id);
    if (!result?.ok) {
      els.slotAssignmentStatus.dataset.state = 'error';
      els.slotAssignmentStatus.textContent = result?.reason || tr('status.removeFail');
      return;
    }
    els.slotAssignmentDialog.close();
    await loadProfiles(null, { skipDeviceOverview: true });
    await loadDeviceOverview({ silent: true });
    renderAttentionInbox();
    setStatus(tr('status.removedSlot'));
  } catch (_error) {
    els.slotAssignmentStatus.dataset.state = 'error';
    els.slotAssignmentStatus.textContent = tr('status.removeFail');
  } finally {
    button.disabled = false;
  }
}

async function confirmSlotAssignment() {
  const slot = catalogSlotByKey(state.mesh.assigningSlotKey);
  const mode = els.slotAssignmentMode.value;
  const name = els.slotAssignmentName.value.trim();
  if (!slot || !mode || !name) return;
  els.confirmSlotAssignmentBtn.disabled = true;
  const result = await window.manager.assignAgentSlot({
    deviceId: slot.deviceId,
    profileId: slot.profileId,
    mode,
    agentId: mode === 'existing-agent' ? els.slotAssignmentAgent.value : undefined,
    accountBindingId: mode === 'existing-binding' ? els.slotAssignmentBinding.value : undefined,
    displayName: name,
    displayAlias: name,
    group: els.slotAssignmentGroup.value,
    note: els.slotAssignmentNote.value,
    baseRevision: currentCatalogRevision()
  });
  if (!result?.ok) {
    els.slotAssignmentStatus.dataset.state = 'error';
    els.slotAssignmentStatus.textContent = tr('catalog.error.generic', {
      code: result?.reasonCode || 'slot-assignment-failed'
    });
    syncSlotAssignmentControls();
    return;
  }
  const assigned = result.overview.slots.find((item) => (
    item.deviceId === slot.deviceId && item.profileId === slot.profileId
  ));
  state.mesh.assigningSlotKey = null;
  els.slotAssignmentDialog.close();
  await refreshCatalogWorkspace(result.overview, {
    agentId: assigned?.agentId,
    slotKey: catalogSlotKey(assigned)
  });
  setStatus(tr('catalog.status.assigned'));
}

async function handleUpdateClick() {
  if (updateBusy) return;
  updateBusy = true;
  clearTimeout(updateButtonTimer);
  els.updateBtn.disabled = true;
  els.updateBtn.classList.remove('update-available', 'update-error');
  els.updateBtn.textContent = tr('update.btn.checking');
  els.updateBtn.title = tr('update.title.querying');
  setStatus(tr('status.checkingUpdate'));

  const result = await window.manager.checkForUpdates();
  if (!result.ok) {
    setStatus(result.reason || tr('status.checkFail'));
    finishUpdateButton(tr('update.btn.retry'), tr('update.title.checkFailRetry'), 'update-error');
    return;
  }

  state.updateInfo = result;
  renderAttentionInbox();
  if (!result.updateAvailable) {
    setStatus(tr('status.latest', { version: result.currentVersion }));
    finishUpdateButton(tr('update.btn.latest'), tr('update.title.currentVersion', { version: result.currentVersion }), '');
    return;
  }

  els.updateBtn.classList.add('update-available');
  els.updateBtn.textContent = tr('update.btn.update');
  els.updateBtn.title = tr('update.title.foundClick', { version: result.latestVersion });
  const size = result.assetSize ? tr('update.sizeSuffix', { size: formatBytes(result.assetSize) }) : '';
  const action = result.installSupported
    ? tr('update.action.auto', { asset: result.assetName || tr('update.assetFallback'), size })
    : tr('update.action.manual', { reason: result.manualReason || tr('update.manualReasonFallback') });
  const confirmed = window.confirm(
    tr('update.confirm', { latest: result.latestVersion, current: result.currentVersion, action })
  );
  if (!confirmed) {
    updateBusy = false;
    els.updateBtn.disabled = false;
    setStatus(tr('status.newVersion', { version: result.latestVersion }));
    return;
  }

  els.updateBtn.disabled = true;
  els.updateBtn.textContent = result.installSupported ? '0%' : tr('update.btn.open');
  const installed = await window.manager.installUpdate();
  if (!installed.ok) {
    setStatus(installed.reason || tr('status.updateFail'));
    finishUpdateButton(tr('update.btn.retry'), tr('update.title.updateFailRetry'), 'update-error');
    return;
  }
  if (installed.manual) {
    setStatus(installed.message || tr('status.openedRelease'));
    finishUpdateButton(tr('update.btn.opened'), tr('update.title.openedRelease'), '');
    return;
  }
  if (installed.upToDate) {
    setStatus(installed.message || tr('status.alreadyLatestShort'));
    finishUpdateButton(tr('update.btn.latest'), tr('update.title.alreadyLatest'), '');
    return;
  }
  if (installed.restarting) {
    els.updateBtn.textContent = tr('update.btn.restart');
    els.updateBtn.title = tr('update.title.restarting');
    setStatus(installed.message || tr('status.updateDoneRestart'));
  }
}

function handleUpdateProgress(progress = {}) {
  if (progress.message) setStatus(progress.message);
  if (progress.stage === 'downloading' && Number.isFinite(progress.percent)) {
    els.updateBtn.textContent = `${progress.percent}%`;
    els.updateBtn.title = tr('update.title.downloading', { percent: progress.percent });
  } else if (progress.stage === 'installing') {
    els.updateBtn.textContent = tr('update.btn.install');
    els.updateBtn.title = tr('update.title.verifyReady');
  } else if (progress.stage === 'error') {
    els.updateBtn.textContent = tr('update.btn.retry');
    els.updateBtn.classList.add('update-error');
    els.updateBtn.title = progress.message || tr('update.title.updateFail');
  }
}

function finishUpdateButton(label, title, className) {
  updateBusy = false;
  els.updateBtn.disabled = false;
  els.updateBtn.textContent = label;
  els.updateBtn.title = title;
  els.updateBtn.classList.remove('update-available', 'update-error');
  if (className) els.updateBtn.classList.add(className);
  updateButtonTimer = setTimeout(() => {
    if (state.updateInfo?.updateAvailable) {
      els.updateBtn.textContent = tr('update.btn.update');
      els.updateBtn.title = tr('update.title.foundClick', { version: state.updateInfo.latestVersion });
      els.updateBtn.classList.add('update-available');
    } else {
      els.updateBtn.textContent = tr('update.btn.recheck');
      els.updateBtn.title = tr('topbar.update.title');
      els.updateBtn.classList.remove('update-available', 'update-error');
    }
  }, 2200);
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

function setSessionView(view) {
  const next = view === 'detail' ? 'detail' : 'compact';
  if (els.sessionDisplayMenu) els.sessionDisplayMenu.open = false;
  if (next === state.sessionView) {
    renderSessionControls();
    return;
  }
  state.sessionView = next;
  persistSettings({ sessionView: next });
  renderSessionControls();
  renderSessions();
}

function renderSessionControls() {
  const all = state.ui.agentScope === 'all';
  const detail = state.sessionView === 'detail';
  els.sessionCompactBtn?.setAttribute('aria-pressed', String(!detail));
  els.sessionDetailBtn?.setAttribute('aria-pressed', String(detail));
  if (els.sessionDisplayLabel) {
    els.sessionDisplayLabel.textContent = tr(detail ? 'session.view.detail' : 'session.view.compact');
  }
  if (els.sessionTable) {
    els.sessionTable.dataset.scope = state.ui.agentScope;
    els.sessionTable.dataset.mode = state.sessionView;
  }
  if (els.sessionTitle) {
    const agent = all ? null : identityGroups().find((item) => item.key === currentAgentId());
    const lens = currentDeviceLensId() === 'all' ? '' : ` · ${selectedDeviceLensLabel()}`;
    els.sessionTitle.textContent = (agent ? tr('session.titleAgent', { name: agent.primary.name }) : tr('session.titleAll')) + lens;
    els.sessionTitle.title = els.sessionTitle.textContent;
    els.sessionTitle.removeAttribute('data-i18n');
  }
  if (els.rosterAllCard) {
    els.rosterAllCard.classList.toggle('selected', all);
    els.rosterAllCard.setAttribute('aria-pressed', String(all));
  }
}

// ── 账号额度（Beta）────────────────────────────────────
async function loadQuotas(force = false) {
  if (!window.manager.listQuotas) return null;
  if (quotaRequest) {
    if (force !== true) return quotaRequest;
    // "Refresh now" while a request is running: ask again with force once it ends.
    quotaForcedAfter ||= quotaRequest.then(() => {
      quotaForcedAfter = null;
      return loadQuotas(true);
    });
    return quotaForcedAfter;
  }

  quotaRequestedAt = Date.now();
  state.quotaError = null;
  renderQuotaSummary();
  quotaRequest = (async () => {
    try {
      const list = await window.manager.listQuotas({ force: force === true });
      if (!Array.isArray(list)) throw new Error(tr('quota.err.badFormat'));
      state.quotas = Object.fromEntries(
        list.filter((item) => item?.profileId).map((item) => [item.profileId, item])
      );
      return list;
    } catch (error) {
      state.quotaError = error?.message || tr('quota.err.queryFail');
      return null;
    } finally {
      quotaHasLoaded = true;
      quotaRequest = null;
      renderAccountHeader();
      renderAttentionInbox();
    }
  })();
  // Render once more after quotaRequest becomes truthy so the loading marker
  // appears even when a previous snapshot is still on screen.
  renderQuotaSummary();
  return quotaRequest;
}

function selectedQuota() {
  const profile = selectedProfile();
  const group = profile ? groupOfProfile(profile.id) : null;
  const evidence = trustedLocalAccountCardQuota(group, Date.now());
  if (evidence.status === 'ok') return { ...evidence.snapshot, windows: evidence.windows };
  if (evidence.status === 'not_applicable') return evidence.snapshot;
  if (evidence.status === 'conflict') return { status: 'error', windows: [], reason: tr('card.quotaConflict') };
  const snapshot = profile ? state.quotas[profile.id] : null;
  if (!snapshot || snapshot.status !== 'ok') return snapshot || null;
  return { ...snapshot, status: 'stale', windows: [], reason: tr('energy.unknown') };
}

function quotaPlanLabel(value) {
  const labels = {
    free: 'Free',
    go: 'Go',
    plus: 'Plus',
    pro: 'Pro',
    prolite: 'Pro Lite',
    team: 'Team',
    self_serve_business_usage_based: 'Business',
    business: 'Business',
    enterprise_cbp_usage_based: 'Enterprise',
    enterprise: 'Enterprise',
    edu: 'Edu',
    unknown: 'Unknown'
  };
  return value ? (labels[value] || String(value)) : '';
}

function formatQuotaReset(value, now = Date.now()) {
  const resetAt = Date.parse(value);
  if (!Number.isFinite(resetAt)) return tr('quota.reset.unknown');
  const remaining = resetAt - now;
  if (remaining <= 0) return tr('quota.reset.due');
  const minutes = Math.ceil(remaining / 60_000);
  if (minutes < 60) return tr('quota.reset.min', { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return tr('quota.reset.hm', { h: hours, m: minutes % 60 });
  const days = Math.floor(hours / 24);
  if (days < 7) return tr('quota.reset.dh', { d: days, h: hours % 24 });
  const time = new Date(resetAt).toLocaleString(dateLocale(), { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  return tr('quota.reset.at', { time });
}

function quotaHeadline(snapshot) {
  if (!snapshot || !window.YardEnergy) return tr('quota.unknown');
  const window_ = window.YardEnergy.constrainingWindow(snapshot, Date.now());
  if (!window_) return snapshot.reason || tr('quota.unknown');
  return tr('quota.headline', { label: window_.label, pct: Math.round(window_.remainingPercent) });
}

function renderQuotaMeters(snapshot) {
  els.quotaMeters.replaceChildren();
  const windows = Array.isArray(snapshot?.windows) ? snapshot.windows : [];
  if (!windows.length) return;
  const labelCounts = windows.reduce((map, item) => {
    map.set(item.label, (map.get(item.label) || 0) + 1);
    return map;
  }, new Map());

  for (const window_ of windows) {
    const remaining = Number(window_.remainingPercent);
    if (!Number.isFinite(remaining)) continue;
    const level = window.YardEnergy?.energyForRemaining(remaining) || 'unknown';
    const meter = document.createElement('div');
    meter.className = 'quota-meter';
    meter.dataset.level = level;

    const head = document.createElement('div');
    head.className = 'quota-meter-head';
    const label = document.createElement('span');
    label.className = 'quota-meter-label';
    const scope = String(window_.scope || '').trim();
    const showScope = scope && (scope.toLowerCase() !== 'codex' || labelCounts.get(window_.label) > 1);
    label.textContent = `${showScope ? `${scope} · ` : ''}${window_.label || tr('quota.window.fallback')}`;
    const value = document.createElement('span');
    value.className = 'quota-meter-value';
    value.textContent = tr('quota.remainingShort', { pct: Math.round(remaining) });
    head.append(label, value);

    const track = document.createElement('div');
    track.className = 'quota-track';
    track.setAttribute('role', 'progressbar');
    track.setAttribute('aria-label', label.textContent);
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', '100');
    track.setAttribute('aria-valuenow', String(Math.round(remaining)));
    const fill = document.createElement('div');
    fill.className = 'quota-fill';
    fill.style.width = `${Math.max(0, Math.min(100, remaining))}%`;
    track.append(fill);

    const foot = document.createElement('div');
    foot.className = 'quota-meter-foot';
    foot.textContent = formatQuotaReset(window_.resetsAt);
    meter.title = tr('quota.meter.title', { label: label.textContent, used: Math.round(window_.usedPercent), reset: foot.textContent });
    meter.append(head, track, foot);
    els.quotaMeters.append(meter);
  }
}

function toggleQuotaPopover(anchor) {
  if (state.quotaAnchor === anchor) {
    els.quotaPopover.hidePopover();
  } else {
    openQuotaPopover(anchor);
  }
}

function openQuotaPopover(anchor) {
  if (!anchor || anchor.disabled || anchor.hidden) return;
  els.quotaPopover.hidePopover();
  if (state.ui.workspaceMode === 'remote') setWorkspaceMode('sessions');
  state.quotaAnchor = anchor;
  renderQuotaSummary();
  if (anchor.hidden || (anchor !== els.quotaChipAll && els.quotaSummary.hidden)) {
    state.quotaAnchor = null;
    return;
  }
  anchor.focus({ preventScroll: true });
  els.quotaPopover.showPopover({ source: anchor });
  anchor.setAttribute('aria-expanded', 'true');
  positionQuotaPopover();
}

function positionQuotaPopover() {
  const { quotaAnchor: anchor } = state;
  const popup = els.quotaPopover;
  if (!anchor || !popup.matches(':popover-open')) return;
  const gap = 6;
  const inset = 12;
  const rect = anchor.getBoundingClientRect();
  const roster = els.accountRoster.getBoundingClientRect();
  if (!rect.width || (anchor !== els.quotaChipAll && (rect.right <= roster.left || rect.left >= roster.right))) {
    popup.hidePopover();
    return;
  }

  const below = window.innerHeight - rect.bottom - gap - inset;
  const above = rect.top - gap - inset;
  const openBelow = below >= above;
  popup.style.maxHeight = `${Math.max(below, above)}px`;
  const width = popup.offsetWidth;
  const left = anchor === els.quotaChipAll ? rect.right - width : Math.max(rect.left, roster.left);
  popup.style.left = `${Math.max(inset, Math.min(left, window.innerWidth - width - inset))}px`;
  popup.style.top = `${openBelow ? rect.bottom + gap : rect.top - gap - popup.offsetHeight}px`;
}

function renderQuotaSummary() {
  renderQuotaOverview();
  const profile = selectedProfile();
  const { quotaAnchor: anchor } = state;
  els.quotaSummary.hidden = !profile || !anchor || anchor !== accountCardControl(actionAgentId(), '.account-card-quota-summary') || anchor.disabled;
  if (els.quotaSummary.hidden) {
    if (anchor && anchor !== els.quotaChipAll) els.quotaPopover.hidePopover();
    return;
  }
  const name = groupOfProfile(profile.id)?.primary.name || profile.name;
  els.quotaPopoverTitle.textContent = tr('quota.accountTitle', { name });
  renderAccountQuota();
  positionQuotaPopover();
}

function renderAccountQuota() {
  const snapshot = selectedQuota();
  const loading = Boolean(quotaRequest);
  els.quotaRefreshBtn.disabled = loading;
  els.quotaSummary.classList.toggle('is-loading', loading);
  const refreshFailed = Boolean(state.quotaError) && snapshot?.status === 'ok';
  els.quotaSummary.dataset.status = refreshFailed ? 'stale' : (snapshot?.status || (loading ? 'loading' : 'unknown'));
  els.quotaSummary.dataset.energy = 'unknown';
  els.quotaPlan.textContent = quotaPlanLabel(snapshot?.planType);
  els.quotaMeters.replaceChildren();

  if (!snapshot) {
    els.quotaStateBadge.textContent = loading ? tr('quota.badge.querying') : (state.quotaError ? tr('quota.badge.readFail') : tr('quota.waiting'));
    els.quotaMessage.textContent = loading
      ? tr('quota.msg.loading')
      : (state.quotaError || tr('quota.msg.idle'));
    els.quotaSummary.title = els.quotaMessage.textContent;
    return;
  }

  const statusLabels = {
    unsupported: tr(snapshot.reasonCode === 'api-key-auth' ? 'quota.status.notApplicable' : 'quota.status.unsupported'),
    signed_out: tr('quota.status.signed_out'),
    stale: tr('quota.status.stale'),
    error: tr('quota.status.error')
  };
  if (refreshFailed) {
    els.quotaStateBadge.textContent = tr('quota.badge.lastData');
    renderQuotaMeters(snapshot);
    els.quotaMessage.textContent = tr('quota.msg.refreshFailKeep', { err: state.quotaError });
  } else if (snapshot.status === 'ok') {
    const energy = window.YardEnergy ? window.YardEnergy.deriveEnergy(snapshot, Date.now()) : 'unknown';
    const meta = window.YardEnergy?.ENERGY_META?.[energy];
    els.quotaSummary.dataset.energy = energy;
    const energyLabel = meta ? tr('energy.' + energy) : tr('quota.available');
    els.quotaStateBadge.textContent = loading ? `${energyLabel} · ${tr('quota.suffix.refreshing')}` : energyLabel;
    renderQuotaMeters(snapshot);
    const extras = [];
    if (snapshot.credits?.unlimited) extras.push(tr('quota.credits.unlimited'));
    else if (snapshot.credits?.hasCredits && snapshot.credits?.balance !== null && snapshot.credits?.balance !== undefined) {
      extras.push(tr('quota.credits.balance', { n: snapshot.credits.balance }));
    }
    extras.push(tr('quota.credits.live'));
    els.quotaMessage.textContent = extras.join(' · ');
  } else {
    const statusLabel = statusLabels[snapshot.status] || tr('quota.unknown');
    els.quotaStateBadge.textContent = loading
      ? `${statusLabel} · ${tr('quota.suffix.refreshing')}`
      : statusLabel;
    if (snapshot.status === 'stale') renderQuotaMeters(snapshot);
    els.quotaMessage.textContent = snapshot.reason || tr('quota.msg.noData');
  }
  els.quotaSummary.title = snapshot.reason || `${quotaPlanLabel(snapshot.planType)} ${quotaHeadline(snapshot)}`.trim();
}

function renderQuotaOverview() {
  // 总览按「账号」而不是槽位：同一登录身份的多个槽位只出一行，
  // 行代表取组内有真实额度快照的那个（额度只在部分客户端有官方 API）。
  const groups = identityGroups();
  const rows = window.QuotaOverview?.buildTrustedQuotaOverview(groups, state.quotas, Date.now(), {
    quotaError: state.quotaError,
    reasonFor: (evidence) => tr(evidence.status === 'conflict' ? 'card.quotaConflict'
      : (evidence.status === 'not_applicable' ? 'quota.status.notApplicable' : 'energy.unknown'))
  }) || [];

  renderQuotaOverviewButton(groups, rows);
  els.quotaOverview.hidden = state.quotaAnchor !== els.quotaChipAll || groups.length < 2;
  if (els.quotaOverview.hidden) return;
  els.quotaPopoverTitle.textContent = tr('quotaMap.title');
  const withQuota = rows.filter((row) => row.hasQuota).length;
  if (els.quotaOverviewMeta) {
    els.quotaOverviewMeta.textContent = withQuota
      ? tr('quota.overview.withQuota', { a: withQuota, b: rows.length })
      : tr('quota.overview.count', { n: rows.length });
  }

  els.quotaOverviewList.replaceChildren();
  const unsupported = [];
  for (const row of rows) {
    if (row.status === 'unsupported') {
      unsupported.push(row);
      continue; // 折叠到尾部一行，不再一账号一行灰字刷屏
    }
    const item = document.createElement('li');
    item.className = 'quota-overview-item';
    item.dataset.status = row.status;

    const name = document.createElement('span');
    name.className = 'quota-overview-name';
    name.textContent = row.name;

    const value = document.createElement('span');
    value.className = 'quota-overview-value';
    if (row.hasQuota) {
      const level = window.YardEnergy?.energyForRemaining(row.tightest.remainingPercent) || 'unknown';
      item.dataset.level = level;
      value.textContent = tr('quota.overview.value', { label: row.tightest.label, pct: Math.round(row.tightest.remainingPercent) });
      item.title = `${row.name} · ${formatQuotaReset(row.tightest.resetsAt)}`;
    } else {
      value.textContent = row.status === 'loading' ? tr('quota.overview.querying') : (row.reason || tr('quota.overview.noData'));
      item.title = row.reason || value.textContent;
    }

    item.append(name, value);
    els.quotaOverviewList.append(item);
  }

  if (unsupported.length) {
    const rest = document.createElement('li');
    rest.className = 'quota-overview-rest';
    rest.textContent = tr('quota.overview.rest', { n: unsupported.length });
    rest.title = unsupported.map((row) => row.name).join('、');
    els.quotaOverviewList.append(rest);
  }
  positionQuotaPopover();
}

function renderQuotaOverviewButton(groups, rows) {
  const known = rows.filter((row) => row.hasQuota);
  const allRow = known.length
    ? known.reduce((a, b) => (a.tightest.remainingPercent <= b.tightest.remainingPercent ? a : b))
    : null;
  const chip = els.quotaChipAll;
  const value = chip.querySelector('b');
  const hint = tr('quota.chip.allHint');
  if (allRow) {
    const pct = Math.max(0, Math.min(100, Math.round(allRow.tightest.remainingPercent)));
    value.textContent = tr('quotaMap.minimum', { pct });
    chip.title = tr('quota.chip.title', {
      prefix: tr('quota.chip.allPrefix', { name: allRow.name }),
      label: allRow.tightest.label, pct, hint
    });
  } else {
    value.textContent = quotaRequest ? '…' : '—';
    chip.title = tr('quota.chip.hintOnly', { reason: tr(quotaRequest ? 'quota.chip.querying' : 'quota.chip.noData'), hint });
  }
  chip.hidden = groups.length < 2;
  if (chip.hidden && state.quotaAnchor === chip) els.quotaPopover.hidePopover();
}

function applySessionFilter() {
  const query = state.query;
  const searched = query
    ? withHubRuns(state.sessions).filter((session) => {
        return [
          session.title,
          session.id,
          session.address,
          session.projectPath,
          session.filePath,
          session.source,
          session.status,
          session.model,
          session._accountName,
          session._profileName,
          session._appLabel,
          session._deviceName,
          session._hubRun?.title,
          session._hubRun?.from,
          session._hubRun?.target?.name
        ].filter(Boolean).some((value) => String(value).toLowerCase().includes(query));
      })
    : [...withHubRuns(state.sessions)];
  // 标签与“新回复”筛选和搜索框同一处生效：只决定哪些行显示，不碰正在看的和已勾选的。
  const filtered = sessionMarks.filter(searched);
  const sorted = window.SessionTable
    ? window.SessionTable.sort(filtered, state.sessionSort, dateLocale())
    : filtered;
  state.filteredSessions = sessionMarks.order(sorted);
  sessionMarks.renderFilters(withHubRuns(state.sessions), { query: Boolean(query) });

  renderSessionControls();
  renderSessions();
}

// ── 猫咪档案卡（编辑对话框换装） ─────────────────────
// 只有三项：毛色（分三组）、项圈颜色、一件配饰。左边的预览按批准的动作逐帧在动。
let catDraft = { look: 'orange', collar: '#c94f2e', accessory: 'none' };
let catBase = null;
let editingProfile = null;
let catSwatchesBuilt = false;

// 没有自己外观的猫，显示规则和卡片一样：橘猫配默认的红项圈。
function catAppearanceOf(cat, seed) {
  if (!cat || typeof cat !== 'object') return { look: 'orange', accessory: 'none', collar: '#c94f2e' };
  return window.YardCats.resolveCat(cat, seed);
}

function openCatCustomizer(profile) {
  if (!window.YardCats || !window.PixelCats) return;
  editingProfile = profile;
  catBase = profile.cat && typeof profile.cat === 'object' ? profile.cat : null;
  catDraft = catAppearanceOf(profile.cat, profile.id);
  if (!catSwatchesBuilt) { buildCatSwatches(); catSwatchesBuilt = true; }
  syncCatSwatches();
  renderCatPreview();
}

function storedCatDraft() {
  return { coat: null, wear: null, ...window.YardCats.storeCat(catDraft, catBase) };
}

function catLookName(look) {
  return tr('cat.breed.' + look);
}

// 这种毛色能配的项圈：它自带的项圈色排第一，其后是通用的几种。
function catCollarChoices(look) {
  const own = window.CatArt?.LOOKS?.[look]?.collar || null;
  const choices = window.YardCats.COLLAR_CHOICES.slice();
  return own && !choices.includes(own) ? [own, ...choices] : choices;
}

function catTile(label, draw) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'cc-tile';
  button.setAttribute('role', 'radio');
  button.setAttribute('aria-label', label);
  button.title = label;
  // 坐着的那一帧在 18 行里放得下每一顶帽子，小样不用多留头顶的空
  const canvas = document.createElement('canvas');
  canvas.width = 40;
  canvas.height = 36;
  button.append(canvas);
  button._draw = () => draw(canvas);
  return button;
}

// 单选组：方向键在组里移动并选中，Tab 只停在选中的那一个。
function bindCatRadioKeys(group) {
  group.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    const items = [...group.querySelectorAll('[role="radio"]')];
    const index = items.indexOf(document.activeElement);
    if (index < 0) return;
    event.preventDefault();
    const step = ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1;
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + step + items.length) % items.length;
    items[next].click();
    items[next].focus();
  });
}

function buildCatSwatches() {
  const cats = window.YardCats;
  els.editBreedSwatches.replaceChildren();
  for (const groupId of cats.LOOK_GROUPS) {
    const looks = cats.LOOK_KEYS.filter((look) => cats.lookGroup(look) === groupId);
    if (!looks.length) continue;
    const title = document.createElement('span');
    title.className = 'cc-subtitle';
    title.dataset.catGroup = groupId;
    title.textContent = tr('cat.group.' + groupId);
    const block = document.createElement('div');
    block.className = 'cc-look-group';
    const row = document.createElement('div');
    row.className = 'cc-swatches';
    for (const look of looks) {
      const tile = catTile(catLookName(look), (canvas) => window.PixelCats.drawStill(canvas, {
        look, accessory: window.CatArt.LOOKS[look].accessory || 'none', action: 'onduty', frame: 5, scale: 2, headroom: 0
      }));
      tile.dataset.look = look;
      tile._pressed = () => catDraft.look === look;
      tile.addEventListener('click', () => pickCatLook(look));
      row.append(tile);
    }
    block.append(title, row);
    els.editBreedSwatches.append(block);
  }
  for (const id of cats.ACCESSORY_KEYS) {
    const tile = catTile(tr('cat.acc.' + id), (canvas) => window.PixelCats.drawStill(canvas, {
      look: catDraft.look, accessory: id, collar: catDraft.collar, action: 'onduty', frame: 5, scale: 2, headroom: 0
    }));
    tile.dataset.accessory = id;
    tile._pressed = () => catDraft.accessory === id;
    tile.addEventListener('click', () => { catDraft = { ...catDraft, accessory: id }; syncCatSwatches(); renderCatPreview(); });
    els.editAccSwatches.append(tile);
  }
  [els.editBreedSwatches, els.editCollarSwatches, els.editAccSwatches].forEach(bindCatRadioKeys);
}

function pickCatLook(look) {
  const data = window.CatArt.LOOKS[look] || {};
  const previousOwn = window.CatArt.LOOKS[catDraft.look]?.collar || null;
  let collar = catDraft.collar;
  if (data.collar) collar = data.collar;
  else if (collar === previousOwn && !window.YardCats.COLLAR_CHOICES.includes(collar)) {
    collar = window.YardCats.defaultCatFor(editingProfile?.id || '').collar;
  }
  const accessory = catDraft.accessory === 'none' && data.accessory ? data.accessory : catDraft.accessory;
  catDraft = { look, collar, accessory };
  syncCatSwatches();
  renderCatPreview();
}

function renderCatCollars() {
  const choices = catCollarChoices(catDraft.look);
  const own = window.CatArt?.LOOKS?.[catDraft.look]?.collar || null;
  const signature = choices.join('|');
  if (els.editCollarSwatches.dataset.choices !== signature) {
    els.editCollarSwatches.dataset.choices = signature;
    els.editCollarSwatches.replaceChildren(...choices.map((color) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'cc-collar';
      button.setAttribute('role', 'radio');
      const known = color === own ? tr('cat.collar.own') : tr('cat.collar.' + color);
      button.setAttribute('aria-label', known);
      button.title = known;
      const dot = document.createElement('i');
      dot.style.background = color;
      button.append(dot);
      button._pressed = () => catDraft.collar === color;
      button.addEventListener('click', () => { catDraft = { ...catDraft, collar: color }; syncCatSwatches(); renderCatPreview(); });
      return button;
    }));
  }
}

function syncCatSwatches() {
  if (!window.YardCats) return;
  renderCatCollars();
  els.editDialog.querySelectorAll('.cc-tile, .cc-collar').forEach((button) => {
    const pressed = Boolean(button._pressed && button._pressed());
    button.setAttribute('aria-checked', String(pressed));
    button.tabIndex = pressed ? 0 : -1;
  });
  // 配饰的小样戴在当前这只猫身上；毛色的小样画一次就够
  els.editAccSwatches.querySelectorAll('.cc-tile').forEach((button) => button._draw && button._draw());
  els.editBreedSwatches.querySelectorAll('.cc-tile').forEach((button) => {
    if (!button._drawn) { button._draw(); button._drawn = true; }
  });
  if (els.editCatLookName) els.editCatLookName.textContent = catLookName(catDraft.look);
  if (els.editCatLookNote) {
    const key = 'cat.note.' + catDraft.look;
    const note = tr(key);
    els.editCatLookNote.textContent = note === key ? '' : note;
  }
}

function renderCatPreview() {
  if (!window.PixelCats) return;
  window.PixelCats.show(els.editCatCanvas, { ...catDraft, action: 'onduty', scale: 6, seed: 'editor' });
}

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

// ── Personal Agent Mesh / 设备中心 ──────────────────
let remoteSurfaceLayoutFrame = null;
let remoteSurfaceObserver = null;
let deviceJourneyPollTimer = null;
let deviceJourneyPollPromise = null;
const DETAIL_MODES = new Set(['session', 'remote']);
const childDialogReturnFocus = new WeakMap();
const childDialogFocusBound = new WeakSet();

function captureChildDialogReturnFocus(trigger = document.activeElement) {
  if (!(trigger instanceof HTMLElement)) return null;
  // 触发控件在菜单或折叠区里时，返回时把它重新展开，焦点才能回到触发控件本身。
  const disclosure = trigger.closest('details');
  return {
    element: trigger,
    disclosure,
    disclosureWasOpen: disclosure?.open === true
  };
}

function openChildDialog(dialog, trigger = document.activeElement) {
  if (!dialog || dialog.open) return;
  const focusContext = trigger?.element instanceof HTMLElement
    ? trigger
    : captureChildDialogReturnFocus(trigger);
  if (focusContext) childDialogReturnFocus.set(dialog, focusContext);
  if (!childDialogFocusBound.has(dialog)) {
    childDialogFocusBound.add(dialog);
    dialog.addEventListener('close', () => {
      const focusContext = childDialogReturnFocus.get(dialog);
      childDialogReturnFocus.delete(dialog);
      requestAnimationFrame(() => {
        const returnFocus = focusContext?.element;
        if (!(returnFocus instanceof HTMLElement) || !returnFocus.isConnected || returnFocus.matches(':disabled')) return;
        const ownerDialog = returnFocus.closest('dialog');
        if (ownerDialog && !ownerDialog.open) return;
        const topDialog = document.querySelector('dialog:modal');
        if (topDialog && !topDialog.contains(returnFocus)) return;
        if (focusContext.disclosureWasOpen && focusContext.disclosure && !focusContext.disclosure.open) {
          focusContext.disclosure.open = true;
        }
        utilityDialogFocusTarget(returnFocus).focus({ preventScroll: true });
      });
    });
  }
  dialog.showModal();
}

function utilityDialogEntries() {
  return [
    ['devices', els.deviceCenterBtn, els.deviceCenterDialog],
    ['system', els.systemBtn, els.systemDialog],
    ['activity', els.activityCenterBtn, els.activityCenterDialog]
  ];
}

function closeUtilityDialogs(exceptDialog = null) {
  for (const [kind, button, dialog] of utilityDialogEntries()) {
    if (!dialog || dialog === exceptDialog) continue;
    if (dialog.open) dialog.close();
    button?.setAttribute('aria-expanded', 'false');
    if (state.utilityDialog === kind) state.utilityDialog = null;
  }
}

function closeUtilityDialog(dialog, { restoreFocus = true } = {}) {
  if (!dialog) return;
  const entry = utilityDialogEntries().find(([, , candidate]) => candidate === dialog);
  let returnFocus = null;
  if (entry) {
    const [kind, button] = entry;
    returnFocus = button;
    button?.setAttribute('aria-expanded', 'false');
    if (state.utilityDialog === kind) state.utilityDialog = null;
  }
  if (dialog.open) dialog.close();
  if (returnFocus && restoreFocus) {
    requestAnimationFrame(() => {
      if (!document.querySelector('dialog:modal')) utilityDialogFocusTarget(returnFocus)?.focus({ preventScroll: true });
    });
  }
}

// 入口收在菜单里时（系统、设备视角），菜单关着就把焦点还给菜单的开关。
function utilityDialogFocusTarget(button) {
  const menu = button?.closest('details.context-menu');
  return menu && !menu.open ? menu.querySelector('summary') : button;
}

function openUtilityDialog(kind) {
  const entry = utilityDialogEntries().find(([name]) => name === kind);
  if (!entry) return;
  const [, button, dialog] = entry;
  if (!dialog) return;
  closeUtilityDialogs(dialog);
  state.utilityDialog = kind;
  button?.setAttribute('aria-expanded', 'true');
  if (!dialog.open) dialog.showModal();
}

function mountWorkspaceSurfaces() {
  if (!els.mainGrid) return;
  if (els.remoteWorkspaceHost && typeof ResizeObserver === 'function') {
    remoteSurfaceObserver = new ResizeObserver(() => scheduleRemoteSurfaceLayout());
    remoteSurfaceObserver.observe(els.remoteWorkspaceHost);
  }
  window.addEventListener('resize', scheduleRemoteSurfaceLayout);
  setWorkspaceMode('sessions');
}

function setDetailMode(mode) {
  const next = DETAIL_MODES.has(mode) ? mode : 'session';
  state.detailMode = next;
  if (els.mainGrid) els.mainGrid.dataset.detail = next;
  if (els.detailPanel) {
    els.detailPanel.dataset.detail = next;
    els.detailPanel.hidden = next === 'session';
  }
  if (els.remoteWorkspaceHost) els.remoteWorkspaceHost.hidden = next !== 'remote';

  if (next === 'remote') {
    els.quotaPopover.hidePopover();
    scheduleRemoteSurfaceLayout();
  }
}

function setWorkspaceMode(mode, options = {}) {
  const requested = mode === 'sessions' ? 'session' : mode;
  const detail = DETAIL_MODES.has(requested) ? requested : 'session';
  const next = detail === 'remote' ? 'remote' : 'sessions';
  const wasRemote = state.ui.workspaceMode === 'remote';
  if (detail === 'remote' && !wasRemote) state.detailBeforeRemote = state.detailMode || 'session';
  if (detail === 'remote') closeUtilityDialogs();
  state.ui = window.UiContext.setWorkspace(state.ui, next);
  if (els.mainGrid) els.mainGrid.dataset.workspace = next;
  setDetailMode(detail);

  if (next === 'remote') scheduleRemoteSurfaceLayout();
  else if (wasRemote && options.remoteAlreadyReleased !== true) {
    // Main releases every pressed key and downgrades control before hiding the
    // isolated surface. Hiding the view directly is not a safe "back" action.
    if (window.manager.returnRemoteControl) {
      void window.manager.returnRemoteControl(state.ui.activeRemoteSessionId);
    }
  }
  renderRemoteActivity();
  renderTopbarContext();
}

function renderRemoteActivity() {
  if (!els.remoteActivityBtn) return;
  const sessions = activeOutgoingRemoteSessions();
  const background = state.ui.workspaceMode !== 'remote' && sessions.length > 0;
  els.remoteActivityBtn.hidden = !background;
  if (!background) {
    els.remoteActivityBtn.textContent = '';
    els.remoteActivityBtn.removeAttribute('title');
    els.remoteActivityBtn.removeAttribute('aria-label');
    return;
  }
  const active = sessions.find((item) => item.sessionId === state.ui.activeRemoteSessionId) || sessions[0];
  els.remoteActivityBtn.textContent = tr('remote.background.button', { n: sessions.length });
  els.remoteActivityBtn.title = tr('remote.background.hint', {
    name: active?.deviceName || '-',
    n: sessions.length
  });
  els.remoteActivityBtn.setAttribute('aria-label', els.remoteActivityBtn.title);
  els.remoteActivityBtn.dataset.state = sessions.some((item) => item.state === 'error' || item.state === 'rejected')
    ? 'error'
    : 'viewing';
}

function scheduleRemoteSurfaceLayout() {
  if (remoteSurfaceLayoutFrame) cancelAnimationFrame(remoteSurfaceLayoutFrame);
  remoteSurfaceLayoutFrame = requestAnimationFrame(() => {
    remoteSurfaceLayoutFrame = null;
    void syncRemoteSurfaceLayout();
  });
}

async function syncRemoteSurfaceLayout() {
  if (!els.remoteWorkspaceHost || !window.manager.setRemoteControlSurface || state.ui.workspaceMode !== 'remote') return;
  const rect = els.remoteWorkspaceHost.getBoundingClientRect();
  if (rect.width < 320 || rect.height < 160) return;
  const x = Math.max(0, Math.floor(rect.left));
  const y = Math.max(0, Math.floor(rect.top));
  const result = await window.manager.setRemoteControlSurface({
    visible: true,
    bounds: {
      x,
      y,
      width: Math.max(0, Math.floor(rect.right) - x),
      height: Math.max(0, Math.floor(rect.bottom) - y)
    }
  });
  if (!result?.ok) {
    state.mesh.errorCode = result?.reasonCode || 'remote-surface-failed';
    setStatus(meshErrorText(state.mesh.errorCode));
  }
}

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

// 标签打给谁：这一行已勾选时打给所有勾选的，否则只打这一行（与“复制会话信息”的范围一致）。
function markTargets(session) {
  const key = sessionKey(session);
  if (key && state.ui.checkedConversationIds.has(key)) {
    return withHubRuns(state.sessions)
      .filter((item) => state.ui.checkedConversationIds.has(sessionKey(item)))
      .map((item) => window.SessionTable.markKeyOf(item))
      .filter(Boolean);
  }
  const markKey = window.SessionTable.markKeyOf(session);
  return markKey ? [markKey] : [];
}

function checkedMarkKeys() {
  return withHubRuns(state.sessions)
    .filter((item) => state.ui.checkedConversationIds.has(sessionKey(item)))
    .map((item) => window.SessionTable.markKeyOf(item))
    .filter(Boolean);
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

function deploymentStateLabel(value) {
  const stateName = String(value || 'absent');
  return tr(`deployment.state.${stateName}`);
}

function renderAccounts() {
  populateGroupDatalist();
  renderAccountRoster();
  renderTopbarContext();
  renderAttentionInbox();
}

let rosterController = null;
let lastRevealedAgent = null;

function orderedAgentGroups() {
  const groups = identityGroups();
  const order = window.RosterInteractions.normalizeOrder(state.agentOrder, groups.map(group => group.key));
  const byId = new Map(groups.map(group => [group.key, group]));
  return order.map(id => byId.get(id));
}

function ensureRosterInteractions() {
  if (rosterController || !window.RosterInteractions) return;
  rosterController = window.RosterInteractions.attach(els.accountRoster, {
    onReorder(ids, detail) {
      state.agentOrder = [...ids, ...state.agentOrder.filter(id => !ids.includes(id))];
      persistSettings({ agentOrder: state.agentOrder });
      document.querySelector('#rosterAnnouncement').textContent = tr('roster.moved', { n: detail.position, total: detail.total });
    },
    onEnd() { renderAccountRoster(); }
  });
}

// 空台面：一只趴着的猫、一句说明和唯一的主按钮。已经在台面上时不重画，免得打断待机动作。
function renderRosterEmptyState() {
  const titleText = tr('roster.empty.title');
  const current = els.accountRoster.querySelector('.account-roster-empty b');
  if (current?.textContent === titleText) return;
  const empty = document.createElement('div');
  empty.className = 'account-roster-empty';
  const seat = document.createElement('span');
  seat.className = 'account-roster-empty-seat';
  seat.setAttribute('aria-hidden', 'true');
  const pit = document.createElement('span');
  pit.className = 'account-card-pit';
  const cat = document.createElement('span');
  cat.className = 'account-card-cat fx-idle';
  const canvas = document.createElement('canvas');
  canvas.className = 'account-card-avatar';
  canvas.width = 80;
  canvas.height = 80;
  cat.append(canvas);
  pit.append(cat);
  const ledge = document.createElement('i');
  ledge.className = 'account-card-ledge';
  seat.append(pit, ledge);
  const body = document.createElement('div');
  const title = document.createElement('b');
  title.textContent = titleText;
  const lead = document.createElement('p');
  lead.textContent = tr('roster.empty.lead');
  const recruit = document.createElement('button');
  recruit.type = 'button';
  recruit.className = 'primary';
  const icon = document.createElement('i');
  icon.className = 'pxi';
  icon.dataset.i = 'plus';
  icon.setAttribute('aria-hidden', 'true');
  const label = document.createElement('span');
  label.textContent = tr('roster.recruitFirst');
  recruit.append(icon, label);
  recruit.addEventListener('click', () => els.addProfileBtn.click());
  body.append(title, lead, recruit);
  empty.append(seat, body);
  els.accountRoster.replaceChildren(empty);
  window.PixelUi?.setCat(canvas, { look: 'orange', accessory: 'none', collar: '#2f9e8f', action: 'rest', seed: 'empty-desk' });
  // 页脚还停在默认的“就绪”时，换成一句能照着做的话。
  if (els.statusText?.dataset.i18n === 'status.ready') setStatus(tr('roster.empty.status'));
}

function renderAccountRoster() {
  if (!els.accountRoster || rosterController?.isInteracting()) return;
  ensureRosterInteractions();
  const scrollLeft = els.accountRoster.scrollLeft;
  const groups = orderedAgentGroups();
  if (els.presenterCount) els.presenterCount.textContent = `×${groups.length}`;
  renderRosterAllCard(groups.length);
  if (!groups.length) {
    renderRosterEmptyState();
    return;
  }

  const cards = new Map([...els.accountRoster.children].map((card) => [card.dataset.agentId, card]));
  const now = Date.now();
  const orderedCards = groups.map((group) => {
    const card = cards.get(group.key) || createAccountCard(group.key);
    cards.delete(group.key);
    updateAccountCard(card, group, now);
    return card;
  });
  for (const card of cards.values()) card.remove();
  for (const [index, card] of orderedCards.entries()) {
    // Polling updates the labels in place so an open selector and keyboard focus survive.
    const current = els.accountRoster.children[index];
    if (current !== card) els.accountRoster.insertBefore(card, current || null);
  }
  els.accountRoster.scrollLeft = scrollLeft;
  renderHubLinks();
  if (lastRevealedAgent !== currentAgentId()) {
    lastRevealedAgent = currentAgentId();
    revealSelectedAccountCard();
  }
  positionQuotaPopover();
}

function revealSelectedAccountCard() {
  if (!els.accountRoster) return;
  const selected = els.accountRoster.querySelector('.account-card.selected');
  if (!selected) return;
  // Keep the roster itself as the explicit horizontal owner. Chromium's
  // scrollIntoView can choose the presenter's overflow:hidden box in this
  // nested layout and leave a persisted/right-side selection clipped.
  const rosterRect = els.accountRoster.getBoundingClientRect();
  const selectedRect = selected.getBoundingClientRect();
  const style = getComputedStyle(els.accountRoster);
  const inlineInset = Number.parseFloat(style.scrollPaddingInlineStart) || 0;
  const visibleLeft = rosterRect.left + inlineInset;
  const visibleRight = rosterRect.right - inlineInset;
  if (selectedRect.left < visibleLeft) {
    els.accountRoster.scrollLeft = Math.max(0, els.accountRoster.scrollLeft - (visibleLeft - selectedRect.left));
  } else if (selectedRect.right > visibleRight) {
    const maxScrollLeft = Math.max(0, els.accountRoster.scrollWidth - els.accountRoster.clientWidth);
    els.accountRoster.scrollLeft = Math.min(
      maxScrollLeft,
      els.accountRoster.scrollLeft + (selectedRect.right - visibleRight)
    );
  }
}

function accountCardQuotaSource(member) {
  const parts = [
    member?._accountBindingAlias || (!member?._meshAgentId ? member?.name : null),
    member?._meshDeviceName,
    member?.appId ? appLabel(member.appId) : null
  ].filter(Boolean);
  return [...new Set(parts)].join(' / ') || String(member?.id || '-');
}

function trustedLocalAccountCardQuota(group, now) {
  if (!window.QuotaOverview?.selectTrustedAccountQuota) {
    return { status: 'unknown', reason: 'quota-helper-unavailable' };
  }
  return window.QuotaOverview.selectTrustedAccountQuota(group, state.quotas, now, {
    quotaError: state.quotaError,
    maxAgeMs: window.AgentDeskTimeWindows.QUOTA_FRESH_MS
  });
}

function selectedCardControl(selector) {
  return els.accountRoster.querySelector(`.account-card.selected ${selector}`);
}

// 一张卡片上动作的落点：正在看的那只用明确选定的运行位置，
// 其他的用这个设备视角下记住的位置，没有记录时用卡片上显示的首选位置。
function cardActionProfile(group) {
  if (!group) return null;
  return group.key === currentAgentId() ? selectedGroupProfile(group) : preferredGroupSlot(group);
}

function accountCardControl(agentId, selector) {
  const card = [...els.accountRoster.children].find((item) => item.dataset.agentId === agentId);
  return card?.querySelector(selector) || null;
}

function createAccountCard(agentId) {
  const card = els.accountCardTemplate.content.firstElementChild.cloneNode(true);
  card.dataset.agentId = agentId;
  card.addEventListener('click', (event) => {
    if (!event.target.closest('[data-roster-control]')) void pickRosterAgent(agentId);
  });
  card.querySelector('.account-card-launch').addEventListener('click', async () => {
    // 打开不选中这只猫：正在看的列表、范围和其他猫的选择都保持原样。
    window.PixelUi?.launchStart(agentId);
    let result = null;
    try {
      result = await openAgent(agentId);
    } finally {
      const outcome = launchOutcome(result);
      window.PixelUi?.launchEnd(agentId, outcome, tr(outcome === 'ok' ? 'fx.started' : 'fx.waiting'));
    }
  });
  card.querySelector('.account-card-manage').addEventListener('click', () => {
    openAgentDossier(agentId);
  });
  // 信封：看这只猫的会话，并只看有新回复的那些。
  card.querySelector('.account-card-mail').addEventListener('click', async () => {
    sessionMarks.clearFilters();
    sessionMarks.showFresh();
    await pickRosterAgent(agentId);
    applySessionFilter();
  });
  card.querySelector('select').addEventListener('change', (event) => {
    changeAccountCardRuntime(agentId, event.target.value);
  });
  card.querySelector('.account-card-quota-summary').addEventListener('click', (event) => {
    event.preventDefault();
    const anchor = event.currentTarget;
    if (state.quotaAnchor !== anchor) {
      els.quotaPopover.hidePopover();
      setActionAgent(agentId);
    }
    toggleQuotaPopover(anchor);
  });
  return card;
}

function changeAccountCardRuntime(agentId, value) {
  const group = identityGroups().find((item) => item.key === agentId);
  if (!group || !value) return;
  if (value.startsWith('prepare:')) {
    if (group.members.length) return;
    const [, appId, clientForm = 'desktop'] = value.split(':');
    const action = currentAgentActionContext(group, null);
    rememberProvisioningChoice(group, action.deviceId, appId, clientForm);
    renderAccountHeader();
    return;
  }
  const member = group.members.find((item) => item.id === value);
  if (!member) return;
  // 换运行位置只记在这只猫身上，不选中它，正在看的列表不变。
  updateUi(window.UiContext.setAgentSlot(state.ui, group.key, member._meshSlotKey || member.id));
  persistUiSelectionMemory();
  renderAccounts();
  renderAccountHeader();
}

const READINESS_BADGE = {
  absent: 'plus', planning: 'dots', preparing: 'dots', verifying: 'dots',
  'waiting-install': 'dl', 'waiting-login': 'key', error: 'bang',
  unsupported: 'ban', offline: 'cloud', retired: 'ban'
};

// 打开的结果归成三种：起来了、要用户接着做、没成。
function launchOutcome(result) {
  if (!result || result.ok === false) return 'fail';
  if (result.state && result.state !== 'ready') return 'wait';
  return 'ok';
}

// 选谁看谁：点一只猫只看它的会话；“全部”看所有猫的。底层仍是 agentScope。
async function pickRosterAgent(agentId) {
  if (state.ui.agentScope !== 'current') {
    state.ui = window.UiContext.setAgentScope(state.ui, 'current');
    persistSettings({ sessionScope: 'current' });
    renderSessionControls();
    if (agentId === currentAgentId()) {
      renderAccounts();
      await loadSessions();
      return;
    }
  }
  if (agentId !== currentAgentId()) await selectAgent(agentId);
}

async function pickRosterAll() {
  if (state.ui.agentScope === 'all') return;
  const pending = setSessionScope('all');
  renderAccounts();
  await pending;
}

function renderRosterAllCard(agentCount) {
  if (!els.rosterAllCard) return;
  const all = state.ui.agentScope === 'all';
  els.rosterAllCard.hidden = agentCount === 0;
  els.rosterAllCard.classList.toggle('selected', all);
  els.rosterAllCard.setAttribute('aria-pressed', String(all));
  if (els.rosterAllMeta) {
    els.rosterAllMeta.textContent = all
      ? tr('roster.allMeta', { agents: agentCount, n: state.sessions.length })
      : tr('roster.allAgents', { agents: agentCount });
  }
}

function updateAccountCard(card, group, now) {
  const primary = group.primary;
  const current = group.key === currentAgentId();
  const selected = current && state.ui.agentScope !== 'all';
  const profile = cardActionProfile(group);
  const action = currentAgentActionContext(group, profile);
  const selectAgentButton = card.querySelector('.account-card-select');
  card.classList.toggle('selected', selected);
  card.classList.toggle('current', current);
  selectAgentButton.setAttribute('aria-pressed', String(selected));

  const activityEvidence = window.IdentityGroups?.cardActivityEvidence
    ? window.IdentityGroups.cardActivityEvidence(group.members, state.activity)
    : { merged: state.activity[primary.id] || null, remoteUnknown: primary._remote === true };
  const merged = activityEvidence.merged;
  const derivedActivityState = merged && window.YardCats ? window.YardCats.deriveState(now, primary, merged) : null;
  // A local working signal proves that the Agent is working. A local rest/idle
  // signal cannot describe remote Presence while remote activity is not part
  // of inventory, so mixed groups otherwise remain explicitly unknown.
  let activityState = window.IdentityGroups?.resolveCardActivityState
    ? window.IdentityGroups.resolveCardActivityState(activityEvidence, derivedActivityState)
    : (activityEvidence.remoteUnknown && derivedActivityState !== 'working' ? null : derivedActivityState);
  // 后台对话是 AgentDesk 亲手中转的，在跑就是在干活；刚结束的那一会儿按结局显示。
  const hubCard = hubCardState(group);
  if (hubCard.state) activityState = hubCard.state;
  // 猫有多忙：同时在跑的对话数决定演干活、忙还是抓狂；0 条或不知道时不改上面的判断。迷糊照旧先演。
  const running = cardRunningCount(group, merged);
  const busyAction = window.YardCats?.busyAction ? window.YardCats.busyAction(running) : null;
  if (busyAction && activityState !== 'confused') activityState = busyAction;
  const meshMode = state.mesh.overview?.initialized === true;
  const deploymentState = group.readiness?.state || 'absent';
  const notReady = meshMode && deploymentState !== 'ready';
  // 状态只说一次：这一行说它在干嘛；要用户做的事交给徽章和按钮。
  const stateLabel = busyAction && activityState === busyAction
    ? tr('card.running', { n: running })
    : (activityState
      ? tr('state.' + activityState)
      : (notReady ? deploymentStateLabel(deploymentState) : tr('card.activityUnknown')));

  const activityAt = merged?.contentActiveAt || merged?.latestMtime || null;
  const activityDate = activityAt ? new Date(activityAt) : null;
  const hasActivityTime = Boolean(activityDate && !Number.isNaN(activityDate.getTime()));
  const lastActiveLine = `${tr(activityEvidence.remoteUnknown && merged ? 'card.lastActiveLocal' : 'card.lastActive')} ${
    hasActivityTime ? fullDate(activityAt) : tr('common.unrecorded')}`;
  const slots = group.allMembers || group.members;
  const positionsLine = meshMode
    ? tr('presenter.positions', {
        positions: slots.length,
        online: slots.filter((member) => member._deviceStatus === 'online').length
      })
    : (primary.group ? tr('card.group', { g: primary.group }) : '');
  selectAgentButton.title = [accountCardTooltip(action), lastActiveLine, positionsLine].filter(Boolean).join('\n');

  const name = card.querySelector('.account-card-name');
  name.textContent = primary.name;

  // 新回复：本机运行位置上回完了、还没在这里点开过的条数；没有就什么都不显示。
  const replies = sessionMarks.freshCount(group.members
    .filter((member) => member._remote !== true)
    .map((member) => state.activity[member.id])
    .filter(Boolean));
  const repliesLine = card.querySelector('.account-card-replies');
  repliesLine.hidden = replies === 0;
  repliesLine.textContent = replies ? tr('card.replies', { n: replies }) : '';
  const mail = card.querySelector('.account-card-mail');
  const wasMail = Number(mail.dataset.count) || 0;
  mail.hidden = replies === 0;
  mail.dataset.count = String(replies);
  mail.querySelector('b').textContent = String(replies);
  mail.title = tr('card.mail.title', { n: replies });
  mail.setAttribute('aria-label', `${primary.name} · ${mail.title}`);
  if (replies > wasMail && wasMail >= 0 && card.isConnected && mail.dataset.seen === 'true') {
    mail.classList.remove('fx-pop');
    void mail.offsetWidth;
    mail.classList.add('fx-pop');
  }
  mail.dataset.seen = 'true';

  const st = card.querySelector('.account-card-state');
  st.dataset.activity = activityState || 'unknown';
  st.title = busyAction && activityState === busyAction ? tr('card.running.hint') : '';
  card.querySelector('.account-card-state-label').textContent = stateLabel;
  card.dataset.readiness = meshMode ? deploymentState : 'local';

  const badgeIcon = notReady
    ? (READINESS_BADGE[deploymentState] || 'bang')
    : (activityState === 'confused' ? 'q' : '');
  const badge = card.querySelector('.account-card-badge');
  badge.hidden = !badgeIcon;
  badge.dataset.i = badgeIcon;
  badge.title = notReady ? deploymentStateLabel(deploymentState) : (badgeIcon ? stateLabel : '');

  const quotaSummary = card.querySelector('.account-card-quota-summary');
  let quotaTrack = quotaSummary.querySelector('.account-card-quota');
  let quotaValue = quotaSummary.querySelector('.account-card-fact-value');
  if (!quotaTrack || !quotaValue) {
    quotaTrack = document.createElement('span');
    quotaTrack.className = 'account-card-quota';
    for (let index = 0; index < 5; index += 1) {
      const pip = document.createElement('i');
      pip.style.setProperty('--i', String(index));
      quotaTrack.append(pip);
    }
    quotaValue = document.createElement('strong');
    quotaValue.className = 'account-card-fact-value';
    quotaSummary.replaceChildren(quotaTrack, quotaValue);
  }
  const setPips = (count) => {
    [...quotaTrack.children].forEach((pip, index) => pip.classList.toggle('on', index < count));
  };

  // 只展示本地 Slot 的新鲜实时快照；旧采样、已过重置点和远端缓存都不进入卡片额度。
  const trustedQuota = trustedLocalAccountCardQuota(group, now);
  delete quotaSummary.dataset.source;
  if (trustedQuota.status === 'ok') {
    const { member, snapshot, tightest } = trustedQuota;
    const source = accountCardQuotaSource(member);
    const percent = Math.max(0, Math.min(100, Math.round(tightest.remainingPercent)));
    const fullValue = tr('quota.overview.value', { label: tightest.label, pct: percent });
    const title = tr('card.quotaSource', {
      source,
      value: fullValue,
      time: fullDate(snapshot.observedAt)
    });
    quotaValue.textContent = `${percent}%`;
    quotaValue.title = title;
    quotaSummary.dataset.source = source;
    quotaTrack.dataset.trusted = 'true';
    quotaTrack.dataset.level = window.YardEnergy?.energyForRemaining?.(percent) || 'unknown';
    setPips(percent > 0 ? Math.max(1, Math.round(percent / 20)) : 0);
    quotaTrack.title = title;
  } else {
    const conflict = trustedQuota.status === 'conflict';
    const notApplicable = trustedQuota.status === 'not_applicable';
    quotaValue.textContent = tr(conflict ? 'card.quotaConflict'
      : (notApplicable ? 'quota.status.notApplicable' : 'devices.value.unknown'));
    quotaValue.title = notApplicable ? trustedQuota.snapshot.reason
      : tr(conflict ? 'card.quotaConflictHint' : 'quota.chip.noData');
    quotaTrack.dataset.trusted = 'false';
    quotaTrack.dataset.reason = trustedQuota.reason || 'unknown';
    quotaTrack.dataset.level = 'unknown';
    setPips(0);
    quotaTrack.title = quotaValue.title;
  }
  // 猫：外观来自它存的样子；演哪个动作由活动和这条能量格一起决定（规则在 yard/cats.js 的 actionFor）。
  const look = window.YardCats ? catAppearanceOf(primary.cat, primary.id) : null;
  window.PixelUi?.setCat(card.querySelector('.account-card-avatar'), {
    ...(look || {}),
    ...(hubCard.accessory ? { accessory: hubCard.accessory } : {}),
    seed: group.key,
    state: activityState || null,
    papers: busyAction ? running : 0,
    energy: quotaTrack.dataset.trusted === 'true' ? quotaTrack.dataset.level : null
  });

  quotaSummary.disabled = !profile;
  quotaSummary.title = tr('quota.self.title');
  quotaSummary.setAttribute('aria-label', `${primary.name} · ${tr('card.quota')} · ${quotaValue.textContent}`);

  renderAccountCardRuntime(card.querySelector('.account-card-runtime'), action);
  renderAccountCardLaunch(card.querySelector('.account-card-launch'), action);
  const manage = card.querySelector('.account-card-manage');
  manage.textContent = tr('account.manageShort');
  manage.title = tr('account.manageAgent');
  manage.setAttribute('aria-label', `${primary.name} · ${manage.title}`);
}

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

function renderAccountCardRuntime(label, action) {
  const { group, profile, requested } = action;
  const select = label.querySelector('select');
  label.querySelector('span').textContent = tr('devices.slot.label');
  select.title = tr('devices.slot.title');
  const single = label.querySelector('.account-card-runtime-single');
  const singleMember = group.members.length === 1 ? group.members[0] : null;
  single.hidden = !singleMember;
  select.hidden = Boolean(singleMember);
  if (singleMember) {
    const device = singleMember._remote ? singleMember._meshDeviceName : tr('devices.device.local');
    single.textContent = `${device || singleMember.name} · ${appLabel(singleMember.appId)}`;
    single.title = `${singleMember._meshDeviceName || singleMember.name} · ${appLabel(singleMember.appId)}`;
  }
  const options = [];
  let value = profile?.id || '';
  if (group.members.length) {
    if (!profile) options.push({ value: '', text: tr('devices.slot.choose'), disabled: true });
    const locations = group.members.map((member) => {
      const device = member._remote ? member._meshDeviceName : tr('devices.device.local');
      return { member, text: `${device || member.name} · ${appLabel(member.appId)}` };
    });
    for (const { member, text } of locations) {
      const ambiguous = locations.some((location) => location.member !== member && location.text === text);
      options.push({
        value: member.id,
        text: ambiguous ? `${text} · ${member.name}` : text,
        disabled: false
      });
    }
  } else {
    const apps = supportedProvisioningApps();
    if (!requested || !apps.length) {
      options.push({ value: '', text: tr(apps.length ? 'deployment.client.choose' : 'deployment.client.noneSupported'), disabled: true });
    }
    for (const app of apps) {
      const optionValue = `prepare:${app.appId}:${app.clientForm}`;
      options.push({ value: optionValue, text: tr('deployment.client.unprepared', { app: app.label }), disabled: false });
      if (app.appId === requested?.appId && app.clientForm === requested?.clientForm) value = optionValue;
    }
  }
  // Retain the open native picker on ordinary activity and quota refreshes.
  if (select.options.length !== options.length || !options.every((item, index) => {
    const option = select.options[index];
    return option.value === item.value && option.textContent === item.text && option.disabled === item.disabled;
  })) {
    select.replaceChildren(...options.map((item) => {
      const option = new Option(item.text, item.value);
      option.disabled = item.disabled;
      return option;
    }));
  }
  if (select.value !== value) select.value = value;
  select.disabled = options.every((item) => item.disabled);
}

function accountCardTooltip(action) {
  const { profile, group, agent } = action;
  if (!profile) {
    const device = action.device?.name || selectedDeviceLensLabel() || '-';
    return [group.primary.name, tr('deployment.environmentStatus', { device, state: deploymentStateLabel(action.readiness?.state) }), agent?.note].filter(Boolean).join('\n');
  }
  const groupLabel = agent?.group || profile.group;
  const meta = profile._remote
    ? tr('devices.slot.remoteMeta', { device: profile._meshDeviceName || '-', status: tr(`devices.status.${profile._deviceStatus || 'offline'}`) })
    : [appLabel(profile.appId), tr(profile.isProtected ? 'acct.slotDefault' : 'acct.slotIndependent'),
      groupLabel, tr('acct.lastOpen', { t: compactDate(profile.lastLaunchedAt) })].filter(Boolean).join(' · ');
  const location = profile._remote
    ? tr('devices.slot.remotePath')
    : tr('acct.tip', { p: shortPath(profile.profilePath), s: shortPath(profile.sessionRoot) });
  return [group.primary.name, meta, location, profile.note ? tr('acct.note', { note: profile.note }) : ''].filter(Boolean).join('\n');
}

function renderAccountHeader() {
  const profile = selectedProfile();
  const remote = profile?._remote === true;
  const meshMode = state.mesh.overview?.initialized === true;
  const selectedAgent = catalogAgentById(actionAgentId());
  const localLens = !meshMode
    || currentDeviceLensId() === 'all'
    || currentDeviceLensId() === state.mesh.overview.localDeviceId;
  const firstUseAction = onboardingNeedsPresentation() && (
    !meshMode || !(state.mesh.overview?.agents || []).length
  );

  const recruitLabel = els.addProfileBtn.querySelector(':scope > span');
  if (recruitLabel) recruitLabel.textContent = tr('roster.recruit');
  const editProfileLabel = els.editProfileBtn.querySelector(':scope > span');
  const removeProfileLabel = els.removeProfileBtn.querySelector(':scope > span');
  if (editProfileLabel) editProfileLabel.textContent = tr(meshMode ? 'account.editAgent' : 'account.edit');
  else els.editProfileBtn.textContent = tr(meshMode ? 'account.editAgent' : 'account.edit');
  if (removeProfileLabel) removeProfileLabel.textContent = tr(meshMode ? 'account.removeCatalog' : 'account.remove');
  else els.removeProfileBtn.textContent = tr(meshMode ? 'account.removeCatalog' : 'account.remove');
  els.addProfileBtn.disabled = false;
  els.addProfileBtn.title = firstUseAction
    ? tr('account.createFirstAgentHint')
    : (meshMode ? tr('account.addAgentHint') : '');
  if (els.addRuntimeLocationBtn) {
    els.addRuntimeLocationBtn.hidden = !meshMode;
    els.addRuntimeLocationBtn.disabled = !selectedAgent || !localLens;
    els.addRuntimeLocationBtn.title = localLens ? '' : tr('account.addRemoteDisabled');
  }
  if (els.manageAgentRelationsBtn) {
    els.manageAgentRelationsBtn.hidden = !meshMode;
    els.manageAgentRelationsBtn.disabled = !selectedAgent;
  }

  els.pathConfigBtn.disabled = !profile || remote;
  els.diagnosticsBtn.disabled = !profile || remote;
  els.profileFolderBtn.disabled = !profile || remote;
  els.refreshBtn.disabled = !profile || (remote && !window.manager.refreshMeshInventory);
  els.editProfileBtn.disabled = meshMode ? !selectedAgent : (!profile || remote);
  els.removeProfileBtn.disabled = meshMode ? !selectedAgent : (!profile || remote);

  renderAccountRoster();
  renderQuotaSummary();
  renderTopbarContext();
  renderAgentManageContext();
}

function renderAccountCardLaunch(button, action) {
  const { profile, meshMode } = action;
  const remote = profile?._remote === true;
  const profileCanLaunch = profile ? state.appMeta[profile.appId]?.canLaunch !== false : false;
  const requestedCanProvision = action.requested?.appId
    ? state.appMeta[action.requested.appId]?.canProvision === true
    : false;
  const unavailable = ['offline', 'retired'].includes(action.readiness?.state);
  const remoteCapability = profile ? 'profile.launch' : 'agent.prepare';
  const remoteSupported = !action.isRemote
    || (action.device?.capabilities || []).includes(remoteCapability);
  const remotePermitted = !action.isRemote
    || (action.device?.permissions || []).includes(remoteCapability);
  const canOpen = meshMode
    ? Boolean(action.agent && !action.busy && !unavailable && remoteSupported && remotePermitted && (
        (profile && profileCanLaunch) || (!profile && requestedCanProvision)
      ))
    : Boolean(profile && profileCanLaunch && !remote);
  button.textContent = meshMode ? provisioningButtonLabel(action) : tr('account.open');
  button.dataset.kind = profile && (!meshMode || action.readiness?.state === 'ready') ? 'open' : 'step';
  button.disabled = !canOpen;
  if (action.isRemote && !remoteSupported) button.title = tr('deployment.action.remoteUnsupported');
  else if (action.isRemote && !remotePermitted) button.title = tr('deployment.action.remotePermission');
  else if (unavailable) button.title = tr('deployment.action.offline');
  else if (!profile && !action.requested?.appId) button.title = tr('deployment.action.chooseClient');
  else if (!profile && !requestedCanProvision) button.title = tr('deployment.action.unsupportedClient');
  else if (profile && !profileCanLaunch) button.title = tr('deployment.action.externalClient');
  else button.title = '';
  button.setAttribute('aria-label', `${action.group.primary.name} · ${button.textContent}`);
}

const COMPACT_SESSION_COLUMNS = [
  { key: 'title', label: 'session.col.title', className: 'col-title', cellClass: 'title-cell' },
  { key: 'project', label: 'session.col.project', className: 'col-project', cellClass: 'path-cell' },
  { key: 'updatedAt', label: 'session.col.active', className: 'col-date' },
  { key: 'source', label: 'session.col.source', className: 'col-source' }
];

const DETAIL_SESSION_COLUMNS = [
  { key: 'title', label: 'session.col.title', className: 'col-title', cellClass: 'title-cell' },
  { key: 'account', label: 'session.col.account', className: 'col-account' },
  { key: 'app', label: 'session.col.app', className: 'col-app' },
  { key: 'createdAt', label: 'session.col.created', className: 'col-date' },
  { key: 'updatedAt', label: 'session.col.active', className: 'col-date' },
  { key: 'project', label: 'session.col.project', className: 'col-project', cellClass: 'mono path-cell' },
  { key: 'source', label: 'session.col.source', className: 'col-source' },
  { key: 'status', label: 'session.col.status', className: 'col-status' },
  { key: 'model', label: 'session.col.model', className: 'col-model' },
  { key: 'id', label: 'session.col.id', className: 'col-id', cellClass: 'mono' }
];

const MESH_LOCATION_COLUMN = {
  key: 'location',
  label: 'session.col.location',
  className: 'col-location'
};

function sessionColumns() {
  const base = state.sessionView === 'detail' ? DETAIL_SESSION_COLUMNS : COMPACT_SESSION_COLUMNS;
  return state.mesh.overview?.initialized && currentDeviceLensId() === 'all'
    ? [...base, MESH_LOCATION_COLUMN]
    : base;
}

function actionSessions() {
  const ids = new Set(window.UiContext.actionConversationIds(state.ui));
  return state.sessions.filter((session) => ids.has(sessionKey(session)));
}

function replicaResolution(session) {
  return window.UiContext.resolveReplica(state.ui, session, sessionKey(session));
}

function resolvedSessionRow(session) {
  if (!session) return null;
  const resolution = replicaResolution(session);
  if (!resolution.resolved) return null;
  if (!resolution.replica) return session;
  return enrichMeshSession({
    ...sessionAtReplica(session, resolution.replica, state.mesh.overview),
    replicas: session.replicas
  }, state.mesh.overview);
}

function unresolvedActionSessions() {
  return actionSessions().filter((session) => !replicaResolution(session).resolved);
}

function resolvedActionSessions() {
  if (unresolvedActionSessions().length) return [];
  return actionSessions().map(resolvedSessionRow).filter(Boolean);
}

let sessionFileActionBusy = false;

function isLocalActionSession(session) {
  return Boolean(session?._profileId && !session._remote && !session._stale
    && state.profiles.some((profile) => String(profile.id) === String(session._profileId)));
}

function sessionFileActionRefs(sessions) {
  return sessions.map((session) => ({
    profileId: String(session._profileId),
    sessionId: String(session.id)
  }));
}

function renderSessionActionToolbar() {
  const selected = actionSessions();
  const count = selected.length;
  const resolved = selected.map(resolvedSessionRow);
  const unresolved = resolved.filter((session) => !session).length;
  const folders = resolved.filter((session) => isLocalActionSession(session) && session.filePath).length;
  const exportable = resolved.filter((session) => (
    isLocalActionSession(session) && state.appMeta[session.appId]?.canExportTranscript
  )).length;
  const visibility = window.UiContext.actionVisibility(
    state.ui,
    state.filteredSessions.map(sessionKey)
  );
  els.sessionSelectionBar.hidden = count === 0;
  els.sessionSelectionCount.textContent = tr('session.selection.count', { n: count });
  const issues = [];
  if (visibility.hidden) issues.push(tr('session.selection.hiddenCount', { n: visibility.hidden }));
  if (unresolved) issues.push(tr('session.replica.requiredCount', { n: unresolved }));
  else if (folders < count) issues.push(tr('session.actions.localOnly'));
  else if (exportable < count) issues.push(tr('session.actions.unsupportedExport'));
  const hasReplicaChoice = selected.some((session) => replicaResolution(session).candidates?.length > 1);
  els.chooseSessionReplicaBtn.hidden = !hasReplicaChoice;
  els.sessionSelectionNotice.hidden = issues.length === 0 && !hasReplicaChoice;
  els.sessionSelectionIssue.textContent = issues.join(' · ');
  els.copySessionInfoBtn.disabled = count === 0 || unresolved > 0;
  els.copySessionInfoBtn.textContent = count > 1
    ? tr('session.copyInfoCount', { n: count })
    : tr('session.copyInfo');
  els.copySessionInfoBtn.title = unresolved
    ? tr('session.replica.requiredAction')
    : tr('session.copyInfoHint');
  els.openSessionFileBtn.disabled = !count || count !== folders || sessionFileActionBusy;
  els.openSessionFileBtn.title = tr('session.actions.openHint');
  els.exportSessionBtn.disabled = !count || count !== exportable || sessionFileActionBusy;
  els.exportSessionBtn.title = tr('session.actions.exportHint');
  const handoff = count === 1 && isLocalActionSession(resolved[0])
    && ['native', 'transcript'].includes(state.appMeta[resolved[0].appId]?.taskPackageMode);
  els.taskPackageActionBtn.disabled = !handoff;
  els.taskPackageActionBtn.title = tr(handoff ? 'taskPackage.action.hint' : 'taskPackage.action.unsupported');
  // 说明纸条在按钮不可用时最后写一行真正的原因（按钮的 title 有时只是通用说明）
  setHubReason(els.copySessionInfoBtn, count === 0 ? 'hub.tip.reason.select' : (unresolved ? 'session.replica.requiredAction' : null));
  setHubReason(els.taskPackageActionBtn, handoff ? null : (count === 0 ? 'hub.tip.reason.select'
    : (count > 1 ? 'hub.tip.reason.single'
      : (!isLocalActionSession(resolved[0]) ? 'hub.tip.reason.localOnly' : 'taskPackage.action.unsupported'))));
  if (els.sendSessionInfoBtn) {
    const remotes = (state.mesh.overview?.devices || []).filter((device) => !device.isLocal);
    const paused = crossDeviceActionsPaused();
    els.sendSessionInfoBtn.disabled = count === 0 || unresolved > 0 || remotes.length === 0 || paused;
    (els.sendSessionInfoLabel || els.sendSessionInfoBtn).textContent = count > 1
      ? tr('session.sendInfoCount', { n: count })
      : tr('session.sendInfo');
    els.sendSessionInfoBtn.title = paused
      ? tr('status.crossDevicePaused')
      : (unresolved
          ? tr('session.replica.requiredAction')
          : tr('session.sendInfoHint'));
    setHubReason(els.sendSessionInfoBtn, paused ? 'status.crossDevicePaused'
      : (count === 0 ? 'hub.tip.reason.select'
        : (unresolved ? 'session.replica.requiredAction'
          : (remotes.length === 0 ? 'hub.tip.reason.noDevice' : null))));
  }
}

function setHubReason(button, key) {
  if (!button) return;
  if (key) button.dataset.hubReason = tr(key);
  else delete button.dataset.hubReason;
}

async function openSessionDirectoryOption(option) {
  let result;
  try { result = await window.manager.openSessionDirectory(option.ref, option.path); } catch (_error) { /* Show a fixed error below. */ }
  const message = result?.ok ? tr('status.sessionLocOk') : (result?.reason || tr('status.sessionLocFail'));
  setStatus(message);
  if (!els.sessionDirectoryDialog.open) return;
  if (result?.ok) els.sessionDirectoryDialog.close();
  else {
    els.sessionDirectoryStatus.hidden = false;
    els.sessionDirectoryStatus.textContent = message;
  }
}

async function openSelectedSessionDirectories() {
  if (els.openSessionFileBtn.disabled) return;
  const refs = sessionFileActionRefs(resolvedActionSessions());
  sessionFileActionBusy = true;
  renderSessionActionToolbar();
  try {
    const result = await window.manager.listSessionDirectories(refs);
    if (!result?.ok || !result.directories.length) {
      setStatus(result?.reason || tr('status.sessionLocFail'));
      return;
    }
    if (result.directories.length === 1) {
      await openSessionDirectoryOption(result.directories[0]);
      return;
    }
    els.sessionDirectoryOptions.replaceChildren();
    els.sessionDirectoryStatus.hidden = true;
    for (const option of result.directories) {
      const button = document.createElement('button');
      button.type = 'button';
      const location = document.createElement('code');
      location.textContent = shortPath(option.path);
      location.title = option.path;
      const count = document.createElement('span');
      count.textContent = tr('session.actions.directorySessions', { n: option.count });
      button.append(location, count);
      button.addEventListener('click', async () => {
        if (sessionFileActionBusy) return;
        sessionFileActionBusy = true;
        const choices = els.sessionDirectoryOptions.querySelectorAll('button');
        for (const choice of choices) choice.disabled = true;
        try {
          await openSessionDirectoryOption(option);
        } finally {
          sessionFileActionBusy = false;
          for (const choice of choices) choice.disabled = false;
        }
      });
      els.sessionDirectoryOptions.append(button);
    }
    openChildDialog(els.sessionDirectoryDialog, els.openSessionFileBtn);
  } catch (_error) {
    setStatus(tr('status.sessionLocFail'));
  } finally {
    sessionFileActionBusy = false;
    renderSessionActionToolbar();
  }
}

async function exportSelectedSessions() {
  if (els.exportSessionBtn.disabled) return;
  const refs = sessionFileActionRefs(resolvedActionSessions());
  sessionFileActionBusy = true;
  renderSessionActionToolbar();
  setStatus(tr('session.actions.preparingExport'));
  try {
    const result = await window.manager.exportSessions(refs);
    setStatus(result?.message || result?.reason || tr(result?.ok ? 'status.exportOk' : 'status.exportFail'));
    if (result?.ok && !result.cancelled) window.PixelUi?.mascot?.('cheer');
    else if (result && !result.ok) window.PixelUi?.mascot?.('no');
  } catch (_error) {
    setStatus(tr('status.exportFail'));
    window.PixelUi?.mascot?.('no');
  } finally {
    sessionFileActionBusy = false;
    renderSessionActionToolbar();
  }
}

function crossDeviceActionsPaused() {
  return state.mesh.sessionSource === 'local-fallback'
    || state.mesh.sessionSource === 'remote-unavailable'
    || Boolean(state.mesh.sessionErrorCode);
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

function setAllVisibleSessionsSelected(selected) {
  const next = new Set(state.ui.checkedConversationIds);
  for (const session of state.filteredSessions) {
    const key = sessionKey(session);
    if (selected) next.add(key);
    else next.delete(key);
  }
  state.ui = window.UiContext.setCheckedConversations(state.ui, next);
  renderSessions();
}

function clearSessionActionSelection() {
  state.ui = window.UiContext.clearConversationActions(state.ui);
  renderSessions();
}

function setSessionChecked(session, checked) {
  const key = sessionKey(session);
  state.ui = window.UiContext.checkConversation(state.ui, key, checked);
  renderSessions();
}

function focusSession(session) {
  state.ui = window.UiContext.focusConversation(state.ui, session ? sessionKey(session) : null);
  if (session) setWorkspaceMode('sessions');
}

function renderSessionHead() {
  if (!els.sessionHead) return;
  const activeControl = document.activeElement;
  const restoreSelectAll = activeControl?.id === 'sessionSelectAll';
  const restoreSort = els.sessionHead.contains(activeControl) ? activeControl.dataset.sortKey : null;
  let sortControl = null;
  const row = document.createElement('tr');
  const selectHeading = document.createElement('th');
  selectHeading.scope = 'col';
  selectHeading.className = 'col-select';
  const selectAll = document.createElement('input');
  selectAll.id = 'sessionSelectAll';
  selectAll.className = 'session-select-box';
  selectAll.type = 'checkbox';
  selectAll.setAttribute('aria-label', tr('session.selectAll'));
  const selectedCount = state.filteredSessions.filter((session) => (
    state.ui.checkedConversationIds.has(sessionKey(session))
  )).length;
  selectAll.checked = state.filteredSessions.length > 0 && selectedCount === state.filteredSessions.length;
  selectAll.indeterminate = selectedCount > 0 && selectedCount < state.filteredSessions.length;
  selectAll.disabled = state.filteredSessions.length === 0;
  selectAll.addEventListener('change', () => setAllVisibleSessionsSelected(selectAll.checked));
  selectHeading.append(selectAll);
  row.append(selectHeading);
  for (const column of sessionColumns()) {
    const heading = document.createElement('th');
    heading.scope = 'col';
    heading.className = column.className || '';
    const active = state.sessionSort.key === column.key;
    if (active) {
      heading.setAttribute('aria-sort', state.sessionSort.direction === 'asc' ? 'ascending' : 'descending');
    }

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sort-button';
    button.dataset.sortKey = column.key;
    if (restoreSort === column.key) sortControl = button;
    const label = tr(column.label);
    button.title = tr('session.sort.hint', { label });
    const text = document.createElement('span');
    text.textContent = label;
    const indicator = document.createElement('span');
    indicator.className = 'sort-indicator';
    indicator.setAttribute('aria-hidden', 'true');
    indicator.textContent = active ? (state.sessionSort.direction === 'asc' ? '↑' : '↓') : '';
    button.append(text, indicator);
    button.addEventListener('click', () => {
      const direction = state.sessionSort.key === column.key
        ? (state.sessionSort.direction === 'asc' ? 'desc' : 'asc')
        : (window.SessionTable?.defaultDirection(column.key) || 'asc');
      state.sessionSort = { key: column.key, direction };
      applySessionFilter();
    });
    heading.append(button);
    row.append(heading);
  }

  els.sessionHead.replaceChildren(row);
  (restoreSelectAll ? selectAll : sortControl)?.focus({ preventScroll: true });
}

function renderSessions() {
  const activeControl = document.activeElement;
  const restoreKey = activeControl?.closest('tr[data-session-key]')?.dataset.sessionKey;
  const restoreSelector = activeControl?.classList.contains('session-select-box') ? '.session-select-box' : '.title-cell-main';
  let rowControl = null;
  renderSessionControls();
  renderSessionActionToolbar();
  fitSessionToolbar();
  renderSessionHead();
  els.sessionRows.replaceChildren();
  const accountCount = sessionAccountCount(state.filteredSessions);
  els.sessionCount.title = state.ui.agentScope === 'all'
    ? tr('session.countAll', { n: state.filteredSessions.length, accounts: accountCount })
    : tr('session.count', { n: state.filteredSessions.length });
  const filtering = Boolean(state.query) || sessionMarks.filterActive();
  const wasFiltering = els.sessionCount.dataset.filtered === 'true';
  els.sessionCount.dataset.filtered = String(filtering);
  if (filtering || wasFiltering) clearInterval(els.sessionCount._fxRoll);
  // 条数一直留出“N / N”的宽度：点筛选时它从“10”变成“2 / 10”，不能把旁边的筛选条挤动。
  els.sessionCount.style.minWidth = `${String(withHubRuns(state.sessions).length).length * 2 + 3}ch`;
  if (filtering) {
    const total = withHubRuns(state.sessions).length;
    els.sessionCount.textContent = `${state.filteredSessions.length} / ${total}`;
    els.sessionCount.title = tr('marks.shown', { shown: state.filteredSessions.length, total });
  } else if (window.PixelFx && !wasFiltering) window.PixelFx.roll(els.sessionCount, state.filteredSessions.length);
  else els.sessionCount.textContent = String(state.filteredSessions.length);
  if (els.rosterAllMeta && state.ui.agentScope === 'all') {
    els.rosterAllMeta.textContent = tr('roster.allMeta', { agents: identityGroups().length, n: state.sessions.length });
  }

  if (!state.filteredSessions.length) {
    const row = document.createElement('tr');
    row.className = 'empty-row';
    const cell = document.createElement('td');
    cell.colSpan = sessionColumns().length + 1;
    cell.textContent = state.sessions.length
      ? tr('session.empty.filtered')
      : tr(!orderedAgentGroups().length
        ? 'session.empty.noAgents'
        : state.ui.agentScope === 'all' ? 'session.empty.noneAll' : 'session.empty.none');
    row.append(cell);
    els.sessionRows.append(row);
    return;
  }

  for (const session of state.filteredSessions) {
    if (session._hubRun) {
      const row = renderHubRow(session);
      if (sessionKey(session) === restoreKey) rowControl = row.querySelector(restoreSelector);
      els.sessionRows.append(row);
      continue;
    }
    const key = sessionKey(session);
    const row = document.createElement('tr');
    row.dataset.sessionKey = key;
    const checked = state.ui.checkedConversationIds.has(key);
    row.classList.toggle('selected', checked);
    row.classList.toggle('session-active', key === state.ui.focusedConversationId);
    row.setAttribute('aria-selected', String(checked || key === state.ui.focusedConversationId));

    const selectCell = document.createElement('td');
    selectCell.className = 'select-cell';
    const checkbox = document.createElement('input');
    checkbox.className = 'session-select-box';
    checkbox.type = 'checkbox';
    checkbox.checked = checked;
    checkbox.setAttribute('aria-label', tr('session.selectOne', { title: session.title || session.id || '' }));
    checkbox.addEventListener('click', (event) => event.stopPropagation());
    checkbox.addEventListener('change', () => setSessionChecked(session, checkbox.checked));
    selectCell.append(checkbox);
    row.append(selectCell);

    for (const column of sessionColumns()) {
      row.append(renderSessionCell(session, column));
    }
    if (key === restoreKey) rowControl = row.querySelector(restoreSelector);

    row.addEventListener('click', (event) => {
      const tagButton = event.target.closest('.session-tag-btn');
      if (tagButton) {
        sessionMarks.openPicker(markTargets(session), tagButton);
        return;
      }
      if (event.metaKey || event.ctrlKey) {
        setSessionChecked(session, !state.ui.checkedConversationIds.has(key));
      } else {
        focusSession(session);
        renderSessions();
        // 点开这一行就算在这里看过了；从 AgentDesk 打开客户端不算。
        void sessionMarks.markSeen([session]);
      }
    });
    row.addEventListener('contextmenu', (event) => {
      const targets = markTargets(session);
      if (!targets.length) return;
      event.preventDefault();
      sessionMarks.openPicker(targets, { x: event.clientX, y: event.clientY });
    });
    els.sessionRows.append(row);
  }
  rowControl?.focus({ preventScroll: true });
}

// 会话工具栏只有一行（面板标题 38–48px）。放不下时一级一级收起次要的字，直到不溢出为止；放得下就全部显示。
function fitSessionToolbar() {
  const main = document.querySelector('.session-toolbar-main');
  if (!main) return;
  for (const level of ['0', '1', '2']) {
    main.dataset.fit = level;
    if (main.scrollWidth <= main.clientWidth + 1) return;
  }
}

function renderSessionCell(session, column) {
  const cell = document.createElement('td');
  cell.className = [column.className, column.cellClass].filter(Boolean).join(' ');
  let value = '';
  let fullValue = '';
  switch (column.key) {
    case 'title': {
      const title = document.createElement('button');
      title.type = 'button';
      title.className = 'title-cell-main';
      title.textContent = session.title || '-';
      cell.append(title);
      sessionMarks.decorateTitle(cell, session, title);
      if (state.ui.agentScope === 'all' && state.sessionView === 'compact') {
        const account = document.createElement('span');
        account.className = 'cell-subline';
        account.textContent = tr('session.itemMeta', {
          account: session._accountName || session._profileName || '-',
          app: session._appLabel || session.appId || '-'
        });
        cell.append(account);
      }
      cell.title = session.title || '';
      return cell;
    }
    case 'account':
      value = session._accountName || session._profileName || '-';
      break;
    case 'app':
      value = session._appLabel || session.appId || '-';
      break;
    case 'createdAt':
      value = compactDate(session.createdAt);
      fullValue = fullDate(session.createdAt);
      break;
    case 'updatedAt':
      value = compactDate(session.updatedAt);
      fullValue = fullDate(session.updatedAt);
      break;
    case 'project':
      fullValue = session.projectPath || '';
      value = fullValue ? (
        state.sessionView === 'compact'
          ? fullValue.split(/[\\/]/).filter(Boolean).at(-1) || fullValue
          : shortPath(fullValue)
      ) : '-';
      break;
    case 'id':
      value = session.address || session.id || '-';
      break;
    case 'location': {
      const replicas = Array.isArray(session.replicas) ? session.replicas : [];
      value = replicas.length > 1
        ? tr('session.locationCount', { n: replicas.length })
        : (session._deviceName || '-');
      fullValue = replicas.map((replica) => replica.deviceName || replica.deviceId).join(' · ');
      break;
    }
    default:
      value = session[column.key] || '-';
  }
  cell.textContent = value;
  cell.title = fullValue || String(value === '-' ? '' : value);
  return cell;
}

function sessionAccountCount(sessions) {
  return new Set((sessions || []).map((session) => (
    session._accountKey || session._profileId || ''
  )).filter(Boolean)).size;
}

function renderReplicaPicker(sessions) {
  els.sessionReplicaOptions.replaceChildren();
  const overview = state.mesh.overview;
  for (const session of sessions) {
    const resolution = replicaResolution(session);
    if (!(resolution.candidates?.length > 1)) continue;
    const group = document.createElement('fieldset');
    const legend = document.createElement('legend');
    legend.textContent = session.title || session.id;
    group.append(legend);
    for (const replica of resolution.candidates) {
      const device = overview?.devices?.find((item) => item.deviceId === replica.deviceId);
      const slot = overview?.slots?.find((item) => (
        item.deviceId === replica.deviceId && String(item.profileId) === String(replica.profileId)
      ));
      const label = document.createElement('label');
      label.className = 'session-replica-option';
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = `session-replica-${sessionKey(session)}`;
      radio.value = replica.replicaId;
      radio.checked = resolution.replicaId === replica.replicaId;
      const copy = document.createElement('span');
      const name = document.createElement('strong');
      name.textContent = device?.name || replica.deviceName || replica.deviceId;
      const meta = document.createElement('small');
      meta.textContent = [
        slot?.localLabel,
        appLabel(replica.appId || slot?.appId),
        replica.stale ? tr('session.offlineSnapshot') : tr(`devices.status.${device?.status || 'offline'}`)
      ].filter(Boolean).join(' · ');
      copy.append(name, meta);
      radio.addEventListener('change', () => {
        state.ui = window.UiContext.selectReplica(state.ui, sessionKey(session), replica.replicaId);
        renderSessions();
      });
      label.append(radio, copy);
      group.append(label);
    }
    els.sessionReplicaOptions.append(group);
  }
}

async function showDiagnostics() {
  const profile = selectedProfile();
  if (!profile) return;
  lastDiagnostics = await window.manager.getDiagnostics(profile);
  renderDiagnostics(lastDiagnostics);
  els.diagnosticsDialog.showModal();
}

function renderDiagnostics(diagnostics) {
  els.diagnosticsBody.replaceChildren();
  if (!diagnostics) return;

  const runtime = diagnostics.runtime || {};
  const crashpad = runtime.crashpad || {};

  const summary = document.createElement('div');
  summary.className = 'diagnostics-summary';
  summary.append(
    diagnosticBadge(diagnostics.executable.launchable ? 'ok' : 'warn', diagnostics.executable.launchable ? tr('diag.appLaunchable') : tr('diag.appNotFound')),
    diagnosticBadge(diagnostics.profilePath.exists ? 'ok' : 'warn', diagnostics.profilePath.exists ? tr('diag.profileDirExists') : tr('diag.profileDirMissing')),
    diagnosticBadge(diagnostics.sessionRoot.exists && diagnostics.sessionRoot.readable ? 'ok' : 'warn', diagnostics.sessionRoot.exists ? tr('diag.sessionDirReadable') : tr('diag.sessionDirMissing')),
    diagnosticBadge(diagnostics.sessionCount > 0 ? 'ok' : 'warn', tr('diag.sessionCount', { n: diagnostics.sessionCount })),
    diagnosticBadge(runtime.fusedAt ? 'warn' : 'ok', runtime.fusedAt
      ? tr('diag.crashpadFused')
      : tr('diag.crashpadBounded'))
  );
  els.diagnosticsBody.append(summary);

  if (diagnostics.warnings.length) {
    const warningList = document.createElement('ul');
    warningList.className = 'diagnostics-warnings';
    diagnostics.warnings.forEach((warning) => {
      const item = document.createElement('li');
      item.textContent = warning;
      warningList.append(item);
    });
    els.diagnosticsBody.append(warningList);
  }

  if (diagnostics.migration?.needed) {
    const repair = document.createElement('div');
    repair.className = 'diagnostics-repair';
    const text = document.createElement('span');
    text.textContent = tr('diag.migrateSuggest', { path: diagnostics.migration.recommendedPath });
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'primary';
    button.textContent = tr('diag.migrateBtn');
    button.addEventListener('click', async () => {
      const profile = selectedProfile();
      if (!profile) return;
      if (!window.confirm(tr('status.migrateConfirm', { name: profile.name }))) {
        return;
      }
      button.disabled = true;
      button.textContent = tr('diag.migrating');
      setStatus(tr('status.migrating'));
      const result = await window.manager.migrateWindowsProfilePath(profile.id);
      if (!result.ok) {
        button.disabled = false;
        button.textContent = tr('diag.migrateBtn');
        setStatus(result.reason || tr('status.migrateFail'));
        return;
      }
      await loadProfiles(profile.id);
      lastDiagnostics = await window.manager.getDiagnostics(selectedProfile());
      renderDiagnostics(lastDiagnostics);
      setStatus(result.message || tr('status.migrateDone'));
    });
    repair.append(text, button);
    els.diagnosticsBody.append(repair);
  }

  const table = document.createElement('table');
  table.className = 'diagnostics-table';
  const tbody = document.createElement('tbody');
  [
    [tr('diag.row.platform'), [diagnostics.platform, diagnostics.arch, diagnostics.osRelease].filter(Boolean).join(' · ')],
    [tr('diag.row.officialApp'), diagnostics.executable.path || tr('diag.notFound')],
    [tr('diag.row.launchMethod'), diagnostics.executable.source || (diagnostics.executable.protocolUsable ? tr('diag.winProtocol') : tr('diag.notFound'))],
    [tr('diag.row.manualPath'), diagnostics.executable.configuredPath
      ? `${diagnostics.executable.configuredPath}${diagnostics.executable.explicitMissing ? tr('diag.invalid') : ''}`
      : tr('diag.notSet')],
    [tr('diag.row.profileDir'), diagnostics.profilePath.path],
    [tr('diag.row.sessionRoot'), diagnostics.sessionRoot.path],
    [tr('diag.row.systemDefault'), `${diagnostics.defaultProfile.source} · ${diagnostics.defaultProfile.path}`],
    [tr('diag.row.configFile'), diagnostics.storeFile],
    [tr('diag.row.runtimeOwnership'), runtime.owned
      ? tr('diag.runtimeOwned')
      : tr('diag.runtimeUnowned')],
    [tr('diag.row.runtimeProcesses'), runtime.processCount === null || runtime.processCount === undefined
      ? tr('diag.notSet')
      : String(runtime.processCount)],
    [tr('diag.row.crashpadUsage'), crashpad.fileCount === null || crashpad.fileCount === undefined
      ? tr('diag.crashpadUnavailable')
      : tr('diag.crashpadUsage', {
          files: crashpad.fileCount,
          size: formatBytes(crashpad.totalBytes || 0),
          maxFiles: crashpad.limits?.maxFiles || 100,
          maxSize: formatBytes(crashpad.limits?.maxBytes || 0)
        })],
    [tr('diag.row.crashpadFuse'), runtime.fusedAt
      ? `${tr('diag.crashpadFused')} · ${runtime.fusedAt}`
      : tr('diag.crashpadReady')]
  ].forEach(([label, value]) => appendDiagnosticRow(tbody, label, value));
  const executableCandidates = diagnostics.executable.candidateDetails || [];
  if (executableCandidates.length) {
    appendDiagnosticRow(
      tbody,
      tr('diag.row.launchCandidates'),
      executableCandidates.map((item) => `${item.exists ? '✓' : '×'} ${item.source} · ${item.path}`).join('\n')
    );
  }
  if (diagnostics.executable.discoveryChannels?.length) {
    appendDiagnosticRow(
      tbody,
      tr('diag.row.discoveryChannels'),
      diagnostics.executable.discoveryChannels
        .map((item) => tr('diag.channelCandidates', { source: item.source, n: item.count }))
        .join('\n')
    );
  }
  if (diagnostics.defaultProfile?.candidates?.length) {
    appendDiagnosticRow(
      tbody,
      tr('diag.row.dataDirCandidates'),
      diagnostics.defaultProfile.candidates.map((item) => `${item.score >= 0 ? '✓' : '×'} ${item.source} · ${item.path}`).join('\n')
    );
  }
  diagnostics.sessionAreas.forEach((area) => {
    appendDiagnosticRow(tbody, area.label, `${area.exists ? tr('diag.exists') : tr('diag.notExists')} · ${area.path}`);
  });
  table.append(tbody);
  els.diagnosticsBody.append(table);
}

function diagnosticBadge(kind, text) {
  const badge = document.createElement('span');
  badge.className = `diagnostic-badge ${kind}`;
  badge.textContent = text;
  return badge;
}

function appendDiagnosticRow(tbody, label, value) {
  const row = document.createElement('tr');
  const key = document.createElement('th');
  const val = document.createElement('td');
  key.textContent = label;
  val.textContent = value || '-';
  row.append(key, val);
  tbody.append(row);
}

function formatDiagnosticsText(diagnostics) {
  const lines = [
    tr('diag.txt.title'),
    '',
    tr('diag.txt.platform', { v: diagnostics.platform }),
    tr('diag.txt.system', { arch: diagnostics.arch || '-', os: diagnostics.osRelease || '-' }),
    tr('diag.txt.app', { v: diagnostics.appName }),
    tr('diag.txt.officialApp', { v: diagnostics.executable.path || tr('diag.notFound') }),
    tr('diag.txt.launchMethod', { v: diagnostics.executable.source || (diagnostics.executable.protocolUsable ? tr('diag.winProtocol') : tr('diag.notFound')) }),
    tr('diag.txt.manualPath', { v: `${diagnostics.executable.configuredPath || tr('diag.notSet')}${diagnostics.executable.explicitMissing ? tr('diag.invalid') : ''}` }),
    tr('diag.txt.profileDir', { v: diagnostics.profilePath.path }),
    tr('diag.txt.sessionRoot', { v: diagnostics.sessionRoot.path }),
    tr('diag.txt.sessionCount', { v: diagnostics.sessionCount }),
    tr('diag.txt.configFile', { v: diagnostics.storeFile }),
    tr('diag.txt.runtimeOwnership', { v: diagnostics.runtime?.owned ? tr('diag.runtimeOwned') : tr('diag.runtimeUnowned') }),
    tr('diag.txt.crashpadUsage', {
      v: diagnostics.runtime?.crashpad?.fileCount === null || diagnostics.runtime?.crashpad?.fileCount === undefined
        ? tr('diag.crashpadUnavailable')
        : tr('diag.crashpadUsage', {
            files: diagnostics.runtime.crashpad.fileCount,
            size: formatBytes(diagnostics.runtime.crashpad.totalBytes || 0),
            maxFiles: diagnostics.runtime.crashpad.limits?.maxFiles || 100,
            maxSize: formatBytes(diagnostics.runtime.crashpad.limits?.maxBytes || 0)
          })
    })
  ];

  if (diagnostics.warnings.length) {
    lines.push('', tr('diag.txt.warnings'), ...diagnostics.warnings.map((warning) => `- ${warning}`));
  }

  lines.push('', tr('diag.txt.scanAreas'));
  diagnostics.sessionAreas.forEach((area) => {
    lines.push(`- ${area.label}: ${area.exists ? tr('diag.exists') : tr('diag.notExists')} · ${area.path}`);
  });

  lines.push('', tr('diag.txt.launchCandidates'));
  (diagnostics.executable.candidateDetails || []).forEach((item) => {
    lines.push(`- ${item.exists ? tr('diag.available') : tr('diag.unavailable')} · ${item.source} · ${item.path}`);
  });

  if (diagnostics.executable.discoveryChannels?.length) {
    lines.push('', tr('diag.txt.discoveryChannels'));
    diagnostics.executable.discoveryChannels.forEach((item) => {
      lines.push('- ' + tr('diag.txt.channelLine', { source: item.source, n: item.count }));
    });
  }

  lines.push('', tr('diag.txt.dataDirCandidates'));
  (diagnostics.defaultProfile?.candidates || []).forEach((item) => {
    lines.push(`- ${item.score >= 0 ? tr('diag.exists') : tr('diag.notExists')} · ${item.source} · ${item.path}`);
  });

  if (diagnostics.migration?.needed) {
    lines.push('', tr('diag.txt.migrateSuggest', { path: diagnostics.migration.recommendedPath }));
  }

  return lines.join('\n');
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

// ── 调度中枢：后台对话在台面上的样子 ─────────────────────
// 只演 AgentDesk 知道的事：调用经过它中转，开始、在跑、结束都是确切的，由 Main 在每次变化时推过来，这里不轮询。
// 发起方只有在 AgentDesk 知道是哪只猫时（它中转的上一段对话，或发起的进程就在那个账号的目录里）才从那只猫飞出；
// 否则信封从桌子边缘进来，自报的名字只当标签显示。动效规矩在 pixel/desk.js：后台不演、减少动态效果时不演、可打断。
const HUB_AFTERGLOW_MS = 15000;
const HUB_ACTIVE = new Set(['starting', 'running']);

async function loadHub() {
  let result = null;
  try { result = await window.manager.hubState(); } catch (_error) { result = null; }
  if (!result || !Array.isArray(result.runs)) return;
  state.hub.runs = new Map(result.runs.map((run) => [run.id, run]));
  applyHubSettings(result);
  hubRefresh();
}

// ── 调度中枢：档案里的两个开关、系统页的文件夹与上限 ─────────
// 这些只在桌面窗口里由人来改；命令行没有对应的命令，所以一个 Agent 不能给自己或别人开门。
// 文件夹只能从 Main 打开的系统选择框里来，这里只送编号。
function applyHubSettings(result) {
  if (!result || typeof result !== 'object') return;
  // 开关正在保存时不拿中途读到的旧值盖掉人刚点的样子；保存的结果会补上
  if (Array.isArray(result.accounts) && !state.hub.saving) state.hub.accounts = result.accounts;
  if (result.clients && typeof result.clients === 'object') state.hub.clients = result.clients;
  if (Array.isArray(result.folders)) state.hub.folders = result.folders;
  if (Number.isInteger(result.maxConcurrent)) state.hub.maxConcurrent = result.maxConcurrent;
  renderHubSystem();
  if (els.agentManageDialog?.open) renderAgentManageContext();
}

function hubNameKey(value) {
  return String(value || '').normalize('NFKC').trim().toLocaleLowerCase();
}

const HUB_UNSUPPORTED_NOTES = {
  'desktop-only': 'hub.dossier.desktopOnly',
  'prompt-argument-only': 'hub.dossier.promptArgOnly',
  'no-read-only-mode': 'hub.dossier.noReadOnly'
};

// 档案的“调用”一段跟着展开的那个位置走；只对本机位置有意义（调用只在这台电脑上）。
function renderHubCalling(group, profile) {
  const section = els.hubCallingSection;
  if (!section) return;
  const profileId = profile && profile._remote !== true ? String(profile._meshProfileId || profile.id) : '';
  const account = profileId ? state.hub.accounts.find((item) => item.id === profileId) || null : null;
  section.hidden = !group || !account;
  if (section.hidden) {
    delete section.dataset.profileId;
    return;
  }
  section.dataset.profileId = profileId;
  const support = state.hub.clients[profile.appId] || { callable: false, reason: null, via: null };
  const supported = support.callable === true;
  const callable = supported && account.callable === true;
  const writable = callable && account.writable === true;
  els.hubCallingName.textContent = tr('hub.dossier.name', { name: account.name });
  els.hubAllowCall.checked = callable;
  els.hubAllowCall.disabled = !supported;
  els.hubAllowWrite.checked = writable;
  els.hubAllowWrite.disabled = !callable;
  els.hubAllowCallState.textContent = tr(callable ? 'hub.dossier.on' : 'hub.dossier.off');
  els.hubAllowWriteState.textContent = tr(writable ? 'hub.dossier.on' : 'hub.dossier.off');
  const notes = [];
  if (!supported) {
    notes.push(tr(HUB_UNSUPPORTED_NOTES[support.reason] || 'hub.dossier.notVerified', { client: appLabel(profile.appId) }));
  } else {
    notes.push(tr('hub.dossier.via', { where: `${tr('hub.dossier.here')} · ${support.via || appLabel(profile.appId)}` }));
    if (callable) {
      // 同名的可被调用的位置不止一个时，调用方只能用编号
      const key = hubNameKey(account.name);
      const same = state.hub.accounts.filter((item) => item.callable && hubNameKey(item.name) === key);
      if (same.length > 1) {
        const cats = new Set(same.map((item) => hubGroupKey(item.id) || item.id));
        notes.push(cats.size > 1
          ? tr('hub.dossier.duplicate', { n: cats.size, id: profileId })
          : tr('hub.dossier.duplicateSelf', { n: same.length, id: profileId }));
      }
      if (!state.hub.folders.length) notes.push(tr('hub.dossier.noFolder'));
    }
  }
  els.hubCallingNotes.replaceChildren(...notes.map((text) => {
    const note = document.createElement('p');
    note.className = 'dossier-note';
    note.textContent = text;
    return note;
  }));
}

// 开关先按人点的样子显示，Main 存好后以它返回的为准；没存上就退回原样并说一声。
async function saveHubAccess(next) {
  const profileId = els.hubCallingSection?.dataset.profileId;
  if (!profileId || !window.manager.hubSetAccess) return;
  const before = state.hub.accounts.find((item) => item.id === profileId);
  if (!before || state.hub.saving) {
    renderAgentManageContext();
    return;
  }
  const patch = (value) => {
    state.hub.accounts = state.hub.accounts.map((item) => (item.id === profileId ? { ...item, ...value } : item));
  };
  state.hub.saving = true;
  patch({ callable: next.callable === true, writable: next.callable === true && next.writable === true });
  renderAgentManageContext();
  let result = null;
  try { result = await window.manager.hubSetAccess({ profileId, callable: next.callable === true, writable: next.writable === true }); } catch (_error) { result = null; }
  state.hub.saving = false;
  if (result?.ok) {
    patch({ callable: result.hub?.callable === true, writable: result.hub?.writable === true });
  } else {
    patch({ callable: before.callable, writable: before.writable });
    setStatus(tr('hub.dossier.saveFailed'), 'error');
  }
  renderAgentManageContext();
}

function renderHubSystem() {
  const list = els.hubFolderList;
  if (!list) return;
  const items = state.hub.folders.map((folder) => {
    const item = document.createElement('li');
    const name = document.createElement('b');
    name.textContent = folder.name;
    const where = document.createElement('code');
    where.textContent = folder.displayPath;
    where.title = folder.displayPath;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.dataset.folderId = folder.id;
    remove.textContent = tr('hub.system.remove');
    remove.setAttribute('aria-label', `${tr('hub.system.remove')} ${folder.name}`);
    item.append(name, where, remove);
    return item;
  });
  if (!items.length) {
    const empty = document.createElement('li');
    empty.className = 'hub-folder-empty';
    empty.textContent = tr('hub.system.noFolders');
    items.push(empty);
  }
  list.replaceChildren(...items);
  if (els.hubMaxConcurrent) els.hubMaxConcurrent.value = String(state.hub.maxConcurrent);
}

async function addHubFolder() {
  if (!window.manager.hubAddFolder) return;
  let result = null;
  try { result = await window.manager.hubAddFolder(); } catch (_error) { result = null; }
  if (result?.ok) {
    applyHubSettings(result.state);
    return;
  }
  if (result?.reasonCode === 'cancelled') return;
  setStatus(tr(result?.reasonCode === 'folder-limit' ? 'hub.system.folderLimit'
    : (result?.reasonCode === 'folder-invalid' ? 'hub.system.folderInvalid' : 'hub.system.saveFailed')), 'error');
}

async function removeHubFolder(id) {
  if (!id || !window.manager.hubRemoveFolder) return;
  let result = null;
  try { result = await window.manager.hubRemoveFolder(id); } catch (_error) { result = null; }
  if (result?.state) applyHubSettings(result.state);
  if (!result?.ok) setStatus(tr('hub.system.saveFailed'), 'error');
}

async function setHubLimit(value) {
  if (!window.manager.hubSetMaxConcurrent) return;
  let result = null;
  try { result = await window.manager.hubSetMaxConcurrent(value); } catch (_error) { result = null; }
  if (result?.state) applyHubSettings(result.state);
  else {
    renderHubSystem();
    setStatus(tr('hub.system.saveFailed'), 'error');
  }
}

function hubRefresh() {
  applySessionFilter();
  renderAccountRoster();
  renderHubFooter();
  ensureHubTicker();
}

function applyHubChange(run) {
  if (!run || typeof run.id !== 'string') {
    void loadHub();
    return;
  }
  if (state.hub.pending.has(run.id)) {
    // 信封还在路上：落地时用最新的这一份
    state.hub.pending.set(run.id, run);
    return;
  }
  const previous = state.hub.runs.get(run.id) || null;
  if (!previous && HUB_ACTIVE.has(run.state)) {
    hubStart(run);
    return;
  }
  state.hub.runs.set(run.id, run);
  if (previous && previous.state !== run.state) hubEnd(run, previous.state);
  hubRefresh();
}

function hubGroupKey(profileId) {
  if (!profileId) return null;
  const group = identityGroups().find((item) => item.members.some((member) => (
    !member._remote && String(member._meshProfileId || member.id) === String(profileId)
  )));
  return group?.key || null;
}

function hubNameOf(profileId) {
  const key = hubGroupKey(profileId);
  return identityGroups().find((group) => group.key === key)?.primary?.name || null;
}

function hubCardOf(groupKey) {
  return groupKey ? [...(els.accountRoster?.children || [])].find((card) => card.dataset.agentId === groupKey) || null : null;
}

// 猫胸口的位置；卡片被滚出名册可见区时，停在名册靠它那一侧的边上
function hubCatPoint(groupKey) {
  const canvas = hubCardOf(groupKey)?.querySelector('.account-card-avatar');
  const point = window.PixelDesk?.center(canvas, 10);
  if (!point || !els.accountRoster) return point || null;
  const box = els.accountRoster.getBoundingClientRect();
  return { x: Math.max(box.left + 16, Math.min(box.right - 16, point.x)), y: point.y };
}

// 台面外面：Agent 区的左上角
function hubEdgePoint(near) {
  const panel = els.accountRoster?.closest('.agent-panel') || els.accountRoster;
  const box = panel?.getBoundingClientRect();
  if (!box) return null;
  return { x: box.left - 12, y: Math.max(box.top + 8, (near?.y || box.top + 60) - 40) };
}

function hubCue(kind) {
  try { window.PixelUi?.hubSound?.(kind); } catch (_error) { /* sound is optional */ }
}

function hubCatAct(groupKey, action) {
  if (!groupKey || !window.PixelDesk?.foreground() || window.PixelDesk.reduced()) return;
  window.PixelUi?.catAct(groupKey, action);
}

function hubOverride(groupKey, catState, ms) {
  if (!groupKey) return;
  state.hub.overrides.set(groupKey, { state: catState, until: Date.now() + ms });
  setTimeout(() => renderAccountRoster(), ms + 60);
}

// 卡片上这只猫此刻因为后台对话该是什么样：被叫在跑的在干活；同时叫着两只以上的那只戴上领结
// 一只猫同时在跑几条对话：本机各运行位置的探测结果（同一份数据根只算一次），和调度中枢正在跑的、
// 目标是它的那几段，两者可能是同一条，所以取较大的而不相加。远端位置没有这项数据，不计；都不知道时返回 null。
function cardRunningCount(group, merged) {
  const ids = new Set((group?.members || []).filter((member) => !member._remote).map((member) => String(member._meshProfileId || member.id)));
  let hub = 0;
  for (const run of state.hub.runs.values()) {
    if (HUB_ACTIVE.has(run.state) && ids.has(String(run.target?.id))) hub += 1;
  }
  const files = merged && Number.isFinite(merged.writingNow) ? merged.writingNow : null;
  if (files === null && hub === 0) return null;
  return Math.max(files || 0, hub);
}

function hubCardState(group) {
  const ids = new Set((group?.members || []).filter((member) => !member._remote).map((member) => String(member._meshProfileId || member.id)));
  let working = false;
  let calling = 0;
  for (const run of state.hub.runs.values()) {
    if (!HUB_ACTIVE.has(run.state)) continue;
    if (ids.has(String(run.target.id))) working = true;
    if (run.caller && ids.has(String(run.caller.id))) calling += 1;
  }
  const override = state.hub.overrides.get(group?.key);
  const after = override && override.until > Date.now() ? override.state : null;
  return { state: working ? 'working' : after, accessory: calling >= 2 ? 'bow' : null };
}

function hubStart(run) {
  const callee = hubGroupKey(run.target.id);
  const caller = run.caller ? hubGroupKey(run.caller.id) : null;
  hubCue(caller ? 'start' : 'outside');
  state.hub.pending.set(run.id, run);
  renderHubFooter();
  const to = hubCatPoint(callee);
  const from = caller ? hubCatPoint(caller) : hubEdgePoint(to);
  // 同一只同时叫几只：信封错开 150 毫秒
  const last = state.hub.lastStartByCaller.get(caller || 'outside') || 0;
  const delayMs = Math.max(0, last + 150 - Date.now());
  state.hub.lastStartByCaller.set(caller || 'outside', Date.now() + delayMs);
  const land = (played) => {
    const latest = state.hub.pending.get(run.id) || run;
    state.hub.pending.delete(run.id);
    state.hub.runs.set(latest.id, latest);
    state.hub.fresh.add(latest.id);
    if (played) window.PixelDesk.ring(to, 'brand');
    const from = caller ? hubNameOf(run.caller.id) : null;
    setStatus(from
      ? tr('hub.say.started', { from, to: latest.target.name })
      : tr('hub.say.startedOutside', { label: latest.from ? tr('hub.from.label', { label: latest.from }) : tr('hub.from.unknown'), to: latest.target.name }));
    hubRefresh();
    if (!HUB_ACTIVE.has(latest.state)) hubEnd(latest, 'running');
  };
  if (!window.PixelDesk || caller === callee) land(false);
  else window.PixelDesk.fly({ from, to, arc: caller ? 16 : 10, delayMs, onLand: land });
}

function hubEnd(run, before) {
  if (!HUB_ACTIVE.has(before) || HUB_ACTIVE.has(run.state)) return;
  const callee = hubGroupKey(run.target.id);
  const caller = run.caller ? hubGroupKey(run.caller.id) : null;
  const back = (kind, onArrive) => {
    if (!window.PixelDesk || caller === callee) return;
    const from = hubCatPoint(callee);
    const to = caller ? hubCatPoint(caller) : hubEdgePoint(from);
    window.PixelDesk.fly({ from, to, arc: 16, kind, delayMs: 200, onLand: (played) => { if (played) onArrive?.(to); } });
  };
  if (run.state === 'completed') {
    hubCue('done');
    hubOverride(callee, 'onduty', HUB_AFTERGLOW_MS);
    hubCatAct(callee, 'cheer');
    back('mail', (point) => {
      window.PixelDesk.ring(point, 'ok');
      if (caller) hubCatAct(caller, 'hop');
    });
    setStatus(tr('hub.say.done', { to: run.target.name }));
  } else if (run.state === 'failed') {
    hubOverride(callee, 'onduty', HUB_AFTERGLOW_MS);
    hubCatAct(callee, 'no');
    back('bad', () => {
      if (caller) {
        hubOverride(caller, 'confused', 2500);
        renderAccountRoster();
      }
    });
    // 红字的状态行本身会带出“出错”的声音（pixel/ui.js 认这个标记），这里不再另响
    const reason = run.reasonCode ? tr(`hub.reason.${run.reasonCode}`) : '';
    setStatus(tr('hub.say.failed', { to: run.target.name, reason: reason.startsWith('hub.reason.') ? '' : reason }), 'error');
  } else if (run.state === 'stopped') {
    hubOverride(callee, 'rest', HUB_AFTERGLOW_MS);
    hubCatAct(callee, 'settle');
    setStatus(tr('hub.say.stopped', { to: run.target.name }));
  }
}

async function hubStop(runId) {
  if (!window.manager.hubStopRun) return;
  const result = await window.manager.hubStopRun(runId);
  if (!result?.ok) setStatus(tr('hub.stopFailed'), 'error');
}

// 一段后台对话在账本里只占一行：被叫账号自己的那条会话找到以后，就用那一行
function withHubRuns(sessions) {
  if (!state.hub.runs.size) return sessions;
  const byKey = new Map();
  for (const run of state.hub.runs.values()) {
    if (run.session?.id) byKey.set(`${run.target.id}::${run.session.id}`, run);
  }
  const used = new Set();
  const out = sessions.map((session) => {
    if (session._remote) return session;
    const run = byKey.get(`${session._meshProfileId || session._profileId}::${session.address || session.id}`);
    if (!run) return session;
    used.add(run.id);
    return { ...session, _hubRun: run };
  });
  const lens = currentDeviceLensId();
  const localLens = !state.mesh.overview?.initialized || lens === 'all' || lens === state.mesh.overview?.localDeviceId;
  if (!localLens) return out;
  for (const run of state.hub.runs.values()) {
    if (used.has(run.id)) continue;
    if (state.ui.agentScope !== 'all' && hubGroupKey(run.target.id) !== currentAgentId()) continue;
    out.push({
      id: run.id,
      address: run.id,
      title: run.title,
      _hubRun: run,
      _hubOnly: true,
      _profileId: run.target.id,
      _accountName: run.target.name,
      appId: run.target.app,
      createdAt: run.startedAt || run.createdAt,
      updatedAt: HUB_ACTIVE.has(run.state) ? new Date().toISOString() : (run.endedAt || run.createdAt)
    });
  }
  return out;
}

function hubRowContext() {
  return {
    t: tr,
    nameOf: (profileId) => hubNameOf(profileId),
    appLabel: (appId) => appLabel(appId),
    compactDate,
    fullDate,
    onStop: (runId) => void hubStop(runId)
  };
}

function renderHubRow(session) {
  const run = session._hubRun;
  const row = document.createElement('tr');
  row.className = 'hub-run-row';
  row.dataset.runId = run.id;
  row.dataset.runState = run.state;
  if (state.hub.fresh.has(run.id)) {
    state.hub.fresh.delete(run.id);
    if (!window.PixelDesk?.reduced()) row.classList.add('fx-in');
  }
  const selectCell = document.createElement('td');
  selectCell.className = 'select-cell';
  row.append(selectCell);
  if (!session._hubOnly) {
    const key = sessionKey(session);
    row.dataset.sessionKey = key;
    const checked = state.ui.checkedConversationIds.has(key);
    row.classList.toggle('selected', checked);
    row.classList.toggle('session-active', key === state.ui.focusedConversationId);
    row.setAttribute('aria-selected', String(checked || key === state.ui.focusedConversationId));
    const checkbox = document.createElement('input');
    checkbox.className = 'session-select-box';
    checkbox.type = 'checkbox';
    checkbox.checked = checked;
    checkbox.setAttribute('aria-label', tr('session.selectOne', { title: run.title }));
    checkbox.addEventListener('click', (event) => event.stopPropagation());
    checkbox.addEventListener('change', () => setSessionChecked(session, checkbox.checked));
    selectCell.append(checkbox);
    row.addEventListener('click', (event) => {
      if (event.metaKey || event.ctrlKey) setSessionChecked(session, !state.ui.checkedConversationIds.has(key));
      else {
        focusSession(session);
        renderSessions();
      }
    });
  }
  const context = hubRowContext();
  for (const column of sessionColumns()) row.append(window.AgentHubUi.cellFor(run, column, context));
  return row;
}

function renderHubLinks() {
  if (!els.hubLinks || !window.AgentHubUi) return;
  const links = [];
  for (const run of state.hub.runs.values()) {
    if (!HUB_ACTIVE.has(run.state) || !run.caller) continue;
    const from = hubGroupKey(run.caller.id);
    const to = hubGroupKey(run.target.id);
    if (from && to && from !== to) links.push({ from, to });
  }
  window.AgentHubUi.renderLinks(els.hubLinks, els.accountRoster, links);
}

function renderHubFooter() {
  if (!els.hubFooter) return;
  let active = state.hub.pending.size;
  for (const run of state.hub.runs.values()) if (HUB_ACTIVE.has(run.state)) active += 1;
  els.hubFooter.hidden = active === 0;
  if (!active) {
    els.hubFooter.replaceChildren();
    return;
  }
  els.hubFooter.replaceChildren(window.AgentHubUi.lamp('running', tr), document.createTextNode(tr('hub.footer.running', { n: active })));
}

// 用时每秒走一格；没有在跑的就不留计时器。只读本地的钟，不向 Main 要数据。
function ensureHubTicker() {
  const any = [...state.hub.runs.values()].some((run) => run.state === 'running');
  if (!any) {
    clearInterval(state.hub.ticker);
    state.hub.ticker = null;
    return;
  }
  if (state.hub.ticker) return;
  state.hub.ticker = setInterval(() => {
    for (const cell of document.querySelectorAll('#sessionRows td[data-hub-elapsed]')) {
      const run = state.hub.runs.get(cell.dataset.hubElapsed);
      if (run) window.AgentHubUi.timeCell(run, hubRowContext(), cell);
    }
  }, 1000);
}

// ── 交接：发送到另一台电脑、收到别处送来的 ──────────────
// 发出去、对方确认收到都有回执，是确切的；对方不在线时信封停在顶栏，写着“等对方上线”。
const DESK_PENDING = new Set(['queued', 'sending', 'awaiting-ack']);

function deskTickRows(keys) {
  const floaters = document.getElementById('fxFloaters');
  if (!floaters) return;
  const wanted = new Set(keys || []);
  for (const row of document.querySelectorAll('#sessionRows tr[data-session-key]')) {
    if (!wanted.has(row.dataset.sessionKey)) continue;
    const box = row.getBoundingClientRect();
    if (box.bottom < 0 || box.top > window.innerHeight) continue;
    const tick = document.createElement('i');
    tick.className = 'desk-tick';
    tick.textContent = tr('transfers.delivered');
    // 停在标题那一栏的末尾，不压住时间和来源
    const project = row.querySelector('td.col-project')?.getBoundingClientRect();
    tick.style.left = `${Math.round((project ? project.left : box.right) - 112)}px`;
    tick.style.top = `${Math.round(box.top + box.height / 2 - 8)}px`;
    floaters.append(tick);
    setTimeout(() => tick.remove(), 2600);
  }
}

function deskLensPoint() {
  return window.PixelDesk?.center(document.getElementById('deviceLensButton'));
}

function deskFlyOut(entry) {
  const from = deskLensPoint();
  const out = from ? { x: window.innerWidth + 24, y: from.y } : null;
  window.PixelDesk?.fly({ from, to: out, arc: 0, onLand: () => deskTickRows(entry.keys) });
  if (!window.PixelDesk) deskTickRows(entry.keys);
}

function deskSendFlights() {
  for (const entry of state.hub.sent) {
    if (entry.flown) continue;
    entry.flown = true;
    const first = document.querySelector(`#sessionRows tr[data-session-key="${CSS.escape(entry.keys[0] || '')}"] .title-cell-main`);
    const from = window.PixelDesk?.center(first);
    window.PixelDesk?.fly({
      from, to: deskLensPoint(), arc: 10,
      onLand: () => {
        if (entry.state === 'completed') {
          entry.delivered = true;
          deskFlyOut(entry);
        }
        renderDeskParked();
      }
    });
  }
  renderDeskParked();
}

function deskTransfersChanged(previous, current) {
  const before = new Map((previous || []).map((item) => [item.transferId, item.state]));
  for (const entry of state.hub.sent) {
    const now = (current || []).find((item) => item.transferId === entry.transferId);
    if (!now) continue;
    entry.state = now.state;
    if (now.state === 'completed' && before.get(entry.transferId) !== 'completed' && entry.flown && !entry.delivered) {
      entry.delivered = true;
      deskFlyOut(entry);
    }
  }
  renderDeskParked();
  deskReceived(previous, current);
}

function renderDeskParked() {
  if (!els.deskParked) return;
  const waiting = (state.mesh.transfers || []).some((item) => (
    item.direction === 'outgoing' && item.type === 'session-pointer' && DESK_PENDING.has(item.state)
  ));
  els.deskParked.hidden = !waiting;
  els.deskParked.title = waiting ? tr('transfers.parked') : '';
  els.deskParked.setAttribute('aria-label', waiting ? tr('transfers.parked') : '');
}

// 收到：信封从窗口右上角飞进“收件箱”，按钮跳一下；数字由收件箱自己的计数更新
function deskReceived(previous, current) {
  const seen = new Set((previous || []).map((item) => item.transferId));
  const fresh = (current || []).some((item) => {
    if (item.direction !== 'incoming' || seen.has(item.transferId)) return false;
    const created = Date.parse(item.createdAt);
    return Number.isFinite(created) && Date.now() - created < 120000 && !['failed', 'cancelled', 'expired'].includes(item.state);
  });
  if (!fresh || !previous) return;
  const inbox = document.getElementById('activityCenterBtn');
  const to = window.PixelDesk?.center(inbox);
  const from = to ? { x: window.innerWidth + 16, y: -16 } : null;
  window.PixelDesk?.fly({
    from, to, arc: 12,
    onLand: (played) => {
      if (played) {
        window.PixelDesk.ring(to, 'brand');
        window.PixelFx?.once(inbox, 'fx-bump', 160);
      }
    }
  });
}

