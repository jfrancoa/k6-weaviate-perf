import { sleep } from 'k6';
import { errorRate, durationMetrics } from '../lib/metrics.js';
import { defaultConfig } from '../config/default.js';
import { WeaviateClient } from '../lib/http.js';
import { getUniqueCollectionName, generateTenantNames, randomSleep } from '../lib/utils.js';
import { Collection } from '../lib/models/Collection.js';
import { Tenant } from '../lib/models/Tenant.js';
import { WeaviateObject } from '../lib/models/WeaviateObject.js';
import { Counter, Trend } from 'k6/metrics';
import { SharedArray } from 'k6/data';

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
    thresholds: defaultConfig.thresholds,
    noConnectionReuse: defaultConfig.test.noConnectionReuse,
    discardResponseBodies: defaultConfig.test.discardResponseBodies,
    setupTimeout: defaultConfig.test.setupTimeout,
    teardownTimeout: defaultConfig.test.teardownTimeout,
    scenarios: {
        initial_setup: {
            executor: 'shared-iterations',
            vus: defaultConfig.test.vus,
            iterations: 1,
            maxDuration: '5m',
            exec: 'initialSetup'
        },
        object_simulation: {
            executor: 'constant-vus',
            vus: defaultConfig.test.vus,
            duration: defaultConfig.timing.duration,
            startTime: '5s',
            exec: 'objectSimulation'
        }
    }
};

// Initialize the client
const client = new WeaviateClient();

export async function initialSetup() {
    console.log('\nInitial Setup:');
    console.log(`- Multi-tenancy: ${defaultConfig.tenant.enabled}`);
    console.log(`- Initial objects: ${defaultConfig.objects.count}`);
    console.log(`- Batch mode: ${defaultConfig.objects.useBatch}`);
    console.log(`- Batch size: ${defaultConfig.objects.batchSize}`);

    // Create collection instance
    const collection = new Collection(
        collectionData[0],
        defaultConfig.tenant.enabled,
        defaultConfig.tenant.autoCreation
    );
    
    // Create collection with replication config if needed
    await Collection.create(client, collection, {
        replicationConfig: defaultConfig.collection.replicationFactor > 1 ? {
            factor: defaultConfig.collection.replicationFactor,
            asyncEnabled: defaultConfig.collection.asyncReplication,
            deletionStrategy: "NoAutomatedResolution"
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
        defaultConfig.tenant.enabled ? tenantData.map(name => ({ name })) : null,
        defaultConfig.objects.count,
        defaultConfig.objects.useBatch,
        defaultConfig.objects.batchSize
    );

    objectsCreated.add(defaultConfig.objects.count);
    objectCount.add(defaultConfig.objects.count);
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
        const tenant = defaultConfig.tenant.enabled ? 
            { name: tenantData[Math.floor(Math.random() * tenantData.length)] } : 
            null;

        if (shouldAdd) {
            // Add objects
            success = await WeaviateObject.createMany(
                client,
                collection,
                tenant ? [tenant.name] : null,
                operationCount,
                defaultConfig.objects.useBatch,
                defaultConfig.objects.batchSize
            );
            
            if (success) {
                objectsCreated.add(operationCount);
                objectCount.add(operationCount);
                console.log(`Added ${operationCount} objects${tenant ? ` for tenant ${tenant.name}` : ''}`);
            }
        } else {
            // Get objects to delete
            const objectsToDelete = await WeaviateObject.getObjects(
                client,
                collection,
                tenant,
                operationCount
            );

            if (objectsToDelete.length > 0) {
                const uuids = objectsToDelete.map(obj => obj.id);
                const result = await WeaviateObject.deleteMany(
                    client,
                    collection,
                    tenant,
                    {
                        path: ['id'],
                        operator: 'ContainsAny',
                        valueTextArray: uuids
                    }
                );

                if (result.success) {
                    objectsDeleted.add(result.totalDeleted);
                    objectCount.add(-result.totalDeleted);
                    console.log(`Deleted ${result.totalDeleted} objects${tenant ? ` for tenant ${tenant.name}` : ''}`);
                }
            }
        }

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