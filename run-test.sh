#!/bin/bash

# Default values
WEAVIATE_HOST=${WEAVIATE_HOST:-"http://localhost:8080"}
WEAVIATE_API_KEY=${WEAVIATE_API_KEY:-""}
MULTI_TENANCY=${MULTI_TENANCY:-"true"}
AUTO_TENANT_CREATION=${AUTO_TENANT_CREATION:-"false"}
NUMBER_TENANTS=${NUMBER_TENANTS:-"2"}
NUMBER_OBJECTS=${NUMBER_OBJECTS:-"10"}
USE_BATCH=${USE_BATCH:-"false"}
BATCH_SIZE=${BATCH_SIZE:-"100"}
DURATION=${DURATION:-"30s"}
VUS=${VUS:-"1"}
MIN_THINK_TIME=${MIN_THINK_TIME:-"3"}
MAX_THINK_TIME=${MAX_THINK_TIME:-"8"}
REPLICATION_FACTOR=${REPLICATION_FACTOR:-"1"}
ASYNC_REPLICATION=${ASYNC_REPLICATION:-"false"}
BACKUP_ENABLED=${BACKUP_ENABLED:-"false"}
CLOUD_ENABLED=${CLOUD_ENABLED:-"false"}
CLOUD_ZONE=${CLOUD_ZONE:-"amazon:us:ashburn"}

# Function to display usage
usage() {
    echo "Usage: $0 [options] <test-name>"
    echo "Options:"
    echo "  --host <url>              Weaviate host URL (default: http://localhost:8080)"
    echo "  --api-key <key>           Weaviate API key"
    echo "  --multi-tenant <true/false> Enable multi-tenancy (default: true)"
    echo "  --auto-tenant <true/false> Enable auto tenant creation (default: false)"
    echo "  --tenants <number>        Number of tenants to create (default: 2)"
    echo "  --offload <true/false>    Enable offload (default: false)"
    echo "  --objects <number>        Number of objects to create (default: 10)"
    echo "  --use-batch <true/false>  Enable batch object creation (default: false)"
    echo "  --batch-size <number>     Batch size for object creation (default: 100)"
    echo "  --duration <duration>      Test duration (default: 30s)"
    echo "  --vus <number>            Number of virtual users (default: 1)"
    echo "  --min-think <seconds>     Minimum think time (default: 3)"
    echo "  --max-think <seconds>     Maximum think time (default: 8)"
    echo "  --replication <factor>    Replication factor (default: 1)"
    echo "  --async-repl <true/false> Enable async replication (default: false)"
    echo "  --backup <true/false>     Enable backup testing (default: false)"
    echo "  --out <file>              Output file (default: no output). Example: --out json=metrics.json"
    echo "  --quiet <true/false>      Enable quiet mode (default: false)"
    echo "  --cloud <true/false>      Enable k6 cloud execution (default: false)"
    echo "  --cloud-zone <zone>       k6 cloud zone (default: amazon:us:ashburn)"
    echo "  -h, --help               Display this help message"
    echo
    echo "Available tests:"
    echo "  multi-tenancy    - Run the multi-tenancy test"
    echo "  object-insertion - Run the object insertion test"
    echo
    echo "Available cloud zones for GCP us-east1:"
    echo "  amazon:us:ashburn     Ashburn, US (closest to GCP us-east1)"
    echo "  amazon:us:columbus    Columbus, US"
    echo "  amazon:ca:montreal    Montreal, CA"
    exit 1
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --host)
            WEAVIATE_HOST="$2"
            shift 2
            ;;
        --api-key)
            WEAVIATE_API_KEY="$2"
            shift 2
            ;;
        --multi-tenant)
            MULTI_TENANCY="$2"
            shift 2
            ;;
        --auto-tenant)
            AUTO_TENANT_CREATION="$2"
            shift 2
            ;;
        --tenants)
            NUMBER_TENANTS="$2"
            shift 2
            ;;
        --offload)
            S3_OFFLOAD="$2"
            shift 2
            ;;
        --objects)
            NUMBER_OBJECTS="$2"
            shift 2
            ;;
        --use-batch)
            USE_BATCH="$2"
            shift 2
            ;;
        --batch-size)
            BATCH_SIZE="$2"
            shift 2
            ;;
        --duration)
            DURATION="$2"
            shift 2
            ;;
        --vus)
            VUS="$2"
            shift 2
            ;;
        --min-think)
            MIN_THINK_TIME="$2"
            shift 2
            ;;
        --max-think)
            MAX_THINK_TIME="$2"
            shift 2
            ;;
        --replication)
            REPLICATION_FACTOR="$2"
            shift 2
            ;;
        --async-repl)
            ASYNC_REPLICATION="$2"
            shift 2
            ;;
        --backup)
            BACKUP_ENABLED="$2"
            shift 2
            ;;
        --out)
            OUTPUT_FILE="$2"
            shift 2
            ;;
        --quiet)
            QUIET="$2"
            shift 2
            ;;
        --cloud)
            CLOUD_ENABLED="$2"
            shift 2
            ;;
        --cloud-zone)
            CLOUD_ZONE="$2"
            shift 2
            ;;
        -h|--help)
            usage
            ;;
        *)
            TEST_NAME="$1"
            shift
            ;;
    esac
done

# Validate test name
if [ -z "$TEST_NAME" ]; then
    echo "Error: Test name is required"
    usage
fi

# Validate test file exists
TEST_FILE="src/tests/${TEST_NAME}.js"
if [ ! -f "$TEST_FILE" ]; then
    echo "Error: Test file $TEST_FILE not found"
    exit 1
fi

# Build k6 command with environment variables
K6_CMD="k6 run"

# Add cloud options if enabled
if [ "$CLOUD_ENABLED" = "true" ]; then
    K6_CMD="k6 cloud run -e CLOUD_ZONE=$CLOUD_ZONE"
fi

# Run k6 test with environment variables
$K6_CMD \
    -e WEAVIATE_HOST="$WEAVIATE_HOST" \
    -e WEAVIATE_API_KEY="$WEAVIATE_API_KEY" \
    -e MULTI_TENANCY="$MULTI_TENANCY" \
    -e AUTO_TENANT_CREATION="$AUTO_TENANT_CREATION" \
    -e S3_OFFLOAD="$S3_OFFLOAD" \
    -e NUMBER_TENANTS="$NUMBER_TENANTS" \
    -e NUMBER_OBJECTS="$NUMBER_OBJECTS" \
    -e USE_BATCH="$USE_BATCH" \
    -e BATCH_SIZE="$BATCH_SIZE" \
    -e DURATION="$DURATION" \
    -e VUS="$VUS" \
    -e MIN_THINK_TIME="$MIN_THINK_TIME" \
    -e MAX_THINK_TIME="$MAX_THINK_TIME" \
    -e REPLICATION_FACTOR="$REPLICATION_FACTOR" \
    -e ASYNC_REPLICATION="$ASYNC_REPLICATION" \
    -e BACKUP_ENABLED="$BACKUP_ENABLED" \
    ${OUTPUT_FILE:+--out "$OUTPUT_FILE"} \
    ${QUIET:+--quiet "$QUIET"} \
    "$TEST_FILE"
