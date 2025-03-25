import { sleep } from 'k6';
import { errorRate, durationMetrics } from '../lib/metrics.js';
import { defaultConfig } from '../config/default.js';
import { WeaviateClient } from '../lib/http.js';
import { getUniqueCollectionName, generateTenantNames, randomSleep } from '../lib/utils.js';
import { Collection } from '../lib/models/Collection.js';
import { Tenant } from '../lib/models/Tenant.js';
import { WeaviateObject } from '../lib/models/WeaviateObject.js';
import { Counter } from 'k6/metrics';
import { fail } from 'k6';
import weaviate from 'k6/x/weaviate';

// Create a counter to track collections
const collectionsCounter = new Counter('collections_created');

export let options = {
    vus: defaultConfig.test.vus,
    duration: defaultConfig.timing.duration,
    thresholds: defaultConfig.thresholds,
    noConnectionReuse: defaultConfig.test.noConnectionReuse,
    discardResponseBodies: defaultConfig.test.discardResponseBodies,
    setupTimeout: defaultConfig.test.setupTimeout,
    teardownTimeout: defaultConfig.test.teardownTimeout,
    cloud: {
        distribution: {
            distributionLabel: { loadZone: defaultConfig.test.cloudZone, percent: 100 }
        }
    }
};

// Initialize the client
const client = weaviate.newClient({
    host: defaultConfig.weaviate.host,
    apiKey: defaultConfig.weaviate.apiKey,
    grpcHost: defaultConfig.weaviate.grpcHost,
})

// Initialize the client
const httpClient = new WeaviateClient({host: 'http://localhost:8080', apiKey: null});

export function setup() {
    console.log('\nTest configuration:');
    console.log(`- Virtual Users: ${defaultConfig.test.vus}`);
    console.log(`- Duration: ${defaultConfig.timing.duration}`);
    console.log(`- Multi-tenancy: ${defaultConfig.tenant.enabled}`);
    console.log(`- Objects per VU: ${defaultConfig.objects.count}`);
    console.log(`- Batch mode: ${defaultConfig.objects.useBatch}`);
    console.log(`- Replication factor: ${defaultConfig.collection.replicationFactor}`);
    console.log(`- Async replication: ${defaultConfig.collection.asyncReplication}`);

    if (!defaultConfig.tenant.enabled) {
        console.log('Multi-tenancy will be enabled for this test anyway');
    }
}

export default async function () {
    const startTime = new Date();
    let success = true;
    let collectionName;
    let tenantNames;

    try {
        // Generate unique collection name
        collectionName = getUniqueCollectionName();
        collectionsCounter.add(1);
        
        console.log(`\nVU ${__VU}: Creating collection ${collectionName}`);

        // Create collection instance
        const collection = new Collection(
            collectionName,
            true,  // Multi-tenancy enabled
            defaultConfig.tenant.autoCreation
        );

        // Create collection
        console.log(`Creating collection ${collectionName}`);
        success = await Collection.create(client, collection, {
            replicationConfig: (defaultConfig.collection.replicationFactor > 1 || defaultConfig.collection.asyncReplication || defaultConfig.collection.deleteStrategy !== "NoAutomatedResolution") ? {
                factor: defaultConfig.collection.replicationFactor,
                asyncEnabled: defaultConfig.collection.asyncReplication,
                deletionStrategy: defaultConfig.collection.deleteStrategy
            } : null
        }) && success;


        // Wait for collection to be ready before proceeding
        sleep(2);

        console.log(`Collection ${collectionName} created`);
        // Verify collection exists before creating tenants
        const schemaResponse = await httpClient.makeRequest('GET', `/schema/${collectionName}`);
        if (schemaResponse.status !== 200) {
            console.log(`Waiting for collection ${collectionName} to be ready...`);
            sleep(3); // Wait a bit longer if collection is not ready
        }

        console.log(`Generating ${defaultConfig.tenant.count} tenant names`);
        // Generate tenant names
        tenantNames = generateTenantNames(defaultConfig.tenant.count, collectionName);
        
        if (!defaultConfig.tenant.autoCreation) {
            console.log(`Tenant names: ${tenantNames}`);
            success = await Tenant.createMany(client, collection, tenantNames) && success;
            if (!success) {
                console.error('Failed to create tenants');
                return;
            }
            // Add a small delay to ensure tenants are fully created
            sleep(2);
        }
        
        // Create objects only if previous steps were successful
        if (success) {
            console.log(`Creating objects for tenants: ${tenantNames}`);
            success = await WeaviateObject.createMany(
                client,
                collection,
                tenantNames,
                defaultConfig.objects.count,
                defaultConfig.objects.useBatch,
                defaultConfig.objects.batchSize
            ) && success;

            if (!success) {
                console.error('Failed to create objects');
                return;
            }
        }

        // Only proceed with tenant operations if objects were created successfully
        if (success) {
            console.log(`Deactivating tenants: ${tenantNames}`);
            // Deactivate tenants (HOT to COLD)
            for (const tenantName of tenantNames) {
                success = await Tenant.deactivate(client, collectionName, tenantName) && success;
            }
            // Random sleep between state changes
            randomSleep();

            console.log(`Reactivating tenants: ${tenantNames}`);
            // Reactivate tenants (COLD to HOT)
            for (const tenantName of tenantNames) {
                success = await Tenant.activate(client, collectionName, tenantName) && success;
            }

            // Optional: Test offloading if configured
            if (defaultConfig.collection.s3OffloadEnabled) {
                // Offload tenants
                for (const tenantName of tenantNames) {
                    success = await Tenant.offload(client, collectionName, tenantName) && success;
                }
                
                randomSleep();
                
                // Reactivate from offloaded state
                for (const tenantName of tenantNames) {
                    success = await Tenant.activate(client, collectionName, tenantName) && success;
                }
            }

            console.log(`Deleting tenants: ${tenantNames}`);
            // Delete tenants
            for (const tenantName of tenantNames) {
                success = await Tenant.delete(client, collectionName, tenantName) && success;
            }

            // Clean up - delete the collection
            console.log(`Deleting collection: ${collectionName}`);
            success = await Collection.delete(client, collection) && success;
            console.log(`Collection ${collectionName} deleted`);
        }

    } catch (error) {
        console.error('Test failed:', {
            message: error.message,
            stack: error.stack,
            collection: collectionName,
            tenants: tenantNames
        });
        success = false;
    }

    // Calculate total duration
    durationMetrics.total.add(new Date() - startTime);

    // Record error rate
    errorRate.add(!success);
    
    sleep(1); // Small delay between iterations
}

export async function teardown() {
    // Clean up all collections created during the test
    console.log('\nCleaning up collections...');
    
    try {
        // Get all collections from schema
        const response = await client.makeRequest('GET', '/schema');
        if (!response || response.status !== 200) {
            console.error('Failed to get schema:', response ? response.status : 'No response');
            console.error('Response details:', response);
            return;
        }

        let schema;
        try {
            schema = JSON.parse(response.body);
            console.log('Successfully parsed schema response');
        } catch (error) {
            console.error('Failed to parse schema response:', error);
            console.error('Response body:', response.body);
            return;
        }

        if (!schema || !schema.classes) {
            console.error('Invalid schema response format:', schema);
            console.error('Full response:', response);
            return;
        }

        // Filter collections created by this test (they start with Collection_VU)
        const testCollections = schema.classes
            .filter(c => c.class && c.class.startsWith('Collection_VU'))
            .map(c => c.class);

        console.log(`Found ${testCollections.length} collections to clean up`);

        // Delete each collection
        for (const collectionName of testCollections) {
            const collection = new Collection(collectionName, false, false);
            await Collection.delete(client, collection);
            console.log(`Deleted collection: ${collectionName}`);
        }
    } catch (error) {
        console.error('Cleanup failed:', error);
        if (error.response) {
            console.error('Response details:', {
                status: error.response.status,
                body: error.response.body,
                headers: error.response.headers
            });
        }
    }

    console.log('Cleanup completed');
} 