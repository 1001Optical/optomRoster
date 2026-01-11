#!/usr/bin/env node
/**
 * HO Low Stock Alert (Optomate OtherItems)
 * - Filters: BARCODE in list, BRANCH_IDENTIFIER='HO', INVENTORY=true
 * - Low stock rule: QOH < REORDER_LEVEL
 * - Sends email via SMTP
 * - Cooldown per barcode (default 24h) using a local JSON state file
 *
 * Node: 18+
 */
import fs from "fs";
import { google } from "googleapis";
import "dotenv/config";

const toBase64 = (str) => Buffer.from(str, "utf8").toString('base64');
const createSecret = (username, password) => {
    return `Basic ${toBase64(`${username}:${password ?? ""}`)}`;
};

const tokens = JSON.parse(fs.readFileSync("gmail_token.json", "utf8"));

const auth = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET
);
auth.setCredentials(tokens);

const gmail = google.gmail({ version: "v1", auth });

function toBase64Url(str) {
    return Buffer.from(str)
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
}

// =====================
// CONFIG (env)
// =====================
const BASE_URL = "https://1001optdb.habitat3.net:12443/OptomateTouch/OData4/";
const TOKEN = createSecret("1001_HO_JH", "10011001")
const TO_EMAILS = "shannon@1001optical.com.au"

const ITEMS = [
    {barcode: "20015195", alertPoint: 60},
    {barcode: "20015206", alertPoint: 20},
    {barcode: "20023351", alertPoint: 20},
    {barcode: "20021629", alertPoint: 60},
    {barcode: "20021691", alertPoint: 130},
    {barcode: "20021692", alertPoint: 130},
    {barcode: "20088059", alertPoint: 70},
    {barcode: "20021695", alertPoint: 140},
    {barcode: "20021701", alertPoint: 5},
    {barcode: "20021702", alertPoint: 20},
]

// =====================
// VALIDATION
// =====================
function nowIso() {
    return new Date().toISOString();
}

function odataEscape(str) {
    // OData string literal escaping: single quote doubled.
    return String(str).replace(/'/g, "''");
}

// =====================
// OPTOMATE API CALL
// =====================
async function fetchOtherItemsForBarcodes() {
    // Build $filter: BARCODE eq '...' or ...
    const filter = ITEMS.map(({barcode}) => `BARCODE eq '${odataEscape(barcode)}'`).join(" or ");

    // Expand HO branch infos
    // Try to filter inside expand (may or may not be supported). If it fails, fallback without an inner filter.
    const select = ["ID", "BARCODE", "DESCRIPTION"].join(",");

    const expandUnfiltered =
        "BRANCH_INFOS(" +
        "$select=BRANCH_IDENTIFIER,QOH,REORDER_LEVEL,REORDER_QUANTITY,INVENTORY" +
        ")";

    const urlUnfiltered = `${BASE_URL}OtherItems?$filter=${encodeURIComponent(
        filter
    )}&$select=${encodeURIComponent(select)}&$expand=${encodeURIComponent(expandUnfiltered)}`;

    const headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Authorization": TOKEN,
    };

    // 1) try filtered expand
    let res = await fetch(urlUnfiltered, { headers });

    return await res.json();
}

// =====================
// LOW STOCK LOGIC
// =====================
function extractHoLowStockRows(itemsJson) {
    const out = [];

    for (const item of itemsJson?.value || []) {
        const branches = Array.isArray(item.BRANCH_INFOS) ? item.BRANCH_INFOS : [];

        // If server didn't support expand-filter, we filter here too
        const ho = branches.find(b => b?.BRANCH_IDENTIFIER === "HO" && b?.INVENTORY === true);
        if (!ho) continue;

        const qoh = Number(ho.QOH);

        // If missing values, skip
        if (!Number.isFinite(qoh)) continue;

        const reorderCount = ITEMS.find(v => v.barcode === item.BARCODE).alertPoint;

        // Rule: QOH < REORDER_LEVEL
        if (qoh < reorderCount) {
            out.push({
                barcode: String(item.BARCODE ?? ""),
                description: String(item.DESCRIPTION ?? ""),
                qoh,
                alertPoint: reorderCount,
            });
        }
    }

    return out;
}

function buildHtml(rows) {
    const tr = rows
        .map(
            (r) => `<tr>
                <td style="padding:8px;border:1px solid #ddd;">${r.barcode}</td>
                <td style="padding:8px;border:1px solid #ddd;">${r.description}</td>
                <td style="padding:8px;border:1px solid #ddd;">${r.qoh}</td>
                <td style="padding:8px;border:1px solid #ddd;">${r.alertPoint}</td>
            </tr>`
        )
        .join("");

    return `
    <div style="font-family:Arial,sans-serif;">
      <p>Hi Shannon</p>
      <p>The QoH for these items has fallen below the threshold quantity.</p>
      <table style="border-collapse:collapse;">
        <thead>
          <tr>
            <th style="padding:8px;border:1px solid #ddd;background:#f5f5f5;">BARCODE</th>
            <th style="padding:8px;border:1px solid #ddd;background:#f5f5f5;">DESCRIPTION</th>
            <th style="padding:8px;border:1px solid #ddd;background:#f5f5f5;">QOH</th>
            <th style="padding:8px;border:1px solid #ddd;background:#f5f5f5;">ALERT POINT</th>
          </tr>
        </thead>
        <tbody>${tr}</tbody>
      </table>
      <p>best regards,<br/>Junhee Cho</p>
    </div>
  `;
}

export async function sendGmailHtml({ to, subject, html }) {
    const raw = [
        `From: ${process.env.GMAIL_SENDER}`,
        `To: ${to}`,
        `Subject: ${subject}`,
        "MIME-Version: 1.0",
        'Content-Type: text/html; charset="UTF-8"',
        "",
        html,
    ].join("\n");

    await gmail.users.messages.send({
        userId: "me",
        requestBody: { raw: toBase64Url(raw) },
    });
}

// =====================
// MAIN
// =====================
(async function main() {
    try {
        const json = await fetchOtherItemsForBarcodes();
        const lowRows = extractHoLowStockRows(json);

        if (lowRows.length === 0) {
            console.log(`[${nowIso()}] OK: no low stock items`);
            return;
        }

        const mailHtml = buildHtml(lowRows)

        await sendGmailHtml({
            to: TO_EMAILS,
            subject: "[Warning] Stationery Low Stock Alert",
            html: mailHtml
        })

        console.log(`[${nowIso()}] SENT`);
    } catch (err) {
        console.error(`[${nowIso()}] ERROR:`, err?.stack || err);
        process.exitCode = 1;
    }
})();