import fs from "fs";
import readline from "readline";
import { google } from "googleapis";
import "dotenv/config";

const SCOPES = ["https://www.googleapis.com/auth/gmail.send"];

const oAuth2Client = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    "http://localhost:3000/oauth2callback"
);

const url = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
});

console.log("Open this URL and authorize:\n", url);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question("Paste the code here: ", async (code) => {
    const { tokens } = await oAuth2Client.getToken(code);
    fs.writeFileSync("gmail_token.json", JSON.stringify(tokens, null, 2));
    console.log("Saved: gmail_token.json");
    rl.close();
});