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
            class: collection.name,
            properties,
            vector: vector || WeaviateObject.generateRandomVector()
        };

        // Add tenant to object body if we're in a multi-tenant collection
        if (collection.isMultiTenant && tenant) {
            objectData.tenant = tenant;
        }
        
        const response = await client.makeRequest('POST', '/objects', objectData);
        const success = client.detailedCheck(response, 'object created successfully', 'Create Object');
        
        durationMetrics.createObject.add(new Date() - startTime);
        return success;
    }

    // Batch object creation
    static async batchObjects(client, collection, objects) {
        const startTime = new Date();
        
        const response = await client.makeRequest('POST', '/batch/objects', {
            objects: objects.map(obj => ({
                class: collection.name,
                properties: obj.properties,
                vector: obj.vector,
                ...(obj.tenant && { tenant: obj.tenant })
            }))
        });
        
        const success = client.detailedCheck(response, 
            'batch objects created successfully', 
            'Create Objects Batch'
        );

        durationMetrics.createBatchObjects.add(new Date() - startTime);
        return success;
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

            const obj = {
                class: collection.name,
                properties,
                vector: this.generateRandomVector()
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
                const promise = this.batchObjects(client, collection, batch);
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
            const maxConcurrentTenants = 2;
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
            // Build query string with proper encoding
            const params = [
                'class=' + collection.name,
                'limit=' + count
            ];
            
            if (collection.isMultiTenant && tenant) {
                params.push('tenant=' + encodeURIComponent(typeof tenant === 'string' ? tenant : tenant.name));
            }

            const url = '/objects?' + params.join('&');
            const response = await client.makeRequest('GET', url);
            

            if (!response || response.status !== 200) {
                console.error('Failed to get objects:');
                console.error('- Status:', response?.status);
                console.error('- URL:', response?.request?.url);
                console.error('- Response body:', response?.body);
                return [];
            }

            if (!response.body) {
                console.error('Empty response body received');
                return [];
            }

            try {
                const result = JSON.parse(response.body);

                if (!result) {
                    console.error('Failed to parse response body:', response.body);
                    return [];
                }

                durationMetrics.fetchObjects.add(new Date() - startTime);
                return result.objects || [];
            } catch (parseError) {
                console.error('Failed to parse response:', {
                    error: parseError.message,
                    body: response.body
                });
                return [];
            }

        } catch (error) {
            console.error('Error getting objects:', {
                message: error.message,
                stack: error.stack,
                details: error
            });
            return [];
        }
    }

    static async deleteMany(client, collection, tenant = null, where = null) {
        const startTime = new Date();
        let success = true;
        let totalDeleted = 0;

        try {
            // Handle multi-tenancy check
            if (collection.isMultiTenant && !tenant) {
                throw new Error('Tenant is required for multi-tenant collections');
            }

            // Prepare the base request body
            const requestBody = {
                match: {
                    class: collection.name
                },
                output: 'minimal',
                dryRun: false
            };

            // Add where filter if provided
            if (where) {
                requestBody.match.where = where;
            }

            // Build URL with tenant query parameter if needed
            const params = [];
            if (collection.isMultiTenant && tenant) {
                params.push('tenant=' + encodeURIComponent(typeof tenant === 'string' ? tenant : tenant.name));
            }
            const url = '/batch/objects' + (params.length > 0 ? '?' + params.join('&') : '');

            // Make the request
            const response = await client.makeRequest('DELETE', url, requestBody);
            
            if (!response || response.status !== 200) {
                console.error('Batch deletion failed:', response);
                success = false;
            } else {
                const result = JSON.parse(response.body);
                totalDeleted = result.results.successful;

                if (result.results.failed > 0) {
                    console.warn(`Warning: ${result.results.failed} objects failed to delete`);
                    success = false;
                }
            }

        } catch (error) {
            console.error('Error in batch deletion:', error);
            success = false;
        }

        // Add metrics
        durationMetrics.deleteBatchObjects.add(new Date() - startTime);

        return {
            success,
            totalDeleted
        };
    }
} 