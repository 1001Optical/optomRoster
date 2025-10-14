# Optometrist Roster Automation

A Next.js 15 application that synchronizes roster shifts from Employment Hero into a local SQLite database, provides a simple UI to browse rosters by date range and location, and triggers downstream automations (e.g., email/webhook notifications and Optomate API updates) when changes are detected.

## Features
- Fetch roster shifts from Employment Hero for a date range
- Persist and upsert into SQLite with automatic migrations
- Efficient diffing and change processing (including breaks per shift)
- Trigger downstream actions:
  - Call Optomate-related APIs when roster changes occur
  - Send email/webhook notifications for first-time/existing users
- Simple web UI to:
  - Pick a weekly range and filter by location
  - Refresh roster data on demand
- Daily sync script for cron-based automation

## Tech Stack
- Next.js 15, React 19
- TypeScript
- SQLite (better-sqlite3)
- date-fns / date-fns-tz
- Tailwind CSS 4 (via PostCSS)

## Directory Structure (high level)
- src/
  - app/
    - page.tsx: Main UI (calendar, location selector, refresh button, roster table)
    - api/roster/
      - refresh/route.ts: Calls Employment Hero to refresh roster data in DB
      - getList/route.ts: Reads roster data from DB (filter by date range and optional location)
    - layout.tsx: App layout and metadata
  - lib/
    - getEmploymentHeroList.ts: Fetches shifts and employees from Employment Hero, caches employee info, and syncs DB
    - getEmployeeInfo.ts: Fetch single employee info from Employment Hero
    - syncRoster.ts: Upsert a roster and breaks; delete stale entries within scope
    - changeProcessor.ts: Detects changes, posts to Optomate-related APIs, and emails via webhooks
    - postEmail.ts: Sends webhook emails for first-time/existing users
  - utils/
    - db/db.ts: SQLite connection, pragmas, and SQL migrations runner
    - time.ts: Time helpers (ISO formatting, timezone formatting)
    - fetch_utils.ts: Frontend helpers calling API routes (refresh, getList)
  - data/
    - stores.ts: Store location mapping (ids and names)
  - components/
    - table.tsx, IooICalendar, IooISelect: UI components used on the main page
- migrations/: SQL migration files
- scripts/
  - daily-sync.sh: Cron-friendly script to refresh and sync rosters for the next 14 days
- public/: Static assets

## Environment Variables
Create a .env file in the project root. The following variables are used by the codebase:

Required
- EMPLOYMENTHERO_API_URL: Base URL for Employment Hero API (e.g., https://example.com/api)
- EMPLOYMENTHERO_SECRET: Shared secret used to sign Employment Hero requests

Webhooks (email/automation)
- MAKE_WEBHOOK_FIRST: Webhook URL used when notifying a first-time user
- MAKE_WEBHOOK_EXIST: Webhook URL used when notifying an existing user

Optional
- DB_FILE: Custom path to the SQLite file (default: ./roster.sqlite)
- API_URL: Base URL used by scripts/daily-sync.sh when calling the app locally (default: http://localhost:3000)

Note: Do not commit your .env file.

## Database
- Default database file: roster.sqlite (WAL mode enabled)
- Migrations are automatically executed on server start via src/utils/db/db.ts against files under /migrations
- Core tables include ROSTER, ROSTER_BREAK, CHANGE_LOG, STORE_INFO (see migration SQL for details)

## API
1) GET /api/roster/refresh
- Purpose: Fetch shifts from Employment Hero for the requested window and persist to DB, then process changes
- Query Params:
  - from: ISO-like datetime (YYYY-MM-DDTHH:mm:ssZ) or date (YYYY-MM-DD)
  - to: ISO-like datetime (YYYY-MM-DDTHH:mm:ssZ) or date (YYYY-MM-DD)
  - range: optional shortcut; one of today | weekly | monthly. If range is provided, from/to are ignored
- Responses:
  - 200: { message: "success", data: optomData[] }
  - 400/500: error messages on invalid input or server error

2) GET /api/roster/getList
- Purpose: Read roster rows from DB for a date range; optionally filter by location
- Query Params:
  - from: YYYY-MM-DD
  - to: YYYY-MM-DD
  - locationId: optional number
- Responses:
  - 200: { message: "Success", data: I1001RosterData[] }
  - 400/500: error messages on invalid input or server error

## Running Locally
Prerequisites
- Node.js 20+
- pnpm, npm, or yarn

Install and run
- Install dependencies: npm install (or yarn install)
- Create and fill .env (see Environment Variables)
- Dev server: npm run dev (default http://localhost:3000)
- Production build: npm run build && npm start

The first server start will run migrations and create/update the SQLite schema as needed.

## Using the App
- Open the app in a browser and select a week using the calendar control
- Optionally select a location to filter
- Press the Refresh button to pull the latest Employment Hero data for the selected window
- The table will show roster entries grouped by store and date (with start/end times)

## Automation (Cron)
The provided script scripts/daily-sync.sh calls the refresh endpoint for the next 14 days.

Example cron (runs at 06:00, 09:00, 13:00, 17:00):
- 0 6,9,13,17 * * * API_URL="http://localhost:3000" /path/to/repo/scripts/daily-sync.sh >> /var/log/roster-sync.log 2>&1

Ensure the Next.js server is accessible at API_URL when the cron runs.

## Error Handling and Logging
- API routes validate required parameters and return 400 on invalid inputs
- External requests are checked for HTTP status; failures surface with clear messages
- Server logs include contextual messages during refresh, list retrieval, and emailing

## Security Notes
- Keep your .env secret values out of version control
- Webhook URLs should be treated as secrets
- The Employment Hero secret is used to sign requests via utils/crypto#createSecret

## Development Tips
- If you change SQL under /migrations, restart the dev server to apply
- To point the DB to a different file, set DB_FILE in .env and restart
- When developing against a remote Employment Hero sandbox, ensure EMPLOYMENTHERO_API_URL is reachable from your environment

## License
Private project. All rights reserved.
