/**
 * OAuth2 auth script — Node.js v22 compatible (no googleapis dependency)
 * Scopes: gmail.send + spreadsheets.readonly
 * Uses local HTTP server to capture callback code
 */
import fs from "fs";
import http from "http";
import { exec } from "child_process";
import "dotenv/config";

const CLIENT_ID = process.env.GMAIL_CLIENT_ID;
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;
const PORT = 3030;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;

const SCOPES = [
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/spreadsheets.readonly",
];

const authUrl =
    "https://accounts.google.com/o/oauth2/v2/auth?" +
    new URLSearchParams({
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        response_type: "code",
        scope: SCOPES.join(" "),
        access_type: "offline",
        prompt: "consent",
    }).toString();

console.log("\n브라우저에서 Google 계정 승인 후 자동으로 토큰이 저장됩니다...");
console.log("브라우저가 자동으로 열리지 않으면 아래 URL을 직접 열어주세요:\n");
console.log(authUrl + "\n");

// Open browser automatically
exec(`open "${authUrl}"`);

// Local server to capture callback
const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    if (url.pathname !== "/oauth2callback") {
        res.end("Not found");
        return;
    }

    const code = url.searchParams.get("code");
    const error = url.searchParams.get("error");

    if (error) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<h2>❌ 오류: ${error}</h2><p>터미널을 확인하세요.</p>`);
        console.error("❌ 오류:", error);
        server.close();
        return;
    }

    try {
        const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                code,
                client_id: CLIENT_ID,
                client_secret: CLIENT_SECRET,
                redirect_uri: REDIRECT_URI,
                grant_type: "authorization_code",
            }).toString(),
        });

        const tokens = await tokenRes.json();
        if (tokens.error) {
            res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
            res.end(`<h2>❌ 토큰 오류: ${tokens.error}</h2>`);
            console.error("❌ 토큰 오류:", tokens.error, tokens.error_description);
        } else {
            fs.writeFileSync("gmail_token.json", JSON.stringify(tokens, null, 2));
            res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
            res.end(`<h2>✅ 인증 완료!</h2><p>gmail_token.json 저장됐습니다. 이 창을 닫아도 됩니다.</p>`);
            console.log("\n✅ 저장 완료: gmail_token.json");
            console.log("   refresh_token:", tokens.refresh_token ? "있음" : "없음");
        }
    } catch (e) {
        res.end(`오류: ${e.message}`);
        console.error("❌ 네트워크 오류:", e.message);
    }

    server.close(() => process.exit(0));
});

server.listen(PORT, () => {
    console.log(`콜백 서버 대기 중: http://localhost:${PORT}`);
});
