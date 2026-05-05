# Optometrist Roster Automation

A full-stack **Next.js** automation system for 1001 Optical that synchronizes optometrist rosters from **Employment Hero**, propagates changes to **Optomate** and internal APIs, and sends notifications when slot mismatches or appointment conflicts are detected.

## Features

- **Employment Hero → SQLite roster sync**: Fetches roster shifts by date range and store, upserts into DB
- **Change detection & propagation**: SQLite triggers automatically log changes to `CHANGE_LOG` → replayed to Optomate/internal APIs
- **Appointment conflict & slot mismatch detection**: Compares Optomate appointment data against EH roster slots, alerts on conflicts
- **Email/webhook notifications**: Sends notifications via Make.com webhooks with retry queue (`EMAIL_QUEUE`)
- **Roster dashboard UI**: Weekly calendar + store/state filters for browsing and manually refreshing rosters
- **Appointment occupancy UI**: Per-store weekly/monthly appointment occupancy visualization
- **Vercel Cron automation**: Periodic per-store sync, change log replay, email retry, and past data cleanup

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript (strict) |
| UI | React 19, Tailwind CSS 4, Framer Motion, Lucide React |
| Calendar | react-day-picker v9 |
| Date | date-fns, date-fns-tz |
| Database | SQLite via `@libsql/client` (local file or Turso remote) |
| Observability | Axiom (`@axiomhq/nextjs`) |
| Hosting | Vercel (with Cron Jobs) |

### External Integrations

- **Employment Hero** — Roster shifts and employee information
- **Optomate** — Appointment counts, identifier checks, roster adjustments (OData + Basic Auth)
- **1001 Internal API** — Optometrist account creation, appointment management (Bearer Token)
- **Make.com** — Email/automation webhooks
- **Gmail API** — Low-stock alerts (scripts only)

## Directory Structure

```
├── src/
│   ├── app/
│   │   ├── page.tsx                      # Main roster dashboard
│   │   ├── layout.tsx                    # App layout and metadata
│   │   ├── globals.css                   # Global styles
│   │   ├── optom-count/                  # Appointment occupancy page
│   │   │   ├── page.tsx
│   │   │   ├── useOptomCount.ts
│   │   │   ├── occupancy-utils.ts
│   │   │   └── components/
│   │   └── api/
│   │       ├── roster/
│   │       │   ├── refresh/route.ts      # EH → DB sync
│   │       │   ├── getList/route.ts      # Read roster from DB
│   │       │   ├── optom-count/route.ts  # Appointment occupancy API
│   │       │   ├── change-log-pending-count/route.ts
│   │       │   ├── send-conflict-email/route.ts
│   │       │   └── cleanup-past-data/route.ts
│   │       └── cron/
│   │           ├── store-sync/route.ts   # Per-store automated sync
│   │           ├── email-retry/route.ts  # Email queue retry
│   │           ├── replay-change-log/route.ts
│   │           └── low-stock/route.ts    # Low-stock Gmail alert
│   ├── components/
│   │   ├── table.tsx                     # Roster table
│   │   ├── IooICalendar.tsx             # Weekly calendar picker
│   │   ├── IooISelect.tsx               # Store/state selector
│   │   ├── AlertToast.tsx               # Slot mismatch/conflict alerts
│   │   └── modal/loginModal.tsx
│   ├── lib/
│   │   ├── getEmploymentHeroList.ts     # EH shift fetch + orchestration
│   │   ├── getEmployeeInfo.ts           # Single employee info fetch
│   │   ├── syncRoster.ts               # Roster/break upsert and cleanup
│   │   ├── changeProcessor.ts          # Read CHANGE_LOG → push to Optomate
│   │   ├── rosterAdjustService.ts      # Optomate roster adjustments
│   │   ├── slotService.ts              # Slot calculations
│   │   ├── getAppointmentCount.ts      # Optomate appointment count fetch
│   │   ├── checkIdentifierCount.ts     # Optomate identifier validation
│   │   ├── optometrists.ts            # 1001 API - optometrist management
│   │   ├── appointment.ts             # 1001 API - appointment management
│   │   ├── createOptomAccount.ts      # 1001 API - account creation
│   │   ├── postEmail.ts               # Make.com webhook + EMAIL_QUEUE
│   │   ├── logger.ts                  # Logging configuration
│   │   └── axiom/                     # Axiom logging utilities
│   ├── data/
│   │   └── stores.ts                  # Store code / Location ID mapping (NSW, VIC, QLD)
│   ├── services/
│   │   └── apiFetch.ts               # Rate-limited API client
│   ├── types/                         # TypeScript type definitions
│   └── utils/
│       ├── db/db.ts                   # LibSQL client + migration runner
│       ├── time.ts                    # Time/timezone helpers
│       ├── formatting.ts             # Table data formatting
│       ├── slots.ts                  # Slot calculation utilities
│       ├── fetch_utils.ts            # Frontend fetch helpers
│       └── crypto.ts                 # EH request signing
├── migrations/                        # SQLite migrations (001–005)
├── scripts/                           # Cron/automation shell scripts
├── public/                            # Static assets + fonts
├── vercel.json                        # Vercel Cron schedule configuration
└── package.json
```

## Database

Uses SQLite (local file or Turso remote). Migrations from the `migrations/` directory are automatically executed on server startup.

### Tables

| Table | Description |
|-------|-------------|
| `ROSTER` | Roster shifts (employee, store, start/end time) |
| `ROSTER_BREAK` | Break periods within a shift (FK → ROSTER) |
| `CHANGE_LOG` | Roster change history (auto-recorded via SQLite triggers) |
| `STORE_INFO` | Store information |
| `EMAIL_QUEUE` | Email send queue (with retry on failure) |

### Change Detection Triggers

On every INSERT, UPDATE, or DELETE on the `ROSTER` table, SQLite triggers automatically record before/after data as JSON into `CHANGE_LOG`.

## API Endpoints

### Roster

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/roster/refresh` | Fetch roster from EH, sync to DB, and process changes |
| GET | `/api/roster/getList` | Read roster from DB (date and store filters) |
| GET | `/api/roster/optom-count` | EH roster slots + Optomate appointment-based occupancy |
| GET | `/api/roster/change-log-pending-count` | Count of pending change log entries |
| GET | `/api/roster/send-conflict-email` | Push changes to Optomate API |
| GET | `/api/roster/cleanup-past-data` | Purge past roster data |

### Cron

| Method | Path | Description | Schedule |
|--------|------|-------------|----------|
| GET | `/api/cron/store-sync?store={CODE}` | Per-store roster sync (today → +56 days) | Every 4 hours, staggered per store |
| GET | `/api/cron/email-retry` | Retry failed emails from EMAIL_QUEUE | Every 10 minutes |
| GET | `/api/cron/replay-change-log` | Replay CHANGE_LOG → Optomate | Hourly |
| GET | `/api/cron/low-stock` | Low-stock Gmail alert via Optomate | Manual / external scheduler |

### Key Query Parameters (`/api/roster/refresh`)

| Parameter | Description |
|-----------|-------------|
| `from`, `to` | ISO date range (YYYY-MM-DD or YYYY-MM-DDTHH:mm:ssZ) |
| `range` | `today` \| `weekly` \| `monthly` (used instead of from/to) |
| `branch` | Filter by store code |
| `state` | Filter by state (NSW, VIC, QLD) |
| `scheduler` | `true` allows extended date ranges |
| `manual` | `true` applies range limits |

## Environment Variables

Create a `.env` file in the project root.

### Required

| Variable | Description |
|----------|-------------|
| `EMPLOYMENTHERO_API_URL` | Employment Hero API base URL |
| `EMPLOYMENTHERO_SECRET` | Shared secret for signing EH requests |

### Database

| Variable | Description |
|----------|-------------|
| `TURSO_DATABASE_URL` | Turso remote DB URL (overrides local file when set) |
| `TURSO_AUTH_TOKEN` | Turso authentication token |
| `DB_FILE` | Local SQLite file path (default: `roster.sqlite`) |

### Optomate

| Variable | Description |
|----------|-------------|
| `OPTOMATE_API_URL` | Optomate OData API base URL |
| `OPTOMATE_USERNAME` | Optomate Basic Auth username |
| `OPTOMATE_PASSWORD` | Optomate Basic Auth password |

### 1001 Internal API

| Variable | Description |
|----------|-------------|
| `API_BASE_URL` | 1001 internal API base URL |
| `API_TOKENS` | Bearer token |
| `NEXT_PUBLIC_API_BASE_URL` | Client-side API URL |

### Webhooks / Email

| Variable | Description |
|----------|-------------|
| `MAKE_WEBHOOK_FIRST` | Webhook URL for first-time user notifications |
| `MAKE_WEBHOOK_EXIST` | Webhook URL for existing user notifications |

### Rate Limiting

| Variable | Description |
|----------|-------------|
| `API_1001_MIN_GAP_MS` | Minimum gap between API calls (ms) |
| `API_1001_MAX_PER_MINUTE` | Maximum API calls per minute |

### Axiom (Observability)

| Variable | Description |
|----------|-------------|
| `AXIOM_TOKEN` | Axiom API token |
| `AXIOM_DATASET` | Axiom dataset name |
| `LOG_LEVEL` | Log level |

### Gmail (low-stock script)

| Variable | Description |
|----------|-------------|
| `GMAIL_CLIENT_ID` | Gmail OAuth client ID |
| `GMAIL_CLIENT_SECRET` | Gmail OAuth client secret |
| `GMAIL_SENDER` | Sender email address |
| `GMAIL_TOKEN_JSON` | Gmail OAuth token JSON |

## Getting Started

### Prerequisites

- Node.js 20+
- pnpm, npm, or yarn

### Install & Run

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env   # Create .env and fill in values (see Environment Variables above)

# Start development server
npm run dev
```

On first startup, migration SQL files from the `migrations/` directory are automatically executed to create the DB schema.

### Production Build

```bash
npm run build
npm start
```

## Store Directory

The following stores are currently registered:

| State | Stores | Codes |
|-------|--------|-------|
| NSW | Blacktown, Bondi, Burwood, Chatswood Chase, Chatswood Westfield, Eastgardens, Hornsby, Hurstville, Macquarie, Parramatta, Penrith, Top Ryde | BKT, BON, BUR, CHC, CHW, ETG, HOB, HUR, MQU, PA1, PEN, TOP |
| VIC | Box Hill, Doncaster, Emporium | BOH, DON, EMP |
| QLD | Indooroopilly | IND |

## Cron Automation (Vercel)

Cron schedules defined in `vercel.json`:

- **Per-store sync**: EH sync every 4 hours per store (staggered at 10-minute intervals)
- **Change log replay**: Hourly push of `CHANGE_LOG` entries to Optomate
- **Email retry**: Every 10 minutes, retries failed entries in `EMAIL_QUEUE`
- **Past data cleanup**: Daily at 17:55 UTC, purges past roster data

## Architecture Flow

```
Employment Hero  ──fetch──▶  Next.js API  ──upsert──▶  SQLite
                                                          │
                                                   (SQLite Trigger)
                                                          │
                                                          ▼
                                                     CHANGE_LOG
                                                          │
                                              (Cron: replay-change-log)
                                                          │
                                    ┌─────────────────────┼─────────────────────┐
                                    ▼                     ▼                     ▼
                              Optomate API         1001 Internal API      Make.com Webhook
                           (Roster Adjustment)   (Optom/Appt Management)  (Email Alerts)
```

## Security Notes

- Never commit your `.env` file to version control
- Treat webhook URLs as secrets
- Employment Hero requests are signed via `crypto.ts` (`createSecret`)
- Optomate uses Basic Auth; 1001 API uses Bearer Token authentication

## License

Private project. All rights reserved.
