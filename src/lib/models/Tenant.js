import { durationMetrics, operationCounters } from '../metrics.js';
import { createTenantConfig } from '../utils.js';
import { WeaviateObject } from './WeaviateObject.js';

export class Tenant {
    constructor(client, collection, name) {
        this.client = client;
        this.collection = collection;
        this.name = name;
    }

    async create() {
        const startTime = new Date();
        
        const config = [createTenantConfig(this.name)];
        const response = await this.client.makeRequest('POST', `/schema/${this.collection.name}/tenants`, config);
        const success = this.client.detailedCheck(response, 
            'tenant created successfully', 
            'Create Tenant'
        );
        
        durationMetrics.createTenants.add(new Date() - startTime);
        if (success) {
            operationCounters.tenantsCreated.add(1);
        }
        
        return success;
    }

    async delete() {
        const startTime = new Date();
        
        const response = await this.client.makeRequest('DELETE', `/schema/${this.collection.name}/tenants`, [this.name]);
        const success = this.client.detailedCheck(response,
            'tenant deleted successfully',
            'Delete Tenant'
        );
        
        durationMetrics.tenantDeletion.add(new Date() - startTime);
        if (success) {
            operationCounters.tenantsDeleted.add(1);
        }
        
        return success;
    }

    async updateStatus(status) {
        const startTime = new Date();
        const operation = `tenant ${status.toLowerCase()}`;
        
        const config = [createTenantConfig(this.name, status)];
        const response = await this.client.makeRequest('PUT', `/schema/${this.collection.name}/tenants`, config);
        const success = this.client.detailedCheck(response,
            `tenant ${status.toLowerCase()}d successfully`,
            `${status} Tenant`
        );
        
        // Update metrics based on status
        switch(status) {
            case 'ACTIVE':
                durationMetrics.tenantActivation.add(new Date() - startTime);
                if (success) operationCounters.tenantsActivated.add(1);
                break;
            case 'INACTIVE':
                durationMetrics.tenantDeactivation.add(new Date() - startTime);
                if (success) operationCounters.tenantsDeactivated.add(1);
                break;
            case 'OFFLOADED':
                durationMetrics.tenantOffload.add(new Date() - startTime);
                if (success) operationCounters.tenantsOffloaded.add(1);
                break;
        }
        
        return success;
    }

    async activate() {
        return this.updateStatus('ACTIVE');
    }

    async deactivate() {
        return this.updateStatus('INACTIVE');
    }

    async offload() {
        return this.updateStatus('OFFLOADED');
    }

    // Factory method to create an Object instance for this tenant
    object(properties = {}) {
        return new WeaviateObject(this.client, this.collection, this, properties);
    }

    // Static method to handle multiple tenants
    static async createMany(client, collection, tenantNames) {
        const startTime = new Date();
        
        const tenantConfigs = tenantNames.map(name => createTenantConfig(name));
        const response = await client.makeRequest('POST', `/schema/${collection.name}/tenants`, tenantConfigs);
        const success = client.detailedCheck(response, 
            'tenants created successfully', 
            'Create Tenants'
        );
        
        durationMetrics.createTenants.add(new Date() - startTime);
        if (success) {
            operationCounters.tenantsCreated.add(tenantNames.length);
        }
        
        return success;
    }
} 