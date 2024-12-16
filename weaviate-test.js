import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';
import { uuidv4 } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';
import { randomIntBetween } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

// Custom metrics
const errorRate = new Rate('errors');

// Create custom metrics for timing (in milliseconds)
const createCollectionDuration = new Trend('create_collection_duration', true);
const deleteCollectionDuration = new Trend('delete_collection_duration', true);
const createTenantsDuration = new Trend('create_tenants_duration', true);
const createObjectDuration = new Trend('create_object_duration', true);
const tenantDeactivationDuration = new Trend('tenant_deactivation_duration', true);
const tenantActivationDuration = new Trend('tenant_activation_duration', true);
const tenantDeletionDuration = new Trend('tenant_deletion_duration', true);
const totalDuration = new Trend('total_duration', true);

// Create counters for operations
const tenantsCreated = new Counter('tenants_created');
const objectsCreated = new Counter('objects_created');
const tenantsDeactivated = new Counter('tenants_deactivated');
const tenantsActivated = new Counter('tenants_activated');
const tenantsDeleted = new Counter('tenants_deleted');

// Configuration
const WEAVIATE_HOST = __ENV.WEAVIATE_HOST || 'http://localhost:8080';
const WEAVIATE_API_KEY = __ENV.WEAVIATE_API_KEY && __ENV.WEAVIATE_API_KEY !== "" ? __ENV.WEAVIATE_API_KEY : null;
const AUTO_TENANT_CREATION = __ENV.AUTO_TENANT_CREATION === 'true';
const NUMBER_TENANTS = parseInt(__ENV.NUMBER_TENANTS || '2');
const MIN_THINK_TIME = parseInt(__ENV.MIN_THINK_TIME || '3'); // minimum think time in seconds
const MAX_THINK_TIME = parseInt(__ENV.MAX_THINK_TIME || '8'); // maximum think time in seconds
const DURATION = __ENV.DURATION || '30s';

export let options = {
  vus: 1,          // Default value, will be overridden by --vus
  duration: DURATION,
  thresholds: {
    errors: ['rate<0.1'],
    'create_collection_duration': ['p(95)<1000'],
    'delete_collection_duration': ['p(95)<5000'],
    'create_tenants_duration': ['p(95)<2000'],
    'create_object_duration': ['p(95)<2000'],
    'tenant_activation_duration': ['p(95)<5000'],
    'tenant_deactivation_duration': ['p(95)<5000'],
    'tenant_deletion_duration': ['p(95)<2000'],
  },
  noConnectionReuse: true,
  discardResponseBodies: true,
  setupTimeout: '1m',
  teardownTimeout: '1m',
};

// Helper function to generate a unique collection name for each VU and iteration
function getUniqueCollectionName() {
  // Using both VU ID and a UUID to ensure uniqueness even if the same VU runs multiple iterations
  return `MultiTenancyCollection_VU${__VU}_${uuidv4().split('-')[0]}`;
}

// Helper function to make authenticated requests
function makeRequest(method, path, body = null) {
  const url = `${WEAVIATE_HOST}/v1${path}`;
  const headers = {
    'Content-Type': 'application/json',
  };
  
  // Only add Authorization header if API key is not null
  if (WEAVIATE_API_KEY !== null) {
    headers['Authorization'] = `Bearer ${WEAVIATE_API_KEY}`;
  }
  
  const params = {
    headers: headers,
    tags: { name: path },
  };

  let response;
  if (method === 'GET') {
    response = http.get(url, params);
  } else if (method === 'POST') {
    response = http.post(url, JSON.stringify(body), params);
  } else if (method === 'PUT') {
    response = http.put(url, JSON.stringify(body), params);
  } else if (method === 'DELETE') {
    if (body) {
      response = http.del(url, JSON.stringify(body), params);
    } else {
      response = http.del(url, null, params);
    }
  }

  // Log detailed information for failed requests
  if (response.status !== 200) {
    console.log(`\n[${method} ${path}] Request failed:`);
    console.log(`Status: ${response.status}`);
    console.log(`Body: ${response.body}`);
    if (body) {
      console.log(`Request body: ${JSON.stringify(body, null, 2)}`);
    }
    console.log(`Headers sent: ${JSON.stringify(headers, null, 2)}`);
  }

  return response;
}

// Helper function for detailed checks
function detailedCheck(response, checkName, operation) {
  const success = check(response, {
    [checkName]: (r) => r.status === 200,
  }, { quiet: true });

  if (!success && !__ENV.K6_QUIET) {
    console.log(`\n[${operation}] Check failed:`);
    console.log(`Status: ${response.status}`);
    try {
      const responseBody = JSON.parse(response.body);
      console.log(`Error details: ${JSON.stringify(responseBody, null, 2)}`);
    } catch (e) {
      console.log(`Response body: ${response.body}`);
    }
    console.log(`Headers sent: ${JSON.stringify(response.request.headers, null, 2)}`);
  }

  return success;
}

// Generate tenant names
function generateTenantNames(count, collectionName) {
  return Array.from({ length: count }, (_, i) => `tenant${i + 1}_${collectionName}`);
}

// Main test function
export default function () {
  let startTime = new Date();
  let success = true;

  // Generate a unique collection name for this iteration
  const collectionName = getUniqueCollectionName();

  console.log(`\nStarting test iteration with:`);
  console.log(`- Host: ${WEAVIATE_HOST}`);
  console.log(`- Collection: ${collectionName}`);
  console.log(`- Auto tenant creation: ${AUTO_TENANT_CREATION}`);
  console.log(`- Number of tenants: ${NUMBER_TENANTS}`);

  // Create collection with multi-tenancy enabled
  const createCollectionStartTime = new Date();
  const createCollectionResponse = makeRequest('POST', '/schema', {
    "class": collectionName,
    "description": "A collection with multi-tenancy enabled",
    "vectorizer": "none",
    "multiTenancyConfig": {
      "enabled": true,
      "autoTenantCreation": AUTO_TENANT_CREATION
    }
  });

  success = detailedCheck(createCollectionResponse, 'collection created successfully', 'Create Collection') && success;
  
  const collectionTime = new Date() - createCollectionStartTime;
  createCollectionDuration.add(collectionTime);

  // Generate tenant names specific to this collection
  const tenantNames = generateTenantNames(NUMBER_TENANTS, collectionName);

  // Create tenants explicitly if autoTenantCreation is false
  if (!AUTO_TENANT_CREATION) {
    for (const tenantName of tenantNames) {
      const createTenantStartTime = new Date();
      const createTenantResponse = makeRequest('POST', `/schema/${collectionName}/tenants`, [
        { name: tenantName }
      ]);

      success = detailedCheck(createTenantResponse, 
        `tenant ${tenantName} created successfully`, 
        `Create Tenant ${tenantName}`
      ) && success;

      const tenantTime = new Date() - createTenantStartTime;
      createTenantsDuration.add(tenantTime);
      tenantsCreated.add(1);
    }
  }

  // Create objects for each tenant
  for (const tenantName of tenantNames) {
    const createObjectStartTime = new Date();
    const createObjectResponse = makeRequest('POST', '/objects', {
      "class": collectionName,
      "tenant": tenantName,
      "properties": {
        "name": `Object for ${tenantName}`,
        "description": `This is an object for ${tenantName}`
      }
    });

    success = detailedCheck(createObjectResponse,
      `object created for ${tenantName}`,
      `Create Object for ${tenantName}`
    ) && success;

    const objectTime = new Date() - createObjectStartTime;
    createObjectDuration.add(objectTime);
    objectsCreated.add(1);
  }

  // Deactivate tenants (HOT to COLD)
  for (const tenantName of tenantNames) {
    const deactivateStartTime = new Date();
    const deactivateResponse = makeRequest('PUT', `/schema/${collectionName}/tenants`, [
      { name: tenantName, activityStatus: "INACTIVE" }
    ]);

    success = detailedCheck(deactivateResponse,
      `tenant ${tenantName} deactivated successfully`,
      `Deactivate Tenant ${tenantName}`
    ) && success;

    const deactivateTime = new Date() - deactivateStartTime;
    tenantDeactivationDuration.add(deactivateTime);
    tenantsDeactivated.add(1);
  }

  // Think time between state changes - using random delay for more realistic behavior
  const thinkTime = randomIntBetween(MIN_THINK_TIME, MAX_THINK_TIME);
  console.log(`\nWaiting ${thinkTime} seconds before reactivating tenants...`);
  sleep(thinkTime);

  // Reactivate tenants (COLD to HOT)
  for (const tenantName of tenantNames) {
    const activateStartTime = new Date();
    const activateResponse = makeRequest('PUT', `/schema/${collectionName}/tenants`, [
      { name: tenantName, activityStatus: "ACTIVE" }
    ]);

    success = detailedCheck(activateResponse,
      `tenant ${tenantName} activated successfully`,
      `Activate Tenant ${tenantName}`
    ) && success;

    const activateTime = new Date() - activateStartTime;
    tenantActivationDuration.add(activateTime);
    tenantsActivated.add(1);
  }

  // Delete tenants
  for (const tenantName of tenantNames) {
    const deleteStartTime = new Date();
    const deleteResponse = makeRequest('DELETE', `/schema/${collectionName}/tenants`, 
      [tenantName]
    );

    success = detailedCheck(deleteResponse,
      `tenant ${tenantName} deleted successfully`,
      `Delete Tenant ${tenantName}`
    ) && success;

    const deleteTime = new Date() - deleteStartTime;
    tenantDeletionDuration.add(deleteTime);
    tenantsDeleted.add(1);
  }

  // Clean up - delete the collection after test regardless of previous operations
  const deleteCollectionStartTime = new Date();
  const deleteResponse = makeRequest('DELETE', `/schema/${collectionName}`);
  
  success = detailedCheck(deleteResponse,
    'collection deleted successfully',
    'Delete Collection'
  ) && success;

  const deleteCollectionTime = new Date() - deleteCollectionStartTime;
  deleteCollectionDuration.add(deleteCollectionTime);

  // Calculate total duration
  const totalTime = new Date() - startTime;
  totalDuration.add(totalTime);

  // Record error rate
  errorRate.add(!success);
  
  sleep(1); // Add a small delay between iterations
} 