#!/bin/bash

# Store-by-store sync script
# Processes each store with 5-minute intervals to reduce server load
# Usage: ./scripts/store-by-store-sync.sh

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

# Get date range (8 weeks ahead = 56 days)
# Note: This uses GNU date syntax. For macOS, you may need: brew install coreutils and use 'gdate'
start_date=$(date '+%Y-%m-%d')
end_date=$(date -d "+56 days" '+%Y-%m-%d')

# API URL (can be overridden by environment variable)
api_url=${API_URL:-"https://1001optometrist.com/roster"}

# Store list (OptCode values from OptomMap)
stores=(
    "ETG"  # Eastgardens
    "HUR"  # Hurstville
    "BKT"  # Blacktown
    "CHC"  # Chase
    "BON"  # Bondi
    "BUR"  # Burwood
    "HOB"  # Hornsby
    "EMP"  # Emporium
    "IND"  # Indooroopilly
    "PA1"  # Parramatta
    "PEN"  # Penrith
    "BOH"  # Box Hill
    "DON"  # Doncaster
    "TOP"  # Topryde
    "MQU"  # Macquarie
    "CHW"  # Chatswood Westfield
)

total_stores=${#stores[@]}
current=0

# Function to process a single store
process_store() {
    local store=$1
    local store_num=$2
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    
    echo "[$timestamp] [$store_num/$total_stores] Starting store: $store"
    
    # Call refresh API with branch parameter and scheduler flag
    response=$(curl -s -w "\n%{http_code}" "$api_url/api/roster/refresh?from=$start_date&to=$end_date&branch=$store&scheduler=true")
    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | sed '$d')
    
    timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    if [ "$http_code" -eq 200 ]; then
        echo "[$timestamp] [$store_num/$total_stores] ✅ Success: $store"
    else
        echo "[$timestamp] [$store_num/$total_stores] ❌ Error: $store (HTTP $http_code)"
        echo "  Response: $body"
    fi
}

echo "=========================================="
echo "Store-by-Store Sync Started"
echo "=========================================="
echo "Date Range: $start_date to $end_date"
echo "Total Stores: $total_stores"
echo "Interval: 5 minutes between store starts"
echo "API URL: $api_url"
echo "Note: Stores run in parallel with 5-min intervals"
echo "=========================================="
echo ""

# Clean up past data (before today) for all branches before starting store sync
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Cleaning up past data (before today) for all branches..."
cleanup_response=$(curl -s -w "\n%{http_code}" "$api_url/api/roster/cleanup-past-data")
cleanup_http_code=$(echo "$cleanup_response" | tail -n1)
cleanup_body=$(echo "$cleanup_response" | sed '$d')

if [ "$cleanup_http_code" -eq 200 ]; then
    deleted_count=$(echo "$cleanup_body" | grep -o '"deleted":[0-9]*' | grep -o '[0-9]*')
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ✅ Cleaned up past data: $deleted_count entries deleted (today's data preserved)"
else
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ⚠️  Warning: Failed to cleanup past data (HTTP $cleanup_http_code)"
    echo "  Response: $cleanup_body"
fi
echo ""

# Start each store in background with 5-minute intervals
for store in "${stores[@]}"; do
    current=$((current + 1))
    
    # Start store processing in background
    process_store "$store" "$current" &
    
    # Wait 5 minutes before starting next store (except for the last one)
    if [ $current -lt $total_stores ]; then
        echo "  ⏳ Next store will start in 5 minutes..."
        sleep 120  # 2 minutes = 120 seconds
        echo ""
    fi
done

# Wait for all background jobs to complete
echo ""
echo "All stores started. Waiting for all jobs to complete..."
wait

echo ""
echo "=========================================="
echo "Store-by-Store Sync Completed"
echo "=========================================="
echo "Finished at: $(date '+%Y-%m-%d %H:%M:%S')"
echo "Total stores processed: $total_stores"
echo "=========================================="

