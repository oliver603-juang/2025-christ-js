/**
 * app.js - 2026 東京冬旅 (最終極致版 - Fix: All Google Map Links)
 * * 修復項目：
 * 1. [Critical] InfoTab 周邊機能：修正為 https://www.google.com/maps/search/?api=1&query=...
 * 2. [Critical] FAB 三折地圖：修正為 https://www.google.com/maps/dir/座標1/座標2...
 * 3. [Critical] 行程導航：修正為 https://www.google.com/maps/dir/?api=1&origin=...
 * 4. [Feat] 保留所有功能 (AI 辨識、行程連動、記帳表格報表、FAB 地圖按鈕)。
 * 5. [Fix] Icon Polyfill 防止崩潰。
 */

const { useState, useEffect, useMemo, useCallback, useRef } = React;

// ============================================================================
// SECTION 0: ICON POLYFILLS (防止圖示缺失導致崩潰)
// ============================================================================
(function ensureIcons() {
  if (!window.Icons) window.Icons = {};

  // 補全可能缺失的關鍵圖示
  if (!window.Icons.Map)
    window.Icons.Map = (props) => (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        {...props}
      >
        <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21 3 6" />
        <line x1="9" x2="9" y1="3" y2="18" />
        <line x1="15" x2="15" y1="6" y2="21" />
      </svg>
    );
  if (!window.Icons.Image)
    window.Icons.Image = (props) => (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        {...props}
      >
        <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
        <circle cx="9" cy="9" r="2" />
        <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
      </svg>
    );
  if (!window.Icons.Loader2)
    window.Icons.Loader2 = (props) => (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        {...props}
      >
        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
      </svg>
    );
  if (!window.Icons.AlertTriangle)
    window.Icons.AlertTriangle = (props) => (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        {...props}
      >
        <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
        <path d="M12 9v4" />
        <path d="M12 17h.01" />
      </svg>
    );
})();

// ==========================================
// 1. 工具函數 (Utilities)
// ==========================================

const generateGeminiContent = async (
  prompt,
  base64Image = null,
  useSearch = false
) => {
  const apiKey = localStorage.getItem("gemini_api_key") || "";
  if (!apiKey) throw new Error("NO_API_KEY");

  const MODEL_NAME = "gemini-2.5-flash-preview-09-2025";
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${apiKey}`;

  const contents = [{ role: "user", parts: [{ text: prompt }] }];
  if (base64Image) {
    const data = base64Image.split(",")[1] || base64Image;
    contents[0].parts.unshift({
      inlineData: { mimeType: "image/jpeg", data: data },
    });
  }

  const payload = {
    contents,
    tools: useSearch ? [{ google_search: {} }] : undefined,
  };

  for (let i = 0; i < 3; i++) {
    try {
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        if (response.status === 429 && i < 2) {
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }
        throw new Error(`API Error: ${response.status}`);
      }
      const result = await response.json();
      return result.candidates?.[0]?.content?.parts?.[0]?.text || "無內容生成";
    } catch (error) {
      if (i === 2) throw error;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
};

const timeToMinutes = (t) => {
  if (!t) return 0;
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};
const minutesToTimeStr = (m) => {
  let h = Math.floor(m / 60);
  let min = Math.floor(m % 60);
  h = h % 24;
  return `${h.toString().padStart(2, "0")}:${min.toString().padStart(2, "0")}`;
};
const parseStayDuration = (s) => {
  if (!s || s === "-" || s === "Overnight") return 0;
  if (s.includes("hr")) return parseFloat(s) * 60;
  if (s.includes("min")) return parseInt(s);
  return 0;
};
const formatTime = (ts) => {
  if (!ts) return "";
  const date = new Date(ts);
  if (isNaN(date.getTime())) return String(ts);
  return date.toLocaleString("zh-TW", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
};

function getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return (R * c).toFixed(1);
}

// ==========================================
// 2. 共用 UI 組件 (Components)
// ==========================================

const MarkdownRenderer = ({ content, className = "" }) => {
  const html = marked.parse(content || "");
  return (
    <div
      className={`markdown-content ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};

const ApiKeyModal = ({ isOpen, onClose }) => {
  const [tempKey, setTempKey] = useState(
    localStorage.getItem("gemini_api_key") || ""
  );
  const Icons = window.Icons;
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-stone-900/80 backdrop-blur-sm flex items-center justify-center z-[120] p-4">
      <div className="glass-panel rounded-2xl p-6 w-full max-w-sm shadow-2xl bg-[#1e293b] text-slate-200 border border-slate-700">
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-bold text-lg flex items-center gap-2">
            <Icons.Settings size={20} className="text-[#4ECDC4]" /> 設定 AI 金鑰
          </h3>
          <button onClick={onClose}>
            <Icons.X size={20} className="text-slate-400 hover:text-white" />
          </button>
        </div>
        <input
          type="password"
          value={tempKey}
          onChange={(e) => setTempKey(e.target.value)}
          placeholder="Paste API Key"
          className="w-full bg-slate-800 p-3 rounded-xl mb-4 text-white outline-none border border-slate-600 focus:border-[#4ECDC4]"
        />
        <div className="flex gap-2">
          <a
            href="https://aistudio.google.com/app/apikey"
            target="_blank"
            rel="noreferrer"
            className="flex-1 text-center py-2.5 rounded-xl border border-slate-600 text-xs font-bold text-slate-400"
          >
            取得 Key
          </a>
          <button
            onClick={() => {
              localStorage.setItem("gemini_api_key", tempKey);
              onClose();
              window.location.reload();
            }}
            className="flex-1 bg-[#4ECDC4] text-white rounded-xl font-bold"
          >
            儲存
          </button>
        </div>
      </div>
    </div>
  );
};

// --- ExpenseModal ---
const ExpenseModal = ({
  isOpen,
  onClose,
  currentEditingSpot,
  expenseForm,
  setExpenseForm,
  handleImageUpload,
  pendingReceipts,
  togglePendingReceipt,
  removePendingReceipt,
  saveExpense,
  expenses,
  deleteExpense,
  isAnalyzingReceipt,
  quotaStatus,
}) => {
  const Icons = window.Icons;
  const [sortConfig, setSortConfig] = useState({
    key: "date",
    direction: "desc",
  });

  if (!isOpen || !currentEditingSpot) return null;
  const safePendingReceipts = pendingReceipts || [];

  const currentSpotExpenses = expenses[currentEditingSpot.id] || [];
  const sortedExpenses = [...currentSpotExpenses].sort((a, b) => {
    const valA = sortConfig.key === "date" ? a.timestamp || a.id : a.amount;
    const valB = sortConfig.key === "date" ? b.timestamp || b.id : b.amount;
    return sortConfig.direction === "asc" ? valA - valB : valB - valA;
  });

  const toggleSort = (key) => {
    setSortConfig((prev) => ({
      key,
      direction: prev.key === key && prev.direction === "desc" ? "asc" : "desc",
    }));
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[100] p-4 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="glass-panel rounded-3xl p-6 w-full max-w-sm bg-white border border-gray-100 flex flex-col max-h-[85vh] shadow-2xl">
        <h3 className="font-bold text-lg mb-4 flex items-center gap-2 text-gray-800">
          <Icons.Wallet size={20} className="text-[#E4C2C1]" />{" "}
          {currentEditingSpot.name}
        </h3>

        <div className="flex-1 overflow-y-auto pr-1 no-scrollbar">
          <input
            type="text"
            value={expenseForm.note}
            onChange={(e) =>
              setExpenseForm({ ...expenseForm, note: e.target.value })
            }
            className="w-full bg-gray-50 p-3 rounded-xl mb-4 text-sm outline-none border border-gray-200 text-gray-800 focus:border-[#E4C2C1]"
            placeholder="備註"
          />
          <div className="relative mb-4">
            <input
              type="number"
              value={expenseForm.amount}
              onChange={(e) =>
                setExpenseForm({ ...expenseForm, amount: e.target.value })
              }
              className="w-full bg-gray-50 p-3 rounded-xl text-2xl font-mono border border-gray-200 outline-none text-gray-800 focus:border-[#E4C2C1] pr-12 font-bold placeholder-gray-300"
              placeholder="0"
            />
            <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
              <div className="relative">
                <input
                  type="file"
                  accept="image/*"
                  id="modal-gallery-upload"
                  className="hidden"
                  multiple
                  onChange={handleImageUpload}
                  disabled={isAnalyzingReceipt}
                />
                <label
                  htmlFor="modal-gallery-upload"
                  className={`p-1.5 rounded-lg cursor-pointer flex items-center justify-center transition-colors ${
                    isAnalyzingReceipt
                      ? "text-gray-400 cursor-not-allowed"
                      : "text-gray-400 hover:text-[#4ECDC4] hover:bg-gray-100"
                  }`}
                >
                  <Icons.Image size={20} />
                </label>
              </div>
              <div className="relative">
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  id="modal-camera-upload"
                  className="hidden"
                  onChange={handleImageUpload}
                  disabled={isAnalyzingReceipt}
                />
                <label
                  htmlFor="modal-camera-upload"
                  className={`p-1.5 rounded-lg cursor-pointer flex items-center justify-center transition-colors ${
                    isAnalyzingReceipt
                      ? "text-[#E4C2C1] animate-pulse"
                      : "text-gray-400 hover:text-[#4ECDC4] hover:bg-gray-100"
                  }`}
                >
                  {isAnalyzingReceipt ? (
                    <Icons.Loader2 size={20} className="animate-spin" />
                  ) : (
                    <Icons.Camera size={20} />
                  )}
                </label>
              </div>
            </div>
          </div>

          {safePendingReceipts.length > 0 && (
            <div className="mb-6 space-y-2 bg-[#F9F7F5] p-3 rounded-xl border border-gray-200">
              <div className="text-xs font-bold text-[#A9BFA8] flex justify-between px-1">
                <span>AI 辨識結果</span>
                <span>{quotaStatus.text}</span>
              </div>
              {safePendingReceipts.map((item) => (
                <div
                  key={item.id}
                  className={`flex items-center gap-2 p-2 rounded-lg transition-colors ${
                    item.isChecked
                      ? "bg-white border border-[#E4C2C1]"
                      : "bg-gray-100 opacity-60"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={item.isChecked}
                    onChange={() => togglePendingReceipt(item.id)}
                    className="accent-[#E4C2C1] w-4 h-4 cursor-pointer rounded"
                  />
                  <div className="flex-1 min-w-0">
                    {item.isAnalyzing ? (
                      <div className="text-xs text-gray-500 flex items-center gap-1">
                        <Icons.Loader2 size={12} className="animate-spin" />{" "}
                        分析中...
                      </div>
                    ) : (
                      <>
                        <div className="text-sm truncate text-gray-800">
                          {item.note}
                        </div>
                        <div className="flex justify-between items-center mt-0.5">
                          <div className="text-xs text-[#E4C2C1] font-mono font-bold">
                            ¥{item.amount}
                          </div>
                          {item.timestamp && (
                            <div className="text-[10px] text-gray-400">
                              {formatTime(item.timestamp)}
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                  <button
                    onClick={() => removePendingReceipt(item.id)}
                    className="text-gray-400 hover:text-red-400"
                  >
                    <Icons.X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="pt-4 border-t border-dashed border-gray-200">
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                歷史紀錄
              </span>
              <div className="flex gap-1">
                <button
                  onClick={() => toggleSort("date")}
                  className={`px-2 py-1 rounded-full text-[10px] font-bold border transition-colors ${
                    sortConfig.key === "date"
                      ? "bg-[#E4C2C1] text-white border-[#E4C2C1]"
                      : "bg-gray-50 text-gray-400 border-gray-200"
                  }`}
                >
                  時間{" "}
                  {sortConfig.key === "date" &&
                    (sortConfig.direction === "desc" ? "↓" : "↑")}
                </button>
                <button
                  onClick={() => toggleSort("amount")}
                  className={`px-2 py-1 rounded-full text-[10px] font-bold border transition-colors ${
                    sortConfig.key === "amount"
                      ? "bg-[#A9BFA8] text-white border-[#A9BFA8]"
                      : "bg-gray-50 text-gray-400 border-gray-200"
                  }`}
                >
                  金額{" "}
                  {sortConfig.key === "amount" &&
                    (sortConfig.direction === "desc" ? "↓" : "↑")}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              {sortedExpenses.length === 0 && (
                <div className="text-xs text-gray-400 text-center py-2">
                  無消費紀錄
                </div>
              )}
              {sortedExpenses.map((r) => (
                <div
                  key={r.id}
                  className="flex justify-between text-sm bg-gray-50 p-3 rounded-xl border border-gray-100"
                >
                  <div className="flex flex-col">
                    <span className="text-gray-700 font-medium">
                      {r.note || "消費"}
                    </span>
                    <span className="text-[10px] text-gray-400">
                      {formatTime(r.timestamp || r.id)}
                    </span>
                  </div>
                  <div className="flex gap-3 items-center">
                    <span className="font-mono font-bold text-gray-800">
                      ¥{r.amount}
                    </span>
                    <button
                      onClick={() => deleteExpense(currentEditingSpot.id, r.id)}
                      className="text-gray-400 hover:text-red-400"
                    >
                      <Icons.X size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="flex gap-2 mt-4 shrink-0 pt-4 border-t border-gray-100">
          <button
            onClick={onClose}
            className="flex-1 py-3 text-gray-500 hover:bg-gray-50 rounded-xl transition-colors font-medium"
          >
            取消
          </button>
          <button
            onClick={saveExpense}
            className="flex-1 bg-[#E4C2C1] text-white rounded-xl font-bold py-3 shadow-md hover:brightness-105 active:scale-95 transition-all"
          >
            儲存
          </button>
        </div>
      </div>
    </div>
  );
};

// --- Email 發送彈窗 ---
const EmailModal = ({
  isOpen,
  onClose,
  emailInput,
  setEmailInput,
  handleSendEmail,
  isSendingEmail,
}) => {
  const Icons = window.Icons;
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[130] p-4">
      <div className="glass-panel rounded-3xl p-6 w-full max-w-sm bg-white border border-gray-100 shadow-xl">
        <h3 className="font-bold text-lg mb-2 flex items-center gap-2 text-gray-800">
          <Icons.Mail size={20} className="text-[#A9BFA8]" /> 寄送報表
        </h3>
        <p className="text-xs text-gray-400 mb-4">
          將本次旅程的詳細花費清單 (HTML 表格) 發送至您的信箱。
        </p>
        <input
          type="email"
          value={emailInput}
          onChange={(e) => setEmailInput(e.target.value)}
          placeholder="Email"
          className="w-full bg-gray-50 p-3 rounded-xl mb-4 border border-gray-200 outline-none focus:border-[#E4C2C1] text-gray-800"
        />
        <button
          onClick={handleSendEmail}
          className="w-full bg-[#E4C2C1] text-white rounded-xl font-bold py-3 shadow-md flex items-center justify-center gap-2 hover:brightness-105"
          disabled={isSendingEmail}
        >
          {isSendingEmail ? (
            <Icons.Loader2 size={16} className="animate-spin" />
          ) : (
            "確認發送"
          )}
        </button>
        <button
          onClick={onClose}
          className="w-full mt-2 text-gray-400 py-2 hover:text-gray-600"
        >
          取消
        </button>
      </div>
    </div>
  );
};

// --- 每日明細彈窗 ---
const DailyDetailModal = ({
  isOpen,
  onClose,
  dayData,
  allExpenses,
  spotTicketCounts = {},
  selectedCurrency,
  exchangeRate,
  tripData,
}) => {
  const Icons = window.Icons;
  const [sortConfig, setSortConfig] = useState({
    key: "date",
    direction: "desc",
  });

  if (!isOpen || !dayData) return null;
  const isTotalSummary = dayData.isTotalSummary;
  const filteredDays = isTotalSummary ? tripData : [dayData];
  const dayExpensesList = [];

  filteredDays.forEach((day) => {
    day.spots.forEach((spot) => {
      const expenses = allExpenses[spot.id] || [];
      expenses.forEach((r) =>
        dayExpensesList.push({ ...r, spotName: spot.name })
      );
      if (spot.ticket) {
        const counts = spotTicketCounts[spot.id] || { adult: 2, child: 2 };
        const cost =
          spot.ticket.adult * counts.adult + spot.ticket.child * counts.child;
        if (cost > 0)
          dayExpensesList.push({
            id: `t-${spot.id}`,
            amount: cost,
            note: `門票 (大${counts.adult} 小${counts.child})`,
            spotName: spot.name,
            timestamp: 0,
          });
      }
    });
  });

  const totalTWD = dayExpensesList.reduce((sum, item) => sum + item.amount, 0);

  const sortedList = [...dayExpensesList].sort((a, b) => {
    const valA = sortConfig.key === "date" ? a.timestamp || 0 : a.amount;
    const valB = sortConfig.key === "date" ? b.timestamp || 0 : b.amount;
    return sortConfig.direction === "asc" ? valA - valB : valB - valA;
  });

  const toggleSort = (key) => {
    setSortConfig((prev) => ({
      key,
      direction: prev.key === key && prev.direction === "desc" ? "asc" : "desc",
    }));
  };

  return (
    <div
      className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[130] p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="glass-panel rounded-3xl p-6 w-full max-w-sm shadow-2xl max-h-[85vh] flex flex-col bg-white border border-gray-100"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4 border-b border-gray-100 pb-3">
          <div>
            <div className="text-xs font-bold text-gray-400">
              {isTotalSummary ? "整個行程" : dayData.date}
            </div>
            <h3 className="font-black text-xl text-gray-800">
              {isTotalSummary ? "總花費明細" : dayData.title}
            </h3>
          </div>
          <button onClick={onClose}>
            <Icons.X size={20} className="text-gray-400 hover:text-gray-600" />
          </button>
        </div>

        <div className="flex justify-between items-center mb-2 px-1">
          <span className="text-xs font-bold text-gray-400 uppercase">
            消費列表
          </span>
          <div className="flex gap-1">
            <button
              onClick={() => toggleSort("date")}
              className={`px-2 py-1 rounded-full text-[10px] font-bold border transition-colors ${
                sortConfig.key === "date"
                  ? "bg-[#E4C2C1] text-white border-[#E4C2C1]"
                  : "bg-gray-50 text-gray-400 border-gray-200"
              }`}
            >
              時間{" "}
              {sortConfig.key === "date" &&
                (sortConfig.direction === "desc" ? "↓" : "↑")}
            </button>
            <button
              onClick={() => toggleSort("amount")}
              className={`px-2 py-1 rounded-full text-[10px] font-bold border transition-colors ${
                sortConfig.key === "amount"
                  ? "bg-[#A9BFA8] text-white border-[#A9BFA8]"
                  : "bg-gray-50 text-gray-400 border-gray-200"
              }`}
            >
              金額{" "}
              {sortConfig.key === "amount" &&
                (sortConfig.direction === "desc" ? "↓" : "↑")}
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto space-y-3 no-scrollbar pr-1">
          {sortedList.length === 0 && (
            <div className="text-center text-gray-400 py-10">尚無紀錄</div>
          )}
          {sortedList.map((item, idx) => (
            <div
              key={item.id || idx}
              className="bg-gray-50 p-3 rounded-xl border border-gray-100 flex justify-between items-center"
            >
              <div className="flex flex-col">
                <div className="text-xs text-[#A9BFA8] font-bold mb-0.5">
                  {item.spotName}
                </div>
                <div className="text-sm font-bold text-gray-600">
                  {item.note}
                </div>
                {item.timestamp > 0 && (
                  <div className="text-[10px] text-gray-400 mt-0.5">
                    {formatTime(item.timestamp)}
                  </div>
                )}
              </div>
              <div className="font-mono font-bold text-[#E4C2C1] text-lg">
                ¥{item.amount.toLocaleString()}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 pt-4 border-t border-gray-100 space-y-1">
          <div className="flex justify-between">
            <span className="text-sm font-bold text-gray-500">總計 (JPY)</span>
            <span className="text-xl font-mono font-black text-[#E4C2C1]">
              ¥{totalTWD.toLocaleString()}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-xs font-bold text-gray-400">
              約合 ({selectedCurrency.code})
            </span>
            <span className="text-sm font-mono font-bold text-gray-500">
              {selectedCurrency.symbol}{" "}
              {(totalTWD * exchangeRate).toFixed(0).toLocaleString()}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

// --- CurrencySwitcher ---
const CurrencySwitcher = ({
  selectedCurrency,
  exchangeRate,
  isRateLoading,
  setSelectedCurrency,
}) => {
  const Icons = window.Icons;
  return (
    <div className="flex items-center gap-2">
      <div className="text-[10px] sm:text-xs font-bold text-gray-400 italic whitespace-nowrap hidden sm:block">
        {isRateLoading
          ? "..."
          : `1 TWD ≈ ${exchangeRate.toFixed(4)} ${selectedCurrency.code}`}
      </div>
      <div className="bg-white p-1.5 sm:p-2 rounded-xl shadow-sm border border-gray-200 relative group hover:border-[#A9BFA8] transition-colors">
        <select
          value={selectedCurrency.code}
          onChange={(e) => {
            const f = window.CURRENCY_OPTIONS.find(
              (c) => c.code === e.target.value
            );
            if (f) setSelectedCurrency(f);
          }}
          className="bg-transparent outline-none cursor-pointer text-sm font-bold appearance-none pr-5 text-gray-600"
          disabled={isRateLoading}
        >
          {(window.CURRENCY_OPTIONS || []).map((c) => (
            <option key={c.code} value={c.code}>
              {c.code}
            </option>
          ))}
        </select>
        <Icons.ArrowDown
          size={12}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400 group-hover:text-[#A9BFA8]"
        />
      </div>
    </div>
  );
};

// ==========================================
// 3. 分頁組件 (Tabs)
// ==========================================

const ItineraryTab = ({
  tripData,
  selectedDay,
  setSelectedDay,
  dayStartTimes,
  handleDayStartTimeChange,
  handleDepartureToggle,
  handleTransportToggle,
  handleStayChangeNew,
  openExpenseModal,
  transportModes,
  expenses,
  getTicketCounts,
  updateSpotTicketCount,
  STAY_OPTIONS,
}) => {
  const Icons = window.Icons;
  const filteredTripData =
    selectedDay === "all"
      ? tripData
      : tripData.filter((day) => day.dayId === selectedDay);
  const WeatherIcon = ({ type }) => {
    switch (type) {
      case "sunny":
        return <Icons.Sun className="w-5 h-5 text-amber-400" />;
      case "cloudy":
        return <Icons.Cloud className="w-5 h-5 text-stone-400" />;
      default:
        return <Icons.CloudSnow className="w-5 h-5 text-stone-300" />;
    }
  };

  return (
    <div className="animate-in fade-in duration-700 pb-20">
      <div className="flex gap-2 mb-6 overflow-x-auto pb-2 no-scrollbar sticky top-20 z-30 bg-[#F9F7F5]/90 backdrop-blur-sm py-2 -mx-4 px-4">
        <button
          onClick={() => setSelectedDay("all")}
          className={`px-4 py-2 rounded-xl font-bold text-sm border transition-all ${
            selectedDay === "all"
              ? "bg-white text-gray-800 border-gray-200 shadow-sm"
              : "bg-transparent text-gray-400 border-transparent hover:bg-white/50"
          }`}
        >
          全部
        </button>
        {tripData.map((day) => (
          <button
            key={day.dayId}
            onClick={() => setSelectedDay(day.dayId)}
            className={`px-4 py-2 rounded-xl font-bold text-sm whitespace-nowrap transition-all ${
              selectedDay === day.dayId
                ? `bg-white text-gray-800 border-gray-200 shadow-md transform scale-105`
                : "text-gray-400 border-transparent hover:bg-white/50"
            }`}
          >
            {day.date.split(" ")[0]}
          </button>
        ))}
      </div>

      <div className="space-y-12">
        {filteredTripData.map((day) => (
          <div key={day.dayId} className="relative">
            <div className="flex items-center gap-4 mb-6 px-2">
              <div
                className={`${day.themeColor} w-14 h-14 rounded-2xl flex flex-col items-center justify-center text-white shadow-md border-2 border-white -rotate-3`}
              >
                <span className="text-[10px] font-bold uppercase tracking-wider opacity-80">
                  Day
                </span>
                <span className="text-xl font-black leading-none">
                  {day.dayId.replace("day", "")}
                </span>
              </div>
              <div>
                <div className="text-2xl font-black text-gray-800">
                  {day.date}
                </div>
                <div className="text-sm font-bold text-gray-400">
                  {day.title}
                </div>
              </div>
            </div>

            <div className="space-y-0 pl-6 border-l-2 border-dashed border-gray-300 ml-9 relative pb-4">
              {day.spots.map((spot, index) => {
                const spotExpenses = expenses[spot.id] || [];
                const spotTotal = spotExpenses.reduce(
                  (sum, r) => sum + (r.amount || 0),
                  0
                );
                const counts = getTicketCounts(spot.id);
                const ticketTotal = spot.ticket
                  ? spot.ticket.adult * counts.adult +
                    spot.ticket.child * counts.child
                  : 0;

                const isWalk = transportModes[spot.id] === "walk";

                return (
                  <div key={spot.id} className="relative group mb-10 last:mb-0">
                    <div
                      className={`absolute -left-[31px] top-8 w-4 h-4 rounded-full border-4 z-10 transition-all ${
                        spot.isDeparted
                          ? "bg-gray-300 border-gray-200"
                          : "bg-white border-[#E4C2C1] shadow-[0_0_0_3px_rgba(228,194,193,0.3)]"
                      }`}
                    ></div>
                    <div
                      className={`glass-panel rounded-[2rem] p-6 mb-0 border transition-all ${
                        spot.isDeparted
                          ? "opacity-60 bg-gray-50 grayscale"
                          : "bg-white hover:border-[#E4C2C1] hover:shadow-lg"
                      }`}
                    >
                      <div className="flex justify-between items-center mb-4">
                        <div className="bg-gray-100 px-3 py-1.5 rounded-xl border border-gray-200 flex items-center gap-2">
                          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">
                            {index === 0 ? "出發" : "抵達"}
                          </span>
                          {index === 0 ? (
                            <input
                              type="time"
                              value={dayStartTimes[day.dayId] || "09:00"}
                              onChange={(e) =>
                                handleDayStartTimeChange(
                                  day.dayId,
                                  e.target.value
                                )
                              }
                              className="bg-transparent font-mono font-bold text-lg text-gray-700 w-20 outline-none"
                            />
                          ) : (
                            <span className="font-mono font-bold text-lg text-gray-700">
                              {spot.time}
                            </span>
                          )}
                        </div>
                        <button
                          onClick={() => handleDepartureToggle(spot.id)}
                          className={`px-4 py-2 rounded-full text-xs font-bold transition-all shadow-sm active:scale-95 ${
                            spot.isDeparted
                              ? "bg-white border border-gray-200 text-gray-400"
                              : "bg-[#E4C2C1] text-white hover:brightness-105"
                          }`}
                        >
                          {spot.isDeparted
                            ? `已出發 ${spot.actualDepTime}`
                            : "確認動身"}
                        </button>
                      </div>

                      <div>
                        <h3 className="text-xl font-black text-gray-800 mb-2">
                          {spot.name}
                        </h3>
                        <div className="flex items-center gap-4 text-xs font-bold text-gray-500 mb-4">
                          <div className="flex items-center gap-1 bg-gray-100 px-2 py-1 rounded-lg border border-gray-200">
                            <Icons.Clock size={12} />
                            <span>停留</span>
                            <select
                              value={spot.stay}
                              onChange={(e) =>
                                handleStayChangeNew(spot.id, e.target.value)
                              }
                              className="bg-transparent text-[#E4C2C1] outline-none font-bold cursor-pointer"
                              disabled={spot.isDeparted}
                            >
                              {STAY_OPTIONS.map((opt) => (
                                <option key={opt} value={opt}>
                                  {opt}
                                </option>
                              ))}
                            </select>
                          </div>
                          {spot.ticket && (
                            <div className="text-[#E4C2C1] flex items-center gap-1">
                              <Icons.Ticket size={12} /> ¥
                              {ticketTotal.toLocaleString()}
                            </div>
                          )}
                        </div>

                        {spot.ticket && (
                          <div className="bg-gray-50 border border-gray-100 p-3 rounded-xl flex gap-4 text-[10px] mb-4">
                            <div className="flex items-center gap-2 text-gray-500">
                              大
                              <div className="flex items-center bg-white border rounded px-1">
                                <button
                                  onClick={() =>
                                    updateSpotTicketCount(spot.id, "adult", -1)
                                  }
                                  className="text-gray-400 hover:text-[#E4C2C1] px-1"
                                >
                                  -
                                </button>
                                <span className="text-gray-800 font-bold px-1">
                                  {counts.adult}
                                </span>
                                <button
                                  onClick={() =>
                                    updateSpotTicketCount(spot.id, "adult", 1)
                                  }
                                  className="text-gray-400 hover:text-[#E4C2C1] px-1"
                                >
                                  +
                                </button>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 text-gray-500">
                              小
                              <div className="flex items-center bg-white border rounded px-1">
                                <button
                                  onClick={() =>
                                    updateSpotTicketCount(spot.id, "child", -1)
                                  }
                                  className="text-gray-400 hover:text-[#E4C2C1] px-1"
                                >
                                  -
                                </button>
                                <span className="text-gray-800 font-bold px-1">
                                  {counts.child}
                                </span>
                                <button
                                  onClick={() =>
                                    updateSpotTicketCount(spot.id, "child", 1)
                                  }
                                  className="text-gray-400 hover:text-[#E4C2C1] px-1"
                                >
                                  +
                                </button>
                              </div>
                            </div>
                          </div>
                        )}

                        <p className="text-sm text-gray-500 mb-4 leading-relaxed">
                          {spot.desc}
                        </p>

                        <div className="flex gap-2">
                          <a
                            href={spot.gmapLink}
                            target="_blank"
                            className="flex-1 bg-gray-50 text-gray-500 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 hover:bg-gray-100 transition-colors border border-gray-100"
                          >
                            <Icons.MapPin
                              size={14}
                              className="text-[#A9BFA8]"
                            />{" "}
                            地圖
                          </a>
                          <button
                            onClick={() => openExpenseModal(spot)}
                            className="flex-1 bg-[#F9F3F3] text-[#E4C2C1] py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 hover:bg-[#E4C2C1] hover:text-white transition-colors border border-[#E4C2C1]/20"
                          >
                            <Icons.Wallet size={14} /> 記帳
                          </button>
                        </div>

                        {(spotTotal > 0 || ticketTotal > 0) && (
                          <div className="mt-3 pt-2 border-t border-dashed border-slate-700/50 text-right">
                            <span className="text-[10px] text-slate-500 mr-2 uppercase">
                              Total Est.
                            </span>
                            <span className="text-sm font-mono font-bold text-[#FF6B6B]">
                              ¥{(spotTotal + ticketTotal).toLocaleString()}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {spot.nextStop && (
                      <div className="py-4 flex flex-col items-center">
                        <div className="bg-white border border-gray-200 rounded-xl p-3 w-full max-w-[260px] text-center shadow-md relative z-10">
                          <div className="text-[10px] text-gray-400 font-bold uppercase mb-1 flex justify-between px-2">
                            <span>NEXT</span>
                            <span>{spot.nextStop.distance}</span>
                          </div>
                          <div className="text-xs font-bold text-gray-700 truncate mb-2">
                            {spot.nextStop.name}
                          </div>
                          <div className="h-px bg-gray-100 w-full mb-2"></div>
                          <div className="flex justify-between items-center px-1">
                            <button
                              onClick={() => handleTransportToggle(spot.id)}
                              className={`flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-lg transition-colors ${
                                isWalk
                                  ? "text-orange-400 bg-orange-50"
                                  : "text-[#A9BFA8] bg-[#A9BFA8]/10"
                              }`}
                            >
                              {isWalk ? (
                                <Icons.Footprints size={14} />
                              ) : (
                                <Icons.Car size={14} />
                              )}
                              {isWalk
                                ? spot.nextStop.walkTime
                                : spot.nextStop.driveTime}
                            </button>
                            <a
                              href={spot.nextStop.navLink}
                              target="_blank"
                              className="text-[10px] bg-gray-800 text-white px-3 py-1 rounded-full hover:bg-gray-700 transition-colors"
                            >
                              導航
                            </a>
                          </div>
                        </div>
                        <div className="text-[10px] font-mono text-gray-400 mt-2 bg-white px-2 py-0.5 rounded-full border border-gray-100 shadow-sm">
                          預計 {spot.nextArrivalTime} 抵達
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// --- InfoTab ---
const InfoTab = () => {
  const Icons = window.Icons;
  const flightInfo = window.FLIGHT_INFO || { outbound: {}, inbound: {} };
  const hotelInfo = window.HOTEL_INFO || [];

  const NAV_BUTTONS = [
    {
      title: "超市/熟食",
      query: "supermarket",
      icon: Icons.ShoppingBag,
      color: "text-green-600 bg-green-50 border-green-100",
    },
    {
      title: "便利商店",
      query: "convenience store",
      icon: Icons.Store,
      color: "text-orange-500 bg-orange-50 border-orange-100",
    },
    {
      title: "咖啡廳",
      query: "coffee",
      icon: Icons.Coffee,
      color: "text-amber-600 bg-amber-50 border-amber-100",
    },
    {
      title: "加油站",
      query: "gas station",
      icon: Icons.Fuel,
      color: "text-red-500 bg-red-50 border-red-100",
    },
    {
      title: "藥妝店",
      query: "drug store",
      icon: Icons.Smile,
      color: "text-blue-500 bg-blue-50 border-blue-100",
    },
  ];

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-6 duration-700 pb-20">
      <div className="glass-panel p-6 rounded-3xl bg-white border-gray-100 shadow-lg">
        <h3 className="font-bold text-lg mb-4 text-gray-800 flex items-center gap-2">
          <Icons.Navigation size={20} className="text-[#A9BFA8]" /> 周邊機能
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {NAV_BUTTONS.map((btn, i) => (
            <button
              key={i}
              onClick={() =>
                window.open(
                  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                    btn.query
                  )}`,
                  "_blank"
                )
              }
              className={`p-3 rounded-xl flex items-center gap-2 transition-all border text-sm font-bold hover:brightness-95 ${btn.color}`}
            >
              <btn.icon size={18} /> {btn.title}
            </button>
          ))}
        </div>
      </div>

      <div className="glass-panel p-6 rounded-3xl bg-white border-gray-100 shadow-lg">
        <h3 className="font-bold text-lg mb-4 text-gray-800 flex items-center gap-2">
          <Icons.Plane size={20} className="text-[#E4C2C1]" /> 航班資訊
        </h3>
        <div className="space-y-4">
          <div className="bg-gray-50 p-4 rounded-xl border border-gray-200">
            <div className="flex justify-between mb-2">
              <span
                className={`text-[10px] font-black px-2 py-0.5 rounded text-white bg-[#A9BFA8]`}
              >
                去程
              </span>
              <span className="text-[10px] font-bold text-gray-400">
                {flightInfo.outbound?.date}
              </span>
            </div>
            <div className="flex justify-between items-center text-gray-800">
              <div className="text-center">
                <div className="text-xl font-black">
                  {flightInfo.outbound?.dep}
                </div>
                <div className="text-[10px] text-gray-500">
                  {flightInfo.outbound?.from}
                </div>
              </div>
              <div className="flex flex-col items-center">
                <span className="text-[10px] text-gray-400">
                  {flightInfo.outbound?.flight}
                </span>
                <div className="w-10 h-px bg-gray-300 my-1"></div>
              </div>
              <div className="text-center">
                <div className="text-xl font-black">
                  {flightInfo.outbound?.arr}
                </div>
                <div className="text-[10px] text-gray-500">
                  {flightInfo.outbound?.to}
                </div>
              </div>
            </div>
          </div>
          <div className="bg-gray-50 p-4 rounded-xl border border-gray-200">
            <div className="flex justify-between mb-2">
              <span
                className={`text-[10px] font-black px-2 py-0.5 rounded text-white bg-[#E4C2C1]`}
              >
                回程
              </span>
              <span className="text-[10px] font-bold text-gray-400">
                {flightInfo.inbound?.date}
              </span>
            </div>
            <div className="flex justify-between items-center text-gray-800">
              <div className="text-center">
                <div className="text-xl font-black">
                  {flightInfo.inbound?.dep}
                </div>
                <div className="text-[10px] text-gray-500">
                  {flightInfo.inbound?.from}
                </div>
              </div>
              <div className="flex flex-col items-center">
                <span className="text-[10px] text-gray-400">
                  {flightInfo.inbound?.flight}
                </span>
                <div className="w-16 h-px bg-gray-300 relative">
                  <Icons.Plane
                    size={14}
                    className="absolute -top-1.5 left-1/2 -translate-x-1/2 text-slate-400 rotate-90"
                  />
                </div>
              </div>
              <div className="text-center">
                <div className="text-xl font-black">
                  {flightInfo.inbound?.arr}
                </div>
                <div className="text-[10px] text-gray-500">
                  {flightInfo.inbound?.to}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="glass-panel p-6 rounded-3xl bg-white border-gray-100 shadow-lg">
        <h3 className="font-bold text-lg mb-4 text-gray-800 flex items-center gap-2">
          <Icons.Hotel size={20} className="text-[#E8D595]" /> 住宿安排
        </h3>
        <div className="space-y-3">
          {hotelInfo.map((h, i) => (
            <div
              key={i}
              className="flex items-center gap-3 p-3 rounded-xl bg-gray-50 border border-gray-100 mb-2 last:mb-0"
            >
              <div className="bg-[#A9BFA8] text-white font-bold text-xs h-10 w-10 flex items-center justify-center rounded-lg">
                {h.day.split("/")[1]}日
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-gray-800 truncate">
                  {h.name}
                </div>
                <div className="text-[10px] text-gray-500 truncate">
                  {h.location}
                </div>
              </div>
              <a
                href={h.link}
                target="_blank"
                className="p-2 bg-white border border-gray-200 rounded-full text-gray-400 hover:text-[#E4C2C1]"
              >
                <Icons.Navigation size={14} />
              </a>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// --- StatsTab ---
const StatsTab = ({
  dailyStats,
  handleOpenDailyDetail,
  handleOpenEmailClick,
  stats,
  selectedCurrency,
  exchangeRate,
}) => {
  const Icons = window.Icons;
  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-6 duration-700 pb-20">
      <div className="glass-panel p-6 rounded-3xl bg-white border-gray-100 shadow-lg text-center relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-[#E4C2C1] to-[#E8D595]"></div>
        <div className="text-sm font-bold text-gray-400 mb-1">總花費估算</div>
        <div className="text-4xl font-black text-gray-800 mb-2 tracking-tight">
          {selectedCurrency.symbol}{" "}
          {(stats.totalJpy * exchangeRate).toLocaleString(undefined, {
            maximumFractionDigits: 0,
          })}
        </div>
        <div className="text-xs text-gray-400 font-mono mb-6">
          ( ¥{stats.totalJpy.toLocaleString()} )
        </div>
        <button
          onClick={handleOpenEmailClick}
          className="w-full py-3 bg-[#F9F7F5] border border-gray-200 text-[#A9BFA8] rounded-xl text-sm font-bold flex items-center justify-center gap-2 hover:bg-white hover:shadow-md transition-all"
        >
          <Icons.Mail size={16} /> 發送詳細報表
        </button>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-bold text-gray-400 uppercase ml-1">
          每日明細
        </h3>
        {dailyStats.map((day) => (
          <div
            key={day.dayId}
            onClick={() => handleOpenDailyDetail(day)}
            className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm flex justify-between items-center hover:translate-y-[-2px] transition-transform cursor-pointer"
          >
            <div className="flex items-center gap-3">
              <div className={`${day.themeColor} w-1.5 h-8 rounded-full`}></div>
              <div>
                <div className="text-sm font-bold text-gray-800">
                  {day.date}
                </div>
                <div className="text-xs text-gray-500">{day.title}</div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-lg font-mono font-bold text-[#E4C2C1]">
                {selectedCurrency.symbol}{" "}
                {(day.totalTwd * exchangeRate).toLocaleString(undefined, {
                  maximumFractionDigits: 0,
                })}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// --- GuardTab ---
const GuardTab = ({
  tripData,
  flightInfo,
  hotelInfo,
  openKeyModal,
  aiLoading,
  setAiLoading,
}) => {
  const Icons = window.Icons;
  const [flightAnalysis, setFlightAnalysis] = useState("");
  const [hotelAnalysis, setHotelAnalysis] = useState({});
  const [spotAnalysis, setSpotAnalysis] = useState({});
  const [aiInput, setAiInput] = useState("");
  const [aiGeneralResult, setAiGeneralResult] = useState("");

  const allSpots = useMemo(() => {
    return tripData.flatMap((day) =>
      day.spots.map((spot) => ({ ...spot, dayDate: day.date.split(" ")[0] }))
    );
  }, [tripData]);

  const checkFlight = async () => {
    setAiLoading(true);
    setFlightAnalysis("分析中...");
    try {
      const prompt = `分析交通風險：去程 ${flightInfo.outbound?.date} ${flightInfo.outbound?.flight}，回程 ${flightInfo.inbound?.date} ${flightInfo.inbound?.flight}。`;
      const res = await generateGeminiContent(prompt, null, true);
      setFlightAnalysis(res);
    } catch (e) {
      setFlightAnalysis("分析失敗");
      if (e.message.includes("NO_API_KEY")) openKeyModal(true);
    }
    setAiLoading(false);
  };

  const checkHotel = async (h) => {
    setAiLoading(true);
    setHotelAnalysis((p) => ({ ...p, [h.name]: "分析中..." }));
    try {
      const prompt = `評估飯店治安、機能：${h.name} (${h.location})`;
      const res = await generateGeminiContent(prompt, null, true);
      setHotelAnalysis((p) => ({ ...p, [h.name]: res }));
    } catch (e) {
      setHotelAnalysis((p) => ({ ...p, [h.name]: "分析失敗" }));
      if (e.message.includes("NO_API_KEY")) openKeyModal(true);
    }
    setAiLoading(false);
  };

  const checkSpot = async (s) => {
    setAiLoading(true);
    setSpotAnalysis((p) => ({ ...p, [s.id]: "分析中..." }));
    try {
      const prompt = `景點掃雷：${s.name}\n1.營業驗證 2.雨雪備案 3.周邊3個平價美食推薦。`;
      const res = await generateGeminiContent(prompt, null, true);
      setSpotAnalysis((p) => ({ ...p, [s.id]: res }));
    } catch (e) {
      setSpotAnalysis((p) => ({ ...p, [s.id]: "分析失敗" }));
      if (e.message.includes("NO_API_KEY")) openKeyModal(true);
    }
    setAiLoading(false);
  };

  const analyzeGeneral = async () => {
    if (!aiInput) return;
    setAiGeneralResult("分析中...");
    setAiLoading(true);
    try {
      const res = await generateGeminiContent(
        `分析旅遊情報：${aiInput}`,
        null,
        true
      );
      setAiGeneralResult(res);
    } catch (e) {
      setAiGeneralResult("分析失敗");
      if (e.message.includes("NO_API_KEY")) openKeyModal(true);
    }
    setAiLoading(false);
  };

  return (
    <div className="space-y-8 pb-20 animate-in fade-in duration-700">
      <h1 className="text-2xl font-black text-gray-800 flex items-center gap-2">
        <Icons.Shield className="text-[#A9BFA8]" /> AI 旅遊防雷
      </h1>
      <div className="glass-panel p-6 rounded-3xl bg-white border-gray-100 shadow-lg">
        <h3 className="font-bold text-[#A9BFA8] mb-4 flex items-center gap-2">
          <Icons.Plane size={20} /> 交通防雷
        </h3>
        <button
          onClick={checkFlight}
          disabled={aiLoading}
          className="w-full bg-[#A9BFA8] text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2 hover:brightness-105 shadow-md"
        >
          {aiLoading && flightAnalysis === "分析中..." ? (
            <Icons.Loader2 className="animate-spin" />
          ) : (
            <Icons.Search size={16} />
          )}{" "}
          開始分析
        </button>
        {flightAnalysis && flightAnalysis !== "分析中..." && (
          <div className="mt-4 p-4 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-600 leading-relaxed">
            <MarkdownRenderer content={flightAnalysis} />
          </div>
        )}
      </div>
      <div className="glass-panel p-6 rounded-3xl bg-white border-gray-100 shadow-lg">
        <h3 className="font-bold text-[#E4C2C1] mb-4 flex items-center gap-2">
          <Icons.Hotel size={20} /> 住宿防雷
        </h3>
        <div className="space-y-4">
          {hotelInfo.map((h, i) => (
            <div
              key={i}
              className="mb-4 last:mb-0 bg-gray-50 border border-gray-200 p-4 rounded-xl"
            >
              <div className="flex justify-between items-start mb-2">
                <h4 className="font-bold text-gray-800 text-sm">{h.name}</h4>
                <button
                  onClick={() => checkHotel(h)}
                  disabled={aiLoading}
                  className="bg-white border border-gray-200 p-2 rounded-full text-gray-400 hover:text-[#E4C2C1] shadow-sm"
                >
                  <Icons.Search size={14} />
                </button>
              </div>
              {hotelAnalysis[h.name] && (
                <div className="mt-2 p-3 bg-white border border-gray-200 rounded-lg text-xs text-gray-500 leading-relaxed">
                  {hotelAnalysis[h.name] === "分析中..." ? (
                    <Icons.Loader2 size={12} className="animate-spin" />
                  ) : (
                    <MarkdownRenderer content={hotelAnalysis[h.name]} />
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="space-y-4">
        <h3 className="font-bold text-gray-800 flex items-center gap-2 px-1">
          <Icons.MapPin size={20} className="text-[#E8D595]" /> 每日景點防雷
        </h3>
        {allSpots.map((spot) => (
          <div
            key={spot.id}
            className="glass-panel p-5 rounded-3xl bg-white border-gray-100 shadow-lg flex flex-col gap-3"
          >
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-[#E8D595] text-white flex flex-col items-center justify-center shadow-md">
                <span className="text-xs font-bold">
                  {spot.dayDate.split("/")[0]}
                </span>
                <span className="text-sm font-black">
                  {spot.dayDate.split("/")[1]}
                </span>
              </div>
              <div className="flex-1 font-bold text-gray-800">{spot.name}</div>
            </div>
            {spotAnalysis[spot.id] && (
              <div className="p-3 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-600">
                {spotAnalysis[spot.id] === "分析中..." ? (
                  <Icons.Loader2 className="animate-spin" size={14} />
                ) : (
                  <MarkdownRenderer content={spotAnalysis[spot.id]} />
                )}
              </div>
            )}
            <button
              onClick={() => checkSpot(spot)}
              disabled={aiLoading}
              className="w-full bg-white border border-gray-200 text-[#E8D595] hover:text-white hover:bg-[#E8D595] py-2 rounded-lg font-bold text-xs transition-all shadow-sm"
            >
              AI 掃雷 (Plan B)
            </button>
          </div>
        ))}
      </div>
      <div className="glass-panel p-6 rounded-3xl bg-white border-gray-100 shadow-lg">
        <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
          <Icons.Bot size={20} className="text-[#A2C4C9]" /> 通用情報分析
        </h3>
        <textarea
          value={aiInput}
          onChange={(e) => setAiInput(e.target.value)}
          placeholder="貼上攻略或注意事項..."
          className="w-full h-24 bg-gray-50 rounded-xl p-3 text-sm text-gray-800 outline-none border border-gray-200 focus:border-[#E4C2C1] resize-none mb-3"
        />
        <button
          onClick={analyzeGeneral}
          disabled={aiLoading || !aiInput}
          className="w-full bg-[#A2C4C9] text-white py-3 rounded-xl font-bold transition-all shadow-md"
        >
          開始分析
        </button>
        {aiGeneralResult && (
          <div className="mt-4 p-4 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-600">
            {aiGeneralResult === "分析中..." ? (
              <Icons.Loader2 className="animate-spin" />
            ) : (
              <MarkdownRenderer content={aiGeneralResult} />
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// ==========================================
// 4. 主應用程式 (App) - 整合所有邏輯
// ==========================================

function App() {
  const Icons = window.Icons;

  // --- States (UI Control) ---
  const [activeTab, setActiveTab] = useState("itinerary");
  const [selectedDay, setSelectedDay] = useState("all");
  const [currentThemeIndex, setCurrentThemeIndex] = useState(() =>
    parseInt(localStorage.getItem("themeIndex") || "0", 10)
  );

  // --- States (Data) ---
  const [dayStartTimes, setDayStartTimes] = useState(() =>
    JSON.parse(localStorage.getItem("start_times") || "{}")
  );
  const [actualDepartures, setActualDepartures] = useState(() =>
    JSON.parse(localStorage.getItem("departures") || "{}")
  );
  const [stays, setStays] = useState(() =>
    JSON.parse(localStorage.getItem("stays") || "{}")
  );
  const [transportModes, setTransportModes] = useState(() =>
    JSON.parse(localStorage.getItem("modes") || "{}")
  );
  const [expenses, setExpenses] = useState(() =>
    JSON.parse(localStorage.getItem("expenses") || "{}")
  );
  const [spotTicketCounts, setSpotTicketCounts] = useState(() =>
    JSON.parse(localStorage.getItem("spot_tickets") || "{}")
  );

  // --- States (AI & Feature) ---
  const [selectedCurrency, setSelectedCurrency] = useState(() => {
    const saved = localStorage.getItem("2026_currency") || "JPY";
    return (
      window.CURRENCY_OPTIONS.find((c) => c.code === saved) ||
      window.CURRENCY_OPTIONS[1]
    );
  });
  const [exchangeRate, setExchangeRate] = useState(1);
  const [isRateLoading, setIsRateLoading] = useState(false);

  const [aiLoading, setAiLoading] = useState(false);
  const [isAnalyzingReceipt, setIsAnalyzingReceipt] = useState(false);
  const [pendingReceipts, setPendingReceipts] = useState([]);
  const [quotaStatus, setQuotaStatus] = useState({
    type: "normal",
    text: "AI Ready",
  });
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [currentEditingSpot, setCurrentEditingSpot] = useState(null);
  const [isKeyModalOpen, setIsKeyModalOpen] = useState(false);
  const [isThemeModalOpen, setIsThemeModalOpen] = useState(false);
  const [isEmailModalOpen, setIsEmailModalOpen] = useState(false);
  const [emailInput, setEmailInput] = useState(
    localStorage.getItem("user_email") || "yofarn@gmail.com"
  );
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [isDailyDetailOpen, setIsDailyDetailOpen] = useState(false);
  const [selectedDailyStats, setSelectedDailyStats] = useState(null);
  const [expenseForm, setExpenseForm] = useState({
    category: "food",
    amount: "",
    note: "",
  });

  // --- Persistence Effects ---
  useEffect(() => {
    localStorage.setItem("start_times", JSON.stringify(dayStartTimes));
  }, [dayStartTimes]);
  useEffect(() => {
    localStorage.setItem("departures", JSON.stringify(actualDepartures));
  }, [actualDepartures]);
  useEffect(() => {
    localStorage.setItem("stays", JSON.stringify(stays));
  }, [stays]);
  useEffect(() => {
    localStorage.setItem("modes", JSON.stringify(transportModes));
  }, [transportModes]);
  useEffect(() => {
    localStorage.setItem("expenses", JSON.stringify(expenses));
  }, [expenses]);
  useEffect(() => {
    localStorage.setItem("spot_tickets", JSON.stringify(spotTicketCounts));
  }, [spotTicketCounts]);
  useEffect(() => {
    localStorage.setItem("themeIndex", currentThemeIndex);
    if (window.THEMES && window.THEMES[currentThemeIndex])
      document.body.className = `theme-${window.THEMES[currentThemeIndex].name}`;
  }, [currentThemeIndex]);
  useEffect(() => {
    if (window.emailjs) window.emailjs.init("mYOFMMnqLdDxR0wjj");
  }, []);

  // --- Currency Fetch ---
  useEffect(() => {
    const fetchRate = async () => {
      if (selectedCurrency.code === "TWD") {
        setExchangeRate(1);
        return;
      }
      setIsRateLoading(true);
      try {
        const res = await generateGeminiContent(
          `1 TWD to ${selectedCurrency.code} rate? number only`,
          null,
          true
        );
        const matches = res.match(/[\d.]+/g);
        const rate = matches ? parseFloat(matches[matches.length - 1]) : 1;
        setExchangeRate(rate);
      } catch (e) {
        setExchangeRate(1);
      }
      setIsRateLoading(false);
    };
    fetchRate();
  }, [selectedCurrency]);

  // --- 核心運算：行程瀑布流 ---
  const tripData = useMemo(() => {
    return window.RAW_KML_DATA.map((day) => {
      let currentMinutes = timeToMinutes(dayStartTimes[day.dayId] || "09:00");
      const newSpots = day.spots.map((spot, idx) => {
        const spotId = `${day.dayId}-s${idx}`;
        const stayStr = stays[spotId] || "1.5 hr";
        const stayMinutes = parseStayDuration(stayStr);
        const arrivalTimeStr = minutesToTimeStr(currentMinutes);
        let departureMinutes;
        let isDeparted = false;
        let actualDepTime = null;
        if (actualDepartures[spotId]) {
          actualDepTime = actualDepartures[spotId];
          departureMinutes = timeToMinutes(actualDepTime);
          isDeparted = true;
        } else {
          departureMinutes = currentMinutes + stayMinutes;
        }
        let nextStopInfo = null;
        let nextArrivalTimeStr = "";
        if (idx < day.spots.length - 1) {
          const nextSpot = day.spots[idx + 1];
          const dist = getDistanceFromLatLonInKm(
            spot.lat,
            spot.lon,
            nextSpot.lat,
            nextSpot.lon
          );
          const mode = transportModes[spotId] || "car";
          const speed = mode === "car" ? 40 : 4;
          let travelMinutes = Math.round((dist / speed) * 60);
          if (mode === "car") travelMinutes += 10;
          currentMinutes = departureMinutes + travelMinutes;
          nextArrivalTimeStr = minutesToTimeStr(currentMinutes);
          nextStopInfo = {
            name: nextSpot.name,
            distance: `${dist} km`,
            driveTime: Math.round((dist / 40) * 60 + 10) + "m",
            walkTime: Math.round((dist / 4) * 60) + "m",
            navLink: `https://www.google.com/maps/dir/?api=1&origin=${
              spot.lat
            },${spot.lon}&destination=${nextSpot.lat},${
              nextSpot.lon
            }&travelmode=${mode === "car" ? "driving" : "walking"}`,
          };
        }
        return {
          ...spot,
          id: spotId,
          time: arrivalTimeStr,
          stay: stayStr,
          isDeparted,
          actualDepTime,
          nextStop: nextStopInfo,
          nextArrivalTime: nextArrivalTimeStr,
          mapcodeDisplay: spot.mapCode || "GPS",
          gmapLink: `https://www.google.com/maps/search/?api=1&query=${spot.lat},${spot.lon}`,
          weather: "sunny",
          temp: "10°C",
          ticket: spot.ticket || null,
        };
      });
      return { ...day, spots: newSpots };
    });
  }, [dayStartTimes, actualDepartures, stays, transportModes]);

  // --- 統計數據計算 ---
  const dailyStats = useMemo(() => {
    return tripData.map((d) => {
      let dayTotal = 0;
      d.spots.forEach((spot) => {
        const spotExpenses = expenses[spot.id] || [];
        spotExpenses.forEach((e) => (dayTotal += e.amount || 0));
        if (spot.ticket) {
          const counts = spotTicketCounts[spot.id] || { adult: 2, child: 2 };
          dayTotal +=
            spot.ticket.adult * counts.adult + spot.ticket.child * counts.child;
        }
      });
      return { ...d, totalTwd: dayTotal };
    });
  }, [tripData, expenses, spotTicketCounts]);
  const stats = {
    totalJpy: dailyStats.reduce((sum, d) => sum + d.totalTwd, 0),
  };

  // --- Handlers ---
  const handleDayStartTimeChange = (id, val) =>
    setDayStartTimes((p) => ({ ...p, [id]: val }));
  const handleStayChangeNew = (id, val) =>
    setStays((p) => ({ ...p, [id]: val }));
  const handleTransportToggle = (id) =>
    setTransportModes((p) => ({
      ...p,
      [id]: p[id] === "walk" ? "car" : "walk",
    }));
  const handleDepartureToggle = (id) =>
    setActualDepartures((p) => {
      const newState = { ...p };
      if (newState[id]) delete newState[id];
      else {
        const now = new Date();
        newState[id] = `${now.getHours().toString().padStart(2, "0")}:${now
          .getMinutes()
          .toString()
          .padStart(2, "0")}`;
      }
      return newState;
    });
  const getTicketCounts = (id) =>
    spotTicketCounts[id] || { adult: 2, child: 2 };
  const updateSpotTicketCount = (id, type, delta) =>
    setSpotTicketCounts((p) => ({
      ...p,
      [id]: {
        ...(p[id] || { adult: 2, child: 2 }),
        [type]: Math.max(0, (p[id]?.[type] || 2) + delta),
      },
    }));

  const openExpenseModal = (spot) => {
    setCurrentEditingSpot(spot);
    setExpenseForm({ category: "food", amount: "", note: "" });
    setPendingReceipts([]);
    setIsModalOpen(true);
  };
  const saveExpense = () => {
    const newRecs = [];
    const timestamp = Date.now();
    if (expenseForm.amount) {
      newRecs.push({
        id: timestamp,
        timestamp: timestamp,
        amount: parseInt(expenseForm.amount),
        note: expenseForm.note || "手動記帳",
        category: "food",
      });
    }
    pendingReceipts.forEach((p, idx) => {
      if (p.isChecked && !p.isAnalyzing) {
        let recordTime = timestamp + idx + 1;
        if (p.note && p.note.match(/^\d{4}\/\d{2}\/\d{2}/)) {
          const aiDate = new Date(
            p.note.split(" ")[0] + " " + (p.note.split(" ")[1] || "12:00")
          );
          if (!isNaN(aiDate.getTime())) recordTime = aiDate.getTime();
        }
        newRecs.push({
          id: timestamp + idx + 100,
          timestamp: recordTime,
          amount: parseInt(p.amount),
          note: p.note,
          category: "food",
        });
      }
    });
    if (newRecs.length > 0) {
      setExpenses((p) => ({
        ...p,
        [currentEditingSpot.id]: [
          ...(p[currentEditingSpot.id] || []),
          ...newRecs,
        ],
      }));
      setIsModalOpen(false);
    }
  };
  const deleteExpense = (sid, rid) =>
    setExpenses((p) => ({ ...p, [sid]: p[sid].filter((r) => r.id !== rid) }));

  const handleOpenEmailClick = () => {
    setEmailInput(localStorage.getItem("user_email") || "");
    setIsEmailModalOpen(true);
  };
  const handleOpenDailyDetail = (dayData) => {
    setSelectedDailyStats(dayData);
    setIsDailyDetailOpen(true);
  };
  const handleSendEmail = async () => {
    if (!emailInput) {
      alert("請輸入信箱");
      return;
    }
    setIsSendingEmail(true);
    localStorage.setItem("user_email", emailInput);
    try {
      const htmlMessage = `<html><body><h2>旅遊報表</h2><p>總花費: ¥${stats.totalJpy}</p></body></html>`;
      await window.emailjs.send("service_5yh7x6g", "template_dlbyml8", {
        email: emailInput,
        to_email: emailInput,
        subject: "旅遊花費報表",
        message: htmlMessage,
      });
      alert("發送成功！");
      setIsEmailModalOpen(false);
    } catch (e) {
      alert("發送失敗: " + e.message);
    } finally {
      setIsSendingEmail(false);
    }
  };

  const handleImageUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;
    setIsAnalyzingReceipt(true);
    setQuotaStatus({ type: "normal", text: "分析中..." });
    const newItems = files.map((f) => ({
      id: Math.random().toString(36),
      file: f,
      isAnalyzing: true,
      isChecked: true,
      amount: 0,
      note: "辨識中...",
    }));
    setPendingReceipts((p) => [...p, ...newItems]);

    const processFile = (item) => {
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = async () => {
          try {
            const res = await generateGeminiContent(
              `分析這張收據的金額、店家名稱與時間。回傳 JSON: {amount: number, store: string, date: "YYYY/MM/DD HH:mm"}。如果找不到時間，date 回傳 null。`,
              reader.result
            );
            const jsonMatch = res.match(/\{[\s\S]*\}/);
            const json = JSON.parse(jsonMatch ? jsonMatch[0] : res);
            setPendingReceipts((prev) =>
              prev.map((p) => {
                if (p.id !== item.id) return p;
                const displayNote =
                  (json.date ? json.date + " " : "") +
                  (json.store || "未命名收據");
                return {
                  ...p,
                  isAnalyzing: false,
                  amount: json.amount,
                  note: displayNote,
                  timestamp: json.date
                    ? new Date(json.date).getTime()
                    : Date.now(),
                };
              })
            );
          } catch (e) {
            setPendingReceipts((prev) =>
              prev.map((p) =>
                p.id === item.id
                  ? { ...p, isAnalyzing: false, note: "辨識失敗" }
                  : p
              )
            );
          } finally {
            resolve();
          }
        };
        reader.readAsDataURL(item.file);
      });
    };
    await Promise.all(newItems.map(processFile));
    setIsAnalyzingReceipt(false);
    setQuotaStatus({ type: "normal", text: "完成" });
  };

  // --- NEW: 地圖開啟邏輯 ---
  const handleOpenMap = () => {
    let points = [];
    if (selectedDay === "all") {
      // 邏輯 1：全部天數 -> 顯示所有景點
      tripData.forEach((day) => {
        day.spots.forEach((spot) => {
          if (spot.lat && spot.lon) {
            points.push(`${spot.lat},${spot.lon}`);
          }
        });
      });
    } else {
      // 邏輯 2：特定日期 -> 顯示當日所有景點
      const currentDay = tripData.find((d) => d.dayId === selectedDay);
      if (currentDay) {
        points = currentDay.spots.map((s) => `${s.lat},${s.lon}`);
      }
    }

    // 執行動作：開啟地圖 (Google Map 多點路徑)
    if (points.length > 0) {
      // 標準 Google Maps 多點路徑連結
      // https://www.google.com/maps/dir/座標1/座標2/...
      const url = `https://www.google.com/maps/dir/${points.join("/")}`;
      window.open(url, "_blank");
    } else {
      alert("目前行程無有效的座標點");
    }
  };

  return (
    <div className="min-h-screen pb-24 bg-[#F9F7F5]">
      <nav className="sticky top-0 z-50 bg-[#F9F7F5]/90 backdrop-blur-md p-4 border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white rounded-full border-2 border-[#E4C2C1] overflow-hidden">
              <img
                src={window.APP_LOGO || "logo.jpg"}
                className="w-full h-full object-cover"
                onError={(e) => {
                  e.target.src = "https://placehold.co/100";
                }}
              />
            </div>
            <h1 className="font-black text-lg text-gray-800">
              {window.RAW_KML_DATA[0].title}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <CurrencySwitcher
              selectedCurrency={selectedCurrency}
              exchangeRate={exchangeRate}
              isRateLoading={isRateLoading}
              setSelectedCurrency={setSelectedCurrency}
            />

            {/* NEW: 莫蘭迪粉綠圓形地圖 FAB (In Navbar) */}
            <button
              onClick={handleOpenMap}
              className="bg-[#A9BFA8] p-2 rounded-full text-white shadow-md hover:brightness-110 transition-all flex items-center justify-center w-9 h-9"
              title="預覽地圖"
            >
              <Icons.Map size={18} />
            </button>

            <button
              onClick={() => setIsKeyModalOpen(true)}
              className="p-2 bg-white rounded-full text-gray-400 border border-gray-200 hover:text-[#E4C2C1] hover:border-[#E4C2C1] transition-all shadow-sm"
            >
              <Icons.Settings size={20} />
            </button>
          </div>
        </div>
      </nav>
      <main className="max-w-5xl mx-auto p-4 md:p-8">
        {activeTab === "itinerary" && (
          <ItineraryTab
            tripData={tripData}
            selectedDay={selectedDay}
            setSelectedDay={setSelectedDay}
            dayStartTimes={dayStartTimes}
            handleDayStartTimeChange={handleDayStartTimeChange}
            handleDepartureToggle={handleDepartureToggle}
            handleTransportToggle={handleTransportToggle}
            handleStayChangeNew={handleStayChangeNew}
            openExpenseModal={openExpenseModal}
            transportModes={transportModes}
            expenses={expenses}
            getTicketCounts={getTicketCounts}
            updateSpotTicketCount={updateSpotTicketCount}
            STAY_OPTIONS={window.STAY_OPTIONS}
          />
        )}
        {activeTab === "info" && <InfoTab />}
        {activeTab === "stats" && (
          <StatsTab
            dailyStats={dailyStats}
            stats={stats}
            selectedCurrency={selectedCurrency}
            exchangeRate={exchangeRate}
            handleOpenDailyDetail={(d) => {
              setSelectedDailyStats(d);
              setIsDailyDetailOpen(true);
            }}
            handleOpenEmailClick={() => setIsEmailModalOpen(true)}
          />
        )}
        {activeTab === "guard" && (
          <GuardTab
            tripData={tripData}
            flightInfo={window.FLIGHT_INFO}
            hotelInfo={window.HOTEL_INFO}
            openKeyModal={setIsKeyModalOpen}
            aiLoading={aiLoading}
            setAiLoading={setAiLoading}
          />
        )}
      </main>
      <div className="fixed bottom-0 w-full bg-[#F9F7F5]/95 backdrop-blur-md border-t border-gray-200 pb-safe z-40 flex justify-around py-3 text-xs font-bold text-gray-400">
        <button
          onClick={() => setActiveTab("itinerary")}
          className={`flex flex-col items-center gap-1 ${
            activeTab === "itinerary" ? "text-[#E4C2C1]" : "hover:text-gray-600"
          }`}
        >
          <Icons.List size={22} /> 行程
        </button>
        <button
          onClick={() => setActiveTab("info")}
          className={`flex flex-col items-center gap-1 ${
            activeTab === "info" ? "text-[#A9BFA8]" : "hover:text-gray-600"
          }`}
        >
          <Icons.LayoutGrid size={22} /> 資訊
        </button>
        <button
          onClick={() => setActiveTab("stats")}
          className={`flex flex-col items-center gap-1 ${
            activeTab === "stats" ? "text-[#E8D595]" : "hover:text-gray-600"
          }`}
        >
          <Icons.Calculator size={22} /> 統計
        </button>
        <button
          onClick={() => setActiveTab("guard")}
          className={`flex flex-col items-center gap-1 ${
            activeTab === "guard" ? "text-[#A2C4C9]" : "hover:text-gray-600"
          }`}
        >
          <Icons.Shield size={22} /> 防雷
        </button>
      </div>
      <ApiKeyModal
        isOpen={isKeyModalOpen}
        onClose={() => setIsKeyModalOpen(false)}
      />
      <ExpenseModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        currentEditingSpot={currentEditingSpot}
        expenseForm={expenseForm}
        setExpenseForm={setExpenseForm}
        handleImageUpload={handleImageUpload}
        pendingReceipts={pendingReceipts}
        saveExpense={saveExpense}
        expenses={expenses}
        deleteExpense={deleteExpense}
        quotaStatus={quotaStatus}
        togglePendingReceipt={(id) =>
          setPendingReceipts((p) =>
            p.map((x) => (x.id === id ? { ...x, isChecked: !x.isChecked } : x))
          )
        }
        removePendingReceipt={(id) =>
          setPendingReceipts((p) => p.filter((x) => x.id !== id))
        }
        isAnalyzingReceipt={isAnalyzingReceipt}
      />
      <EmailModal
        isOpen={isEmailModalOpen}
        onClose={() => setIsEmailModalOpen(false)}
        emailInput={emailInput}
        setEmailInput={setEmailInput}
        handleSendEmail={handleSendEmail}
        isSendingEmail={isSendingEmail}
      />
      <DailyDetailModal
        isOpen={isDailyDetailOpen}
        onClose={() => setIsDailyDetailOpen(false)}
        dayData={selectedDailyStats}
        allExpenses={expenses}
        spotTicketCounts={spotTicketCounts}
        selectedCurrency={selectedCurrency}
        exchangeRate={exchangeRate}
        tripData={tripData}
      />
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);
