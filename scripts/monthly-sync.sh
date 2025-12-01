#!/bin/bash

# 0 21 * * *

# Monthly sync - 2 months of data (for early morning)
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

# Get date range (2 months ahead)
start_date=$(date '+%Y-%m-%d')
end_date=$(date -d "+60 days" '+%Y-%m-%d')

# Call refresh API
api_url=${API_URL:-"http://localhost:3000"}
curl -s "$api_url/api/roster/refresh?from=$start_date&to=$end_date" > /dev/null

echo "[$(date '+%H:%M:%S')] Monthly sync completed: $start_date to $end_date"
