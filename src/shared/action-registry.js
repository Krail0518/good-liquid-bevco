/*
 * action-registry.js — the allowlist of action names (GL-DEF-01).
 *
 * Every data-gl-action in the markup must appear here, or the control is
 * dead and the dispatcher says so. This IS the allowlist: a name absent from
 * this file is unreachable from markup no matter what globals exist, which is
 * the whole difference between the old inline handlers and the new ones.
 *
 * The functions themselves are declared across crm-index-core.js and the
 * modules, most of which load AFTER this file. Registration is therefore by
 * name with the lookup deferred to call time — see glRegisterGlobalActions in
 * actions.js. Deferring the lookup does not weaken the allowlist, because the
 * allowlist is the list of names below, not the state of window.
 *
 * GENERATED from the handlers actually converted, so the list cannot drift
 * out of step with the markup. tests/inline-handler-budget.test.cjs fails if
 * a data-gl-action names something missing here.
 */
(function () {
  'use strict';

  window.glRegisterGlobalActions([
    'bkBackToIntake',
    'bkIntakeToSchedule',
    'bkNext',
    'bkPrev',
    'calcRefComm',
    'checkPw',
    'closeAICommModal',
    'closeAddClientModal',
    'closeAddDealModal',
    'closeAddReferrer',
    'closeBooking',
    'closeCalEventModal',
    'closeChangePwModal',
    'closeDealDetail',
    'closeDetail',
    'closeDocUploadModal',
    'closeFollowupModal',
    'closeInventoryModal',
    'closeMeetingNotesModal',
    'closePw',
    'closeRefModal',
    'closeResetOverlay',
    'closeRoleModal',
    'closeTaskModal',
    'deleteDeal',
    'doChangePassword',
    'exitCRM',
    'generateAIComm',
    'generateMeetingNotes',
    'glOpenAttentionBoard',
    'glOpenBulkNudge',
    'glOpenFollowups',
    'glToggleCRMChat',
    'logoutCRM',
    'logoutPortal',
    'markAllNotifRead',
    'openAIProductionOptimizer',
    'openAISettings',
    'openAddClientModal',
    'openAddDealModal',
    'openAddReferrer',
    'openAdmin',
    'openBulkOutreach',
    'openChangePwModal',
    'openDocUploadModal',
    'openFollowUpModal',
    'openInventoryModal',
    'openInviteModal',
    'openLeadEmailComposer',
    'openRefModal',
    'openReports',
    'openTaskModal',
    'openTimeTracker',
    'postAnnouncement',
    'refineAIComm',
    'refineFollowupEmail',
    'regenFollowup',
    'renderDocs',
    'runDailyDigestNow',
    'saveCalEvent',
    'saveDealDetail',
    'saveDocument',
    'saveInventoryItem',
    'saveMeetingNotes',
    'saveNewClient',
    'saveNewDeal',
    'saveReferral',
    'saveReferrer',
    'saveRole',
    'saveTask',
    'sendAIComm',
    'sendChatMsg',
    'sendFollowupEmail',
    'sendOnboardingEmail',
    'sendResetLink',
    'submitBooking',
    'svcChange',
    'toggleCRMSidebar',
    'toggleChat',
    'toggleMobileMenu',
    'toggleNotifPanel',
    'updatePreview',
  ]);

  console.log('[GL] 82 actions registered');
}());
