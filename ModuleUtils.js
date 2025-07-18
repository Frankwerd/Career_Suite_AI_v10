function _setupModule(config) {
  const FUNC_NAME = "_setupModule";
  Logger.log(`\n==== ${FUNC_NAME}: STARTING - ${config.moduleName} Module Setup ====`);
  let messages = [];
  let moduleSuccess = true;
  let dummyDataWasAdded = false;
  let dataSh, dashboardSheet, helperSheet; // Declare here for broader scope within function

  if (!config.activeSS || typeof config.activeSS.getId !== 'function') {
    const errMsg = "CRITICAL: Invalid spreadsheet object passed.";
    Logger.log(`[${FUNC_NAME} ERROR] ${errMsg}`);
    return { success: false, messages: [errMsg] };
  }
  const activeSS = config.activeSS;
  Logger.log(`[${FUNC_NAME} INFO] Operating on: "${activeSS.getName()}" (ID: ${activeSS.getId()})`);

  // --- A. Core Sheet Creation & Formatting ---
  Logger.log(`[${FUNC_NAME} INFO] Setting up core sheets for ${config.moduleName} module...`);
  try {
    // A.1: "Applications" Sheet
    dataSh = activeSS.getSheetByName(config.sheetTabName);
    if (!dataSh) {
      dataSh = activeSS.insertSheet(config.sheetTabName);
      Logger.log(`[${FUNC_NAME} INFO] Created new sheet: "${config.sheetTabName}".`);
    } else {
      Logger.log(`[${FUNC_NAME} INFO] Found existing sheet: "${config.sheetTabName}".`);
    }
    // Corrected THEME for Applications
    if (!setupSheetFormatting(dataSh,
      config.sheetHeaders,        // From Config.gs
      config.columnWidths,          // From Config.gs
      true,                             // applyBandingFlag = true
      config.bandingTheme  // <<< ENSURE THIS IS .BLUE or .CYAN
    )) {
      throw new Error(`Formatting failed for "${config.sheetTabName}".`);
    }
    dataSh.setTabColor(config.tabColor);
    try { // Post-formatting specific tweaks
      if (PEAK_STATUS_COL > 0 && PEAK_STATUS_COL <= dataSh.getMaxColumns() && !dataSh.isColumnHiddenByUser(PEAK_STATUS_COL)) {
        dataSh.hideColumn(dataSh.getRange(1, PEAK_STATUS_COL));
      }
      if (EMAIL_LINK_COL > 0 && dataSh.getMaxRows() > 1 && dataSh.getMaxColumns() >= EMAIL_LINK_COL) {
        dataSh.getRange(2, EMAIL_LINK_COL, dataSh.getMaxRows() - 1, 1).setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
      }
    } catch (ePf) { Logger.log(`[${FUNC_NAME} WARN] Post-format tweaks for Apps sheet: ${ePf.message}`); }
    messages.push(`Sheet '${config.sheetTabName}': Setup OK. Color: ${config.tabColor}.`);

    // A.2: "Dashboard" Sheet
    dashboardSheet = getOrCreateDashboardSheet(activeSS); // From Dashboard.gs
    if (!dashboardSheet) throw new Error(`Get/Create FAILED for sheet: '${DASHBOARD_TAB_NAME}'.`);
    if (!formatDashboardSheet(dashboardSheet)) { // From Dashboard.gs
      throw new Error(`Formatting FAILED for sheet: '${DASHBOARD_TAB_NAME}'.`);
    } // Tab color for dashboard is set within getOrCreateDashboardSheet in Dashboard.gs
    messages.push(`Sheet '${DASHBOARD_TAB_NAME}': Setup OK.`);

    // A.3: "DashboardHelperData" Sheet
    helperSheet = getOrCreateHelperSheet(activeSS); // From Dashboard.gs
    if (!helperSheet) throw new Error(`Get/Create FAILED for sheet: '${HELPER_SHEET_NAME}'.`);
    // Format helper sheet (headers, no banding) using SheetUtils.gs
    if (!setupSheetFormatting(helperSheet, DASHBOARD_HELPER_HEADERS, HELPER_SHEET_COLUMN_WIDTHS, false)) {
      throw new Error(`Basic Formatting FAILED for sheet: '${HELPER_SHEET_NAME}'.`);
    }
    // **** NEW CALL ****
    if (!setupHelperSheetFormulas(helperSheet)) { // Call from Dashboard.gs to set formulas
      throw new Error(`Setting formulas FAILED for sheet: '${HELPER_SHEET_NAME}'.`);
    }
    updateDashboardMetrics(dashboardSheet, helperSheet, dataSh);
    if (!helperSheet.isSheetHidden()) helperSheet.hideSheet();
    helperSheet.setTabColor(BRAND_COLORS.CHARCOAL); // From Config.gs
    messages.push(`Sheet '${HELPER_SHEET_NAME}': Setup OK (Headers & Formulas set). Hidden. Color: Charcoal.`);

    // A.4: "Job Data" Sheet
    const jobDataSheet = getOrCreateJobDataSheet(activeSS); // From Dashboard.gs
    if (!jobDataSheet) throw new Error(`Get/Create FAILED for sheet: '${JOB_DATA_SHEET_NAME}'.`);
    if (!setupJobDataSheetFormulas(jobDataSheet)) { // From Dashboard.gs
      throw new Error(`Formatting FAILED for sheet: '${JOB_DATA_SHEET_NAME}'.`);
    }
    if (!jobDataSheet.isSheetHidden()) jobDataSheet.hideSheet();
    messages.push(`Sheet '${JOB_DATA_SHEET_NAME}': Setup OK (Headers & Formulas set). Hidden.`);

  } catch (e) {
    Logger.log(`[${FUNC_NAME} ERROR] Core sheet setup failed: ${e.toString()}\nStack: ${e.stack}`);
    messages.push(`Core sheet setup FAILED: ${e.message}.`); moduleSuccess = false;
  }

  // --- B. Gmail Label & Filter Setup ---
  let trackerToProcessLabelId = null;
  if (moduleSuccess) {
    Logger.log(`[${FUNC_NAME} INFO] Setting up Gmail labels & filters for ${config.moduleName}...`);
    try {
      getOrCreateLabel(config.gmailLabelParent); Utilities.sleep(100);       // From Config.gs
      const toProcessLabelObject = getOrCreateLabel(config.gmailLabelToProcess); Utilities.sleep(100); // From Config.gs
      getOrCreateLabel(config.gmailLabelProcessed); Utilities.sleep(100);   // From Config.gs
      if (config.gmailLabelManualReview) {
        getOrCreateLabel(config.gmailLabelManualReview); Utilities.sleep(100); // From Config.gs
      }

      if (toProcessLabelObject) {
        Utilities.sleep(300);
        const advancedGmailService = Gmail; // Assumes Advanced Gmail API Service is enabled
        if (!advancedGmailService || !advancedGmailService.Users || !advancedGmailService.Users.Labels) {
          throw new Error("Advanced Gmail Service not available/enabled for label ID fetch.");
        }
        const labelsListResponse = advancedGmailService.Users.Labels.list('me');
        if (labelsListResponse.labels && labelsListResponse.labels.length > 0) {
          const targetLabelInfo = labelsListResponse.labels.find(l => l.name === config.gmailLabelToProcess);
          if (targetLabelInfo && targetLabelInfo.id) {
            trackerToProcessLabelId = targetLabelInfo.id;
          } else { Logger.log(`[${FUNC_NAME} WARN] Label "${config.gmailLabelToProcess}" ID not found via Advanced Service.`); }
        } else { Logger.log(`[${FUNC_NAME} WARN} No labels returned by Advanced Gmail Service.`); }
      }
      if (!trackerToProcessLabelId) throw new Error(`CRITICAL: Could not get ID for Gmail label "${config.gmailLabelToProcess}". Filter creation will fail.`);
      messages.push("Tracker Labels & 'To Process' ID: OK.");

      // Filter Creation
      const filterQuery = config.gmailFilterQuery; // from Config.gs
      const gmailApiServiceForFilter = Gmail; // Advanced Gmail Service
      let filterExists = false;
      const existingFiltersResponse = gmailApiServiceForFilter.Users.Settings.Filters.list('me');
      const existingFiltersList = (existingFiltersResponse && existingFiltersResponse.filter && Array.isArray(existingFiltersResponse.filter)) ? existingFiltersResponse.filter : [];

      for (const filterItem of existingFiltersList) {
        if (filterItem.criteria?.query === filterQuery && filterItem.action?.addLabelIds?.includes(trackerToProcessLabelId)) {
          filterExists = true; break;
        }
      }
      if (!filterExists) {
        const filterResource = { criteria: { query: filterQuery }, action: { addLabelIds: [trackerToProcessLabelId] } };
        const createdFilterResponse = gmailApiServiceForFilter.Users.Settings.Filters.create(filterResource, 'me');
        if (!createdFilterResponse || !createdFilterResponse.id) {
          throw new Error(`Gmail filter creation for tracker FAILED or did not return ID. Response: ${JSON.stringify(createdFilterResponse)}`);
        }
        messages.push("Tracker Filter: CREATED.");
      } else { messages.push("Tracker Filter: Exists."); }

    } catch (e) {
      Logger.log(`[${FUNC_NAME} ERROR] Gmail Label/Filter setup: ${e.toString()}`);
      messages.push(`Gmail Label/Filter setup FAILED: ${e.message}.`); moduleSuccess = false;
    }
  }

  // --- C. Add Dummy Data ---
  let dummyRows = []; // To scope it for removal block
  if (moduleSuccess && dataSh && dataSh.getLastRow() <= 1) { // Only if sheet is truly empty (just header)
    Logger.log(`[${FUNC_NAME} INFO] Adding dummy data to "${config.sheetTabName}".`);
    try {
      const today = new Date();
      const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
      const twoWeeksAgo = new Date(today.getTime() - 14 * 24 * 60 * 60 * 1000);
      dummyRows = [ // Assign to the outer scoped variable
        [new Date(), twoWeeksAgo, "LinkedIn", "DemoCorp Alpha", "Software Intern", DEFAULT_STATUS, DEFAULT_STATUS, twoWeeksAgo, "Applied to Alpha", "https://example.com/alpha", "dummyMsgIdAlpha", "Initial notes for Alpha"],
        [new Date(), weekAgo, "Indeed", "Test Inc. Beta", "QA Analyst", INTERVIEW_STATUS, INTERVIEW_STATUS, weekAgo, "Interview Scheduled for Beta", "https://example.com/beta", "dummyMsgIdBeta", "Follow up after Beta interview"]
        // Add a third dummy row if needed for chart variety
      ];
      dummyRows = dummyRows.map(r => {
        while (r.length < TOTAL_COLUMNS_IN_APP_SHEET) r.push(""); return r.slice(0, TOTAL_COLUMNS_IN_APP_SHEET);
      });
      dataSh.getRange(2, 1, dummyRows.length, TOTAL_COLUMNS_IN_APP_SHEET).setValues(dummyRows);
      dummyDataWasAdded = true; messages.push(`Dummy data added (${dummyRows.length} rows).`);
    } catch (e) { Logger.log(`[${FUNC_NAME} WARN] Failed adding dummy data: ${e.message}`); messages.push("Dummy data add FAILED."); }
  }


  // --- E. Remove Dummy Data ---
  if (moduleSuccess && dummyDataWasAdded && dataSh && dummyRows.length > 0) {
    Logger.log(`[${FUNC_NAME} INFO] Removing dummy data (${dummyRows.length} rows)...`);
    try {
      if (dataSh.getLastRow() >= (1 + dummyRows.length)) { // Check if enough rows exist to delete
        dataSh.deleteRows(2, dummyRows.length);
        messages.push("Dummy data removed.");
      } else {
        Logger.log(`[${FUNC_NAME} WARN] Not enough rows to delete all dummy data as expected. Sheet lastRow: ${dataSh.getLastRow()}, Dummy rows: ${dummyRows.length}`);
      }
    } catch (e) { Logger.log(`[${FUNC_NAME} WARN] Failed removing dummy data: ${e.message}`); }
  }

  // --- F. Trigger Verification/Creation ---
  if (moduleSuccess) {
    Logger.log(`[${FUNC_NAME} INFO] Setting up triggers for ${config.moduleName} module...`);
    try { // Assumes createTimeDrivenTrigger & createOrVerifyStaleRejectTrigger are in Triggers.gs
      if (createTimeDrivenTrigger(config.triggerFunctionName, config.triggerIntervalHours)) messages.push(`Trigger '${config.triggerFunctionName}': CREATED.`);
      else messages.push(`Trigger '${config.triggerFunctionName}': Exists/Verified.`);
      if (config.staleRejectFunctionName) {
        if (createOrVerifyStaleRejectTrigger(config.staleRejectFunctionName, 2)) messages.push(`Trigger '${config.staleRejectFunctionName}': CREATED.`);
        else messages.push(`Trigger '${config.staleRejectFunctionName}': Exists/Verified.`);
      }
    } catch (e) {
      Logger.log(`[${FUNC_NAME} ERROR] Trigger setup failed: ${e.toString()}`);
      messages.push(`Trigger setup FAILED: ${e.message}.`);
      moduleSuccess = false;
    }
  } else {
    messages.push(`Triggers for ${config.moduleName} Module: SKIPPED due to earlier failures.`);
  }

  Logger.log(`\n==== ${FUNC_NAME} ${moduleSuccess ? "COMPLETED." : "ISSUES."} ====`);
  return { success: moduleSuccess, messages: messages };
}
