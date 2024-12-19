import http from 'k6/http';
import { check } from 'k6';
import { defaultConfig } from '../config/default.js';

export class WeaviateClient {
    constructor(config = defaultConfig.weaviate) {
        this.baseUrl = config.host;
        this.apiKey = config.apiKey;
    }

    getHeaders() {
        const headers = {
            'Content-Type': 'application/json',
        };
        
        if (this.apiKey !== null) {
            headers['Authorization'] = `Bearer ${this.apiKey}`;
        }
        
        return headers;
    }

    makeRequest(method, path, body = null, params = {}) {
        const cleanPath = path.startsWith('/v1/') ? path.substring(3) : path;
        const url = `${this.baseUrl}/v1${cleanPath}`;
        const requestParams = {
            headers: this.getHeaders(),
            tags: { name: path },
            responseType: 'text',
            ...params
        };

        let response;
        switch (method.toUpperCase()) {
            case 'GET':
                response = http.get(url, requestParams);
                break;
            case 'POST':
                response = http.post(url, JSON.stringify(body), requestParams);
                break;
            case 'PUT':
                response = http.put(url, JSON.stringify(body), requestParams);
                break;
            case 'DELETE':
                response = body ? 
                    http.del(url, JSON.stringify(body), requestParams) :
                    http.del(url, null, requestParams);
                break;
            default:
                throw new Error(`Unsupported HTTP method: ${method}`);
        }

        if (response.status !== 200) {
            console.log(`${method} ${url} failed: ${response.status} - ${response.body}`);
        }

        return response;
    }

    logIfError(response, method, path, body = null) {
        if (response.status !== 200) {
            console.log(`\n[${method} ${path}] Request failed:`);
            console.log(`Status: ${response.status}`);
            console.log(`Body: ${response.body}`);
            if (body) {
                console.log(`Request body: ${JSON.stringify(body, null, 2)}`);
            }
            console.log(`Headers sent: ${JSON.stringify(this.getHeaders(), null, 2)}`);
        }
    }

    detailedCheck(response, checkName, operation) {
        const success = check(response, {
            [checkName]: (r) => r.status === 200,
        }, { quiet: true });

        if (!success && !__ENV.K6_QUIET) {
            console.log(`\n[${operation}] Check failed:`);
            console.log(`Status: ${response.status}`);
            try {
                const responseBody = JSON.parse(response.body);
                console.log(`Error details: ${JSON.stringify(responseBody, null, 2)}`);
            } catch (e) {
                console.log(`Response body: ${response.body}`);
            }
            console.log(`Headers sent: ${JSON.stringify(this.getHeaders(), null, 2)}`);
        }

        return success;
    }
} 