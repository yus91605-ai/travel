/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 城市旅遊規劃系統 - 後端邏輯 (code.gs)
 */

function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('城市旅遊規劃清單')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * 取得或建立試算表
 */
function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('TravelList');
  if (!sheet) {
    sheet = ss.insertSheet('TravelList');
    // 建立標題列
    sheet.appendRow(['ID', '城市', '日期', '天數', '景點', '預算', '氣候', '行程', '狀態', '建立時間']);
    sheet.getRange(1, 1, 1, 10).setFontWeight('bold').setBackground('#f3f4f6');
  }
  return sheet;
}

/**
 * 讀取所有旅遊行程
 */
function getTravelData() {
  try {
    const sheet = getSheet();
    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return [];

    // 排除標題列並轉換為物件陣列
    const headers = data[0];
    return data.slice(1).map((row, index) => {
      const obj = {};
      headers.forEach((header, i) => {
        obj[header] = row[i];
      });
      obj.rowNumber = index + 2; // 儲存行號方便後續操作
      return obj;
    });
  } catch (e) {
    console.error('讀取失敗: ' + e.toString());
    return [];
  }
}

/**
 * 新增行程
 */
function addTravelItem(item) {
  try {
    const sheet = getSheet();
    const id = Utilities.getUuid();
    const timestamp = new Date();
    sheet.appendRow([
      id,
      item.city,
      item.date,
      item.days,
      item.spots,
      item.budget,
      item.weather,
      item.itinerary,
      '待出發',
      timestamp
    ]);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

/**
 * 刪除行程
 */
function deleteTravelItem(rowNumber) {
  try {
    const sheet = getSheet();
    sheet.deleteRow(rowNumber);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

/**
 * 切換狀態
 */
function toggleTravelStatus(rowNumber, currentStatus) {
  try {
    const sheet = getSheet();
    const newStatus = currentStatus === '已完成' ? '待出發' : '已完成';
    sheet.getRange(rowNumber, 9).setValue(newStatus);
    return { success: true, newStatus: newStatus };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}
