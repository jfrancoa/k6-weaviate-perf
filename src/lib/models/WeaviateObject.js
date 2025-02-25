import { durationMetrics } from '../metrics.js';
import { defaultConfig } from '../../config/default.js';

export class WeaviateObject {
    // Generate a random vector of specified dimensions
    static generateRandomVector(dimensions = 1536) {
        return Array.from({ length: dimensions }, () => Math.random() * 2 - 1);
    }

    static async create(client, collection, tenant = null, properties = {}, vector = null) {
        const startTime = new Date();

        const objectData = {
            properties,
            vector: vector || WeaviateObject.generateRandomVector()
        };

        // Add tenant to object body if we're in a multi-tenant collection
        if (collection.isMultiTenant && tenant) {
            objectData.tenant = tenant;
        }
        
        const result = await client.objectInsert(collection.name, objectData);
        const success = !!result?.id;  // Check for existence of ID indicates success
        
        durationMetrics.createObject.add(new Date() - startTime);
        return success;
    }

    // Batch object creation (modified for gRPC)
    static async batchObjects(client, objects) {
        const startTime = new Date();
        
        const grpcObjects = objects.map(obj => ({
            class: obj.class,
            properties: obj.properties,
            vector: obj.vector,
            ...(obj.tenant && { tenant: obj.tenant })
        }));

        try {
            const createResults = await client.batchCreate(grpcObjects);
            
            // Handle array response format from Go extension
            const failedObjects = createResults.filter(r => r.status !== 'success');
            const success = failedObjects.length === 0;

            if (!success) {
                console.error('Batch create errors:', {
                    totalObjects: grpcObjects.length,
                    failedCount: failedObjects.length,
                    sampleErrors: failedObjects.slice(0, 3).map(f => ({
                        id: f.id,
                        error: f.error,
                        class: f.class
                    }))
                });
            }

            durationMetrics.createBatchObjects.add(new Date() - startTime);
            return success;
        } catch (error) {
            console.error('Batch create failed:', {
                error: error.message,
                sampleObject: grpcObjects[0]
            });
            return false;
        }
    }

    // Utility function to chunk array into batches
    static chunkArray(array, size) {
        const chunks = [];
        for (let i = 0; i < array.length; i += size) {
            chunks.push(array.slice(i, i + size));
        }
        return chunks;
    }

    // Generate objects in smaller chunks for immediate processing
    static generateObjectsBatch(startIndex, count, batchSize, collection, tenant = null) {
        const batch = [];
        const endIndex = Math.min(startIndex + batchSize, count);
        
        for (let i = startIndex; i < endIndex; i++) {
            const properties = {
                testId: `test-${i}`,
                timestamp: new Date().toISOString()
            };

            const vector = this.generateRandomVector();
            const obj = {
                class: collection.name,
                properties,
                vector: vector
            };

            if (tenant) {
                obj.tenant = tenant;
            }

            batch.push(obj);
        }
        
        return batch;
    }

    // Concurrent batch processor
    static async processBatchesConcurrently(client, collection, totalCount, batchSize, tenant = null, maxConcurrent = 3) {
        const inFlightPromises = new Set();
        let success = true;
        let processedCount = 0;

        const processNextBatch = async (batch) => {
            try {
                const promise = this.batchObjects(client, batch);
                inFlightPromises.add(promise);
                
                const result = await promise;
                inFlightPromises.delete(promise);
                processedCount += batch.length;
                
                // Log progress only for large batches (>1000 objects)
                if (totalCount > 1000 && (processedCount % (batchSize * 10) === 0 || processedCount === totalCount)) {
                    const percentage = Math.round((processedCount / totalCount) * 100);
                    console.log(`Progress: ${processedCount}/${totalCount} objects (${percentage}%)${tenant ? ` for tenant ${tenant}` : ''}`);
                }
                
                return result;
            } catch (error) {
                console.error('Error processing batch:', error);
                return false;
            }
        };

        // Process objects in chunks
        for (let i = 0; i < totalCount; i += batchSize) {
            // Generate next batch
            const batch = this.generateObjectsBatch(i, totalCount, batchSize, collection, tenant);
            
            // Wait if we have too many in-flight requests
            while (inFlightPromises.size >= maxConcurrent) {
                await Promise.race([...inFlightPromises]);
            }
            
            // Process the batch
            success = await processNextBatch(batch) && success;
        }

        // Wait for any remaining in-flight requests
        if (inFlightPromises.size > 0) {
            const remainingResults = await Promise.all([...inFlightPromises]);
            success = remainingResults.every(result => result === true) && success;
        }

        return success;
    }

    static async createMany(client, collection, tenants = null, count = 1, useBatch = false, batchSize = 100) {
        const startTime = new Date();
        if (collection.isMultiTenant && !tenants) {
            throw new Error('Tenants are required for multi-tenant collections');
        }

        let success = true;
        
        if (collection.isMultiTenant && tenants) {
            // Process each tenant with concurrent batches
            const maxConcurrentTenants = defaultConfig.objects.batchWorkers;
            for (let i = 0; i < tenants.length; i += maxConcurrentTenants) {
                const currentTenants = tenants.slice(i, i + maxConcurrentTenants);
                const tenantPromises = currentTenants.map(async tenant => {
                    if (useBatch) {
                        return await this.processBatchesConcurrently(
                            client, 
                            collection, 
                            count, 
                            batchSize, 
                            tenant,
                            defaultConfig.objects.batchWorkers
                        );
                    } else {
                        // Original non-batch mode logic
                        let objSuccess = true;
                        for (let i = 0; i < count; i++) {
                            const properties = {
                                testId: `test-${i}`,
                                timestamp: new Date().toISOString()
                            };
                            objSuccess = await this.create(
                                client,
                                collection,
                                tenant,
                                properties
                            ) && objSuccess;
                        }
                        return objSuccess;
                    }
                });
                
                const results = await Promise.all(tenantPromises);
                success = results.every(result => result === true) && success;
            }
        } else {
            // Non-multi-tenant case
            if (useBatch) {
                success = await this.processBatchesConcurrently(
                    client,
                    collection,
                    count,
                    batchSize,
                    null,
                    defaultConfig.objects.batchWorkers
                );
            } else {
                // Original non-batch mode logic
                for (let i = 0; i < count; i++) {
                    const properties = {
                        testId: `test-${i}`,
                        timestamp: new Date().toISOString()
                    };
                    success = await this.create(
                        client,
                        collection,
                        null,
                        properties
                    ) && success;
                }
            }
        }

        // Add metrics
        if (useBatch) {
            durationMetrics.createBatchObjects.add(new Date() - startTime);
        } else {
            durationMetrics.total.add(new Date() - startTime);
        }

        return success;
    }

    static async getObjects(client, collection, tenant = null, count = 100) {
        const startTime = new Date();
        
        try {
            const options = {
                // Force numeric limit through double conversion
                limit: Number.parseInt(Number(count))  
            };
            
            if (collection.isMultiTenant && tenant) {
                options.tenant = typeof tenant === 'string' ? tenant : tenant.name;
            }

            const result = await client.fetchObjects(collection.name, options);
            
            if (!result?.objects) {
                console.error('Failed to get objects:', result);
                return [];
            }

            // Verify actual returned count
            if (result.objects.length > count) {
                console.warn(`Received more objects (${result.objects.length}) than requested (${count})`);
            }

            durationMetrics.fetchObjects.add(new Date() - startTime);
            return result.objects.slice(0, count);

        } catch (error) {
            console.error('Error getting objects:', error.message);
            return [];
        }
    }

    static async deleteMany(client, collection, tenant = null, where = null) {
        const startTime = new Date();
        let success = true;
        let totalDeleted = 0;

        try {
            if (collection.isMultiTenant && !tenant) {
                throw new Error('Tenant is required for multi-tenant collections');
            }

            // Prepare options for gRPC batch delete
            const options = {
                where: where || {
                    operator: "Like",
                    path: ["id"],
                    valueString: "*"
                },
                output: "verbose",
                dryRun: false
            };

            // Add tenant to options if present
            if (collection.isMultiTenant && tenant) {
                options.tenant = typeof tenant === 'string' ? tenant : tenant.name;
            }

            // Execute gRPC batch delete
            const deleteResults = await client.batchDelete(collection.name, options);
            
            // Handle results
            totalDeleted = deleteResults.successful || 0;
            
            if (deleteResults.failed > 0) {
                console.warn(`Batch delete partial failure: 
                    ${deleteResults.successful} succeeded, 
                    ${deleteResults.failed} failed`);
                success = false;
            }

            if (deleteResults.objects) {
                deleteResults.objects.forEach(obj => {
                    if (obj.error) {
                        console.error(`Delete error for ${obj.id}: ${obj.error}`);
                    }
                });
            }

        } catch (error) {
            console.error('Error in gRPC batch deletion:', error);
            success = false;
        }

        durationMetrics.deleteBatchObjects.add(new Date() - startTime);
        return { success, totalDeleted };
    }
} 