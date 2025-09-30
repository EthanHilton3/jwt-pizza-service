const request = require('supertest');
const app = require('../service');
const franchiseRouter = require('./franchiseRouter');
const { DB,Role } = require('../database/database');

function randomName() {
	return Math.random().toString(36).substring(2,10);
}

async function createAdminUser() {
	let user = { password: 'toomanysecrets',roles: [{ role: Role.Admin }] };
	user.name = randomName();
	user.email = user.name + '@admin.com';

	user = await DB.addUser(user);
	return { ...user,password: 'toomanysecrets' };
}

function expectValidJwt(potentialJwt) {
	expect(potentialJwt).toMatch(/^[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*$/);
}

const testUser = { name: 'pizza diner',email: 'reg@test.com',password: 'a' };
let testUserAuthToken;
let adminUser;
let adminUserAuthToken;
let adminID;
let adminEmail;

beforeAll(async () => {
	testUser.email = randomName() + '@test.com';
	const registerRes = await request(app).post('/api/auth').send(testUser);
	testUserAuthToken = registerRes.body.token;
	expectValidJwt(testUserAuthToken);

	adminUser = await createAdminUser();
	const adminRes = await request(app).put('/api/auth').send({ email: adminUser.email,password: adminUser.password });
	adminUserAuthToken = adminRes.body.token;
	adminID = adminUser.id;
	adminEmail = adminUser.email;
	expectValidJwt(adminUserAuthToken);
});

test('GET /api/franchise - List all franchises',async () => {
	const res = await request(app).get('/api/franchise').set('Authorization',`Bearer ${testUserAuthToken}`);
	expect(res.status).toBe(200);
	expect(res.body).toHaveProperty('franchises');
	expect(res.body).toHaveProperty('more');
});

test('GET /api/franchise/:userId - List user franchises',async () => {
	const res = await request(app)
		.get(`/api/franchise/${adminID}`)
		.set('Authorization',`Bearer ${adminUserAuthToken}`);
	expect(res.status).toBe(200);
	expect(Array.isArray(res.body)).toBe(true);
});

test('POST /api/franchise - Create a new franchise',async () => {
	const franchiseData = {
		name: randomName(),
		admins: [{ email: adminEmail }]
	};
	const goodRes = await request(app)
		.post('/api/franchise')
		.set('Authorization',`Bearer ${adminUserAuthToken}`)
		.send(franchiseData);
	expect(goodRes.status).toBe(200);
	expect(goodRes.body).toHaveProperty('id');
	expect(goodRes.body.name).toBe(franchiseData.name);

	const badRes = await request(app)
		.post('/api/franchise')
		.set('Authorization',`Bearer ${testUserAuthToken}`)
		.send(franchiseData);
	expect(badRes.status).toBe(403);
	expect(badRes.body).toMatchObject({ message: 'unable to create a franchise' });
});

test('DELETE /api/franchise/:franchiseId - Delete a franchise',async () => {
	const franchiseName = randomName();
	const franchise = await DB.createFranchise({ name: franchiseName, admins: [{ email: adminEmail }] });
	const res = await request(app)
		.delete(`/api/franchise/${franchise.id}`)
		.set('Authorization',`Bearer ${adminUserAuthToken}`);
	expect(res.status).toBe(200);
	expect(res.body.message).toBe('franchise deleted');
});

test('POST /api/franchise/:franchiseId/store - Create a new store',async () => {
	const franchiseName = randomName();
	const franchise = await DB.createFranchise({ name: franchiseName, admins: [{ email: adminEmail }] });
	const storeData = { name: 'SLC' };
	const res = await request(app)
		.post(`/api/franchise/${franchise.id}/store`)
		.set('Authorization',`Bearer ${adminUserAuthToken}`)
		.send(storeData);
	expect(res.status).toBe(200);
	expect(res.body).toHaveProperty('id');
	expect(res.body.name).toBe(storeData.name);
});

test('DELETE /api/franchise/:franchiseId/store/:storeId - Delete a store', async () => {
	const franchiseName = randomName();
	const franchise = await DB.createFranchise({ name: franchiseName, admins: [{ email: adminEmail }] });
	const store = await DB.createStore(franchise.id,{ name: 'SLC' });
	const res = await request(app)
		.delete(`/api/franchise/${franchise.id}/store/${store.id}`)
		.set('Authorization',`Bearer ${adminUserAuthToken}`);
	expect(res.status).toBe(200);
	expect(res.body.message).toBe('store deleted');
});
