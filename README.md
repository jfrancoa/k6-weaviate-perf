# Weaviate Performance Tests

Performance testing framework for Weaviate multi-tenancy and RBAC features.

## Prerequisites

- k6 (https://k6.io/docs/get-started/installation/)
- Python 3.x
- Go (optional, for profiling)
- A running Weaviate instance or access to weaviate-local-k8s

## Test Script Overview (weaviate-test.js)

The main test script performs a sequence of multi-tenancy operations:

1. Creates a collection with multi-tenancy enabled
2. Creates specified number of tenants (if auto-creation disabled)
3. Creates test objects for each tenant
4. Deactivates all tenants (HOT to COLD)
5. Waits for a configurable think time
6. Reactivates all tenants (COLD to HOT)
7. Deletes all tenants
8. Cleans up by deleting the collection

### Configuration Options

```bash
# Run with default settings
k6 run weaviate-test.js

# Run with custom parameters
k6 run \
  -e WEAVIATE_HOST=http://localhost:8080 \
  -e WEAVIATE_API_KEY=your-api-key \
  -e NUMBER_TENANTS=100 \
  -e AUTO_TENANT_CREATION=true \
  -e MIN_THINK_TIME=3 \
  -e MAX_THINK_TIME=8 \
  -e DURATION=30s \
  weaviate-test.js
```

Environment variables:
- `WEAVIATE_HOST`: Weaviate instance URL (default: http://localhost:8080)
- `WEAVIATE_API_KEY`: API key for authentication (optional)
- `AUTO_TENANT_CREATION`: Enable/disable automatic tenant creation (default: true)
- `NUMBER_TENANTS`: Number of tenants to test with (default: 2)
- `MIN_THINK_TIME`: Minimum wait time between state changes in seconds (default: 3)
- `MAX_THINK_TIME`: Maximum wait time between state changes in seconds (default: 8)
- `DURATION`: Test duration (default: 30s)

### Metrics Collected

The test captures detailed performance metrics:

**Timing Metrics (in milliseconds)**
- Collection creation/deletion duration
- Tenant creation duration
- Object creation duration
- Tenant activation/deactivation duration
- Tenant deletion duration
- Total operation duration

**Operation Counters**
- Number of tenants created
- Number of objects created
- Number of tenant activations/deactivations
- Number of tenant deletions

**Error Rates**
- Overall operation success/failure rate

## Automation Scripts

### compare_versions.sh
Automates testing between two Weaviate versions:

```bash
WEAVIATE_VERSION_1=1.27.6 \
WEAVIATE_VERSION_2=1.28.0 \
RBAC_V1=false \
RBAC_V2=true \
API_KEY_V1="" \
API_KEY_V2="admin-key" \
./compare_versions.sh
```

Key environment variables:
- `WEAVIATE_VERSION_1`, `WEAVIATE_VERSION_2`: Versions to compare
- `RBAC_V1`, `RBAC_V2`: Enable/disable RBAC
- `API_KEY_V1`, `API_KEY_V2`: API keys for authentication
- `K6_ARGS`: Additional k6 test parameters
- `REPLICAS`: Number of Weaviate replicas
- `PROFILING`: Enable Go profiling (true/false)

### create_roles.py
Sets up RBAC roles for testing:

```bash
# Setup roles
./create_roles.sh

# With custom parameters
WEAVIATE_HOST=http://localhost:8080 \
ADMIN_KEY=your-admin-key \
USERNAME=custom-user \
./create_roles.sh
```

### compare_metrics.py
Analyzes and compares test results between versions:

```bash
python3 compare_metrics.py v1.27.6 v1.28.0 false true no-auth with-auth
```

## Results

Test results are stored in k6_results/ directory:
- JSON metrics data
- Profiling data (if enabled)
- Comparison reports

## Performance Thresholds

The test enforces the following performance thresholds:
- Error rate < 10%
- Collection creation p95 < 1000ms
- Collection deletion p95 < 5000ms
- Tenant creation p95 < 2000ms
- Object creation p95 < 2000ms
- Tenant activation p95 < 5000ms
- Tenant deactivation p95 < 5000ms
- Tenant deletion p95 < 2000ms
