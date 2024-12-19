import { durationMetrics, operationCounters } from '../metrics.js';
import { createTenantConfig } from '../utils.js';
import { WeaviateObject } from './WeaviateObject.js';

export class Tenant {
    constructor(name) {
        this.name = name;
    }

    static async create(client, collectionName, tenantName) {
        const startTime = new Date();
        
        const config = [createTenantConfig(tenantName)];
        const response = await client.makeRequest('POST', `/schema/${collectionName}/tenants`, config);
        const success = client.detailedCheck(response, 
            'tenant created successfully', 
            'Create Tenant'
        );
        
        durationMetrics.createTenants.add(new Date() - startTime);
        if (success) {
            operationCounters.tenantsCreated.add(1);
        }
        
        return success;
    }

    static async delete(client, collectionName, tenantName) {
        const startTime = new Date();
        
        const response = await client.makeRequest('DELETE', `/schema/${collectionName}/tenants`, [tenantName]);
        const success = client.detailedCheck(response,
            'tenant deleted successfully',
            'Delete Tenant'
        );
        
        durationMetrics.tenantDeletion.add(new Date() - startTime);
        if (success) {
            operationCounters.tenantsDeleted.add(1);
        }
        
        return success;
    }

    static async updateStatus(client, collectionName, tenantName, status) {
        const startTime = new Date();
        const operation = `tenant ${status.toLowerCase()}`;
        
        const config = [createTenantConfig(tenantName, status)];
        const response = await client.makeRequest('PUT', `/schema/${collectionName}/tenants`, config);
        const success = client.detailedCheck(response,
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

    static async activate(client, collectionName, tenantName) {
        return this.updateStatus(client, collectionName, tenantName, 'ACTIVE');
    }

    static async deactivate(client, collectionName, tenantName) {
        return this.updateStatus(client, collectionName, tenantName, 'INACTIVE');
    }

    static async offload(client, collectionName, tenantName) {
        return this.updateStatus(client, collectionName, tenantName, 'OFFLOADED');
    }

    static async createMany(client, collection, tenantNames) {
        const startTime = new Date();
        let success = true;

        try {
            const tenants = tenantNames.map(name => ({
                name: name,
                activityStatus: "ACTIVE"
            }));

            const response = await client.makeRequest(
                'POST',
                `/schema/${collection.name}/tenants`,
                tenants
            );

            success = client.detailedCheck(response, 'tenants created successfully', 'Create Tenants');
        } catch (error) {
            console.error('Error creating tenants:', error);
            success = false;
        }

        durationMetrics.createTenants.add(new Date() - startTime);
        return success;
    }
} 