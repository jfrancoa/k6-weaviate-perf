#!/bin/bash

set -e  # Exit on error

# Default values
REPLICAS=${REPLICAS:-1}
WORKERS=${WORKERS:-1}
RESULTS_DIR="k6_results"
WEAVIATE_PORT=${WEAVIATE_PORT:-8080}
LOCAL_K8S_DIR=${LOCAL_K8S_DIR:-~/repos/weaviate-local-k8s}
K6_ARGS=${K6_ARGS:-"--vus 10 --multi-tenant true --tenants 100 --auto-tenant true"}
K6_QUIET=${K6_QUIET:-true}
PROFILING=${PROFILING:-false}
TEST_NAME=${TEST_NAME:-"multi-tenancy"}

# Default RBAC and AUTH_CONFIG values for each version
RBAC_V1=${RBAC_V1:-false}
RBAC_V2=${RBAC_V2:-false}
AUTH_CONFIG_V1=${AUTH_CONFIG_V1:-""}
AUTH_CONFIG_V2=${AUTH_CONFIG_V2:-""}

# API Keys for each version (empty means no authentication)
API_KEY_V1=${API_KEY_V1:-""}
API_KEY_V2=${API_KEY_V2:-""}

# Pre-test scripts to run (comma-separated list of Python scripts)
PRE_TEST_SCRIPTS_V1=${PRE_TEST_SCRIPTS_V1:-""}
PRE_TEST_SCRIPTS_V2=${PRE_TEST_SCRIPTS_V2:-""}

# Create results directory
mkdir -p "$RESULTS_DIR"

function run_pre_test_scripts() {
    local scripts=$1
    local api_key=$2
    
    if [ -n "$scripts" ]; then
        echo "Running pre-test scripts..."
        IFS=',' read -ra SCRIPT_ARRAY <<< "$scripts"
        for script in "${SCRIPT_ARRAY[@]}"; do
            script=$(echo "$script" | xargs)  # Trim whitespace
            if [ -f "$script" ]; then
                echo "Running $script..."
                if [[ "$script" == *".py" ]]; then
                    python3 "$script"
                else
                    ./"$script"
                fi
            else
                echo "Warning: Script $script not found"
            fi
        done
    fi
}

function run_test() {
    local version=$1
    local result_file=$2
    local rbac=$3
    local auth_config=$4
    local api_key=$5
    local pre_test_scripts=$6
    local test_name=$7
    
    echo "Starting Weaviate cluster with version $version (RBAC=$rbac, AUTH_CONFIG=$auth_config API_KEY=${api_key:+enabled (key: $api_key)})..."
    pushd "$LOCAL_K8S_DIR"
    WEAVIATE_VERSION="$version" \
    REPLICAS="$REPLICAS" \
    WORKERS="$WORKERS" \
    WEAVIATE_PORT="$WEAVIATE_PORT" \
    OBSERVABILITY="false" \
    RBAC="$rbac" \
    AUTH_CONFIG="$auth_config" \
    ./local-k8s.sh setup
    popd

    # Wait for the cluster to be ready
    sleep 10

    # Run pre-test scripts if specified
    run_pre_test_scripts "$pre_test_scripts" "$api_key"

    # Start profiling if enabled
    local pprof_pids=()
    if [ "$PROFILING" = "true" ]; then
        echo "Starting profiling for $REPLICAS replicas..."
        mkdir -p "$RESULTS_DIR/pprof_$version"
        
        # Calculate test duration from K6_ARGS
        local duration=30  # default duration in seconds
        if [[ "$K6_ARGS" =~ --duration[[:space:]]*([0-9]+[smh]) ]]; then
            local duration_str="${BASH_REMATCH[1]}"
            case ${duration_str: -1} in
                s) duration="${duration_str%s}";;
                m) duration=$((${duration_str%m} * 60));;
                h) duration=$((${duration_str%h} * 3600));;
            esac
        fi

        for ((i=0; i<REPLICAS; i++)); do
            local port=$((6060 + i))
            echo "Starting profiler for replica $i on port $port for $duration seconds"
            go tool pprof -png -lines "http://localhost:${port}/debug/pprof/profile?seconds=${duration}" > "${RESULTS_DIR}/pprof_${version}/profile_replica_rbac_${rbac}_weaviate_${i}.png" &
            pprof_pids+=($!)
        done
    fi

    echo "Running k6 tests ${test_name}..."
    # Add API key to k6 arguments if provided
    local k6_auth_args=""
    if [ -n "$api_key" ]; then
        k6_auth_args="--api-key $api_key"
    fi

    # Add quiet flag if enabled
    local k6_quiet_arg=""
    if [ "$K6_QUIET" = "true" ]; then
        k6_quiet_arg="--quiet=true"
    fi

    # Run the test using run-test.sh and store the metrics
    echo "./run-test.sh ${k6_quiet_arg} ${K6_ARGS} ${k6_auth_args} ${result_file:+--out=json=$result_file} $test_name"
    ./run-test.sh $k6_quiet_arg $K6_ARGS $k6_auth_args ${result_file:+--out=json=$result_file} $test_name || true

    # Wait for profiling to complete if enabled
    if [ "$PROFILING" = "true" ]; then
        echo "Waiting for profiling to complete..."
        for pid in "${pprof_pids[@]}"; do
            if ! wait "$pid"; then
                echo "Warning: Profiler process $pid failed"
            fi
        done
        echo "Profiling completed"
    fi

    echo "Cleaning up cluster..."
    pushd "$LOCAL_K8S_DIR"
    ./local-k8s.sh clean
    popd
}

# Print usage information
function usage() {
    echo "Usage: $0 [options]"
    echo "Required environment variables:"
    echo "  WEAVIATE_VERSION_1    First Weaviate version to test"
    echo "  WEAVIATE_VERSION_2    Second Weaviate version to test"
    echo
    echo "Optional environment variables:"
    echo "  REPLICAS              Number of Weaviate replicas (default: 1)"
    echo "  WORKERS               Number of Weaviate workers (default: 1)"
    echo "  WEAVIATE_PORT         Weaviate port (default: 8080)"
    echo "  K6_ARGS               Additional k6 arguments"
    echo "  K6_QUIET              Enable quiet mode (default: true)"
    echo "  PROFILING             Enable profiling (default: false)"
    echo "  TEST_NAME             Test to run (default: multi-tenancy)"
    echo
    echo "Available cloud zones for GCP us-east1:"
    echo "  amazon:us:ashburn     Ashburn, US (closest to GCP us-east1)"
    echo "  amazon:us:columbus    Columbus, US"
    echo "  amazon:ca:montreal    Montreal, CA"
    echo
    echo "Example:"
    echo "  WEAVIATE_VERSION_1=1.24.4 WEAVIATE_VERSION_2=1.24.5 CLOUD_ENABLED=true $0"
    exit 1
}
# Check required environment variables
if [ -z "$WEAVIATE_VERSION_1" ] || [ -z "$WEAVIATE_VERSION_2" ]; then
    usage
fi

# Run tests for first version
echo "Testing Weaviate version $WEAVIATE_VERSION_1..."
run_test "$WEAVIATE_VERSION_1" "$RESULTS_DIR/metrics_v1.json" "$RBAC_V1" "$AUTH_CONFIG_V1" "$API_KEY_V1" "$PRE_TEST_SCRIPTS_V1" "$TEST_NAME"

# Run tests for second version  
echo "Testing Weaviate version $WEAVIATE_VERSION_2..."
run_test "$WEAVIATE_VERSION_2" "$RESULTS_DIR/metrics_v2.json" "$RBAC_V2" "$AUTH_CONFIG_V2" "$API_KEY_V2" "$PRE_TEST_SCRIPTS_V2" "$TEST_NAME"

# Run comparison
echo "Comparing results..."
python3 compare_metrics.py "$WEAVIATE_VERSION_1" "$WEAVIATE_VERSION_2" "$RBAC_V1" "$RBAC_V2" \
    "$([ -n "$API_KEY_V1" ] && echo "with-auth" || echo "no-auth")" \
    "$([ -n "$API_KEY_V2" ] && echo "with-auth" || echo "no-auth")"