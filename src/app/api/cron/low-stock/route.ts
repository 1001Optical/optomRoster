import { NextResponse } from "next/server";
import { google } from "googleapis";
import type { Credentials } from "google-auth-library";
import fs from "node:fs";
import path from "node:path";

export const runtime = "nodejs";

const toBase64 = (str: string) => Buffer.from(str, "utf8").toString("base64");
const createSecret = (username: string, password?: string) =>
    `Basic ${toBase64(`${username}:${password ?? ""}`)}`;

const toBase64Url = (str: string) =>
    Buffer.from(str)
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");

const nowIso = () => new Date().toISOString();

const BASE_URL = "https://1001optdb.habitat3.net:12443/OptomateTouch/OData4/";
const TOKEN = createSecret("1001_HO_JH", "10011001");
const TO_EMAILS = "shannon@1001optical.com.au";

const ITEMS: { barcode: string; alertPoint: number }[] = [
    { barcode: "20015195", alertPoint: 60 },
    { barcode: "20015206", alertPoint: 20 },
    { barcode: "20023351", alertPoint: 20 },
    { barcode: "20021629", alertPoint: 60 },
    { barcode: "20021691", alertPoint: 130 },
    { barcode: "20021692", alertPoint: 130 },
    { barcode: "20088059", alertPoint: 70 },
    { barcode: "20021695", alertPoint: 140 },
    { barcode: "20021701", alertPoint: 5 },
    { barcode: "20021702", alertPoint: 20 },
];

type OtherItemsResponse = {
    value?: Array<{
        BARCODE?: string;
        DESCRIPTION?: string;
        BRANCH_INFOS?: Array<{
            BRANCH_IDENTIFIER?: string;
            QOH?: number | string;
            REORDER_LEVEL?: number | string;
            REORDER_QUANTITY?: number | string;
            INVENTORY?: boolean;
        }>;
    }>;
};

type LowStockRow = {
    barcode: string;
    description: string;
    qoh: number;
    alertPoint: number;
};

function odataEscape(str: string) {
    return String(str).replace(/'/g, "''");
}

async function fetchOtherItemsForBarcodes(): Promise<OtherItemsResponse> {
    const filter = ITEMS.map(({ barcode }) => `BARCODE eq '${odataEscape(barcode)}'`).join(" or ");
    const select = ["ID", "BARCODE", "DESCRIPTION"].join(",");
    const expandUnfiltered =
        "BRANCH_INFOS(" +
        "$select=BRANCH_IDENTIFIER,QOH,REORDER_LEVEL,REORDER_QUANTITY,INVENTORY" +
        ")";

    const url = `${BASE_URL}OtherItems?$filter=${encodeURIComponent(
        filter
    )}&$select=${encodeURIComponent(select)}&$expand=${encodeURIComponent(expandUnfiltered)}`;

    const headers = {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: TOKEN,
    };

    const res = await fetch(url, { headers });
    return (await res.json()) as OtherItemsResponse;
}

function extractHoLowStockRows(itemsJson: OtherItemsResponse): LowStockRow[] {
    const out: LowStockRow[] = [];

    for (const item of itemsJson?.value || []) {
        const branches = Array.isArray(item.BRANCH_INFOS) ? item.BRANCH_INFOS : [];
        const ho = branches.find(
            (b) => b?.BRANCH_IDENTIFIER === "HO" && b?.INVENTORY === true
        );
        if (!ho) continue;

        const qoh = Number(ho.QOH);
        if (!Number.isFinite(qoh)) continue;

        const found = ITEMS.find((v) => v.barcode === item.BARCODE);
        if (!found) continue;

        if (qoh < found.alertPoint) {
            out.push({
                barcode: String(item.BARCODE ?? ""),
                description: String(item.DESCRIPTION ?? ""),
                qoh,
                alertPoint: found.alertPoint,
            });
        }
    }

    return out;
}

function buildHtml(rows: LowStockRow[]) {
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
      <p>The QOH for these items has fallen below the threshold quantity.</p>
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

async function sendGmailHtml(to: string, subject: string, html: string) {
    if (!process.env.GMAIL_CLIENT_ID || !process.env.GMAIL_CLIENT_SECRET || !process.env.GMAIL_SENDER) {
        throw new Error("Gmail API env not set");
    }

    let tokens: Credentials;
    if (process.env.GMAIL_TOKEN_JSON) {
        try {
            tokens = JSON.parse(process.env.GMAIL_TOKEN_JSON) as Credentials;
        } catch {
            throw new Error("GMAIL_TOKEN_JSON is not valid JSON");
        }
    } else {
        const tokenPath = path.join(process.cwd(), "gmail_token.json");
        if (!fs.existsSync(tokenPath)) {
            throw new Error("gmail_token.json not found");
        }
        tokens = JSON.parse(fs.readFileSync(tokenPath, "utf8")) as Credentials;
    }

    const auth = new google.auth.OAuth2(
        process.env.GMAIL_CLIENT_ID,
        process.env.GMAIL_CLIENT_SECRET
    );
    auth.setCredentials(tokens);

    const gmail = google.gmail({ version: "v1", auth });

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

export async function GET(): Promise<NextResponse> {
    try {
        const json = await fetchOtherItemsForBarcodes();
        const lowRows = extractHoLowStockRows(json);

        if (lowRows.length === 0) {
            return NextResponse.json(
                { message: "ok", data: { count: 0 } },
                { status: 200 }
            );
        }

        const mailHtml = buildHtml(lowRows);
        await sendGmailHtml(TO_EMAILS, "[Warning] Stationery Low Stock Alert", mailHtml);

        return NextResponse.json(
            { message: "sent", data: { count: lowRows.length } },
            { status: 200 }
        );
    } catch (error) {
        console.error(`[${nowIso()}] ERROR:`, error);
        return NextResponse.json(
            {
                message: "error",
                error: error instanceof Error ? error.message : String(error),
            },
            { status: 500 }
        );
    }
}
