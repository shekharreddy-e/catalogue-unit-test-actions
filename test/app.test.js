// Mock @instana/collector before anything else — it instruments at require time
jest.mock('@instana/collector', () => {
    const mock = jest.fn();
    mock.currentSpan = jest.fn(() => ({ annotate: jest.fn() }));
    return mock;
});

// Mock mongodb so tests run without a real database
const mockFindResult = {
    toArray: jest.fn().mockResolvedValue([
        { sku: 'CAT-001', name: 'Robot Ninja', categories: ['apparel'] }
    ]),
    sort: jest.fn().mockReturnThis()
};

const mockCollection = {
    find:     jest.fn().mockReturnValue(mockFindResult),
    findOne:  jest.fn().mockResolvedValue({ sku: 'CAT-001', name: 'Robot Ninja' }),
    distinct: jest.fn().mockResolvedValue(['apparel', 'electronics'])
};

jest.mock('mongodb', () => ({
    MongoClient: {
        connect: jest.fn().mockResolvedValue({
            db: jest.fn().mockReturnValue({
                collection: jest.fn().mockReturnValue(mockCollection)
            })
        })
    },
    ObjectId: jest.fn()
}));

const request = require('supertest');
const app = require('../server');

beforeAll(async () => {
    // Allow the async mongoConnect() mock to resolve before tests run
    await new Promise(resolve => setTimeout(resolve, 200));
});

describe('Health Check', () => {
    test('GET /health returns 200 with app OK', async () => {
        const res = await request(app).get('/health');
        expect(res.status).toBe(200);
        expect(res.body.app).toBe('OK');
        expect(res.body).toHaveProperty('mongo');
    });
});

describe('Products', () => {
    test('GET /products returns array', async () => {
        const res = await request(app).get('/products');
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
    });

    test('GET /products/:cat returns filtered products', async () => {
        const res = await request(app).get('/products/apparel');
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
    });

    test('GET /product/:sku returns product when found', async () => {
        const res = await request(app).get('/product/CAT-001');
        expect(res.status).toBe(200);
        expect(res.body.sku).toBe('CAT-001');
    });

    test('GET /product/:sku returns 404 when not found', async () => {
        mockCollection.findOne.mockResolvedValueOnce(null);
        const res = await request(app).get('/product/INVALID-000');
        expect(res.status).toBe(404);
    });
});

describe('Categories', () => {
    test('GET /categories returns array', async () => {
        const res = await request(app).get('/categories');
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
    });
});

describe('Search', () => {
    test('GET /search/:text returns results array', async () => {
        const res = await request(app).get('/search/robot');
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
    });
});

// Load a second server instance where MongoDB never connects
// This covers the `else` (mongoConnected = false) branches in every route
describe('MongoDB disconnected', () => {
    let disconnectedApp;

    beforeAll(async () => {
        process.env.CATALOGUE_SERVER_PORT = '8081';
        jest.resetModules();

        jest.mock('@instana/collector', () => {
            const mock = jest.fn();
            mock.currentSpan = jest.fn(() => ({ annotate: jest.fn() }));
            return mock;
        });
        jest.mock('mongodb', () => ({
            MongoClient: { connect: jest.fn().mockRejectedValue(new Error('refused')) },
            ObjectId: jest.fn()
        }));

        disconnectedApp = require('../server');
        await new Promise(resolve => setTimeout(resolve, 100));
    });

    afterAll(() => {
        delete process.env.CATALOGUE_SERVER_PORT;
    });

    test.each([
        ['/products'],
        ['/product/CAT-001'],
        ['/products/apparel'],
        ['/categories'],
        ['/search/robot']
    ])('GET %s returns 500', async (route) => {
        const res = await request(disconnectedApp).get(route);
        expect(res.status).toBe(500);
    });
});

describe('DB error handling', () => {
    test.each([
        {
            name: 'GET /products returns 500 on db error',
            route: '/products',
            mockFn: () => mockFindResult.toArray.mockRejectedValueOnce(new Error('db error'))
        },
        {
            name: 'GET /product/:sku returns 500 on db error',
            route: '/product/CAT-001',
            mockFn: () => mockCollection.findOne.mockRejectedValueOnce(new Error('db error'))
        },
        {
            name: 'GET /products/:cat returns 500 on db error',
            route: '/products/apparel',
            mockFn: () => mockFindResult.toArray.mockRejectedValueOnce(new Error('db error'))
        },
        {
            name: 'GET /categories returns 500 on db error',
            route: '/categories',
            mockFn: () => mockCollection.distinct.mockRejectedValueOnce(new Error('db error'))
        },
        {
            name: 'GET /search/:text returns 500 on db error',
            route: '/search/robot',
            mockFn: () => mockFindResult.toArray.mockRejectedValueOnce(new Error('db error'))
        }
    ])('$name', async ({ route, mockFn }) => {
        mockFn();
        const res = await request(app).get(route);
        expect(res.status).toBe(500);
    });
});