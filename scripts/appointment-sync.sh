#!/bin/bash

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

# API URL
api_url=${API_URL:-"https://1001optometrist.com"}

# 어제 날짜 동기화
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting appointment count sync for yesterday..."
curl -s "$api_url/roster/api/appointments/sync?yesterday=true" > /dev/null

if [ $? -eq 0 ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Appointment count sync completed successfully"
else
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Appointment count sync failed"
    exit 1
fi





