export const defaultConfig = {
    weaviate: {
        host: __ENV.WEAVIATE_HOST || 'http://localhost:8080',
        apiKey: __ENV.WEAVIATE_API_KEY && __ENV.WEAVIATE_API_KEY !== "" ? __ENV.WEAVIATE_API_KEY : null,
        grpcHost: __ENV.WEAVIATE_GRPC_HOST || 'localhost:50051',
    },
    tenant: {
        enabled: __ENV.MULTI_TENANCY === 'true',
        autoCreation: __ENV.AUTO_TENANT_CREATION === 'false',
        count: parseInt(__ENV.NUMBER_TENANTS || '2'),
    },
    objects: {
        count: parseInt(__ENV.NUMBER_OBJECTS || '10'),
        batchSize: parseInt(__ENV.BATCH_SIZE || '1000'),
        useBatch: __ENV.USE_BATCH === 'true',
        batchWorkers: parseInt(__ENV.BATCH_WORKERS || '8'),
        vectorDimensions: 1536,
        batchTimeout: '10s'
    },
    timing: {
        minThinkTime: parseInt(__ENV.MIN_THINK_TIME || '3'),
        maxThinkTime: parseInt(__ENV.MAX_THINK_TIME || '8'),
        duration: __ENV.DURATION || '30s',
    },
    collection: {
        replicationFactor: parseInt(__ENV.REPLICATION_FACTOR || '3'),
        asyncReplication: __ENV.ASYNC_REPLICATION === 'true',
        s3OffloadEnabled: __ENV.S3_OFFLOAD === 'true',
        deleteStrategy: __ENV.DELETE_STRATEGY || 'NoAutomatedResolution',
    },
    test: {
        vus: parseInt(__ENV.VUS || '1'),
        noConnectionReuse: true,
        discardResponseBodies: true,
        setupTimeout: '1m',
        teardownTimeout: '1m',
        cloudZone: __ENV.CLOUD_ZONE || 'amazon:us:ashburn',
    },
    thresholds: {
        errors: ['rate<0.1'],
        'create_collection_duration': ['p(95)<1000'],
        'delete_collection_duration': ['p(95)<5000'],
        'create_tenants_duration': ['p(95)<2000'],
        'create_object_duration': ['p(95)<1000'],
        'create_batch_objects_duration': ['p(95)<1000'],
        'tenant_activation_duration': ['p(95)<5000'],
        'tenant_deactivation_duration': ['p(95)<5000'],
        'tenant_deletion_duration': ['p(95)<2000'],
    }
}; 