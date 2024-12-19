import { durationMetrics } from '../metrics.js';
import { createCollectionConfig } from '../utils.js';
import { Tenant } from './Tenant.js';
import { WeaviateObject } from './WeaviateObject.js';

export class Collection {
    constructor(client, name, isMultiTenant = true, autoTenantCreation = false) {
        this.client = client;
        this.name = name;
        this.isMultiTenant = isMultiTenant;
        this.autoTenantCreation = autoTenantCreation;
    }

    async create({
        description = "A collection",
        vectorizer = "none",
        replicationConfig = null
    } = {}) {
        const startTime = new Date();
        
        const formattedReplicationConfig = replicationConfig ? {
            factor: replicationConfig.factor || 1,
            asyncEnabled: replicationConfig.asyncEnabled || false,
            deletionStrategy: replicationConfig.deletionStrategy || "NoAutomatedResolution"
        } : null;

        // Only include multiTenancyConfig if this is a multi-tenant collection
        const config = createCollectionConfig({
            name: this.name,
            description,
            vectorizer,
            replicationConfig: formattedReplicationConfig,
            multiTenancyConfig: this.isMultiTenant
                ? { enabled: true, autoTenantCreation: this.autoTenantCreation }
                : { enabled: false, autoTenantCreation: false }
        });

        const response = await this.client.makeRequest('POST', '/schema', config);
        const success = this.client.detailedCheck(response, 'collection created successfully', 'Create Collection');
        
        durationMetrics.createCollection.add(new Date() - startTime);
        return success;
    }

    async delete() {
        const startTime = new Date();
        
        const response = await this.client.makeRequest('DELETE', `/schema/${this.name}`);
        const success = this.client.detailedCheck(response, 'collection deleted successfully', 'Delete Collection');
        
        durationMetrics.deleteCollection.add(new Date() - startTime);
        return success;
    }

    async backup(backupId, include = ["*"]) {
        const startTime = new Date();
        
        const config = {
            id: backupId,
            include
        };
        
        const response = await this.client.makeRequest('POST', `/backups/${this.name}`, config);
        const success = this.client.detailedCheck(response, 'backup created successfully', 'Create Backup');
        
        durationMetrics.backup.add(new Date() - startTime);
        return success;
    }

    async restore(backupId) {
        const startTime = new Date();
        
        const response = await this.client.makeRequest('POST', `/backups/${this.name}/${backupId}/restore`);
        const success = this.client.detailedCheck(response, 'restore completed successfully', 'Restore Backup');
        
        durationMetrics.restore.add(new Date() - startTime);
        return success;
    }

    // Factory method to create a Tenant instance for this collection
    tenant(name) {
        if (!this.isMultiTenant) {
            throw new Error('Cannot create tenant for non-multi-tenant collection');
        }
        return new Tenant(this.client, this, name);
    }

    // Factory method to create an Object instance for this collection
    object(tenant = null) {
        if (this.isMultiTenant && !tenant) {
            throw new Error('Tenant is required for multi-tenant collections');
        }
        return new WeaviateObject(this.client, this, tenant);
    }

    // Batch object creation
    async batchObjects(objects) {
        const startTime = new Date();
        
        const response = await this.client.makeRequest('POST', '/batch/objects', {
            objects: objects.map(obj => ({
                class: this.name,
                properties: obj.properties,
                ...(obj.tenant && { tenant: obj.tenant })
            }))
        });
        
        const success = this.client.detailedCheck(response, 
            'batch objects created successfully', 
            'Create Objects Batch'
        );

        durationMetrics.createBatchObjects.add(new Date() - startTime);
        return success;
    }
} 