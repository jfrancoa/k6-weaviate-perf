import { sleep } from 'k6';
import { errorRate, durationMetrics, durationToSeconds } from '../lib/metrics.js';
import { defaultConfig } from '../config/default.js';
import { WeaviateClient } from '../lib/http.js';
import { getUniqueCollectionName, generateTenantNames, calculateTimeToIngest } from '../lib/utils.js';
import { Collection } from '../lib/models/Collection.js';
import { Tenant } from '../lib/models/Tenant.js';
import { WeaviateObject } from '../lib/models/WeaviateObject.js';
import { Counter, Trend } from 'k6/metrics';
import { SharedArray } from 'k6/data';
import weaviate from 'k6/x/weaviate';

// Custom metrics
const objectsCreated = new Counter('objects_created');
const objectsDeleted = new Counter('objects_deleted');
const objectCount = new Trend('object_count');

// Shared immutable data
const collectionData = new SharedArray('collectionName', function() {
    return [getUniqueCollectionName()];
});

const tenantData = new SharedArray('tenants', function() {
    return defaultConfig.tenant.enabled ? generateTenantNames(defaultConfig.tenant.count, collectionData[0]) : [];
});



export let options = {
    vus: defaultConfig.test.vus,
    thresholds: defaultConfig.thresholds,
    noConnectionReuse: defaultConfig.test.noConnectionReuse,
    discardResponseBodies: defaultConfig.test.discardResponseBodies,
    setupTimeout: defaultConfig.test.setupTimeout,
    teardownTimeout: defaultConfig.test.teardownTimeout,
    scenarios: {
        initial_setup: {
            executor: 'per-vu-iterations',
            vus: 1,
            iterations: 1,
            maxDuration: calculateTimeToIngest(),
            exec: 'initialSetup'
        },
        object_simulation: {
            executor: 'constant-vus',
            vus: defaultConfig.test.vus,
            startTime: calculateTimeToIngest(), // Dynamic start
            duration: defaultConfig.timing.duration,
            exec: 'objectSimulation',
            gracefulStop: '30s'
        }
    }
};

// Initialize the client
const client = weaviate.newClient({
    host: defaultConfig.weaviate.host,
    apiKey: defaultConfig.weaviate.apiKey,
    grpcHost: defaultConfig.weaviate.grpcHost,
})

export async function initialSetup() {
    console.log('\nInitial Setup:');
    console.log(`- Multi-tenancy: ${defaultConfig.tenant.enabled}`);
    if (defaultConfig.tenant.enabled) {
        console.log(`- Tenant count: ${defaultConfig.tenant.count}`);
    }
    console.log(`- Initial objects: ${defaultConfig.objects.count}`);
    if (defaultConfig.objects.useBatch) {
        console.log(`- Batch mode: ${defaultConfig.objects.useBatch}`);
        console.log(`- Batch size: ${defaultConfig.objects.batchSize}`);
    }
    console.log(`- Replication factor: ${defaultConfig.collection.replicationFactor}`);
    console.log(`- Async replication: ${defaultConfig.collection.asyncReplication}`);

    // Create collection instance
    const collection = new Collection(
        collectionData[0],
        defaultConfig.tenant.enabled,
        defaultConfig.tenant.autoCreation
    );
    
    // Create collection with replication config if needed
    await Collection.create(client, collection, {
        replicationConfig: (defaultConfig.collection.replicationFactor > 1 || defaultConfig.collection.asyncReplication || defaultConfig.collection.deleteStrategy !== "NoAutomatedResolution") ? {
            factor: defaultConfig.collection.replicationFactor,
            asyncEnabled: defaultConfig.collection.asyncReplication,
            deletionStrategy: defaultConfig.collection.deleteStrategy
        } : null
    });

    // Setup tenants if needed
    if (defaultConfig.tenant.enabled && !defaultConfig.tenant.autoCreation) {
        await Tenant.createMany(client, collection, tenantData);
    }

    // Create initial objects
    await WeaviateObject.createMany(
        client,
        collection,
        defaultConfig.tenant.enabled ? tenantData : null,
        defaultConfig.objects.count,
        defaultConfig.objects.useBatch,
        defaultConfig.objects.batchSize
    );

    objectsCreated.add(defaultConfig.objects.count);
    objectCount.add(defaultConfig.objects.count);
    
    // After successful object creation
    console.log('Initial setup completed successfully');
}

export async function objectSimulation() {
    const startTime = new Date();
    let success = true;

    try {
        // Create collection instance using shared collection name
        const collection = new Collection(
            collectionData[0],
            defaultConfig.tenant.enabled,
            defaultConfig.tenant.autoCreation
        );

        // Randomly decide to add or delete objects
        const shouldAdd = Math.random() < 0.5;
        const operationCount = Math.floor(Math.random() * 1000) + 1;

        // Select a random tenant if multi-tenancy is enabled
        const tenantName = defaultConfig.tenant.enabled ? 
            tenantData[Math.floor(Math.random() * tenantData.length)] : 
            null;

        if (shouldAdd) {
            // Add objects
            success = await WeaviateObject.createMany(
                client,
                collection,
                tenantName ? [tenantName] : null,
                operationCount,
                defaultConfig.objects.useBatch,
                defaultConfig.objects.batchSize
            );
            
            if (success) {
                objectsCreated.add(operationCount);
                objectCount.add(operationCount);
                console.log(`Added ${operationCount} objects${tenantName ? ` for tenant ${tenantName}` : ''}`);
            }
        } else {
            // Delete objects
            const objectsToDelete = await WeaviateObject.getObjects(
                client,
                collection,
                tenantName,
                operationCount
            );
            if (objectsToDelete.length > 0) {
                const result = await WeaviateObject.deleteMany(
                    client,
                    collection,
                    tenantName,
                    {
                        path: ['id'],
                        operator: 'ContainsAny',
                        valueText: objectsToDelete.map(obj => obj.id || obj._id)
                    }
                );

                if (result.success) {
                    objectsDeleted.add(result.totalDeleted);
                    objectCount.add(-result.totalDeleted);
                    console.log(`Deleted ${result.totalDeleted} objects${tenantName ? ` for tenant ${tenantName}` : ''}`);
                }
            }
        }

        // Add random sleep between operations
        sleep(Math.floor(Math.random() * 5) + 3);

    } catch (error) {
        console.error('Simulation error:', {
            message: error.message,
            stack: error.stack,
            details: error
        });
        success = false;
    }

    // Record error rate
    errorRate.add(!success);
    
    // Add duration metric
    durationMetrics.total.add(new Date() - startTime);
}

export async function teardown() {
    // Clean up - delete the collection
    const collection = new Collection(
        collectionData[0],
        defaultConfig.tenant.enabled,
        defaultConfig.tenant.autoCreation
    );
    await Collection.delete(client, collection);
} 