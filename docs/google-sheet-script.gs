// Paste this into the Google Sheet: Extensions -> Apps Script. Change SECRET to your own word, then Deploy -> New deployment
// -> type "Web app" -> Execute as: Me -> Who has access: Anyone -> Deploy. Copy the link that ends with /exec into the Work Hub.
const SECRET = "CHANGE-THIS-WORD";
const TAB_GID = 1273202001;   // the tab of your log sheet (the number after gid= in the sheet link)

function doPost(e) {
  const d = JSON.parse(e.postData.contents);
  if (d.key !== SECRET) return ContentService.createTextOutput("no");
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheets().filter(function (s) { return s.getSheetId() === TAB_GID; })[0] || ss.getSheets()[0];
  sh.appendRow(d.row);
  return ContentService.createTextOutput("ok");
}
