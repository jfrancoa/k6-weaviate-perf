import { sleep } from 'k6';
import { errorRate, durationMetrics } from '../lib/metrics.js';
import { defaultConfig } from '../config/default.js';
import { WeaviateClient } from '../lib/http.js';
import { getUniqueCollectionName, generateTenantNames, randomSleep } from '../lib/utils.js';
import { Collection } from '../lib/models/Collection.js';
import { Tenant } from '../lib/models/Tenant.js';
import { WeaviateObject } from '../lib/models/WeaviateObject.js';
import { Counter } from 'k6/metrics';

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
const client = new WeaviateClient();

export function setup() {
    console.log('\nTest configuration:');
    console.log(`- Virtual Users: ${defaultConfig.test.vus}`);
    console.log(`- Duration: ${defaultConfig.timing.duration}`);
    console.log(`- Multi-tenancy: ${defaultConfig.tenant.enabled}`);
    console.log(`- Objects per VU: ${defaultConfig.objects.count}`);
    console.log(`- Batch mode: ${defaultConfig.objects.useBatch}`);
    console.log(`- Replication factor: ${defaultConfig.collection.replicationFactor}`);
    console.log(`- Async replication: ${defaultConfig.collection.asyncReplication}`);
}

export default async function () {
    let startTime = new Date();
    let success = true;

    try {
        // Generate unique collection name for this VU
        const collectionName = getUniqueCollectionName();
        collectionsCounter.add(1);
        
        console.log(`\nVU ${__VU}: Creating collection ${collectionName}`);

        // Create collection instance
        const collection = new Collection(
            collectionName,
            true,  // Multi-tenancy enabled
            defaultConfig.tenant.autoCreation
        );

        // Create collection
        success = await Collection.create(client, collection, {
            replicationConfig: defaultConfig.collection.replicationFactor > 1 ? {
                factor: defaultConfig.collection.replicationFactor,
                asyncEnabled: defaultConfig.collection.asyncReplication,
                deletionStrategy: "NoAutomatedResolution"
            } : null
        }) && success;

        // Wait for collection to be ready before proceeding
        sleep(2);

        // Verify collection exists before creating tenants
        const schemaResponse = await client.makeRequest('GET', `/schema/${collectionName}`);
        if (schemaResponse.status !== 200) {
            console.log(`Waiting for collection ${collectionName} to be ready...`);
            sleep(3); // Wait a bit longer if collection is not ready
        }

        // Generate tenant names
        const tenantNames = generateTenantNames(defaultConfig.tenant.count, collectionName);
        
        if (!defaultConfig.tenant.autoCreation) {
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
            // Deactivate tenants (HOT to COLD)
            for (const tenantName of tenantNames) {
                success = await Tenant.deactivate(client, collectionName, tenantName) && success;
            }

            // Random sleep between state changes
            randomSleep();

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

            // Delete tenants
            for (const tenantName of tenantNames) {
                success = await Tenant.delete(client, collectionName, tenantName) && success;
            }

            // Clean up - delete the collection
            success = await Collection.delete(client, collection) && success;
        }

    } catch (error) {
        console.error('Test failed:', error);
        success = false;
    }

    // Calculate total duration
    durationMetrics.total.add(new Date() - startTime);

    // Record error rate
    errorRate.add(!success);
    
    sleep(1); // Small delay between iterations
} 