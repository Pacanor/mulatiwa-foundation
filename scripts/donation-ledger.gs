/**
 * DEPRECATED — staff reports now read live from Cybersource Transaction Search.
 * This Apps Script / spreadsheet ledger is no longer used by the website.
 * Kept only as a historical reference.
 *
 * Mulatiwa Foundation — Donations ledger (Google Sheet)
 *
 * Setup (once):
 * 1. Open the Donations spreadsheet
 * 2. Extensions → Apps Script → paste this file → Save
 * 3. Run setupSheet once (authorize when prompted)
 * 4. Deploy → New deployment → Web app
 *    - Execute as: Me
 *    - Who has access: Anyone
 *
 * API:
 *  POST JSON row → append donation
 *  GET          → JSON { donations: [...] }
 *  GET ?mode=csv → CSV download
 */

var SPREADSHEET_ID = "1-BfsegzvrqhRZAafrS43MGjfCKCUQ5jKHEIuLZ8zF1s";
var SHEET_NAME = "Donations";
var HEADERS = [
  "recorded_at",
  "status",
  "amount",
  "currency",
  "donor_name",
  "donor_email",
  "reference",
  "error_message",
];

var NAVY = "#123a6d";
var BLUE = "#1b5ea8";
var GOLD = "#e8c23a";
var CREAM = "#f6f3ea";
var PAPER = "#fffdf8";
var OK = "#0f6b3c";
var FAIL = "#9b1b1b";
var MUTED = "#66727e";

function getSpreadsheet_() {
  try {
    return SpreadsheetApp.openById(SPREADSHEET_ID);
  } catch (e) {
    return SpreadsheetApp.getActiveSpreadsheet();
  }
}

function setupSheet() {
  var ss = getSpreadsheet_();
  ss.rename("Mulatiwa Foundation — Donations");

  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }

  // Remove default Sheet1 if empty and not our tab
  ss.getSheets().forEach(function (other) {
    if (other.getName() !== SHEET_NAME && other.getName() !== "About" && other.getLastRow() <= 1 && other.getLastColumn() <= 1) {
      try {
        ss.deleteSheet(other);
      } catch (e) {
        // keep at least one sheet
      }
    }
  });

  sheet.clear();
  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(2);
  sheet.setHiddenGridlines(true);
  sheet.setTabColor(NAVY);

  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  styleHeader_(sheet);
  styleBody_(sheet);
  applyConditionalStatus_(sheet);
  autosize_(sheet);

  // Instructions tab
  var help = ss.getSheetByName("About");
  if (!help) help = ss.insertSheet("About", 0);
  help.clear();
  help.setTabColor(GOLD);
  help.setHiddenGridlines(true);
  help.getRange("A1").setValue("Mulatiwa Foundation — Donations ledger");
  help.getRange("A1").setFontFamily("Georgia").setFontSize(22).setFontColor(NAVY).setFontWeight("bold");
  help.getRange("A3").setValue(
    "This workbook is the durable record of website donations (approved and unsuccessful).",
  );
  help.getRange("A4").setValue(
    "The live site appends rows automatically. Staff can filter and follow up from the Donations tab or the private web report.",
  );
  help.getRange("A6").setValue("Columns");
  help.getRange("A6").setFontWeight("bold").setFontColor(BLUE);
  help.getRange("A7").setValue(
    "recorded_at · status · amount · currency · donor_name · donor_email · reference · error_message",
  );
  help.getRange("A9").setValue("Tips");
  help.getRange("A9").setFontWeight("bold").setFontColor(BLUE);
  help.getRange("A10").setValue("• Filter the Status column to focus on declined/failed donations.");
  help.getRange("A11").setValue("• Click a donor email to open your mail client.");
  help.getRange("A12").setValue("• Do not rename the Donations tab — the website depends on that name.");
  help.getRange("A3:A12").setFontFamily("Arial").setFontSize(11).setFontColor("#17212b");
  help.setColumnWidth(1, 860);
  help.getRange("A1:A12").setBackground(PAPER);

  SpreadsheetApp.flush();
}

function styleHeader_(sheet) {
  var header = sheet.getRange(1, 1, 1, HEADERS.length);
  header
    .setBackground(NAVY)
    .setFontColor(GOLD)
    .setFontWeight("bold")
    .setFontFamily("Arial")
    .setFontSize(11)
    .setHorizontalAlignment("left")
    .setVerticalAlignment("middle");
  sheet.setRowHeight(1, 36);
}

function styleBody_(sheet) {
  var maxRows = Math.max(sheet.getMaxRows(), 500);
  var body = sheet.getRange(2, 1, maxRows - 1, HEADERS.length);
  body
    .setBackground(PAPER)
    .setFontFamily("Arial")
    .setFontSize(10)
    .setVerticalAlignment("middle");
  sheet.getRange(2, 1, maxRows - 1, 1).setNumberFormat("yyyy-mm-dd hh:mm");
  sheet.getRange(2, 3, maxRows - 1, 1).setNumberFormat("0.00");
  sheet.setColumnWidths(1, 1, 170);
  sheet.setColumnWidths(2, 1, 100);
  sheet.setColumnWidths(3, 1, 90);
  sheet.setColumnWidths(4, 1, 90);
  sheet.setColumnWidths(5, 1, 140);
  sheet.setColumnWidths(6, 1, 220);
  sheet.setColumnWidths(7, 1, 180);
  sheet.setColumnWidths(8, 1, 220);
}

function applyConditionalStatus_(sheet) {
  var range = sheet.getRange("B2:B1000");
  var rules = sheet.getConditionalFormatRules() || [];
  rules.push(
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo("approved")
      .setBackground("#e7f5ec")
      .setFontColor(OK)
      .setRanges([range])
      .build(),
  );
  rules.push(
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo("declined")
      .setBackground("#f8e8e8")
      .setFontColor(FAIL)
      .setRanges([range])
      .build(),
  );
  rules.push(
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo("failed")
      .setBackground("#f8e8e8")
      .setFontColor(FAIL)
      .setRanges([range])
      .build(),
  );
  sheet.setConditionalFormatRules(rules);
}

function autosize_(sheet) {
  // Keep intentional widths from styleBody_
}

function getDonationsSheet_() {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    setupSheet();
    sheet = getSpreadsheet_().getSheetByName(SHEET_NAME);
  }
  return sheet;
}

function appendDonation_(payload) {
  var sheet = getDonationsSheet_();
  if (sheet.getLastRow() < 1) {
    setupSheet();
    sheet = getDonationsSheet_();
  }

  var row = HEADERS.map(function (key) {
    return payload[key] != null ? String(payload[key]) : "";
  });
  sheet.appendRow(row);

  var last = sheet.getLastRow();
  sheet.getRange(last, 1, 1, HEADERS.length).setBorder(
    false,
    false,
    true,
    false,
    false,
    false,
    "#d7e0ea",
    SpreadsheetApp.BorderStyle.SOLID,
  );
  return { ok: true, row: last };
}

function cellToExport_(value) {
  if (Object.prototype.toString.call(value) === "[object Date]" && !isNaN(value.getTime())) {
    return value.toISOString();
  }
  return value != null && value !== "" ? String(value) : "";
}

function readDonations_() {
  var sheet = getDonationsSheet_();
  var values = sheet.getDataRange().getValues();
  if (!values.length) return [];
  var header = values[0].map(function (key) {
    return String(key || "").trim();
  });
  return values.slice(1).filter(function (line) {
    return line.join("").trim();
  }).map(function (line) {
    var row = {};
    header.forEach(function (key, index) {
      row[key] = cellToExport_(line[index]);
    });
    return row;
  });
}

function doPost(e) {
  try {
    var payload = {};
    if (e.postData && e.postData.contents) {
      payload = JSON.parse(e.postData.contents);
    }
    var result = appendDonation_(payload);
    return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(
      ContentService.MimeType.JSON,
    );
  } catch (error) {
    return ContentService.createTextOutput(
      JSON.stringify({ ok: false, error: String(error) }),
    ).setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  var mode = (e && e.parameter && e.parameter.mode) || "json";
  var donations = readDonations_();

  if (mode === "csv") {
    var lines = [HEADERS.join(",")].concat(
      donations.map(function (row) {
        return HEADERS.map(function (key) {
          var text = row[key] != null ? String(row[key]) : "";
          if (/[",\n\r]/.test(text)) text = '"' + text.replace(/"/g, '""') + '"';
          return text;
        }).join(",");
      }),
    );
    return ContentService.createTextOutput(lines.join("\n")).setMimeType(
      ContentService.MimeType.CSV,
    );
  }

  return ContentService.createTextOutput(
    JSON.stringify({ donations: donations }),
  ).setMimeType(ContentService.MimeType.JSON);
}
