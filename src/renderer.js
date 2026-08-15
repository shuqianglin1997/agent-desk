const state = {
  profiles: [],
  sessions: [],
  filteredSessions: [],
  ui: window.UiContext.create(),
  sessionView: 'compact',
  sessionSort: { key: 'updatedAt', direction: 'desc' },
  query: '',
  theme: null,
  view: 'classic',
  detailMode: 'session',
  detailBeforeRemote: 'session',
  utilityDialog: null,
  activity: {},
  quotas: {},
  quotaError: null,
  quotaSelfOpen: false,     // 「本号」chip 展开额度 Beta 详情块
  quotaOverviewOpen: false, // 「全院」chip 展开跨账号额度总览带
  ledger: null,
  remindersOn: true,
  profileQuitBehavior: 'close',
  atmosTime: 'auto',
  atmosWeather: 'auto',
  yardPositions: {},
  welcomed: false,
  onboardingProgress: { completedVersion: 0, completedAt: null },
  startupStage: 'created',
  firstUse: {
    mode: 'guide',
    model: null,
    busy: false
  },
  updateInfo: null,
  tools: {
    items: [],
    summary: null,
    checkedAt: null,
    loading: false,
    busyId: null,
    message: '',
    statusTone: 'idle'
  },
  mesh: {
    overview: null,
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

function currentSlotKey() {
  return window.UiContext.selectedSlotKey(state.ui);
}

function activeOutgoingRemoteSessions() {
  return state.mesh.remoteSessions.filter((item) => (
    item.direction === 'outgoing'
    && !['error', 'rejected', 'disconnected'].includes(item.state)
  ));
}

function currentProfileId() {
  const agentId = currentAgentId();
  const slotKey = currentSlotKey();
  const group = identityGroups().find((item) => item.key === agentId);
  const member = group?.members.find((item) => item._meshSlotKey === slotKey || item.id === slotKey)
    || (group?.members.length === 1 ? group.members[0] : null);
  return member?.id || null;
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
          provisioningClientForm: a.provisioningClientForm || null
        }
      ]));
    }
  } catch (_error) {
    // 保留内置默认
  }
  // 把配色喂给像素猫（浏览器侧模块无法 require 注册表）
  if (window.YardSprites) {
    for (const [id, meta] of Object.entries(state.appMeta)) window.YardSprites.APP_TAG[id] = meta.tagColor;
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
function appColor(appId) {
  return (state.appMeta[appId] && state.appMeta[appId].tagColor) || '#d96f33';
}

const els = {
  accountRoster: document.querySelector('#accountRoster'),
  presenterCount: document.querySelector('#presenterCount'),
  accountId: document.querySelector('#accountId'),
  accountBadge: document.querySelector('#accountBadge'),
  formSwitcher: document.querySelector('#formSwitcher'),
  formSelect: document.querySelector('#formSelect'),
  quotaChipSelf: document.querySelector('#quotaChipSelf'),
  quotaChipAll: document.querySelector('#quotaChipAll'),
  atmosSceneBtn: document.querySelector('#atmosSceneBtn'),
  atmosSceneLabel: document.querySelector('#atmosSceneLabel'),
  atmosPopover: document.querySelector('#atmosPopover'),
  topbarContext: document.querySelector('#topbarContext'),
  remoteActivityBtn: document.querySelector('#remoteActivityBtn'),
  yardStage: document.querySelector('#yardStage'),
  yardCanvas: document.querySelector('#yardCanvas'),
  yardOverlay: document.querySelector('#yardOverlay'),
  viewToggle: document.querySelector('#viewToggle'),
  classicViewBtn: document.querySelector('#classicViewBtn'),
  viewToggleLabel: document.querySelector('#viewToggleLabel'),
  globalMoreMenu: document.querySelector('#globalMoreMenu'),
  langToggle: document.querySelector('#langToggle'),
  accountActions: document.querySelector('#accountActions'),
  accountManage: document.querySelector('#accountManage'),
  agentManageDialog: document.querySelector('#agentManageDialog'),
  agentManageSummary: document.querySelector('#agentManageSummary'),
  agentManageRuntimeLabel: document.querySelector('#agentManageRuntimeLabel'),
  yardManageActions: document.querySelector('#yardManageActions'),
  addRuntimeLocationBtn: document.querySelector('#addRuntimeLocationBtn'),
  ledgerDone: document.querySelector('#ledgerDone'),
  ledgerMin: document.querySelector('#ledgerMin'),
  reminderToggle: document.querySelector('#reminderToggle'),
  atmosTime: document.querySelector('#atmosTime'),
  atmosWeather: document.querySelector('#atmosWeather'),
  toolCenterBtn: document.querySelector('#toolCenterBtn'),
  activityCenterBtn: document.querySelector('#activityCenterBtn'),
  activityCountBadge: document.querySelector('#activityCountBadge'),
  settingsBtn: document.querySelector('#settingsBtn'),
  deviceCenterBtn: document.querySelector('#deviceCenterBtn'),
  deviceLensSelect: document.querySelector('#deviceLensSelect'),
  deviceCountBadge: document.querySelector('#deviceCountBadge'),
  mainGrid: document.querySelector('#mainGrid'),
  detailPanel: document.querySelector('#detailPanel'),
  detailSurfaceQuota: document.querySelector('#detailSurfaceQuota'),
  sessionPane: document.querySelector('#sessionPane'),
  sessionInspector: document.querySelector('#sessionInspector'),
  sessionInspectorEmpty: document.querySelector('#sessionInspectorEmpty'),
  sessionInspectorFields: document.querySelector('.inspector-primary-fields'),
  remoteWorkspaceHost: document.querySelector('#remoteWorkspaceHost'),
  deviceCenterDialog: document.querySelector('#deviceCenterDialog'),
  closeDeviceCenterBtn: document.querySelector('#closeDeviceCenterBtn'),
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
  meshJoinPanel: document.querySelector('#meshJoinPanel'),
  meshJoinCode: document.querySelector('#meshJoinCode'),
  cancelJoinMeshBtn: document.querySelector('#cancelJoinMeshBtn'),
  confirmJoinMeshBtn: document.querySelector('#confirmJoinMeshBtn'),
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
  transferCenterBtn: document.querySelector('#transferCenterBtn'),
  importTaskPackageBtn: document.querySelector('#importTaskPackageBtn'),
  transferCenterDialog: document.querySelector('#transferCenterDialog'),
  activityCenterDialog: document.querySelector('#activityCenterDialog'),
  settingsDialog: document.querySelector('#settingsDialog'),
  refreshTransfersBtn: document.querySelector('#refreshTransfersBtn'),
  transferList: document.querySelector('#transferList'),
  taskPackageHistory: document.querySelector('#taskPackageHistory'),
  taskPackageHistoryCount: document.querySelector('#taskPackageHistoryCount'),
  taskPackageHistoryList: document.querySelector('#taskPackageHistoryList'),
  taskPackageHistoryEmpty: document.querySelector('#taskPackageHistoryEmpty'),
  incomingTaskPackages: document.querySelector('#incomingTaskPackages'),
  incomingTaskPackageCount: document.querySelector('#incomingTaskPackageCount'),
  incomingTaskPackageList: document.querySelector('#incomingTaskPackageList'),
  toolCenterDialog: document.querySelector('#toolCenterDialog'),
  toolCenterStatus: document.querySelector('#toolCenterStatus'),
  toolSummary: document.querySelector('#toolSummary'),
  toolCheckedAt: document.querySelector('#toolCheckedAt'),
  desktopToolList: document.querySelector('#desktopToolList'),
  cliToolList: document.querySelector('#cliToolList'),
  checkToolsBtn: document.querySelector('#checkToolsBtn'),
  updateAllToolsBtn: document.querySelector('#updateAllToolsBtn'),
  attentionInbox: document.querySelector('#attentionInbox'),
  attentionCount: document.querySelector('#attentionCount'),
  attentionItems: document.querySelector('#attentionItems'),
  attentionEmpty: document.querySelector('#attentionEmpty'),
  leaderboardBtn: document.querySelector('#leaderboardBtn'),
  leaderboardDialog: document.querySelector('#leaderboardDialog'),
  leaderboardBody: document.querySelector('#leaderboardBody'),
  themeToggle: document.querySelector('#themeToggle'),
  profileQuitBehavior: document.querySelector('#profileQuitBehavior'),
  updateBtn: document.querySelector('#updateBtn'),
  helpBtn: document.querySelector('#helpBtn'),
  addProfileBtn: document.querySelector('#addProfileBtn'),
  editProfileBtn: document.querySelector('#editProfileBtn'),
  removeProfileBtn: document.querySelector('#removeProfileBtn'),
  manageAgentRelationsBtn: document.querySelector('#manageAgentRelationsBtn'),
  launchBtn: document.querySelector('#launchBtn'),
  pathConfigBtn: document.querySelector('#pathConfigBtn'),
  diagnosticsBtn: document.querySelector('#diagnosticsBtn'),
  stopProfileBtn: document.querySelector('#stopProfileBtn'),
  cleanCrashpadBtn: document.querySelector('#cleanCrashpadBtn'),
  profileFolderBtn: document.querySelector('#profileFolderBtn'),
  refreshBtn: document.querySelector('#refreshBtn'),
  accountTitle: document.querySelector('#accountTitle'),
  accountMeta: document.querySelector('#accountMeta'),
  accountPath: document.querySelector('#accountPath'),
  accountNote: document.querySelector('#accountNote'),
  quotaOverview: document.querySelector('#quotaOverview'),
  quotaOverviewList: document.querySelector('#quotaOverviewList'),
  quotaOverviewMeta: document.querySelector('#quotaOverviewMeta'),
  quotaSummary: document.querySelector('#quotaSummary'),
  quotaPlan: document.querySelector('#quotaPlan'),
  quotaStateBadge: document.querySelector('#quotaStateBadge'),
  quotaRefreshBtn: document.querySelector('#quotaRefreshBtn'),
  quotaMeters: document.querySelector('#quotaMeters'),
  quotaMessage: document.querySelector('#quotaMessage'),
  sessionCount: document.querySelector('#sessionCount'),
  searchInput: document.querySelector('#searchInput'),
  sessionScopeCurrentBtn: document.querySelector('#sessionScopeCurrentBtn'),
  sessionScopeAllBtn: document.querySelector('#sessionScopeAllBtn'),
  sessionCompactBtn: document.querySelector('#sessionCompactBtn'),
  sessionDetailBtn: document.querySelector('#sessionDetailBtn'),
  sessionDisplayMenu: document.querySelector('#sessionDisplayMenu'),
  sessionDisplayLabel: document.querySelector('#sessionDisplayLabel'),
  sessionActionDock: document.querySelector('#sessionActionDock'),
  sessionSelectionBar: document.querySelector('#sessionSelectionBar'),
  sessionSelectionCount: document.querySelector('#sessionSelectionCount'),
  sessionSelectionIssue: document.querySelector('#sessionSelectionIssue'),
  clearSessionSelectionBtn: document.querySelector('#clearSessionSelectionBtn'),
  sessionFocusedActions: document.querySelector('#sessionFocusedActions'),
  sessionTable: document.querySelector('#sessionTable'),
  sessionHead: document.querySelector('#sessionHead'),
  sessionRows: document.querySelector('#sessionRows'),
  copySessionInfoBtn: document.querySelector('#copySessionInfoBtn'),
  sendSessionInfoBtn: document.querySelector('#sendSessionInfoBtn'),
  statusBar: document.querySelector('#statusBar'),
  statusText: document.querySelector('#statusText'),
  detailTitle: document.querySelector('#detailTitle'),
  detailAccount: document.querySelector('#detailAccount'),
  detailLocation: document.querySelector('#detailLocation'),
  detailCreated: document.querySelector('#detailCreated'),
  detailUpdated: document.querySelector('#detailUpdated'),
  detailSource: document.querySelector('#detailSource'),
  detailProject: document.querySelector('#detailProject'),
  detailCoordinate: document.querySelector('#detailCoordinate'),
  sessionReplicaPicker: document.querySelector('#sessionReplicaPicker'),
  sessionReplicaOptions: document.querySelector('#sessionReplicaOptions'),
  sessionTechnicalDetails: document.querySelector('#sessionTechnicalDetails'),
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
  agentCreateDialog: document.querySelector('#agentCreateDialog'),
  newAgentName: document.querySelector('#newAgentName'),
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
let yardMounted = false;
let updateBusy = false;
let updateButtonTimer = null;
let quotaRequest = null;
let quotaHasLoaded = false;
let quotaRequestedAt = 0;
const QUOTA_REFRESH_INTERVAL = 5 * 60_000;

window.addEventListener('DOMContentLoaded', async () => {
  state.startupStage = 'settings-loading';
  await loadUserSettings();
  initTheme();
  mountWorkspaceSurfaces();
  bindEvents();
  await loadApps();
  await loadDeviceOverview({ silent: true, skipWorkspaceRefresh: true });
  initYard();
  initCompanion();
  applyView();
  state.startupStage = 'profiles-loading';
  await loadProfiles(null, { presentFirstUseBeforeSessions: true });
  state.startupStage = 'task-package-history-loading';
  await loadTaskPackageHistory();
  state.startupStage = 'ready';
  loadActivity();
  loadQuotas();
  // 庭院和经典卡片都会展示活动状态/最近活跃，因此两种 Presenter 可见时都要刷新。
  // 8 秒一轮：干活/在岗要跟得上会话节奏，60 秒太钝会漏掉短生成；应用在后台时不扫。
  setInterval(() => {
    if (!document.hidden) loadActivity();
  }, 8000);
  // 额度查询走独立的慢轮询和主进程缓存，绝不混入 8 秒活跃度探测。
  setInterval(() => {
    if (!document.hidden) loadQuotas();
  }, QUOTA_REFRESH_INTERVAL);
  // Auto time follows the clock; auto weather advances on a calm 20–45 minute
  // deterministic schedule. A one-minute UI tick is enough and avoids work in
  // the background.
  setInterval(() => {
    if (!document.hidden && isYardView()) {
      window.YardScene.refreshAtmosphere();
      updateAtmosphereReadout();
    }
  }, 60_000);
  // 从最小化/后台切回前台时立刻刷新一次，别等下一轮
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    loadActivity();
    if (Date.now() - quotaRequestedAt >= QUOTA_REFRESH_INTERVAL) loadQuotas();
  });
});

const LEGACY_SETTING_KEYS = {
  theme: 'agentdesk-theme',
  view: 'agentdesk-view',
  remindersOn: 'agentdesk-reminders',
  atmosTime: 'agentdesk-yard-time',
  atmosWeather: 'agentdesk-yard-weather',
  welcomed: 'agentdesk-welcomed',
  ledger: 'agentdesk-ledger'
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
  const view = localSetting(LEGACY_SETTING_KEYS.view);
  const reminders = localSetting(LEGACY_SETTING_KEYS.remindersOn);
  const atmosTime = localSetting(LEGACY_SETTING_KEYS.atmosTime);
  const atmosWeather = localSetting(LEGACY_SETTING_KEYS.atmosWeather);
  const welcomed = localSetting(LEGACY_SETTING_KEYS.welcomed);
  const ledger = localSetting(LEGACY_SETTING_KEYS.ledger);

  if (theme !== null) legacy.theme = theme;
  if (view !== null) legacy.view = view;
  if (reminders !== null) legacy.remindersOn = reminders !== '0';
  if (atmosTime !== null) legacy.atmosTime = atmosTime;
  if (atmosWeather !== null) legacy.atmosWeather = atmosWeather;
  if (welcomed !== null) legacy.welcomed = welcomed === '1';
  if (ledger !== null) {
    try {
      legacy.ledger = JSON.parse(ledger);
    } catch (_error) {
      // Invalid legacy localStorage is ignored; the stable store will repair it.
    }
  }
  return legacy;
}

function applyUserSettings(value = {}) {
  state.theme = value.theme === 'light' || value.theme === 'dark' ? value.theme : null;
  state.view = value.view === 'yard' ? 'yard' : 'classic';
  state.ui = window.UiContext.setAgentScope(state.ui, value.sessionScope === 'all' ? 'all' : 'current');
  state.sessionView = value.sessionView === 'detail' ? 'detail' : 'compact';
  state.remindersOn = value.remindersOn !== false;
  state.profileQuitBehavior = value.profileQuitBehavior === 'keep' ? 'keep' : 'close';
  if (els.profileQuitBehavior) els.profileQuitBehavior.value = state.profileQuitBehavior;
  state.atmosTime = ['auto', 'day', 'dusk', 'night'].includes(value.atmosTime)
    ? value.atmosTime
    : 'auto';
  state.atmosWeather = ['auto', 'clear', 'cloudy', 'rain', 'snow'].includes(value.atmosWeather)
    ? value.atmosWeather
    : 'auto';
  state.welcomed = value.welcomed === true;
  state.onboardingProgress = window.OnboardingState
    ? window.OnboardingState.normalizeProgress(value.onboarding)
    : { completedVersion: 0, completedAt: null };
  state.ledger = value.ledger && typeof value.ledger === 'object' ? value.ledger : null;
  state.yardPositions = window.YardInteractions
    ? window.YardInteractions.normalizePositions(value.yardPositions)
    : {};
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
    if (Object.prototype.hasOwnProperty.call(patch, 'view')) {
      localStorage.setItem(LEGACY_SETTING_KEYS.view, patch.view);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'remindersOn')) {
      localStorage.setItem(LEGACY_SETTING_KEYS.remindersOn, patch.remindersOn ? '1' : '0');
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'atmosTime')) {
      localStorage.setItem(LEGACY_SETTING_KEYS.atmosTime, patch.atmosTime);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'atmosWeather')) {
      localStorage.setItem(LEGACY_SETTING_KEYS.atmosWeather, patch.atmosWeather);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'welcomed')) {
      localStorage.setItem(LEGACY_SETTING_KEYS.welcomed, patch.welcomed ? '1' : '0');
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'ledger')) {
      localStorage.setItem(LEGACY_SETTING_KEYS.ledger, JSON.stringify(patch.ledger));
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

function initTheme() {
  const theme = state.theme || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.dataset.theme = theme;
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

function maybeShowWelcome() {
  if (!onboardingNeedsPresentation()) return;
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
  state.welcomed = true;
  state.onboardingProgress = patch.onboarding;
  persistSettings(patch);
  els.welcomeDialog?.close();
  setStatus(tr('onboarding.status.complete'));
}

function closeAgentManageDialog() {
  if (els.agentManageDialog?.open) els.agentManageDialog.close();
}

function renderAgentManageContext() {
  const profile = selectedProfile();
  const localProfile = Boolean(profile && profile._remote !== true);
  const agent = catalogAgentById(currentAgentId());
  const group = identityGroups().find((item) => item.key === currentAgentId()) || null;
  const agentName = agent?.displayName || group?.primary?.name || profile?.name || tr('account.noneAgent');
  if (els.agentManageSummary) {
    els.agentManageSummary.textContent = `${agentName} · ${tr('account.manageHint')}`;
  }
  if (els.agentManageRuntimeLabel) {
    const group = identityGroups().find((item) => item.key === currentAgentId()) || null;
    els.agentManageRuntimeLabel.textContent = profile
      ? [profile._meshDeviceName, profile.name, appLabel(profile.appId)].filter(Boolean).join(' · ')
      : (group ? deploymentStateLabel(group.readiness?.state) : tr('devices.slot.choose'));
  }
  if (els.stopProfileBtn) els.stopProfileBtn.disabled = !localProfile;
  if (els.cleanCrashpadBtn) els.cleanCrashpadBtn.disabled = !localProfile;
}

function openAgentManageDialog() {
  if (!els.agentManageDialog) return;
  renderAgentManageContext();
  if (!els.agentManageDialog.open) els.agentManageDialog.showModal();
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
    if (state.mesh.overview?.initialized) openAgentCreationDialog();
    else openProfileCreationDialog();
  });
  els.addRuntimeLocationBtn?.addEventListener('click', () => {
    openProfileCreationDialog({ agentId: currentAgentId() });
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
    els.welcomeDialog?.close();
    openProfileCreationDialog();
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
  els.accountManage?.addEventListener('click', () => openAgentManageDialog());
  els.newProfileMode?.addEventListener('change', () => syncProfileAssignmentControls());
  els.newProfileApp?.addEventListener('change', () => syncProfileAssignmentControls());
  els.newProfileAgent?.addEventListener('change', () => syncProfileAssignmentControls());
  els.newProfileBinding?.addEventListener('change', () => syncProfileAssignmentControls());
  els.confirmAddProfileBtn.addEventListener('click', (event) => {
    event.preventDefault();
    void confirmProfileCreation();
  });

  els.editProfileBtn.addEventListener('click', () => {
    closeAgentManageDialog();
    openAgentOrProfileEditor();
  });
  els.confirmEditBtn.addEventListener('click', (event) => {
    event.preventDefault();
    void confirmAgentOrProfileEdit();
  });

  els.editCatRandom.addEventListener('click', () => {
    const breeds = window.YardCats.BREED_KEYS;
    const collars = window.YardCats.COLLAR_COLORS;
    const accs = window.YardCats.ACCESSORIES;
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    catDraft = { breed: pick(breeds), collar: pick(collars), accessory: pick(accs) };
    syncCatSwatches();
    renderCatPreview();
  });

  els.manageAgentRelationsBtn?.addEventListener('click', () => {
    closeAgentManageDialog();
    openAgentRelationsDialog();
  });
  els.removeProfileBtn.addEventListener('click', () => {
    closeAgentManageDialog();
    void openAgentOrProfileRemoval();
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
  els.slotAssignmentDialog?.addEventListener('close', () => {
    state.mesh.assigningSlotKey = null;
  });
  els.editDialog?.addEventListener('close', () => {
    state.mesh.editingAgentId = null;
  });

  els.launchBtn.addEventListener('click', () => void openCurrentAgent());

  // 运行位置切换只改变副作用落点；不重新加载会话，也不清空搜索或会话选择。
  els.formSelect?.addEventListener('change', () => {
    const value = els.formSelect.value;
    if (value.startsWith('prepare:')) {
      const [, appId, clientForm = 'desktop'] = value.split(':');
      const group = identityGroups().find((item) => item.key === currentAgentId()) || null;
      const action = currentAgentActionContext(group, null);
      rememberProvisioningChoice(group, action.deviceId, appId, clientForm);
      renderAccountHeader();
      return;
    }
    if (value && value !== currentProfileId()) selectSlot(value);
  });

  els.updateBtn.addEventListener('click', async () => {
    await handleUpdateClick();
  });

  window.manager.onUpdateProgress((progress) => {
    handleUpdateProgress(progress);
  });

  window.manager.onProfileRuntimeIncident?.((incident) => {
    if (incident?.reason === 'crashpad-repeated-signature') {
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
    syncYard();
  });

  els.profileQuitBehavior?.addEventListener('change', () => {
    state.profileQuitBehavior = els.profileQuitBehavior.value === 'keep' ? 'keep' : 'close';
    persistSettings({ profileQuitBehavior: state.profileQuitBehavior });
    setStatus(tr(state.profileQuitBehavior === 'keep'
      ? 'status.profileQuitKeep'
      : 'status.profileQuitClose'));
  });

  // 语言切换：循环 中 → EN → 日 → 中，持久化到 settings；setLang 已替换静态文案，
  // applyView 顺带刷新 viewToggle 的动态标签。
  els.langToggle?.addEventListener('click', () => {
    if (!window.I18N) return;
    const next = window.I18N.setLang(window.I18N.next(), { persist: true });
    persistSettings({ lang: next });
    updateLangToggle();
    applyView();
    rerenderLocalizedText(); // apply() 只换静态 data-i18n；动态渲染的文案也要重刷一遍
  });

  els.viewToggle.addEventListener('click', () => {
    state.view = 'yard';
    persistSettings({ view: state.view });
    applyView();
  });
  els.classicViewBtn?.addEventListener('click', () => {
    state.view = 'classic';
    persistSettings({ view: state.view });
    applyView();
  });

  els.reminderToggle.addEventListener('click', () => {
    state.remindersOn = !state.remindersOn;
    persistSettings({ remindersOn: state.remindersOn });
    els.reminderToggle.setAttribute('aria-pressed', String(state.remindersOn));
    els.reminderToggle.textContent = tr(state.remindersOn ? 'reminder.on' : 'reminder.off');
    setStatus(state.remindersOn ? tr('status.reminderEnabled') : tr('status.reminderDisabled'));
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

  els.settingsBtn?.addEventListener('click', () => {
    openUtilityDialog('settings');
  });

  els.deviceCenterBtn?.addEventListener('click', async () => {
    openUtilityDialog('devices');
    await loadDeviceOverview();
    ensureDeviceDetailForEntry();
    renderDeviceCenter();
  });

  els.closeDeviceCenterBtn?.addEventListener('click', () => closeUtilityDialog(els.deviceCenterDialog));

  for (const [kind, button, dialog] of utilityDialogEntries()) {
    dialog?.addEventListener('close', () => {
      const wasCurrent = state.utilityDialog === kind;
      button?.setAttribute('aria-expanded', 'false');
      if (!dialog.open && state.utilityDialog === kind) state.utilityDialog = null;
      if (wasCurrent) {
        requestAnimationFrame(() => {
          if (!document.querySelector('dialog:modal')) button?.focus({ preventScroll: true });
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

  els.cancelJoinMeshBtn?.addEventListener('click', () => {
    if (els.meshJoinPanel) els.meshJoinPanel.hidden = true;
  });

  els.confirmJoinMeshBtn?.addEventListener('click', async () => {
    await joinExistingMesh();
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

  // 「工具」入口：统一维护桌面 App 与终端工具。
  els.toolCenterBtn?.addEventListener('click', async () => {
    openUtilityDialog('tools');
    renderToolCenter();
    await refreshToolInventory(false);
  });

  els.checkToolsBtn?.addEventListener('click', async () => {
    await refreshToolInventory(true);
  });

  els.updateAllToolsBtn?.addEventListener('click', async () => {
    await updateAllManagedTools();
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

  if (window.manager.onTransfersChanged) {
    window.manager.onTransfersChanged((transfers) => {
      state.mesh.transfers = Array.isArray(transfers) ? transfers : [];
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
    closeAgentManageDialog();
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
    closeAgentManageDialog();
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
    closeAgentManageDialog();
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
    closeAgentManageDialog();
  });

  els.copyDiagnosticsBtn.addEventListener('click', async () => {
    if (!lastDiagnostics) return;
    await window.manager.writeClipboard(formatDiagnosticsText(lastDiagnostics));
    setStatus(tr('status.diagCopied'));
  });

  els.profileFolderBtn.addEventListener('click', async () => {
    const profile = selectedProfile();
    if (!profile) return;
    closeAgentManageDialog();
    const result = await window.manager.openPath(profile.profilePath);
    setStatus(result.message || result.reason || (result.ok ? tr('status.openAcctDirOk') : tr('status.openAcctDirFail')));
  });

  els.refreshBtn.addEventListener('click', async () => {
    closeAgentManageDialog();
    if (isYardView()) window.YardScene.fx('bell');
    const profile = selectedProfile();
    if (profile?._remote === true && window.manager.refreshMeshInventory) {
      await refreshRemoteInventoryForDevice(profile._meshDeviceId);
      return;
    }
    await loadSessions();
    await loadActivity();
    setStatus(isYardView() ? tr('status.refreshBell') : tr('status.refreshList'));
  });

  // 额度 chips 只切换右下详情，不再在 Agent 面板下方插入新行。
  els.quotaChipSelf?.addEventListener('click', () => {
    const opening = state.detailMode !== 'quota' || !state.quotaSelfOpen;
    state.quotaSelfOpen = opening;
    state.quotaOverviewOpen = false;
    setWorkspaceMode(opening ? 'quota' : 'sessions');
    renderQuotaSummary();
  });
  els.quotaChipAll?.addEventListener('click', () => {
    const opening = state.detailMode !== 'quota' || !state.quotaOverviewOpen;
    state.quotaSelfOpen = false;
    state.quotaOverviewOpen = opening;
    setWorkspaceMode(opening ? 'quota' : 'sessions');
    renderQuotaSummary();
    renderQuotaOverview();
  });

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

  els.leaderboardBtn.addEventListener('click', () => {
    renderLeaderboard();
    els.leaderboardDialog.showModal();
  });

  els.sessionScopeCurrentBtn?.addEventListener('click', () => {
    void setSessionScope('current');
  });

  els.sessionScopeAllBtn?.addEventListener('click', () => {
    void setSessionScope('all');
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
  });

  els.sendSessionInfoBtn?.addEventListener('click', async () => {
    await openSessionSendDialog(null, els.sendSessionInfoBtn);
  });

  els.clearSessionSelectionBtn?.addEventListener('click', () => {
    clearSessionActionSelection();
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

  els.transferCenterBtn?.addEventListener('click', async () => {
    await openTransferCenter(els.transferCenterBtn);
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

  els.openSessionFileBtn.addEventListener('click', async () => {
    const session = resolvedFocusedSession();
    const profile = sessionOwnerProfile(session);
    if (!profile || !session?.filePath) return;
    // 合流列表中会话可能属于组内另一个槽位，操作按归属槽位走
    const result = await window.manager.revealSession({
      profileId: sessionOwnerProfile(session).id,
      sessionId: session.id,
      filePath: session.filePath
    });
    setStatus(result.message || result.reason || (result.ok ? tr('status.sessionLocOk') : tr('status.sessionLocFail')));
  });

  els.exportSessionBtn.addEventListener('click', async () => {
    const session = resolvedFocusedSession();
    const profile = sessionOwnerProfile(session);
    if (!profile || !session || !window.manager.exportSession) return;
    const result = await window.manager.exportSession({
      profileId: sessionOwnerProfile(session).id,
      sessionId: session.id
    });
    if (result?.canceled) return;
    setStatus(result?.message || result?.reason || (result?.ok ? tr('status.exportOk') : tr('status.exportFail')));
  });
}

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
  closeAgentManageDialog();
  if (!state.mesh.overview?.initialized || !els.agentCreateDialog) return;
  els.newAgentName.value = '';
  els.newAgentGroup.value = '';
  els.newAgentNote.value = '';
  els.confirmAddAgentBtn.disabled = false;
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
  els.confirmAddAgentBtn.disabled = true;
  try {
    const result = await window.manager.createAgent({
      displayName,
      group: els.newAgentGroup.value,
      note: els.newAgentNote.value,
      baseRevision: currentCatalogRevision()
    });
    if (!result?.ok) throw new Error(result?.reasonCode || 'agent-create-failed');
    els.agentCreateDialog.close();
    await refreshCatalogWorkspace(result.overview, { agentId: result.agent.agentId });
    setStatus(tr('status.agentCreated', { name: result.agent.displayName }));
  } catch (error) {
    setStatus(tr('catalog.error.generic', { code: error?.message || 'agent-create-failed' }));
  } finally {
    if (els.agentCreateDialog.open) els.confirmAddAgentBtn.disabled = false;
  }
}

function openProfileCreationDialog(options = {}) {
  closeAgentManageDialog();
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
  closeAgentManageDialog();
  const meshMode = state.mesh.overview?.initialized === true;
  if (meshMode) {
    const agent = catalogAgentById(currentAgentId());
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
      id: agent.agentId,
      appId: profile?.appId || group?.primary?.appId || 'unknown',
      cat: agent.catAppearance,
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
      catAppearance: { ...catDraft },
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
    cat: { ...catDraft }
  });
  els.editDialog.close();
  await loadProfiles(profile.id);
  setStatus(tr('status.savedProfileCat'));
}

async function refreshCatalogWorkspace(overview, options = {}) {
  state.mesh.overview = overview;
  if (options.agentId && catalogAgentById(options.agentId)) {
    const group = identityGroupsForLens(currentDeviceLensId()).find((item) => item.key === options.agentId);
    const member = (group?.members || []).find((item) => item._meshSlotKey === options.slotKey)
      || preferredSlot(group?.members || []);
    if (group) {
      state.ui = window.UiContext.setAgent(state.ui, group.key, {
        slotKey: member?._meshSlotKey || member?.id
      });
      if (!member) state.ui = window.UiContext.setSlot(state.ui, null);
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
  closeAgentManageDialog();
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

  const agent = catalogAgentById(currentAgentId());
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
  closeAgentManageDialog();
  const agent = catalogAgentById(currentAgentId());
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
    setProfileContext(preferredId);
  } else if (!state.mesh.overview?.initialized && !currentAgentId() && state.profiles[0]) {
    // Pure-local mode keeps the released product's first-slot startup behavior.
    // Mesh mode intentionally starts with no implicit Agent selection.
    setProfileContext(state.profiles[0].id);
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
  const profile = selectedProfile();
  if (!profile && state.ui.agentScope === 'current') {
    state.sessions = [];
    validateSessionContext();
    applySessionFilter();
    return;
  }

  if (state.mesh.overview?.initialized && window.manager.listMeshSessions) {
    await loadMeshSessions();
    return;
  }

  // 当前账号：合流同一登录身份的全部形态；全部账号：一次扫描所有身份组。
  // 每条记录都带归属槽位 + 账号组元数据，跨账号排序、选择和操作仍能回到正确槽位。
  const groups = identityGroups();
  const currentGroup = profile ? groupOfProfile(profile.id) : null;
  const scopedGroups = state.ui.agentScope === 'all'
    ? groups
    : (currentGroup ? [currentGroup] : []);
  const descriptors = new Map();
  for (const group of scopedGroups) {
    for (const member of group.members) {
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
          _appLabel: appLabel(record.appId || member.appId)
        }))
      };
    } catch (_error) {
      return { ok: false, profileId: member.id, records: [] };
    }
  }));

  const loaded = results.flatMap((result) => result.records);

  state.sessions = loaded
    .sort((a, b) => (
      new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime()
    ));
  validateSessionContext();
  applySessionFilter();
}

async function loadMeshSessions(prefetchedRows = null) {
  let rows = Array.isArray(prefetchedRows) ? prefetchedRows : [];
  if (!Array.isArray(prefetchedRows)) {
    try {
      const result = await window.manager.listMeshSessions();
      if (!result?.ok || !Array.isArray(result.sessions)) throw new Error(result?.reasonCode || 'inventory-list-failed');
      rows = result.sessions;
    } catch (_error) {
      rows = [];
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
  validateSessionContext();
  applySessionFilter();
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
  return selectedProfile();
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
  els.sessionScopeCurrentBtn?.setAttribute('aria-pressed', String(!all));
  els.sessionScopeAllBtn?.setAttribute('aria-pressed', String(all));
  if (els.sessionScopeCurrentBtn) {
    els.sessionScopeCurrentBtn.disabled = !currentAgentId();
    els.sessionScopeCurrentBtn.title = currentAgentId() ? '' : tr('session.scope.noAgent');
  }
  els.sessionCompactBtn?.setAttribute('aria-pressed', String(!detail));
  els.sessionDetailBtn?.setAttribute('aria-pressed', String(detail));
  if (els.sessionDisplayLabel) {
    els.sessionDisplayLabel.textContent = tr(detail ? 'session.view.detail' : 'session.view.compact');
  }
  if (els.sessionTable) {
    els.sessionTable.dataset.scope = state.ui.agentScope;
    els.sessionTable.dataset.mode = state.sessionView;
  }
}

// ── 账号额度（Beta）────────────────────────────────────
async function loadQuotas(force = false) {
  if (!window.manager.listQuotas) return null;
  if (quotaRequest) return quotaRequest;

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
      // 刷整个控制条（含 ⚡ 能量徽章），renderAccountHeader 内部会级联 renderQuotaSummary → chips
      renderAccountHeader();
      syncYard();
    }
  })();
  // Render once more after quotaRequest becomes truthy so the loading marker
  // appears even when a previous snapshot is still on screen.
  renderQuotaSummary();
  return quotaRequest;
}

function selectedQuota() {
  const profileId = currentProfileId();
  return profileId ? state.quotas[profileId] || null : null;
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

function renderQuotaSummary() {
  // 总览与单账号额度共用同一批刷新时机（loadQuotas / selectProfile / refreshAll）。
  renderQuotaOverview();
  const profile = selectedProfile();
  els.quotaSummary.hidden = !profile;
  els.quotaRefreshBtn.disabled = !profile || Boolean(quotaRequest);
  if (!profile) return;

  // 额度 Beta 详情块默认收起（原型）：控制条上只留「本号」chip，点击 chip 展开本块
  els.quotaSummary.hidden = !state.quotaSelfOpen;
  const snapshot = selectedQuota();
  const loading = Boolean(quotaRequest);
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
    unsupported: tr('quota.status.unsupported'),
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
  const representatives = groups.map((group) => {
    const holder = group.members.find((member) => state.quotas[member.id]?.status === 'ok') || group.primary;
    return { ...holder, name: group.primary.name };
  });
  const rows = window.QuotaOverview
    ? window.QuotaOverview.buildQuotaOverview(representatives, state.quotas, Date.now())
    : [];

  // 控制条 chips（本号/全院）永远刷新，且不依赖总览带/聚合模块是否存在
  // （code-review：控制条核心 UI 不能被可选模块的守卫连带闸住）
  renderQuotaChips(groups, rows);
  if (!els.quotaOverview || !window.QuotaOverview) return;
  els.quotaOverview.hidden = !state.quotaOverviewOpen || groups.length < 2;
  if (els.quotaOverview.hidden) return;
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
}

// ── 控制条额度 chips（原型：本号 / 全院 各一枚，条形量表 + 百分比）────────
// 本号 = 选中账号（组）的最紧窗口剩余；全院 = 全部账号里最紧的那个（一眼看底线）。
function renderQuotaChips(groups, rows) {
  if (!els.quotaChipSelf || !els.quotaChipAll) return;
  const rowById = new Map(rows.map((row) => [String(row.profileId), row]));
  const selectedGroup = groups.find((group) => group.key === currentAgentId()) || null;
  let selfRow = null;
  if (selectedGroup) {
    for (const member of selectedGroup.members) {
      const row = rowById.get(String(member.id));
      if (row && (!selfRow || (row.hasQuota && !selfRow.hasQuota))) selfRow = row;
    }
  }
  setQuotaChip(els.quotaChipSelf, selfRow, tr('quota.chip.selfHint'));

  const known = rows.filter((row) => row.hasQuota);
  const allRow = known.length
    ? known.reduce((a, b) => (a.tightest.remainingPercent <= b.tightest.remainingPercent ? a : b))
    : null;
  setQuotaChip(els.quotaChipAll, allRow, tr('quota.chip.allHint'), allRow ? tr('quota.chip.allPrefix', { name: allRow.name }) : null);

  // 可展开控件惯例：aria-expanded 反映面板实际可见态；单账号没有总览可展，置灰
  els.quotaChipSelf.setAttribute('aria-expanded', String(Boolean(selectedGroup) && state.detailMode === 'quota' && state.quotaSelfOpen));
  els.quotaChipAll.disabled = groups.length < 2;
  els.quotaChipAll.setAttribute('aria-expanded', String(groups.length >= 2 && state.detailMode === 'quota' && state.quotaOverviewOpen));
  if (els.quotaChipAll.disabled) els.quotaChipAll.title = tr('quota.chip.noAll');
}

function setQuotaChip(chip, row, hint, prefix = null) {
  const fill = chip.querySelector('.mtr i');
  const value = chip.querySelector('b');
  if (!fill || !value) return; // chip 内部结构被改动时安静降级，别抛 TypeError（code-review 加固）
  const loading = Boolean(quotaRequest);
  if (row && row.hasQuota) {
    const percent = Math.max(0, Math.min(100, Math.round(row.tightest.remainingPercent)));
    chip.dataset.level = window.YardEnergy?.energyForRemaining?.(percent) || 'unknown';
    fill.style.width = `${percent}%`;
    value.textContent = `${percent}%`;
    chip.title = tr('quota.chip.title', { prefix: prefix || row.name, label: row.tightest.label, pct: percent, hint });
  } else {
    chip.dataset.level = 'unknown';
    fill.style.width = '0%';
    value.textContent = loading ? '…' : '—';
    chip.title = tr('quota.chip.hintOnly', { reason: row?.reason || (loading ? tr('quota.chip.querying') : tr('quota.chip.noData')), hint });
  }
}

function applySessionFilter() {
  const query = state.query;
  const filtered = query
    ? state.sessions.filter((session) => {
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
          session._deviceName
        ].filter(Boolean).some((value) => String(value).toLowerCase().includes(query));
      })
    : [...state.sessions];
  state.filteredSessions = window.SessionTable
    ? window.SessionTable.sort(filtered, state.sessionSort, dateLocale())
    : filtered;

  renderSessionControls();
  renderSessions();
  renderInspector();
}

// ── 猫咪档案卡（编辑对话框换装） ─────────────────────
let catDraft = { breed: 'orange', collar: '#c94f2e', accessory: 'none' };
let editingProfile = null;
let catSwatchesBuilt = false;

function openCatCustomizer(profile) {
  if (!window.YardCats || !window.YardSprites) return;
  editingProfile = profile;
  catDraft = window.YardCats.normalizeCat(profile.cat, profile.id);
  if (!catSwatchesBuilt) { buildCatSwatches(); catSwatchesBuilt = true; }
  syncCatSwatches();
  renderCatPreview();
}

function buildCatSwatches() {
  const breeds = window.YardSprites.BREEDS;
  window.YardCats.BREED_KEYS.forEach((key) => {
    els.editBreedSwatches.append(makeSwatch({
      dot: breeds[key].f, label: tr('cat.breed.' + key),
      pressed: () => catDraft.breed === key,
      pick: () => { catDraft = { ...catDraft, breed: key }; }
    }));
  });
  window.YardCats.COLLAR_COLORS.forEach((color) => {
    els.editCollarSwatches.append(makeSwatch({
      dot: color, label: tr('cat.collar.' + color),
      pressed: () => catDraft.collar === color,
      pick: () => { catDraft = { ...catDraft, collar: color }; }
    }));
  });
  window.YardCats.ACCESSORIES.forEach((id) => {
    els.editAccSwatches.append(makeSwatch({
      label: tr('cat.acc.' + id),
      pressed: () => catDraft.accessory === id,
      pick: () => { catDraft = { ...catDraft, accessory: id }; }
    }));
  });
}

function makeSwatch({ dot, label, pressed, pick }) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'cc-swatch';
  btn._pressed = pressed;
  if (dot) {
    const swatchDot = document.createElement('span');
    swatchDot.className = 'cc-dot';
    swatchDot.style.background = dot;
    btn.append(swatchDot);
  }
  const text = document.createElement('span');
  text.textContent = label;
  btn.append(text);
  btn.addEventListener('click', () => {
    pick();
    syncCatSwatches();
    renderCatPreview();
  });
  return btn;
}

function syncCatSwatches() {
  els.editDialog.querySelectorAll('.cc-swatch').forEach((btn) => {
    btn.setAttribute('aria-pressed', String(Boolean(btn._pressed && btn._pressed())));
  });
}

function renderCatPreview() {
  const canvas = els.editCatCanvas;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // 草地投影
  ctx.fillStyle = 'rgba(90, 130, 70, 0.28)';
  ctx.fillRect(24, 98, 64, 6);
  ctx.fillRect(30, 104, 52, 3);
  const S = window.YardSprites;
  const pal = S.BREEDS[catDraft.breed] || S.BREEDS.orange;
  const protectedSlot = Boolean(editingProfile && editingProfile.isProtected);
  S.drawCat(ctx, S.SIT, pal, {
    dx: 8, dy: 14, scale: 6, seed: 5,
    collar: catDraft.collar,
    bell: protectedSlot,
    tag: protectedSlot ? null : (editingProfile ? editingProfile.appId : 'claude'),
    accessory: catDraft.accessory === 'none' ? null : catDraft.accessory
  });
}

// ── 庭院视图 ─────────────────────────────────────────
function isYardView() {
  return yardMounted && document.body.dataset.view === 'yard';
}

function initYard() {
  if (!window.YardScene || !window.YardCats || !els.yardCanvas) return;
  window.YardScene.mount({
    canvas: els.yardCanvas,
    overlay: els.yardOverlay,
    onSelect: async (presenterId) => {
      const group = groupOfPresenterId(presenterId);
      if (!group) return;
      await selectAgent(group.key);
      setStatus(tr('status.selected', { name: group.agent?.displayName || group.primary.name }));
    },
    onPet: (profile) => {
      window.YardScene.say(profile.id, { text: tr('yard.say.purr'), kind: 'ambient', duration: 2800 });
      setStatus(tr('status.purr', { name: profile.name }));
    },
    onDrop: handleYardDrop
  });
  yardMounted = true;
  // 固定窗口 + 满铺裁剪横带：场景用固定逻辑尺寸（原生 480×236），CSS 满铺整宽、
  // 木框裁掉底部空草坪 —— 不再按容器宽响应式重算（回退改动①的 ResizeObserver）。
  initAtmosphere();
}

// 时间 / 天气控件：从稳定设置恢复，点击切换并持久化
function initAtmosphere() {
  const syncPressed = () => {
    els.atmosTime.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.time === state.atmosTime)));
    els.atmosWeather.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.weather === state.atmosWeather)));
  };
  els.atmosTime.addEventListener('click', (event) => {
    const btn = event.target.closest('button');
    if (!btn) return;
    state.atmosTime = btn.dataset.time;
    persistSettings({ atmosTime: state.atmosTime });
    window.YardScene.setAtmosphere({ time: state.atmosTime });
    syncPressed();
    updateAtmosphereReadout();
    setStatus(tr('status.yardTime', { label: tr('yard.time.' + state.atmosTime) }));
  });
  els.atmosWeather.addEventListener('click', (event) => {
    const btn = event.target.closest('button');
    if (!btn) return;
    state.atmosWeather = btn.dataset.weather;
    persistSettings({ atmosWeather: state.atmosWeather });
    window.YardScene.setAtmosphere({ weather: state.atmosWeather });
    syncPressed();
    updateAtmosphereReadout();
    setStatus(tr('status.yardWeather', { label: tr('yard.weather.' + state.atmosWeather) }));
  });
  els.atmosPopover?.addEventListener('toggle', (event) => {
    if (event.newState !== 'open' || !els.atmosSceneBtn) return;
    const anchor = els.atmosSceneBtn.getBoundingClientRect();
    const width = Math.min(320, window.innerWidth - 24);
    els.atmosPopover.style.width = `${width}px`;
    els.atmosPopover.style.left = `${Math.max(12, Math.min(window.innerWidth - width - 12, anchor.right - width))}px`;
    els.atmosPopover.style.top = `${Math.min(window.innerHeight - 230, anchor.bottom + 8)}px`;
  });

  window.YardScene.setAtmosphere({ time: state.atmosTime, weather: state.atmosWeather });
  syncPressed();
  updateAtmosphereReadout();
}

function updateAtmosphereReadout() {
  if (!window.YardScene?.getAtmosphere) return;
  const current = window.YardScene.getAtmosphere();
  els.yardStage.dataset.time = current.time;
  els.yardStage.dataset.weather = current.weather;
  const autoTime = els.atmosTime.querySelector('[data-time="auto"]');
  const autoWeather = els.atmosWeather.querySelector('[data-weather="auto"]');
  if (els.atmosSceneLabel) {
    const timeKey = state.atmosTime === 'auto' ? 'auto' : current.time;
    const weatherKey = state.atmosWeather === 'auto' ? 'auto' : current.weather;
    els.atmosSceneLabel.textContent = tr('yard.atmos.sceneValue', {
      time: tr(`yard.time.${timeKey}`),
      weather: tr(`yard.weather.${weatherKey}`)
    });
  }
  if (autoTime) autoTime.title = tr('atmos.autoTimeTip', { label: tr('yard.time.' + current.time) });
  if (autoWeather) {
    const next = current.nextWeatherAt ? compactDate(current.nextWeatherAt) : tr('atmos.later');
    autoWeather.title = tr('atmos.autoWeatherTip', { label: tr('yard.weather.' + current.weather), next });
  }
}

// ── Personal Agent Mesh / 设备中心 ──────────────────
let remoteSurfaceLayoutFrame = null;
let remoteSurfaceObserver = null;
let deviceJourneyPollTimer = null;
let deviceJourneyPollPromise = null;
const DETAIL_MODES = new Set(['session', 'quota', 'remote']);
const childDialogReturnFocus = new WeakMap();
const childDialogFocusBound = new WeakSet();

function captureChildDialogReturnFocus(trigger = document.activeElement) {
  if (!(trigger instanceof HTMLElement)) return null;
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
        returnFocus.focus({ preventScroll: true });
      });
    });
  }
  dialog.showModal();
}

function utilityDialogEntries() {
  return [
    ['devices', els.deviceCenterBtn, els.deviceCenterDialog],
    ['tools', els.toolCenterBtn, els.toolCenterDialog],
    ['activity', els.activityCenterBtn, els.activityCenterDialog],
    ['settings', els.settingsBtn, els.settingsDialog]
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

function closeUtilityDialog(dialog) {
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
  if (returnFocus) {
    requestAnimationFrame(() => {
      if (!document.querySelector('dialog:modal')) returnFocus.focus({ preventScroll: true });
    });
  }
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

function detailSurfaceEntries() {
  return [
    ['session', els.sessionInspector],
    ['quota', els.detailSurfaceQuota],
    ['remote', els.remoteWorkspaceHost]
  ];
}

function setDetailMode(mode) {
  const next = DETAIL_MODES.has(mode) ? mode : 'session';
  state.detailMode = next;
  if (els.mainGrid) els.mainGrid.dataset.detail = next;
  if (els.detailPanel) els.detailPanel.dataset.detail = next;
  for (const [name, surface] of detailSurfaceEntries()) {
    if (surface) surface.hidden = name !== next;
  }

  if (els.quotaChipSelf) els.quotaChipSelf.setAttribute('aria-expanded', String(next === 'quota' && state.quotaSelfOpen));
  if (els.quotaChipAll) els.quotaChipAll.setAttribute('aria-expanded', String(next === 'quota' && state.quotaOverviewOpen));

  if (next === 'remote') scheduleRemoteSurfaceLayout();
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
    const result = await window.manager.listDevices();
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

function renderDeviceLens(overview) {
  if (!els.deviceLensSelect) return;
  const initialized = overview?.initialized === true;
  els.deviceLensSelect.hidden = !initialized;
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
    { disabled: state.mesh.loading }
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

async function createDeviceInvitation() {
  if (state.mesh.loading || !window.manager.createDeviceInvite) return;
  state.mesh.loading = true;
  state.mesh.errorCode = null;
  state.mesh.message = tr('devices.invite.creating');
  renderDeviceCenter();
  const result = await window.manager.createDeviceInvite();
  state.mesh.loading = false;
  if (!result?.ok) {
    state.mesh.errorCode = result?.reasonCode || 'pairing-invite-failed';
    state.mesh.message = '';
  } else {
    state.mesh.invitation = result.invitation;
    state.mesh.message = tr('devices.invite.ready', { code: result.invitation.shortCode });
  }
  renderDeviceCenter();
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

async function joinExistingMesh() {
  const code = String(els.meshJoinCode?.value || '').trim();
  if (!code) {
    state.mesh.errorCode = 'pairing-code-required';
    renderDeviceCenter();
    return;
  }
  openDeviceJourney('join', els.confirmJoinMeshBtn);
  state.mesh.deviceJourney = window.DeviceJourney.transition(state.mesh.deviceJourney, {
    type: 'code',
    code
  }, state.mesh.overview);
  renderDeviceJourney();
  await inspectDeviceJourneyInvitation();
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
async function refreshToolInventory(force = false) {
  if (!window.manager.scanTools || state.tools.loading) return;
  state.tools.loading = true;
  state.tools.statusTone = 'idle';
  state.tools.message = tr('tools.status.checking');
  renderToolCenter();
  try {
    const result = await window.manager.scanTools({ force });
    if (!result?.ok || !Array.isArray(result.items)) {
      throw new Error(result?.reason || tr('tools.status.checkFailed'));
    }
    state.tools.items = result.items;
    state.tools.summary = result.summary || null;
    state.tools.checkedAt = result.checkedAt || null;
    const updates = Number(result.summary?.updates || 0);
    state.tools.message = updates
      ? tr('tools.status.updatesFound', { n: updates })
      : tr('tools.status.checked');
  } catch (error) {
    state.tools.statusTone = 'error';
    state.tools.message = tr('tools.status.checkError', { msg: error.message || error });
  } finally {
    state.tools.loading = false;
    renderToolCenter();
  }
}

function renderToolCenter() {
  if (!els.desktopToolList || !els.cliToolList) return;
  const desktop = state.tools.items.filter((item) => item.kind === 'desktop');
  const terminal = state.tools.items.filter((item) => item.kind !== 'desktop');
  renderToolList(els.desktopToolList, desktop);
  renderToolList(els.cliToolList, terminal);

  const summary = state.tools.summary;
  if (els.toolSummary) {
    els.toolSummary.textContent = summary
      ? tr('tools.summary', {
          installed: summary.installed || 0,
          total: summary.total || 0,
          updates: summary.updates || 0
        })
      : tr('tools.summary.waiting');
  }
  if (els.toolCheckedAt) {
    els.toolCheckedAt.textContent = state.tools.checkedAt
      ? tr('tools.checkedAt', { time: compactDate(state.tools.checkedAt) })
      : tr('tools.notChecked');
  }
  if (els.toolCenterStatus) {
    els.toolCenterStatus.textContent = state.tools.message || tr('tools.status.ready');
    els.toolCenterStatus.dataset.state = state.tools.loading || state.tools.busyId
      ? 'busy'
      : state.tools.statusTone;
  }
  if (els.checkToolsBtn) {
    els.checkToolsBtn.disabled = state.tools.loading || Boolean(state.tools.busyId);
    els.checkToolsBtn.textContent = state.tools.loading
      ? tr('tools.checking')
      : tr('tools.check');
  }
  if (els.updateAllToolsBtn) {
    const count = Number(summary?.automatic || 0);
    els.updateAllToolsBtn.disabled = state.tools.loading || Boolean(state.tools.busyId) || count === 0;
    els.updateAllToolsBtn.textContent = state.tools.busyId === 'all'
      ? tr('tools.updatingAll')
      : tr('tools.updateAll', { n: count });
  }
}

function renderToolList(container, items) {
  container.replaceChildren();
  if (state.tools.loading && !items.length) {
    for (let index = 0; index < (container === els.desktopToolList ? 4 : 6); index += 1) {
      const skeleton = document.createElement('div');
      skeleton.className = 'tool-card tool-card-skeleton';
      skeleton.setAttribute('aria-hidden', 'true');
      container.append(skeleton);
    }
    return;
  }
  if (!items.length) {
    const empty = document.createElement('p');
    empty.className = 'tool-list-empty';
    empty.textContent = tr('tools.empty');
    container.append(empty);
    return;
  }

  for (const item of items) {
    const status = toolStatus(item);
    const card = document.createElement('article');
    card.className = 'tool-card';
    card.dataset.toolId = item.id;
    card.dataset.state = status.state;
    card.dataset.installed = String(Boolean(item.installed));

    const rail = document.createElement('span');
    rail.className = 'tool-card-rail';
    rail.setAttribute('aria-hidden', 'true');

    const identity = document.createElement('div');
    identity.className = 'tool-card-identity';
    const name = document.createElement('strong');
    name.textContent = item.label;
    const kind = document.createElement('small');
    kind.textContent = tr(`tools.kind.${item.kind}`);
    identity.append(name, kind);

    const badge = document.createElement('b');
    badge.className = 'tool-status-badge';
    badge.textContent = status.label;

    const version = document.createElement('div');
    version.className = 'tool-version-track';
    const local = document.createElement('span');
    local.textContent = item.installedVersion
      ? `v${item.installedVersion}`
      : item.installed
        ? tr('tools.version.detected')
        : tr('tools.version.none');
    const arrow = document.createElement('i');
    arrow.textContent = '→';
    const latest = document.createElement('span');
    latest.textContent = item.latestVersion
      ? `v${item.latestVersion}`
      : item.kind === 'desktop'
        ? tr('tools.version.appManaged')
        : '—';
    version.append(local, arrow, latest);

    const source = document.createElement('small');
    source.className = 'tool-source';
    const manager = !item.installed && item.kind === 'cli'
      ? ''
      : tr(`tools.manager.${item.manager}`);
    const sourceLabel = item.sourceKey
      ? tr(`tools.source.${item.sourceKey}`)
      : item.source;
    source.textContent = [manager, sourceLabel].filter(Boolean).join(' · ');
    source.title = source.textContent;

    const actions = document.createElement('div');
    actions.className = 'tool-card-actions';
    const open = document.createElement('button');
    open.type = 'button';
    open.textContent = item.installed ? tr('tools.open') : tr('tools.get');
    open.disabled = state.tools.loading || Boolean(state.tools.busyId);
    open.addEventListener('click', () => openManagedTool(item));
    actions.append(open);

    if (item.kind !== 'terminal' && item.installed && item.canUpdate) {
      const update = document.createElement('button');
      update.type = 'button';
      update.className = item.updateAvailable === true ? 'primary' : '';
      update.textContent = toolUpdateActionLabel(item);
      update.disabled = state.tools.loading ||
        Boolean(state.tools.busyId) ||
        item.updateAvailable === false;
      update.addEventListener('click', () => updateManagedTool(item));
      actions.append(update);
    }

    card.append(rail, identity, badge, version, source, actions);
    container.append(card);
  }
}

function toolStatus(item) {
  if (state.tools.busyId === item.id || state.tools.busyId === 'all') {
    return { state: 'busy', label: tr('tools.state.updating') };
  }
  if (!item.installed) return { state: 'missing', label: tr('tools.state.missing') };
  if (item.kind === 'terminal') return { state: 'system', label: tr('tools.state.system') };
  if (item.updateAvailable === true) return { state: 'update', label: tr('tools.state.update') };
  if (item.updateAvailable === false) return { state: 'current', label: tr('tools.state.current') };
  if (item.checkError) return { state: 'error', label: tr('tools.state.checkError') };
  if (item.kind === 'desktop') return { state: 'managed', label: tr('tools.state.appManaged') };
  if (item.canAutoUpdate) return { state: 'unknown', label: tr('tools.state.canCheck') };
  return { state: 'manual', label: tr('tools.state.manual') };
}

function toolUpdateActionLabel(item) {
  if (item.updateAvailable === false) return tr('tools.current');
  if (item.canAutoUpdate) {
    return item.updateAvailable === true ? tr('tools.updateNow') : tr('tools.checkAndUpdate');
  }
  return item.kind === 'desktop' ? tr('tools.openUpdater') : tr('tools.updateGuide');
}

async function openManagedTool(item) {
  if (!window.manager.openTool) return;
  state.tools.statusTone = 'idle';
  state.tools.message = tr('tools.status.opening', { label: item.label });
  renderToolCenter();
  try {
    const result = await window.manager.openTool({
      toolId: item.id,
      profileId: currentProfileId()
    });
    state.tools.statusTone = result?.ok ? 'idle' : 'error';
    state.tools.message = result?.ok
      ? (result.message || tr('tools.status.opened', { label: item.label }))
      : (result?.reason || tr('tools.status.openFailed', { label: item.label }));
  } catch (error) {
    state.tools.statusTone = 'error';
    state.tools.message = tr('tools.status.openFailed', { label: item.label });
  }
  setStatus(state.tools.message);
  renderToolCenter();
}

async function updateManagedTool(item) {
  if (!window.manager.updateTool || state.tools.busyId) return;
  state.tools.busyId = item.id;
  state.tools.statusTone = 'idle';
  state.tools.message = tr('tools.status.updating', { label: item.label });
  renderToolCenter();
  try {
    const result = await window.manager.updateTool(item.id);
    state.tools.statusTone = result?.ok ? 'idle' : 'error';
    state.tools.message = result?.ok
      ? (result.message || tr('tools.status.updated', { label: item.label }))
      : (result?.reason || tr('tools.status.updateFailed', { label: item.label }));
    setStatus(state.tools.message);
    if (result?.item || result?.current) await refreshToolInventory(true);
  } catch (_error) {
    state.tools.statusTone = 'error';
    state.tools.message = tr('tools.status.updateFailed', { label: item.label });
    setStatus(state.tools.message);
  } finally {
    state.tools.busyId = null;
    renderToolCenter();
  }
}

async function updateAllManagedTools() {
  if (!window.manager.updateAllTools || state.tools.busyId) return;
  state.tools.busyId = 'all';
  state.tools.statusTone = 'idle';
  state.tools.message = tr('tools.status.updatingAll');
  renderToolCenter();
  try {
    const result = await window.manager.updateAllTools();
    if (result?.cancelled) {
      state.tools.message = tr('tools.status.cancelled');
    } else {
      state.tools.statusTone = result?.ok ? 'idle' : 'error';
      state.tools.message = result?.message ||
        (result?.ok ? tr('tools.status.updatedAll') : result?.reason || tr('tools.status.updateAllFailed'));
      if (result?.inventory?.items) {
        state.tools.items = result.inventory.items;
        state.tools.summary = result.inventory.summary || null;
        state.tools.checkedAt = result.inventory.checkedAt || null;
      } else {
        await refreshToolInventory(true);
      }
    }
    setStatus(state.tools.message);
  } catch (_error) {
    state.tools.statusTone = 'error';
    state.tools.message = tr('tools.status.updateAllFailed');
    setStatus(state.tools.message);
  } finally {
    state.tools.busyId = null;
    renderToolCenter();
  }
}

function handleToolProgress(progress) {
  if (!progress?.toolId) return;
  if (!state.tools.busyId) state.tools.busyId = progress.toolId;
  state.tools.statusTone = progress.phase === 'error' ? 'error' : 'idle';
  if (progress.message) state.tools.message = progress.message;
  renderToolCenter();
}

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
        closeUtilityDialog(els.activityCenterDialog);
        state.quotaSelfOpen = true;
        state.quotaOverviewOpen = false;
        setWorkspaceMode('quota');
        renderQuotaSummary();
        els.quotaSummary.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
      else if (item.action === 'update') await handleUpdateClick();
      else if (item.action === 'assign-slot') openSlotAssignmentDialog(catalogSlotByKey(item.slotKey));
    });
    els.attentionItems.append(button);
  }
}

function saveYardPosition(profileId, point, zoneId = 'ground') {
  if (!window.YardInteractions) return false;
  const normalized = window.YardInteractions.normalizePoint(point);
  if (!normalized) return false;
  state.yardPositions = {
    ...state.yardPositions,
    [profileId]: { ...normalized, zoneId, updatedAt: Date.now() }
  };
  persistSettings({ yardPositions: state.yardPositions });
  return true;
}

function handleYardDrop({ profile, state: activityState, point, zone }) {
  if (!profile || !window.YardInteractions) return false;
  const zoneId = zone?.id || 'ground';
  const group = groupOfPresenterId(profile.id);
  const selectedRuntime = group?.key === currentAgentId() ? selectedProfile() : null;
  const hasSelectedSession = Boolean(selectedRuntime && sessionForProfile(selectedRuntime.id));
  const intent = window.YardInteractions.resolveDropIntent(zoneId, {
    activityState,
    hasSession: hasSelectedSession
  });

  if (intent.action === 'save-position') {
    saveYardPosition(profile.id, point, zoneId);
    window.YardScene.say(profile.id, { text: tr('yard.say.nice'), kind: 'ambient' });
    setStatus(tr('status.yardPosSaved', { name: profile.name }));
    return { keepPosition: true };
  }

  // Semantic drops create an intent. They never execute inside the canvas
  // pointer handler, so animation completion cannot become an unsafe action.
  void executeYardIntent(profile, intent);
  return { keepPosition: false };
}

async function executeYardIntent(profile, initialIntent) {
  const group = groupOfPresenterId(profile.id);
  if (!group) return;
  await selectAgent(group.key);
  const runtimeProfile = selectedProfile();
  const profileSession = runtimeProfile ? sessionForProfile(runtimeProfile.id) : null;
  if (profileSession) {
    setActiveSession(profileSession);
    renderSessions();
    renderInspector();
  }
  const mergedActivity = window.IdentityGroups
    ? window.IdentityGroups.mergeActivity(group.members.map((member) => state.activity[member.id]))
    : null;
  const activityState = window.YardCats
    ? window.YardCats.deriveState(Date.now(), profile, mergedActivity)
    : 'rest';
  const intent = window.YardInteractions.resolveDropIntent(initialIntent.zoneId, {
    activityState,
    hasSession: Boolean(profileSession)
  });

  if (!intent.enabled) {
    window.YardScene.say(profile.id, { text: intent.title, kind: 'system', duration: 4200 });
    setStatus(intent.title);
    return;
  }
  if (intent.action === 'focus-running') {
    setStatus(tr('status.alreadyRunning', { name: profile.name }));
    return;
  }
  if (intent.action === 'focus-session') {
    document.querySelector('.inspector')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    setStatus(tr('status.openedSessionDetail', { name: profile.name }));
    return;
  }
  if (intent.action === 'launch-profile') {
    if (!window.confirm(tr('status.openConfirmLaunch', { name: profile.name }))) return;
    const result = await openCurrentAgent();
    if (result?.ok === false) {
      const message = provisioningResultMessage(result);
      window.YardScene.say(profile.id, { text: message, kind: 'error', duration: 5000 });
    }
    return;
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
  const map = { zh: '中', en: 'EN', ja: '日' };
  els.langToggle.textContent = map[window.I18N.getLang()] || '文';
}

// 语言切换后重刷所有「运行时用 tr 生成」的文案（静态 data-i18n 由 I18N.apply 处理）
function rerenderLocalizedText() {
  renderTopbarContext();
  renderAccounts();
  renderAccountHeader();
  renderSessions();
  renderInspector();
  renderQuotaSummary();
  renderAttentionInbox();
  renderLedger();
  renderToolCenter();
  renderDeviceCenter();
  if (els.welcomeDialog?.open) {
    if (state.firstUse.mode === 'onboarding') renderFirstUse();
    else prepareWelcomeGuide();
  }
  if (els.reminderToggle) els.reminderToggle.textContent = tr(state.remindersOn ? 'reminder.on' : 'reminder.off');
  updateAtmosphereReadout();
  if (yardMounted) syncYard();
}

function applyView() {
  const yard = state.view === 'yard' && yardMounted;
  document.body.dataset.view = yard ? 'yard' : 'classic';
  // 统一骨架：账号呈现层随视图切换 —— 庭院视图显示场景，经典视图显示账号名册（CSS 控制显隐）。
  // 新增/编辑/移除按钮固定在控制条（新增紧跟打开账号，编辑/移除在「管理」菜单），两视图共用、不再搬家。
  els.yardStage.hidden = !yard;
  if (els.viewToggleLabel) els.viewToggleLabel.textContent = tr('topbar.toYard');
  els.viewToggle?.setAttribute('aria-pressed', String(yard));
  els.classicViewBtn?.setAttribute('aria-pressed', String(!yard));
  if (yardMounted) window.YardScene.setActive(yard);
  if (yard) loadActivity(); // 切回庭院时立刻刷新猫的状态
  else revealSelectedAccountCard();
  renderTopbarContext();
}

let activityLoading = false;
let busySignature = '';

async function loadActivity() {
  if (activityLoading) return; // 上一轮还没回来就跳过，避免请求堆积
  activityLoading = true;
  try {
    const list = await window.manager.listActivity();
    state.activity = Object.fromEntries(list.map((item) => [item.profileId, item]));
  } catch (_error) {
    state.activity = {};
  } finally {
    activityLoading = false;
  }
  // 并行会话数变化时刷新账号列表徽章（签名不变就不重建 DOM，避免 8 秒一闪）
  const signature = Object.values(state.activity)
    .map((item) => `${item.profileId}:${item.activeNow || 0}`)
    .join('|');
  if (signature !== busySignature) {
    busySignature = signature;
    renderAccounts();
    renderAccountHeader();
  }
  runCompanion();
  syncYard();
}

// ── 全局陪伴状态（固定进入 Footer，不在庭院内占行） ───────
function initCompanion() {
  els.reminderToggle.setAttribute('aria-pressed', String(state.remindersOn));
  els.reminderToggle.textContent = tr(state.remindersOn ? 'reminder.on' : 'reminder.off');
  if (window.YardCompanion) {
    state.ledger = state.ledger || window.YardCompanion.emptyLedger(Date.now());
  }
  renderLedger();
}

function runCompanion() {
  if (!window.YardCompanion || !window.YardCats) return;
  // 整段包起来：账本出任何岔子都不能连累每次轮询的庭院刷新
  try {
    const now = Date.now();
    const workingIds = state.profiles
      .filter((profile) => window.YardCats.deriveState(now, profile, state.activity[profile.id]) === 'working')
      .map((profile) => profile.id);

    const { ledger, events } = window.YardCompanion.tick(state.ledger, {
      now,
      workingIds,
      remindersOn: state.remindersOn
    });
    state.ledger = ledger;
    persistSettings({ ledger });
    renderLedger();

    for (const event of events) {
      if (event.type === 'clockoff') {
        setStatus(tr('status.catWrapped', { min: event.minutes }));
      } else if (event.type === 'stretch') {
        setStatus(tr('status.workedMin', { min: event.minutes }));
        if (isYardView()) window.YardScene.fx('stretch');
      }
    }
  } catch (_error) {
    // 账本坏了就从零重建，别卡住庭院
    state.ledger = window.YardCompanion.emptyLedger(Date.now());
  }
}

function renderLedger() {
  if (!state.ledger) return;
  els.ledgerDone.textContent = String(state.ledger.completed);
  els.ledgerMin.textContent = String(Math.round(state.ledger.workedMs / 60000));
}

function syncYard() {
  if (yardMounted) {
    const now = Date.now();
    const groups = identityGroups();
    const statesById = {};
    const energyById = {};
    // 一只猫 = 一个账号（组）：状态吃组内所有形态的聚合活跃，
    // 任一形态在干活猫就在打字；额度取组内有真实快照的那个槽位。
    for (const group of groups) {
      const primary = group.primary;
      const merged = window.IdentityGroups
        ? window.IdentityGroups.mergeActivity(group.members.map((member) => state.activity[member.id]))
        : state.activity[primary.id];
      statesById[primary.id] = window.YardCats.deriveState(now, primary, merged);
      const snapshot = group.members
        .map((member) => state.quotas[member.id])
        .find((quota) => quota && quota.status === 'ok') || state.quotas[primary.id];
      energyById[primary.id] = window.YardEnergy
        ? window.YardEnergy.deriveEnergy(state.quotaError ? null : snapshot, now)
        : 'unknown';
    }
    const selectedGroup = groups.find((group) => group.key === currentAgentId()) || null;
    window.YardScene.update({
      profiles: groups.map((group) => group.primary),
      statesById,
      energyById,
      positionsById: state.yardPositions,
      // Persistent attention belongs to the Header Activity dialog. The compact
      // yard keeps transient cat speech only, so path/quota warnings cannot
      // cover the Agent presenter or become a second activity surface.
      attentionById: {},
      selectedId: selectedGroup ? selectedGroup.primary.id : currentProfileId(),
      night: document.documentElement.dataset.theme === 'dark'
    });
  }
  renderAccountRoster();
  renderTopbarContext();
  renderAttentionInbox();
  // 排行榜打开时随轮询实时刷新
  if (els.leaderboardDialog.open) renderLeaderboard();
}

// 工作量排行榜：各账号（组）今日活跃/新建场次 + 实时干活状态，算分排序
function renderLeaderboard() {
  if (!window.YardWorkload || !window.YardCats || !window.YardSprites) return;
  const now = Date.now();
  const rows = identityGroups().map((group) => {
    const primary = group.primary;
    const act = (window.IdentityGroups
      ? window.IdentityGroups.mergeActivity(group.members.map((member) => state.activity[member.id]))
      : state.activity[primary.id]) || {};
    return {
      name: primary.name,
      appId: primary.appId,
      cat: primary.cat,
      isProtected: primary.isProtected,
      activeToday: act.activeToday || 0,
      createdToday: act.createdToday || 0,
      working: window.YardCats.deriveState(now, primary, act) === 'working'
    };
  });
  const ranked = window.YardWorkload.rankAccounts(rows);
  els.leaderboardBody.replaceChildren();
  if (!ranked.length) {
    els.leaderboardBody.textContent = tr('leaderboard.empty');
    return;
  }
  ranked.forEach((row, i) => {
    const el = document.createElement('div');
    el.className = `lb-row${i === 0 && row.score > 0 ? ' lb-top' : ''}${row.working ? ' lb-working' : ''}`;

    const rank = document.createElement('div');
    rank.className = 'lb-rank';
    rank.textContent = (i === 0 && row.score > 0) ? '👑' : String(i + 1);

    const avatar = document.createElement('canvas');
    avatar.width = 36; avatar.height = 36; avatar.className = 'lb-avatar';
    const c2 = avatar.getContext('2d');
    c2.imageSmoothingEnabled = false;
    const S = window.YardSprites;
    const pal = S.BREEDS[row.cat && row.cat.breed] || S.BREEDS.orange;
    S.drawCat(c2, S.SIT, pal, {
      dx: 2, dy: 2, scale: 2, seed: 5,
      collar: row.cat && row.cat.collar,
      bell: row.isProtected,
      tag: row.isProtected ? null : row.appId,
      accessory: (row.cat && row.cat.accessory !== 'none') ? row.cat.accessory : null
    });

    const who = document.createElement('div');
    who.className = 'lb-who';
    const name = document.createElement('b');
    name.textContent = row.name + (row.working ? ' 🔥' : '');
    const sub = document.createElement('small');
    sub.textContent = tr('leaderboard.sub', { app: appLabel(row.appId), active: row.activeToday, created: row.createdToday });
    who.append(name, sub);

    const score = document.createElement('div');
    score.className = 'lb-score';
    score.textContent = String(row.score);

    el.append(rank, avatar, who, score);
    els.leaderboardBody.append(el);
  });
}

// 账号名册（经典视图的账号呈现层）：一个卡片 = 一个账号（身份组），带真像素猫头像、
// 名称、分组、活跃状态。与庭院的猫是同一批账号的两种呈现（庭院靠 syncYard 喂场景）。
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

function provisioningAppLabel(appId) {
  return appId && appId !== 'unknown'
    ? appLabel(appId)
    : tr('deployment.client.unselected');
}

function renderAccounts() {
  renderAccountRoster();
  populateGroupDatalist();
  syncYard();
}

function renderAccountRoster() {
  if (!els.accountRoster) return;
  els.accountRoster.replaceChildren();
  const groups = identityGroups();
  if (els.presenterCount) els.presenterCount.textContent = String(groups.length);
  if (!groups.length) {
    const empty = document.createElement('p');
    empty.className = 'account-roster-empty';
    empty.textContent = tr('presenter.empty');
    els.accountRoster.append(empty);
    return;
  }
  const now = Date.now();
  for (const group of groups) {
    els.accountRoster.append(buildAccountCard(group, now));
  }
  revealSelectedAccountCard();
}

function revealSelectedAccountCard() {
  if (!els.accountRoster || document.body.dataset.view !== 'classic') return;
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
    maxAgeMs: Number(window.YardEnergy?.DEFAULT_MAX_AGE_MS) || 15 * 60_000
  });
}

function buildAccountCard(group, now) {
  const primary = group.primary;
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'account-card';
  card.classList.toggle('selected', group.key === currentAgentId());

  const activityEvidence = window.IdentityGroups?.cardActivityEvidence
    ? window.IdentityGroups.cardActivityEvidence(group.members, state.activity)
    : { merged: state.activity[primary.id] || null, remoteUnknown: primary._remote === true };
  const merged = activityEvidence.merged;
  const derivedActivityState = merged && window.YardCats ? window.YardCats.deriveState(now, primary, merged) : null;
  // A local working signal proves that the Agent is working. A local rest/idle
  // signal cannot describe remote Presence while remote activity is not part
  // of inventory, so mixed groups otherwise remain explicitly unknown.
  const activityState = window.IdentityGroups?.resolveCardActivityState
    ? window.IdentityGroups.resolveCardActivityState(activityEvidence, derivedActivityState)
    : (activityEvidence.remoteUnknown && derivedActivityState !== 'working' ? null : derivedActivityState);
  const meshMode = state.mesh.overview?.initialized === true;
  const deploymentState = group.readiness?.state || 'absent';
  const stateLabel = meshMode
    ? deploymentStateLabel(deploymentState)
    : (activityState ? tr('state.' + activityState) : tr('card.activityUnknown'));

  const top = document.createElement('div');
  top.className = 'account-card-top';
  const avatar = document.createElement('canvas');
  avatar.className = 'account-card-avatar';
  avatar.width = 52;
  avatar.height = 48;
  drawAccountAvatar(avatar, primary);
  const meta = document.createElement('div');
  meta.className = 'account-card-meta';
  const name = document.createElement('div');
  name.className = 'account-card-name';
  name.textContent = primary.name;
  const activeNow = group.members.reduce((acc, member) => acc + (state.activity[member.id]?.activeNow || 0), 0);
  if (activeNow > 0) {
    const busy = document.createElement('span');
    busy.className = 'account-card-busy';
    busy.textContent = ` ⌨${activeNow}`;
    busy.title = tr('card.busy', { n: activeNow });
    name.append(busy);
  }
  if (group.members.length > 1) {
    const link = document.createElement('span');
    link.className = 'account-card-link';
    link.textContent = ' ⛓';
    link.title = tr('card.forms', { n: group.members.length });
    name.append(link);
  }
  const gp = document.createElement('div');
  gp.className = 'account-card-group';
  if (meshMode) {
    // “运行位置”以 Slot 为口径；同一设备上的 Desktop/CLI 是两个明确动作落点。
    const positions = (group.allMembers || group.members).length;
    const online = (group.allMembers || group.members).filter((member) => member._deviceStatus === 'online').length;
    gp.textContent = tr('presenter.positions', { positions, online });
  } else {
    gp.textContent = primary.group ? tr('card.group', { g: primary.group }) : appLabel(primary.appId);
  }
  meta.append(name, gp);
  top.append(avatar, meta);

  const st = document.createElement('div');
  st.className = 'account-card-state';
  st.dataset.activity = meshMode ? deploymentState : (activityState || 'unknown');
  const dot = document.createElement('span');
  dot.className = 'account-card-dot';
  dot.style.background = meshMode
    ? (DEPLOYMENT_STATE_DOT[deploymentState] || '#9a9a9a')
    : (CARD_STATE_DOT[activityState] || '#9a9a9a');
  st.append(dot, document.createTextNode(`${stateLabel} · ${provisioningAppLabel(primary.appId)}`));

  const details = document.createElement('div');
  details.className = 'account-card-details';

  const lastActive = document.createElement('div');
  lastActive.className = 'account-card-fact account-card-last-active';
  const lastActiveLabel = document.createElement('span');
  lastActiveLabel.className = 'account-card-fact-label';
  lastActiveLabel.textContent = tr(activityEvidence.remoteUnknown && merged ? 'card.lastActiveLocal' : 'card.lastActive');
  const activityAt = merged?.contentActiveAt || merged?.latestMtime || null;
  const activityDate = activityAt ? new Date(activityAt) : null;
  const hasActivityTime = Boolean(activityDate && !Number.isNaN(activityDate.getTime()));
  const lastActiveValue = document.createElement(hasActivityTime ? 'time' : 'span');
  lastActiveValue.className = 'account-card-fact-value';
  lastActiveValue.textContent = compactDate(hasActivityTime ? activityAt : null);
  lastActiveValue.title = hasActivityTime ? fullDate(activityAt) : tr('common.unrecorded');
  if (hasActivityTime) lastActiveValue.dateTime = activityDate.toISOString();
  lastActive.append(lastActiveLabel, lastActiveValue);

  const quotaSummary = document.createElement('div');
  quotaSummary.className = 'account-card-fact account-card-quota-summary';
  const quotaLabel = document.createElement('span');
  quotaLabel.className = 'account-card-fact-label';
  quotaLabel.textContent = tr('card.quota');
  const quotaValue = document.createElement('strong');
  quotaValue.className = 'account-card-fact-value';

  // 只展示本地 Slot 的新鲜实时快照；旧采样、已过重置点和远端缓存都不进入卡片额度。
  const quotaTrack = document.createElement('div');
  quotaTrack.className = 'account-card-quota';
  const quotaFill = document.createElement('i');
  quotaTrack.append(quotaFill);
  const trustedQuota = trustedLocalAccountCardQuota(group, now);
  if (trustedQuota.status === 'ok') {
    const { member, snapshot, tightest } = trustedQuota;
    const source = accountCardQuotaSource(member);
    const percent = Math.max(0, Math.min(100, Math.round(tightest.remainingPercent)));
    const shortValue = `${tightest.label} · ${tr('quota.remainingShort', { pct: percent })}`;
    const fullValue = tr('quota.overview.value', { label: tightest.label, pct: percent });
    const title = tr('card.quotaSource', {
      source,
      value: fullValue,
      time: fullDate(snapshot.observedAt)
    });
    quotaValue.textContent = shortValue;
    quotaValue.title = title;
    quotaSummary.dataset.source = source;
    quotaTrack.dataset.trusted = 'true';
    quotaTrack.dataset.level = window.YardEnergy?.energyForRemaining?.(percent) || 'unknown';
    quotaFill.style.width = `${percent}%`;
    quotaTrack.title = title;
  } else {
    const conflict = trustedQuota.status === 'conflict';
    quotaValue.textContent = tr(conflict ? 'card.quotaConflict' : 'devices.value.unknown');
    quotaValue.title = tr(conflict ? 'card.quotaConflictHint' : 'quota.chip.noData');
    quotaTrack.dataset.trusted = 'false';
    quotaTrack.dataset.reason = trustedQuota.reason || 'unknown';
    quotaTrack.dataset.level = 'unknown';
    quotaFill.style.width = '0%';
    quotaTrack.title = quotaValue.title;
  }
  quotaSummary.append(quotaLabel, quotaValue);
  details.append(lastActive, quotaSummary, quotaTrack);

  card.append(top, st, details);
  card.addEventListener('click', () => selectAgent(group.key));
  return card;
}

function drawAccountAvatar(canvas, profile) {
  const S = window.YardSprites;
  if (!S) return;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  try {
    const pal = S.BREEDS[profile.cat && profile.cat.breed] || S.BREEDS.orange;
    S.drawCat(ctx, S.SIT, pal, {
      dx: 11, dy: 9, scale: 2, seed: 0,
      collar: profile.cat && profile.cat.collar,
      bell: profile.isProtected,
      tag: profile.isProtected ? null : profile.appId,
      flip: false
    });
  } catch (_error) { /* best effort：头像画不出不影响卡片 */ }
}

function renderTopbarContext() {
  if (!els.topbarContext) return;
  const ctx = tr(state.view === 'yard' ? 'ctx.yard' : 'ctx.classic');
  const deviceContext = selectedDeviceLensLabel();
  if (state.ui.workspaceMode === 'remote') {
    const session = state.mesh.remoteSessions.find((item) => item.sessionId === state.ui.activeRemoteSessionId)
      || state.mesh.remoteSessions.find((item) => item.direction === 'outgoing');
    els.topbarContext.textContent = [deviceContext, ctx, tr('remote.workspace.context', {
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
      ctx,
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
    ctx,
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

function groupOfPresenterId(presenterId) {
  if (!presenterId) return null;
  return identityGroups().find((group) => group.primary?.id === presenterId) || null;
}

function preferredSlot(members) {
  return (members || []).find((member) => member._meshSlotKey === currentSlotKey())
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
  state.ui = window.UiContext.setAgent(state.ui, group.key, {
    slotKey: member._meshSlotKey || member.id
  });
  return true;
}

function setAgentContext(agentId) {
  const group = identityGroups().find((item) => item.key === agentId);
  if (!group) return false;
  const member = preferredSlot(group.members);
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
  renderAccounts();
  renderAccountHeader();
  await loadSessions();
  renderAttentionInbox();
}

async function selectAgent(agentId) {
  if (!setAgentContext(agentId)) return;
  renderAccounts();
  renderAccountHeader();
  await loadSessions();
  renderAttentionInbox();
}

function selectSlot(profileId) {
  const group = groupOfProfile(profileId);
  const member = group?.members.find((item) => item.id === profileId);
  if (!group || !member || group.key !== currentAgentId()) return;
  updateUi(window.UiContext.setSlot(state.ui, member._meshSlotKey || member.id));
  renderAccounts();
  renderAccountHeader();
  renderInspector();
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
  const selectedGroup = group || identityGroups().find((item) => item.key === currentAgentId()) || null;
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

async function openCurrentAgent() {
  const profile = selectedProfile();
  const group = identityGroups().find((item) => item.key === currentAgentId()) || null;
  const meshMode = state.mesh.overview?.initialized === true;
  if (!meshMode) {
    if (!profile) return { ok: false, reasonCode: 'profile-required' };
    const result = await window.manager.launchProfile(profile.id);
    if (!result.ok) {
      setStatus(result.reason || tr('status.openFail'));
      return result;
    }
    await loadProfiles(profile.id);
    setStatus(result.warning || tr('status.opened', { name: profile.name }));
    return result;
  }

  const action = currentAgentActionContext(group, profile);
  if (!action.agent || !action.deviceId) return { ok: false, reasonCode: 'agent-required' };
  if (!action.requested?.appId) {
    const result = { ok: false, reasonCode: 'provisioning-client-required' };
    setStatus(provisioningResultMessage(result, action.agent.displayName));
    els.formSelect?.focus();
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
    await loadProfiles(profile.id);
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
      await loadProfiles(result.slot?.profileId || profile?.id || null);
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

// 卡片/猫只负责选中 Agent。已有 Slot 时选择器列出确切运行位置；当前
// 工作环境没有 Slot 时，同一个控件原位列出受支持的首选客户端，普通流程
// 直接进入首次准备，不要求用户先创建运行位置。
function renderFormSwitcher(profile, group) {
  if (!els.formSwitcher || !els.formSelect) return;
  const label = els.formSwitcher.querySelector('.form-switcher-label');
  if (label) label.textContent = tr('devices.slot.label');
  els.formSelect.title = tr('devices.slot.title');
  // 复用调用方已算好的组；缺省时才自己算一次，保持函数自足
  const grp = group || (profile ? groupOfProfile(profile.id) : null);
  const members = grp ? grp.members : [];
  if (!grp) {
    els.formSwitcher.hidden = true;
    els.formSelect.replaceChildren();
    return;
  }
  els.formSelect.replaceChildren();
  if (members.length && !profile) {
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = tr('devices.slot.choose');
    placeholder.selected = true;
    placeholder.disabled = true;
    els.formSelect.append(placeholder);
  }
  for (const member of members) {
    const option = document.createElement('option');
    option.value = member.id;
    option.textContent = member._meshDeviceName
      ? `${member._meshDeviceName} / ${appLabel(member.appId)}`
      : `${member.name} · ${appLabel(member.appId)}`;
    option.selected = member.id === profile?.id;
    els.formSelect.append(option);
  }

  if (!members.length && state.mesh.overview?.initialized) {
    const action = currentAgentActionContext(grp, null);
    const requested = action.requested;
    const apps = supportedProvisioningApps();
    if (!requested) {
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = tr('deployment.client.choose');
      placeholder.selected = true;
      placeholder.disabled = true;
      els.formSelect.append(placeholder);
    }
    for (const app of apps) {
      const option = document.createElement('option');
      option.value = `prepare:${app.appId}:${app.clientForm}`;
      option.textContent = tr('deployment.client.unprepared', { app: app.label });
      option.selected = app.appId === requested?.appId && app.clientForm === requested?.clientForm;
      els.formSelect.append(option);
    }
    if (!apps.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = tr('deployment.client.noneSupported');
      option.selected = true;
      option.disabled = true;
      els.formSelect.append(option);
    }
  }
  els.formSwitcher.hidden = false;
}

function renderAccountHeader() {
  const profile = selectedProfile();
  const selectedGroup = identityGroups().find((group) => group.key === currentAgentId()) || null;
  const remote = profile?._remote === true;
  const meshMode = state.mesh.overview?.initialized === true;
  const selectedAgent = catalogAgentById(currentAgentId());
  const action = currentAgentActionContext(selectedGroup, profile);
  const localLens = !meshMode
    || currentDeviceLensId() === 'all'
    || currentDeviceLensId() === state.mesh.overview.localDeviceId;
  const firstUseAction = onboardingNeedsPresentation() && (
    !meshMode || !(state.mesh.overview?.agents || []).length
  );

  els.addProfileBtn.textContent = tr(firstUseAction
    ? 'account.createFirstAgent'
    : (meshMode ? 'account.addAgent' : 'account.addSlot'));
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
  if (els.accountManage) els.accountManage.disabled = !selectedGroup && !profile;
  if (els.manageAgentRelationsBtn) {
    els.manageAgentRelationsBtn.hidden = !meshMode;
    els.manageAgentRelationsBtn.disabled = !selectedAgent;
  }

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
    ? Boolean(selectedAgent && !action.busy && !unavailable && remoteSupported && remotePermitted && (
        (profile && profileCanLaunch) || (!profile && requestedCanProvision)
      ))
    : Boolean(profile && profileCanLaunch && !remote);
  els.launchBtn.textContent = meshMode ? provisioningButtonLabel(action) : tr('account.open');
  els.launchBtn.disabled = !canOpen;
  if (action.isRemote && !remoteSupported) els.launchBtn.title = tr('deployment.action.remoteUnsupported');
  else if (action.isRemote && !remotePermitted) els.launchBtn.title = tr('deployment.action.remotePermission');
  else if (unavailable) els.launchBtn.title = tr('deployment.action.offline');
  else if (!profile && !action.requested?.appId) els.launchBtn.title = tr('deployment.action.chooseClient');
  else if (!profile && !requestedCanProvision) els.launchBtn.title = tr('deployment.action.unsupportedClient');
  else if (profile && !profileCanLaunch) els.launchBtn.title = tr('deployment.action.externalClient');
  else els.launchBtn.title = '';
  els.pathConfigBtn.disabled = !profile || remote;
  els.diagnosticsBtn.disabled = !profile || remote;
  els.profileFolderBtn.disabled = !profile || remote;
  els.refreshBtn.disabled = !profile || (remote && !window.manager.refreshMeshInventory);
  els.editProfileBtn.disabled = meshMode ? !selectedAgent : (!profile || remote);
  els.removeProfileBtn.disabled = meshMode ? !selectedAgent : (!profile || remote);

  if (!profile && !selectedGroup) {
    els.accountTitle.textContent = selectedGroup?.agent?.displayName
      || selectedGroup?.primary?.name
      || tr(meshMode ? 'account.noneAgent' : 'account.none');
    if (els.accountBadge) els.accountBadge.hidden = true;
    if (els.accountId) els.accountId.title = '';
    els.accountMeta.textContent = '';
    els.accountPath.textContent = '';
    els.accountNote.textContent = '';
    els.accountNote.style.display = 'none';
    renderFormSwitcher(null, selectedGroup);
    renderQuotaSummary();
    renderTopbarContext();
    renderAgentManageContext();
    return;
  }

  // 主名牌只表达全局 Agent；客户端与设备属于下方明确的运行位置选择器。
  // 长信息（槽位/分组/上次打开/路径/备注）收进名牌 tooltip，不再占控制条版面。
  const identityGroup = selectedGroup || (profile ? groupOfProfile(profile.id) : null);
  const agentName = selectedAgent?.displayName || identityGroup?.primary?.name || profile?.name || tr('account.noneAgent');
  els.accountTitle.textContent = agentName;
  const groupLabel = (selectedAgent?.group || profile?.group) ? ` · ${selectedAgent?.group || profile.group}` : '';
  const members = identityGroup ? identityGroup.members : (profile ? [profile] : []);
  // 并行会话数按整个账号（组）聚合：桌面在跑 + 终端在跑 = 一起数
  const activeNow = members.reduce((acc, member) => acc + (state.activity[member.id]?.activeNow || 0), 0);
  const badgeParts = [];
  if (meshMode) badgeParts.push(deploymentStateLabel(action.readiness?.state));
  if (activeNow > 0) badgeParts.push(tr('acct.badgeParallel', { n: activeNow }));
  if (members.length > 1) badgeParts.push(tr('acct.badgeForms', { n: members.length }));
  const quotaSnapshot = profile ? selectedQuota() : null;
  if (quotaSnapshot?.status === 'ok' && window.YardEnergy) {
    const energyKey = window.YardEnergy.deriveEnergy(quotaSnapshot, Date.now());
    badgeParts.push(`⚡ ${tr('energy.' + energyKey)}`);
  }
  if (els.accountBadge) {
    els.accountBadge.textContent = badgeParts.join(' · ');
    els.accountBadge.hidden = badgeParts.length === 0;
  }
  renderFormSwitcher(profile, identityGroup);

  if (!profile) {
    const environmentName = action.device?.name || selectedDeviceLensLabel() || '-';
    const metaLine = tr('deployment.environmentStatus', {
      device: environmentName,
      state: deploymentStateLabel(action.readiness?.state)
    });
    const clientLine = action.requested?.appId
      ? tr('deployment.client.selected', { app: appLabel(action.requested.appId) })
      : tr('deployment.client.chooseHint');
    if (els.accountId) {
      els.accountId.title = [metaLine, clientLine, selectedAgent?.note || ''].filter(Boolean).join('\n');
    }
    els.accountMeta.textContent = metaLine;
    els.accountPath.textContent = clientLine;
    els.accountNote.textContent = selectedAgent?.note || '';
    els.accountNote.style.display = selectedAgent?.note ? '' : 'none';
    renderQuotaSummary();
    renderTopbarContext();
    renderAgentManageContext();
    return;
  }

  const metaLine = remote
    ? tr('devices.slot.remoteMeta', {
        device: profile._meshDeviceName || '-',
        status: tr(`devices.status.${profile._deviceStatus || 'offline'}`)
      })
    : `${appLabel(profile.appId)} · ${tr(profile.isProtected ? 'acct.slotDefault' : 'acct.slotIndependent')}${groupLabel} · ${tr('acct.lastOpen', { t: compactDate(profile.lastLaunchedAt) })}`;
  const pathLine = remote
    ? tr('devices.slot.remotePath')
    : tr('acct.tip', { p: shortPath(profile.profilePath), s: shortPath(profile.sessionRoot) });
  if (els.accountId) {
    els.accountId.title = [metaLine, pathLine, profile.note ? tr('acct.note', { note: profile.note }) : ''].filter(Boolean).join('\n');
  }
  // 隐藏源（.account-legacy）：保留旧字段写入，作为 tooltip 之外的读取兜底
  els.accountMeta.textContent = metaLine;
  els.accountPath.textContent = pathLine;
  els.accountNote.textContent = selectedAgent?.note || profile.note || '';
  els.accountNote.style.display = selectedAgent?.note || profile.note ? '' : 'none';
  renderQuotaSummary();
  renderTopbarContext();
  renderAgentManageContext();
}

const COMPACT_SESSION_COLUMNS = [
  { key: 'title', label: 'session.col.title', className: 'col-title', cellClass: 'title-cell' },
  { key: 'updatedAt', label: 'session.col.active', className: 'col-date' },
  { key: 'project', label: 'session.col.project', className: 'col-project', cellClass: 'mono path-cell' },
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

function resolvedFocusedSession() {
  return resolvedSessionRow(selectedSession());
}

function renderSessionCopyControl() {
  if (!els.copySessionInfoBtn) return;
  const count = actionSessions().length;
  const unresolved = unresolvedActionSessions();
  const hasExplicitChecks = state.ui.checkedConversationIds.size > 0;
  const visibility = window.UiContext.actionVisibility(
    state.ui,
    state.filteredSessions.map(sessionKey)
  );
  if (els.sessionActionDock) els.sessionActionDock.hidden = count === 0;
  if (els.sessionSelectionBar) els.sessionSelectionBar.hidden = count === 0;
  if (els.sessionFocusedActions) {
    els.sessionFocusedActions.hidden = count === 0 || hasExplicitChecks || !selectedSession();
  }
  if (els.sessionSelectionCount) {
    els.sessionSelectionCount.textContent = tr('session.selection.count', { n: count });
  }
  if (els.sessionSelectionIssue) {
    const issues = [
      visibility.hidden ? tr('session.selection.hiddenCount', { n: visibility.hidden }) : null,
      unresolved.length ? tr('session.replica.requiredCount', { n: unresolved.length }) : null
    ].filter(Boolean);
    els.sessionSelectionIssue.hidden = issues.length === 0;
    els.sessionSelectionIssue.textContent = issues.join(' · ');
  }
  els.copySessionInfoBtn.disabled = count === 0 || unresolved.length > 0;
  els.copySessionInfoBtn.textContent = count > 1
    ? tr('session.copyInfoCount', { n: count })
    : tr('session.copyInfo');
  els.copySessionInfoBtn.title = unresolved.length
    ? tr('session.replica.requiredAction')
    : tr('session.copyInfoHint');
  if (els.sendSessionInfoBtn) {
    const remotes = (state.mesh.overview?.devices || []).filter((device) => !device.isLocal);
    els.sendSessionInfoBtn.disabled = count === 0 || unresolved.length > 0 || remotes.length === 0;
    els.sendSessionInfoBtn.textContent = count > 1
      ? tr('session.sendInfoCount', { n: count })
      : tr('session.sendInfo');
    els.sendSessionInfoBtn.title = unresolved.length
      ? tr('session.replica.requiredAction')
      : tr('session.sendInfoHint');
  }
}

async function openSessionSendDialog(preselectedDeviceId = null, returnFocus = document.activeElement) {
  if (!els.sessionSendDialog) return;
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
  const session = resolvedFocusedSession();
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

async function openTransferCenter(returnFocus = document.activeElement) {
  const focusContext = captureChildDialogReturnFocus(returnFocus);
  await loadTransfers();
  openChildDialog(els.transferCenterDialog, focusContext);
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
      ? createTaskPackageTransferActions(transfer, { returnFocus: els.transferCenterDialog })
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
  renderInspector();
}

function clearSessionActionSelection() {
  state.ui = window.UiContext.clearConversationActions(state.ui);
  renderSessions();
  renderInspector();
}

function setSessionChecked(session, checked) {
  const key = sessionKey(session);
  state.ui = window.UiContext.checkConversation(state.ui, key, checked);
  renderSessions();
  renderInspector();
}

function focusSession(session) {
  state.ui = window.UiContext.focusConversation(state.ui, session ? sessionKey(session) : null);
  if (session) setWorkspaceMode('sessions');
}

function renderSessionHead() {
  if (!els.sessionHead) return;
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
}

function renderSessions() {
  renderSessionControls();
  renderSessionCopyControl();
  renderSessionHead();
  els.sessionRows.replaceChildren();
  const accountCount = sessionAccountCount(state.filteredSessions);
  els.sessionCount.textContent = state.ui.agentScope === 'all'
    ? tr('session.countAll', { n: state.filteredSessions.length, accounts: accountCount })
    : tr('session.count', { n: state.filteredSessions.length });

  if (!state.filteredSessions.length) {
    const row = document.createElement('tr');
    row.className = 'empty-row';
    const cell = document.createElement('td');
    cell.colSpan = sessionColumns().length + 1;
    cell.textContent = state.sessions.length
      ? tr('session.empty.filtered')
      : tr(state.ui.agentScope === 'all' ? 'session.empty.noneAll' : 'session.empty.none');
    row.append(cell);
    els.sessionRows.append(row);
    return;
  }

  for (const session of state.filteredSessions) {
    const key = sessionKey(session);
    const row = document.createElement('tr');
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

    row.addEventListener('click', (event) => {
      if (event.metaKey || event.ctrlKey) {
        setSessionChecked(session, !state.ui.checkedConversationIds.has(key));
      } else {
        focusSession(session);
        renderSessions();
        renderInspector();
      }
    });
    els.sessionRows.append(row);
  }
}

function renderSessionCell(session, column) {
  const cell = document.createElement('td');
  cell.className = column.cellClass || '';
  let value = '';
  let fullValue = '';
  switch (column.key) {
    case 'title': {
      const title = document.createElement('span');
      title.className = 'title-cell-main';
      title.textContent = session.title || '-';
      cell.append(title);
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
      value = session.projectPath ? shortPath(session.projectPath) : '-';
      fullValue = session.projectPath || '';
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

function renderInspector() {
  const focused = selectedSession();
  const resolution = focused ? replicaResolution(focused) : null;
  const session = resolution?.resolved ? resolvedSessionRow(focused) : focused;
  const disabled = !focused || resolution?.resolved === false;
  els.openSessionFileBtn.disabled = disabled || session?._remote === true || session?._stale === true;
  els.openSessionFileBtn.title = resolution?.resolved === false ? tr('session.replica.requiredAction') : '';
  // 导出能力按客户端目录声明。
  const canExport = Boolean(!disabled && session && !session._remote && !session._stale && state.appMeta[session.appId]?.canExportTranscript);
  els.exportSessionBtn.disabled = !canExport;
  els.exportSessionBtn.title = canExport
    ? tr('detail.export.can')
    : (session ? tr('detail.export.cannot') : '');
  const canTaskPackage = Boolean(
    !disabled
    && session
    && !session._remote
    && !session._stale
    && state.appMeta[session.appId]?.taskPackageMode !== 'unsupported'
  );
  if (els.taskPackageActionBtn) {
    els.taskPackageActionBtn.disabled = !canTaskPackage;
    els.taskPackageActionBtn.title = canTaskPackage
      ? tr('taskPackage.action.hint')
      : (session ? tr('taskPackage.action.unsupported') : '');
  }

  renderReplicaPicker(focused, resolution);
  if (els.sessionInspectorEmpty) els.sessionInspectorEmpty.hidden = Boolean(focused);
  if (els.sessionInspectorFields) els.sessionInspectorFields.hidden = !focused;
  if (els.sessionTechnicalDetails) els.sessionTechnicalDetails.hidden = !focused;

  if (!focused) {
    setDetail(els.detailTitle, tr('detail.unselected'), { keep: true });
    for (const dd of [els.detailAccount, els.detailLocation, els.detailCreated, els.detailUpdated, els.detailSource, els.detailProject, els.detailCoordinate]) {
      setDetail(dd, '');
    }
    if (els.sessionTechnicalDetails) els.sessionTechnicalDetails.open = false;
    return;
  }

  const owner = sessionOwnerProfile(session);
  setDetail(els.detailTitle, focused.title, { keep: true });
  setDetail(els.detailAccount, session._accountName || owner?.name);
  setDetail(els.detailLocation, resolution?.resolved === false
    ? tr('session.replica.requiredInline')
    : [
        session._deviceName,
        session._profileName && session._profileName !== session._accountName ? session._profileName : null,
        session._appLabel || (owner ? appLabel(owner.appId) : null),
        session._stale ? tr('session.offlineSnapshot') : null
      ].filter(Boolean).join(' · '));
  setDetail(els.detailCreated, fullDate(session.createdAt));
  setDetail(els.detailUpdated, fullDate(session.updatedAt));
  setDetail(els.detailSource, [
    session.source,
    session.status,
    session.model
  ].filter(Boolean).join(' · '));
  setDetail(els.detailProject, resolution?.resolved === false
    ? ''
    : (window.SessionLocation ? shortPath(window.SessionLocation.pathOf(session)) : shortPath(session.projectPath || session.filePath)));
  setDetail(els.detailCoordinate, resolution?.resolved === false
    ? ''
    : (window.SessionLocation ? shortPath(window.SessionLocation.coordinateOf(session)) : shortPath(session.filePath || session.address || session.id)));
}

function renderReplicaPicker(session, resolution) {
  if (!els.sessionReplicaPicker || !els.sessionReplicaOptions) return;
  const candidates = resolution?.candidates || [];
  const needsPicker = Boolean(session && candidates.length > 1);
  els.sessionReplicaPicker.hidden = !needsPicker;
  els.sessionReplicaOptions.replaceChildren();
  if (!needsPicker) return;

  const overview = state.mesh.overview;
  for (const replica of candidates) {
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
      renderInspector();
    });
    label.append(radio, copy);
    els.sessionReplicaOptions.append(label);
  }
}

// 会话详情：空字段连同标签一起折叠，详情栏更紧凑（keep=true 的字段始终保留）
function setDetail(dd, value, { keep = false } = {}) {
  const empty = !keep && (!value || value === '-' || value === tr('common.unrecorded'));
  dd.textContent = value || '-';
  dd.hidden = empty;
  const dt = dd.previousElementSibling;
  if (dt && dt.tagName === 'DT') dt.hidden = empty;
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

function selectedSession() {
  return state.sessions.find((session) => (
    sessionKey(session) === state.ui.focusedConversationId
  )) || null;
}

function sessionForProfile(profileId) {
  const group = groupOfProfile(profileId);
  const memberIds = new Set((group?.members || []).map((member) => member.id));
  if (!memberIds.size && profileId) memberIds.add(profileId);
  const active = selectedSession();
  if (active && memberIds.has(active._profileId)) return active;
  return state.filteredSessions.find((session) => memberIds.has(session._profileId)) || null;
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

function setStatus(message) {
  els.statusText.textContent = message;
}
