const request = require('supertest');
const app = require('../service');

function randomName() {
	return Math.random().toString(36).substring(2,10);
}

function expectValidJwt(potentialJwt) {
	expect(potentialJwt).toMatch(/^[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*$/);
}

const testUser = { name: 'pizza diner', email: 'reg@test.com', password: 'a' };
let testUserAuthToken;

beforeAll(async () => {
	testUser.email = randomName() + '@test.com';
	const registerRes = await request(app).post('/api/auth').send(testUser);
	testUserAuthToken = registerRes.body.token;
	expectValidJwt(testUserAuthToken);
});

test('GET /api/order/menu - Get the pizza menu', async () => {
	const res = await request(app).get('/api/order/menu');
	expect(res.status).toBe(200);
	expect(Array.isArray(res.body)).toBe(true);
});

test('GET /api/order - Get the orders for the authenticated user', async () => {
	const res = await request(app).get('/api/order').set('Authorization', `Bearer ${testUserAuthToken}`);
	expect(res.status).toBe(200);
	expect(res.body).toHaveProperty('dinerId');
	expect(res.body).toHaveProperty('orders');
	expect(res.body).toHaveProperty('page');
});

test('POST /api/order - Create a order for the authenticated user', async () => {
	const orderData = { franchiseId: 1, storeId: 1, items: [{ menuId: 1, description: 'Veggie', price: 0.05 }] };
	const res = await request(app).post('/api/order').set('Authorization', `Bearer ${testUserAuthToken}`).send(orderData);
	expect(res.status).toBe(200);
	expect(res.body).toHaveProperty('order');
	expect(res.body).toHaveProperty('jwt');
	expect(res.body.order).toMatchObject(orderData);
	expectValidJwt(res.body.jwt);
});

test('POST api/order/menu - Add a new menu item', async () => {
	const newMenuItem = { menuId: 99, description: 'Test Pizza', price: 9.99 };
	const resUnauthorized = await request(app).put('/api/order/menu').send(newMenuItem);
	expect(resUnauthorized.status).toBe(401);

	const resForbidden = await request(app).put('/api/order/menu').set('Authorization', `Bearer ${testUserAuthToken}`).send(newMenuItem);
	expect(resForbidden.status).toBe(403);
});