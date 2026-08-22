import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import { format } from "date-fns";
import {
  archiveMonthlyPdf,
  computeEffectiveHourlyRateForMonth,
  computeMonthlyPayroll,
  formatHM,
  getCountedHours,
  getPdfArchive,
  getWorkHoursForMonth,
  UserSettings,
} from "@/lib/localData";
import { STATUS_META } from "@/pages/design-preview/tokens";

const money = (n: number) => `₪${Math.round(n).toLocaleString("he-IL")}`;
const WEEKDAY_HE = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
const MONTH_HE = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];

// Payslip document palette — deliberately restrained: near-black ink on white paper, one muted
// slate accent for structure, and desaturated (not saturated-red/green) tones for +/- amounts.
const INK = "#20232E";
const PAPER = "#FFFFFF";
const HAIRLINE = "#DEDFE5";
const HAIRLINE_STRONG = "#C7C9D1";
const MUTED = "#8A8D99";
const ACCENT = "#3E5C76";
const ADD_INK = "#3C6B58";
const DED_INK = "#8B4444";
const SERIF = "'Frank Ruhl Libre', 'Heebo', serif";
const SANS = "'Heebo', system-ui, sans-serif";
const NUM = "'Space Grotesk', 'Heebo', sans-serif";

/**
 * Builds one month's payslip as real styled HTML (Hebrew RTL, a restrained document look) —
 * this is rasterized via html2canvas rather than drawn with jsPDF's text APIs, because jsPDF's
 * built-in fonts have no Hebrew glyphs at all (that's what produced the mojibake garbage before).
 */
const buildPayslipHtml = (year: number, month: number, settings: UserSettings, firstName: string): string => {
  const payroll = computeMonthlyPayroll(year, month, settings);
  const workHoursData = getWorkHoursForMonth(year, month) || [];
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthName = `${MONTH_HE[month]} ${year}`;
  const effectiveHourlyRate = computeEffectiveHourlyRateForMonth(year, month, settings);

  const dayRows = Array.from({ length: daysInMonth }, (_, i) => i + 1)
    .map((day) => {
      const date = new Date(year, month, day);
      const dateStr = format(date, "yyyy-MM-dd");
      const entry = workHoursData.find((wh) => wh.date === dateStr);
      if (!entry) return "";
      const status = (entry.status || "worked") as keyof typeof STATUS_META;
      const meta = STATUS_META[status] || STATUS_META.worked;
      const perDay = payroll.perDay.find((p) => p.date === dateStr);
      const hours = getCountedHours(entry);
      const timesLabel =
        status === "worked" && entry.segments && entry.segments.length > 1
          ? entry.segments.map((seg) => `${seg.start}–${seg.end ?? "?"}`).join(", ")
          : status === "worked" && entry.start_time && entry.end_time
            ? `${entry.start_time}–${entry.end_time}`
            : "—";
      const payLabel = perDay ? money(perDay.regularPay + perDay.overtimePay) : status !== "off" && entry.paid !== false ? money(hours * effectiveHourlyRate) : "—";
      return `
        <tr>
          <td style="padding:7px 8px; border:1px solid ${HAIRLINE}; font-weight:600; color:${INK}; white-space:nowrap; font-size:12px;">${day} ${MONTH_HE[month].slice(0, 3)}</td>
          <td style="padding:7px 8px; border:1px solid ${HAIRLINE}; color:${MUTED}; white-space:nowrap; font-size:12px;">${WEEKDAY_HE[date.getDay()]}</td>
          <td style="padding:7px 8px; border:1px solid ${HAIRLINE}; white-space:nowrap;">
            <span style="display:inline-block; width:6px; height:6px; border-radius:50%; background:${meta.grad[0]}; margin-left:6px; vertical-align:middle;"></span>
            <span style="font-size:12px; color:${INK}; vertical-align:middle;">${meta.label}</span>
          </td>
          <td style="padding:7px 8px; border:1px solid ${HAIRLINE}; color:${MUTED}; font-size:11.5px; white-space:nowrap;" dir="ltr">${timesLabel}</td>
          <td style="padding:7px 8px; border:1px solid ${HAIRLINE}; font-weight:600; color:${INK}; text-align:left; white-space:nowrap; font-family:${NUM}; font-size:12px;" dir="ltr">${formatHM(hours)}</td>
          <td style="padding:7px 8px; border:1px solid ${HAIRLINE}; font-weight:700; color:${INK}; text-align:left; white-space:nowrap; font-family:${NUM}; font-size:12px;" dir="ltr">${payLabel}</td>
        </tr>`;
    })
    .join("");

  const statutory = payroll.statutory;
  const deductionRows: { label: string; amount: number }[] = [
    statutory.incomeTax > 0 && { label: "מס הכנסה", amount: statutory.incomeTax },
    statutory.nationalInsurance > 0 && { label: "ביטוח לאומי", amount: statutory.nationalInsurance },
    statutory.healthInsurance > 0 && { label: "ביטוח בריאות", amount: statutory.healthInsurance },
    statutory.pensionEmployee > 0 && { label: "פנסיה", amount: statutory.pensionEmployee },
    statutory.trainingFundEmployee > 0 && { label: "קרן השתלמות", amount: statutory.trainingFundEmployee },
    ...(settings.deductions || []).map((d) => ({ label: d.label, amount: d.amount })),
    payroll.foodExpenseDeduction > 0 && { label: "הוצאות אוכל שדווחו", amount: payroll.foodExpenseDeduction },
  ].filter(Boolean) as { label: string; amount: number }[];

  const additionRows: { label: string; amount: number }[] = [
    { label: `שעות רגילות (${formatHM(payroll.regularHours)})`, amount: payroll.regularPay },
    ...(payroll.overtimeHours > 0 ? [{ label: `שעות נוספות (${formatHM(payroll.overtimeHours)})`, amount: payroll.overtimePay }] : []),
    ...(settings.fixed_components || []).map((c) => ({ label: c.label, amount: c.amount })),
    ...(payroll.foodAllowanceAddition > 0 ? [{ label: "תקציב אוכל", amount: payroll.foodAllowanceAddition }] : []),
  ];

  const grossTotal = additionRows.reduce((s, a) => s + a.amount, 0);
  const deductionsTotalAll = deductionRows.reduce((s, d) => s + d.amount, 0);

  const lineRow = (label: string, value: string, valueColor: string, bold = false) => `
    <div style="display:flex; justify-content:space-between; align-items:baseline; padding:7px 0; border-bottom:1px solid ${HAIRLINE};">
      <span style="font-size:12.5px; color:${bold ? INK : "#454852"}; font-weight:${bold ? 700 : 500}; font-family:${SANS};">${label}</span>
      <span style="font-size:${bold ? "13.5px" : "12.5px"}; font-weight:${bold ? 800 : 600}; color:${valueColor}; font-family:${NUM};" dir="ltr">${value}</span>
    </div>`;

  const notesRows = [
    payroll.holidayDays > 0 && { label: "ימי חג משולמים במלואם", value: payroll.holidayDays.toFixed(1) },
    payroll.unpaidLeaveDays > 0 && { label: "ימי חופש/מחלה לא משולמים", value: payroll.unpaidLeaveDays.toFixed(1) },
    payroll.unpaidOffDays > 0 && { label: 'ימי "לא עובד" לא משולמים', value: payroll.unpaidOffDays.toFixed(1) },
  ].filter(Boolean) as { label: string; value: string }[];

  const summaryCell = (label: string, value: string, opts: { fill?: boolean } = {}) => `
    <div style="flex:1; border:1px solid ${opts.fill ? INK : HAIRLINE_STRONG}; border-radius:6px; padding:14px 16px; ${opts.fill ? `background:${INK};` : ""}">
      <div style="font-size:10px; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:${opts.fill ? "rgba(255,255,255,0.7)" : MUTED}; font-family:${SANS};">${label}</div>
      <div style="font-size:${opts.fill ? "26px" : "19px"}; font-weight:800; margin-top:4px; color:${opts.fill ? PAPER : INK}; font-family:${NUM};" dir="ltr">${value}</div>
    </div>`;

  return `
    <div style="width:800px; font-family:${SANS}; direction:rtl; background:${PAPER}; color:${INK}; padding:44px 48px;">
      <!-- Header -->
      <div style="display:flex; justify-content:space-between; align-items:flex-end; padding-bottom:18px; border-bottom:1px solid ${ACCENT}; margin-bottom:20px;">
        <div>
          <div style="font-family:${SERIF}; font-size:26px; font-weight:700; color:${INK};">תלוש שכר משוער</div>
          <div style="font-size:12.5px; color:${MUTED}; margin-top:4px; font-family:${SANS};">${monthName}</div>
        </div>
        <div style="text-align:left; font-size:10.5px; color:${MUTED}; font-family:${SANS};" dir="ltr">
          WorkTrack · ${new Date().toLocaleDateString("he-IL")}
        </div>
      </div>

      <!-- Identification strip -->
      <div style="display:flex; gap:1px; background:${HAIRLINE}; border:1px solid ${HAIRLINE}; border-radius:6px; overflow:hidden; margin-bottom:24px;">
        <div style="flex:1; background:${PAPER}; padding:10px 16px;">
          <div style="font-size:9.5px; font-weight:700; letter-spacing:0.06em; text-transform:uppercase; color:${MUTED};">עובד/ת</div>
          <div style="font-size:13.5px; font-weight:700; margin-top:2px;">${firstName || "עובד"}</div>
        </div>
        <div style="flex:1; background:${PAPER}; padding:10px 16px;">
          <div style="font-size:9.5px; font-weight:700; letter-spacing:0.06em; text-transform:uppercase; color:${MUTED};">תקופת שכר</div>
          <div style="font-size:13.5px; font-weight:700; margin-top:2px;">${monthName}</div>
        </div>
        <div style="flex:1; background:${PAPER}; padding:10px 16px;">
          <div style="font-size:9.5px; font-weight:700; letter-spacing:0.06em; text-transform:uppercase; color:${MUTED};">${settings.salary_mode === "cap" ? "שכר שעתי מחושב (תקרה)" : "שכר שעתי בסיס"}</div>
          <div style="font-size:13.5px; font-weight:700; margin-top:2px; font-family:${NUM};" dir="ltr">${money(effectiveHourlyRate)}</div>
        </div>
      </div>

      <!-- Attendance ledger -->
      <div style="font-family:${SERIF}; font-size:13.5px; font-weight:700; color:${INK}; margin-bottom:8px;">פירוט נוכחות</div>
      <table style="width:100%; border-collapse:collapse; margin-bottom:26px;">
        <thead>
          <tr style="background:rgba(62,92,118,0.06);">
            <th style="padding:7px 8px; border:1px solid ${HAIRLINE}; text-align:right; font-size:10px; color:${MUTED}; font-weight:700; text-transform:uppercase; letter-spacing:0.04em;">תאריך</th>
            <th style="padding:7px 8px; border:1px solid ${HAIRLINE}; text-align:right; font-size:10px; color:${MUTED}; font-weight:700; text-transform:uppercase; letter-spacing:0.04em;">יום</th>
            <th style="padding:7px 8px; border:1px solid ${HAIRLINE}; text-align:right; font-size:10px; color:${MUTED}; font-weight:700; text-transform:uppercase; letter-spacing:0.04em;">סטטוס</th>
            <th style="padding:7px 8px; border:1px solid ${HAIRLINE}; text-align:right; font-size:10px; color:${MUTED}; font-weight:700; text-transform:uppercase; letter-spacing:0.04em;">שעות עבודה</th>
            <th style="padding:7px 8px; border:1px solid ${HAIRLINE}; text-align:left; font-size:10px; color:${MUTED}; font-weight:700; text-transform:uppercase; letter-spacing:0.04em;">סה״כ שעות</th>
            <th style="padding:7px 8px; border:1px solid ${HAIRLINE}; text-align:left; font-size:10px; color:${MUTED}; font-weight:700; text-transform:uppercase; letter-spacing:0.04em;">תשלום</th>
          </tr>
        </thead>
        <tbody>${dayRows || `<tr><td colspan="6" style="padding:16px; border:1px solid ${HAIRLINE}; text-align:center; color:${MUTED}; font-size:12.5px;">אין רישומים בחודש זה</td></tr>`}</tbody>
      </table>

      <!-- Earnings / Deductions, side by side -->
      <div style="display:flex; gap:16px; margin-bottom:20px;">
        <div style="flex:1; border:1px solid ${HAIRLINE_STRONG}; border-radius:8px; overflow:hidden;">
          <div style="padding:10px 16px; background:rgba(60,107,88,0.07); border-bottom:1px solid ${HAIRLINE_STRONG};">
            <span style="font-family:${SERIF}; font-size:13px; font-weight:700; color:${ADD_INK};">תשלומים</span>
          </div>
          <div style="padding:12px 16px 4px;">
            ${additionRows.map((a) => lineRow(a.label, money(a.amount), INK)).join("")}
            ${lineRow("סה״כ ברוטו", money(grossTotal), ADD_INK, true)}
          </div>
        </div>
        <div style="flex:1; border:1px solid ${HAIRLINE_STRONG}; border-radius:8px; overflow:hidden;">
          <div style="padding:10px 16px; background:rgba(139,68,68,0.06); border-bottom:1px solid ${HAIRLINE_STRONG};">
            <span style="font-family:${SERIF}; font-size:13px; font-weight:700; color:${DED_INK};">ניכויים</span>
          </div>
          <div style="padding:12px 16px 4px;">
            ${deductionRows.length ? deductionRows.map((d) => lineRow(d.label, money(d.amount), INK)).join("") : `<div style="padding:8px 0; font-size:12px; color:${MUTED};">אין ניכויים החודש</div>`}
            ${deductionRows.length ? lineRow("סה״כ ניכויים", money(deductionsTotalAll), DED_INK, true) : ""}
          </div>
        </div>
      </div>

      ${
        notesRows.length
          ? `<div style="display:flex; flex-wrap:wrap; gap:14px; margin-bottom:20px;">${notesRows
              .map(
                (n) => `
        <div style="font-size:11.5px; color:${MUTED};">
          <span style="display:inline-block; width:6px; height:6px; border-radius:50%; background:${ACCENT}; margin-left:5px; vertical-align:middle;"></span>
          ${n.label}: <span style="font-weight:700; color:${INK}; font-family:${NUM};" dir="ltr">${n.value}</span>
        </div>`,
              )
              .join("")}</div>`
          : ""
      }

      <!-- Summary strip -->
      <div style="display:flex; gap:14px;">
        ${summaryCell("ברוטו", money(grossTotal))}
        ${summaryCell("ניכויים", `−${money(deductionsTotalAll)}`)}
        ${summaryCell("נטו לתשלום", money(payroll.netPay), { fill: true })}
      </div>

      <div style="margin-top:22px; font-size:10px; color:${MUTED}; text-align:center;">
        זהו אומדן שהופק על ידי WorkTrack ואינו תלוש שכר רשמי.
      </div>
    </div>
  `;
};

/** Mounts HTML off-screen, rasterizes it with html2canvas, then removes it. */
const renderHtmlToCanvas = async (html: string): Promise<HTMLCanvasElement> => {
  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.top = "0";
  container.style.left = "-99999px";
  container.style.zIndex = "-1";
  container.innerHTML = html;
  document.body.appendChild(container);
  try {
    const canvas = await html2canvas(container, { scale: 2, backgroundColor: "#FFFFFF", useCORS: true });
    return canvas;
  } finally {
    document.body.removeChild(container);
  }
};

/** Adds a canvas to a jsPDF document, slicing it across as many A4 pages as needed. */
const addCanvasAsPages = (pdf: jsPDF, canvas: HTMLCanvasElement, startNewPageIfNotFirst: boolean) => {
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const imgWidthMm = pageWidth;
  const pxPerMm = canvas.width / imgWidthMm;
  const pageHeightPx = Math.floor(pageHeight * pxPerMm);

  let renderedPx = 0;
  let firstSlice = true;
  while (renderedPx < canvas.height) {
    const sliceHeightPx = Math.min(pageHeightPx, canvas.height - renderedPx);
    const sliceCanvas = document.createElement("canvas");
    sliceCanvas.width = canvas.width;
    sliceCanvas.height = sliceHeightPx;
    const ctx = sliceCanvas.getContext("2d")!;
    ctx.drawImage(canvas, 0, renderedPx, canvas.width, sliceHeightPx, 0, 0, canvas.width, sliceHeightPx);
    const imgData = sliceCanvas.toDataURL("image/jpeg", 0.95);

    if (!firstSlice || startNewPageIfNotFirst) pdf.addPage();
    pdf.addImage(imgData, "JPEG", 0, 0, imgWidthMm, sliceHeightPx / pxPerMm);

    renderedPx += sliceHeightPx;
    firstSlice = false;
  }
};

export const exportMonthlyPayslipPdf = async (year: number, month: number, settings: UserSettings, firstName = "") => {
  const html = buildPayslipHtml(year, month, settings, firstName);
  const canvas = await renderHtmlToCanvas(html);
  const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape" });
  addCanvasAsPages(pdf, canvas, false);
  pdf.save(`payslip-${year}-${String(month + 1).padStart(2, "0")}.pdf`);
};

/** Same payslip, returned as a data URI instead of triggering a download — used to silently
 * archive a completed month's PDF (the gross salary belongs on that permanent record, even
 * though the live in-app forecast deliberately doesn't lead with it). */
export const generateMonthlyPayslipDataUrl = async (year: number, month: number, settings: UserSettings, firstName = ""): Promise<string> => {
  const html = buildPayslipHtml(year, month, settings, firstName);
  const canvas = await renderHtmlToCanvas(html);
  const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape" });
  addCanvasAsPages(pdf, canvas, false);
  return pdf.output("datauristring");
};

/** Returns false (and saves nothing) when the year has no recorded data at all. */
export const exportAnnualPayslipPdf = async (year: number, settings: UserSettings, firstName = ""): Promise<boolean> => {
  const monthsWithData: number[] = [];
  for (let m = 0; m < 12; m++) {
    const entries = getWorkHoursForMonth(year, m);
    if (entries && entries.length > 0) monthsWithData.push(m);
  }
  if (monthsWithData.length === 0) return false;

  const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape" });
  for (let i = 0; i < monthsWithData.length; i++) {
    const html = buildPayslipHtml(year, monthsWithData[i], settings, firstName);
    const canvas = await renderHtmlToCanvas(html);
    addCanvasAsPages(pdf, canvas, i > 0);
  }
  pdf.save(`payslip-annual-${year}.pdf`);
  return true;
};

/**
 * Silently archives the payslip PDF for any of the last 3 calendar months (not the current,
 * still-in-progress one) that has real work-hour data but isn't archived yet. Safe to call on
 * every app load — it's a no-op once everything is already archived. This is where the gross
 * salary actually gets written down permanently, since the live "מסע התשלום" forecast never
 * leads with it.
 */
export const autoArchiveCompletedMonths = async (settings: UserSettings, firstName = ""): Promise<void> => {
  const now = new Date();
  const alreadyArchived = new Set(getPdfArchive().map((e) => `${e.year}-${e.month}`));
  for (let back = 1; back <= 3; back++) {
    const d = new Date(now.getFullYear(), now.getMonth() - back, 1);
    const year = d.getFullYear();
    const month = d.getMonth();
    if (alreadyArchived.has(`${year}-${month}`)) continue;
    const entries = getWorkHoursForMonth(year, month);
    if (!entries || entries.length === 0) continue;
    const dataUrl = await generateMonthlyPayslipDataUrl(year, month, settings, firstName);
    archiveMonthlyPdf(year, month, dataUrl);
  }
};
