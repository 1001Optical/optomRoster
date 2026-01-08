#!/bin/bash

# 0 6,9,13,17 * * *

# Daily sync - 2 weeks of data
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

# Get date range (2 weeks ahead)
start_date=$(date '+%Y-%m-%d')
end_date=$(date -d "+14 days" '+%Y-%m-%d')

# Call refresh API with scheduler flag
api_url=${API_URL:-"http://localhost:3000"}
curl -s "$api_url/api/roster/refresh?from=$start_date&to=$end_date&scheduler=true" > /dev/null

echo "[$(date '+%H:%M:%S')] Daily sync completed: $start_date to $end_date"
